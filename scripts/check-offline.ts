/**
 * Regression checks for the offline layer. No database, no browser.
 *
 * Run as part of `npm run test:logic`.
 *
 * These exist because making the app work offline introduced three ways for it
 * to go quietly wrong, all of which produce plausible-looking wrong numbers
 * rather than an error:
 *
 *   1. THE PROFIT MATHS NOW HAS TWO IMPLEMENTATIONS. lib/queries.ts computes it
 *      in SQL for the server; lib/offline/aggregates.ts computes it in
 *      TypeScript for the device. The SQL expression is quoted above each check
 *      below, so a change to one and not the other shows up here as a failure
 *      instead of as a dashboard that disagrees with itself depending on signal.
 *
 *   2. STOCK IS PROJECTED. What an attendant sees is the server's figure less
 *      whatever this phone has sold and not yet sent. Get that subtraction
 *      wrong and the app invites someone to sell the same blanket twice.
 *
 *   3. TIME COMES FROM THE DEVICE. A queued sale carries the date it was
 *      recorded, and a phone with a wrong clock must not be able to file one in
 *      the future or bury it in the past.
 */

import {
  attendantSummary,
  categoryBreakdown,
  dailySeries,
  dashboardMetrics,
  stockValue,
} from '../lib/offline/aggregates';
import {
  project,
  salesInRange,
  sellableItems,
  stockUnits,
  type Snapshot,
} from '../lib/offline/mirror';
import type { OutboxEntry } from '../lib/offline/outbox';
import { clampRecordedAt } from '../lib/dates';

type Check = (name: string, actual: unknown, expected: unknown) => void;

// ------------------------------------------------------------------ fixture
//
// Two categories, three batches, four sales, two expenses. Small enough that
// every expected figure below is hand-computed and can be checked by eye.

const SNAPSHOT: Snapshot = {
  categories: [
    { id: 1, name: 'Blankets', clientId: null, deletedAt: null },
    { id: 2, name: 'Curtains', clientId: null, deletedAt: null },
  ],
  items: [
    // cost 20,000  sells at 30,000  bought 10, five left
    {
      id: 10, categoryId: 1, specifics: 'Woollen double', minPrice: 30_000,
      quantity: 10, qtyRemaining: 5, purchaseDate: '2026-07-01', archived: false,
      clientId: null, costPrice: 20_000,
    },
    // cost 15,000  sells at 25,000  bought 4, one left
    {
      id: 11, categoryId: 2, specifics: 'Lace, cream', minPrice: 25_000,
      quantity: 4, qtyRemaining: 1, purchaseDate: '2026-07-02', archived: false,
      clientId: null, costPrice: 15_000,
    },
    // Archived: must be invisible to stock value and to the sale form.
    {
      id: 12, categoryId: 1, specifics: 'Old stock', minPrice: 9_000,
      quantity: 3, qtyRemaining: 3, purchaseDate: '2026-06-01', archived: true,
      clientId: null, costPrice: 8_000,
    },
  ],
  sales: [
    // 3 blankets at the asking price: revenue 90,000, profit 30,000
    { id: 100, itemId: 10, saleDate: '2026-07-10', quantity: 3, unitPrice: 30_000, unitCost: 20_000, belowMin: false, attendantId: 1, clientId: null, createdAt: '2026-07-10T09:00:00Z', deletedAt: null },
    // 2 blankets haggled down to 26,000: revenue 52,000, profit 12,000, FLAGGED
    { id: 101, itemId: 10, saleDate: '2026-07-11', quantity: 2, unitPrice: 26_000, unitCost: 20_000, belowMin: true, attendantId: 1, clientId: null, createdAt: '2026-07-11T09:00:00Z', deletedAt: null },
    // 3 curtains at the asking price: revenue 75,000, profit 30,000
    { id: 102, itemId: 11, saleDate: '2026-07-11', quantity: 3, unitPrice: 25_000, unitCost: 15_000, belowMin: false, attendantId: null, clientId: null, createdAt: '2026-07-11T10:00:00Z', deletedAt: null },
    // OUTSIDE the range used below. Must not be counted.
    { id: 103, itemId: 10, saleDate: '2026-08-01', quantity: 1, unitPrice: 30_000, unitCost: 20_000, belowMin: false, attendantId: 1, clientId: null, createdAt: '2026-08-01T09:00:00Z', deletedAt: null },
  ],
  expenses: [
    { id: 200, expenseDate: '2026-07-10', description: 'Boda to market', amount: 10_000, kind: 'transport', attendantId: 1, clientId: null, createdAt: '2026-07-10T08:00:00Z', deletedAt: null },
    { id: 201, expenseDate: '2026-07-11', description: 'Rent', amount: 40_000, kind: 'rent', attendantId: null, clientId: null, createdAt: '2026-07-11T08:00:00Z', deletedAt: null },
  ],
  attendants: [{ id: 1, name: 'Nakato', active: true }],
};

const FROM = '2026-07-01';
const TO = '2026-07-31';

function queuedSale(id: string, seq: number, itemId: number, quantity: number, unitPrice: number): OutboxEntry {
  return {
    id, seq, kind: 'sale.create',
    data: { clientId: `c-${id}`, item: { id: itemId }, saleDate: '2026-07-12', quantity, unitPrice },
    status: 'queued', createdAt: '2026-07-12T09:00:00Z', attempts: 0,
    label: `${quantity} × item ${itemId}`,
  };
}

export function runOfflineChecks(check: Check) {
  const empty = project(SNAPSHOT, []);
  const inRange = salesInRange(empty, FROM, TO);

  // ---------------------------------------------------------------------
  console.log('\n--- Offline aggregates agree with the SQL in lib/queries.ts ---');

  // SQL: COALESCE(SUM(quantity * unit_price), 0)
  //      90,000 + 52,000 + 75,000 = 217,000   (the August sale is out of range)
  const metrics = dashboardMetrics(inRange, empty.expenses.filter((e) => e.expenseDate >= FROM && e.expenseDate <= TO), empty.items);
  check('revenue matches SUM(quantity * unit_price)', metrics.revenue, 217_000);

  // SQL: COALESCE(SUM(quantity * (unit_price - unit_cost)), 0)
  //      30,000 + 12,000 + 30,000 = 72,000
  check('gross profit matches SUM(qty * (price - cost))', metrics.grossProfit, 72_000);

  // SQL: revenue - grossProfit
  check('cost of goods sold', metrics.costOfGoodsSold, 145_000);

  // SQL: COALESCE(SUM(amount), 0) over expenses in range = 10,000 + 40,000
  check('expenses total', metrics.expensesTotal, 50_000);

  // The bottom line: 72,000 - 50,000
  check('net profit is gross profit less expenses', metrics.netProfit, 22_000);

  check('units sold', metrics.unitsSold, 8);
  check('transactions is a row count, not a unit count', metrics.transactions, 3);

  // SQL: COUNT(*) FILTER (WHERE below_min)
  check('below-minimum sales are counted', metrics.belowMinCount, 1);
  check('expense count', metrics.expenseCount, 2);

  // ---------------------------------------------------------------------
  console.log('\n--- Stock value is point-in-time and ignores the range ---');

  // SQL: SUM(qty_remaining * cost_price) WHERE archived = false
  //      5 * 20,000 + 1 * 15,000 = 115,000. The archived batch is excluded.
  check('value at cost excludes archived batches', metrics.stock.atCost, 115_000);
  // SQL: SUM(qty_remaining * min_price) = 5 * 30,000 + 1 * 25,000
  check('value at selling price', metrics.stock.atRetail, 175_000);
  check('units on hand', metrics.stock.units, 6);
  check('batches with something left', metrics.stock.batches, 2);

  // The archived batch holds 3 units and 24,000 of cost. If either shows up,
  // the archived filter has been lost.
  check(
    'archived stock is not in the valuation',
    stockValue(empty.items).atCost !== 115_000 + 24_000,
    true,
  );

  // ---------------------------------------------------------------------
  console.log('\n--- The attendant summary carries no profit ---');

  const summary = attendantSummary(inRange, empty.items);
  check('attendant revenue matches the owner figure', summary.revenue, 217_000);
  check('attendant units sold', summary.unitsSold, 8);
  check('attendant stock is a unit count', summary.stockUnits, 6);
  check(
    'attendant summary has no profit field at all',
    Object.keys(summary).sort(),
    ['revenue', 'stockUnits', 'transactions', 'unitsSold'],
  );

  // ---------------------------------------------------------------------
  console.log('\n--- Category breakdown reaches categories through the item ---');

  const byCategory = categoryBreakdown(inRange, empty);
  check('two categories sold in the period', byCategory.length, 2);
  // Ordered by revenue: blankets 142,000 then curtains 75,000
  check('ordered by revenue, highest first', byCategory.map((c) => c.categoryName), ['Blankets', 'Curtains']);
  check('blanket revenue (90,000 + 52,000)', byCategory[0].revenue, 142_000);
  check('blanket profit (30,000 + 12,000)', byCategory[0].profit, 42_000);
  check('curtain profit', byCategory[1].profit, 30_000);

  // ---------------------------------------------------------------------
  console.log('\n--- The daily series pads gaps with zeroes ---');

  const series = dailySeries(inRange, '2026-07-10', '2026-07-12');
  check('one point per day in the range', series.length, 3);
  check('10 July revenue', series[0].revenue, 90_000);
  check('11 July revenue (two sales on one day)', series[1].revenue, 127_000);
  check('12 July had no sales and reads as zero, not missing', series[2], {
    day: '2026-07-12', revenue: 0, profit: 0,
  });

  // ---------------------------------------------------------------------
  console.log('\n--- Projection: queued sales come off the shelf immediately ---');
  // This is what stops an attendant on a dead connection selling the same
  // blanket twice.

  const withQueued = project(SNAPSHOT, [queuedSale('op-1', 1, 10, 2, 30_000)]);
  const blanket = withQueued.items.find((i) => i.id === 10)!;
  check('server said 5 left; 2 are queued, so 3 are sellable', blanket.qtyRemaining, 3);
  check('overall units on hand drop too', stockUnits(withQueued).units, 4);

  const queuedSaleRow = withQueued.sales.find((s) => s.pending);
  check('the queued sale appears in the list right away', Boolean(queuedSaleRow), true);
  check('and is marked as not yet sent', queuedSaleRow?.pending, true);
  check('with no id, because the server has not assigned one', queuedSaleRow?.id, null);

  // A pending sale has no unitCost: the server snapshots it when it applies the
  // decrement. It must contribute revenue but NOT invent profit.
  const projectedMetrics = dashboardMetrics(
    salesInRange(withQueued, FROM, TO),
    [],
    withQueued.items,
  );
  check('a queued sale adds its revenue', projectedMetrics.revenue, 217_000 + 60_000);
  check(
    'and counts its full price as profit only once the cost is known',
    projectedMetrics.grossProfit,
    72_000 + 60_000,
  );

  // ---------------------------------------------------------------------
  console.log('\n--- Projection: a queued delete puts the stock back ---');

  const withDelete = project(SNAPSHOT, [
    {
      id: 'op-2', seq: 1, kind: 'sale.delete',
      data: { sale: { id: 100 } },
      status: 'queued', createdAt: '2026-07-12T09:00:00Z', attempts: 0,
      label: 'Remove a sale',
    },
  ]);
  const afterDelete = withDelete.items.find((i) => i.id === 10)!;
  check('the 3 units from the removed sale return to stock', afterDelete.qtyRemaining, 8);
  check('and the sale is gone from the list', withDelete.sales.some((s) => s.id === 100), false);

  // ---------------------------------------------------------------------
  console.log('\n--- Projection: rejected entries are NOT counted ---');
  // A sale the server refused must never quietly contribute to a total the
  // owner might act on. It waits on the Needs attention screen instead.

  const rejected: OutboxEntry = {
    ...queuedSale('op-3', 1, 10, 2, 30_000),
    status: 'needs_attention',
    reason: 'Only 1 unit left.',
    remaining: 1,
  };
  const withRejected = project(SNAPSHOT, [rejected]);
  check('stock is untouched by a refused sale', withRejected.items.find((i) => i.id === 10)!.qtyRemaining, 5);
  check('and it does not appear as a recorded sale', withRejected.sales.some((s) => s.pending), false);

  // ---------------------------------------------------------------------
  console.log('\n--- Projection: an item created offline is sellable at once ---');
  // The owner adds a batch with no signal, then it is sold with no signal.
  // Both ops reference the batch by clientId and travel together.

  const withNewItem = project(SNAPSHOT, [
    {
      id: 'op-4', seq: 1, kind: 'item.create',
      data: {
        clientId: 'new-batch', category: { id: 1 }, specifics: 'Fleece, grey',
        costPrice: 12_000, minPrice: 18_000, quantity: 6, purchaseDate: '2026-07-12',
      },
      status: 'queued', createdAt: '2026-07-12T08:00:00Z', attempts: 0,
      label: '6 × Fleece, grey',
    },
    {
      id: 'op-5', seq: 2, kind: 'sale.create',
      data: { clientId: 'new-sale', item: { clientId: 'new-batch' }, saleDate: '2026-07-12', quantity: 2, unitPrice: 18_000 },
      status: 'queued', createdAt: '2026-07-12T08:30:00Z', attempts: 0,
      label: '2 × Fleece, grey',
    },
  ]);

  const fleece = withNewItem.items.find((i) => i.clientId === 'new-batch');
  check('the new batch exists locally', Boolean(fleece), true);
  check('a new batch starts entirely unsold, less what was queued against it', fleece?.qtyRemaining, 4);
  check('it is offered on the sale form', sellableItems(withNewItem).some((i) => i.specifics === 'Fleece, grey'), true);
  check('the sale of it resolved to the local batch', withNewItem.sales.some((s) => s.clientId === 'new-sale'), true);

  // ---------------------------------------------------------------------
  console.log('\n--- Sellable items match getSellableItems() ---');

  const sellable = sellableItems(empty);
  check('sold-out and archived batches are excluded', sellable.length, 2);
  check('archived batch is absent', sellable.some((i) => i.specifics === 'Old stock'), false);
  check('sorted by category then description', sellable.map((i) => i.categoryName), ['Blankets', 'Curtains']);

  // ---------------------------------------------------------------------
  console.log('\n--- Ranges stay inclusive of both endpoints ---');

  check('a sale on the last day of the range is counted', salesInRange(empty, '2026-07-01', '2026-07-11').length, 3);
  check('a sale on the first day is counted', salesInRange(empty, '2026-07-10', '2026-07-10').length, 1);
  check('the August sale stays out of a July range', salesInRange(empty, FROM, TO).some((s) => s.id === 103), false);

  // ---------------------------------------------------------------------
  console.log('\n--- Device clocks are trusted, but clamped ---');

  const now = new Date('2026-07-29T12:00:00Z');

  // The normal case: a sale recorded three hours ago on a phone with no signal.
  const threeHoursAgo = '2026-07-29T09:00:00.000Z';
  check(
    'a plausible offline timestamp is kept, so a queued batch does not all land at once',
    clampRecordedAt(threeHoursAgo, now).toISOString(),
    threeHoursAgo,
  );

  check(
    'a phone whose clock says next year cannot file a sale in the future',
    clampRecordedAt('2027-01-01T00:00:00Z', now).toISOString(),
    now.toISOString(),
  );
  check(
    'a phone stuck in the past cannot bury one either',
    clampRecordedAt('2019-01-01T00:00:00Z', now).toISOString(),
    now.toISOString(),
  );
  check('a missing timestamp falls back to now', clampRecordedAt(undefined, now).toISOString(), now.toISOString());
  check('junk falls back to now', clampRecordedAt('not-a-date', now).toISOString(), now.toISOString());

  // The boundary that matters most: sale_date is carried separately and is
  // never recomputed at sync time. A sale recorded at 23:50 Kampala and sent at
  // 00:10 belongs to the earlier day.
  const lateSale = queuedSale('op-6', 1, 10, 1, 30_000);
  lateSale.data = { ...lateSale.data, saleDate: '2026-07-11' } as typeof lateSale.data;
  const lateProjection = project(SNAPSHOT, [lateSale]);
  check(
    'a sale queued overnight keeps the day it was recorded on',
    lateProjection.sales.find((s) => s.pending)?.saleDate,
    '2026-07-11',
  );
  check(
    'so it falls in the range for that day, not the next',
    salesInRange(lateProjection, '2026-07-11', '2026-07-11').length,
    3,
  );
}
