/**
 * Regression checks for the stock page's derivations. No database, no browser.
 *
 * Run as part of `npm run test:logic`.
 *
 * lib/offline/stock.ts turns purchase batches back into products, and that
 * regrouping is where this screen can go quietly wrong in ways that still look
 * plausible:
 *
 *   1. THE LOW-STOCK BASELINE. "Below half" has to mean half of what is
 *      actually on the shelf, not half of everything ever bought. Get it wrong
 *      and a product restocked every month reads as permanently low, the
 *      warning band fills with noise, and the flag stops being read at all.
 *
 *   2. COST PRICE IS ABSENT ON AN ATTENDANT'S DEVICE. Every cost-derived
 *      figure must come out null rather than zero, because a zero formats into
 *      a convincing "USh 0" and a margin of the full selling price.
 *
 *   3. GROUPING IS BY DESCRIPTION. Two batches only merge when they are really
 *      the same product, and a merge that reaches across categories would
 *      pool two different things into one row.
 */

import { project, type Snapshot } from '../lib/offline/mirror';
import {
  NO_FILTERS,
  categoriesPresent,
  describeLastSold,
  filterStockProducts,
  restockSuggestions,
  sortStockProducts,
  statusCounts,
  stockProducts,
  stockStatusFor,
  type StockProduct,
} from '../lib/offline/stock';

type Check = (name: string, actual: unknown, expected: unknown) => void;

// ------------------------------------------------------------------ fixture
//
// Four products across two categories, chosen so that every figure below can
// be checked by eye and so the sold-out batch actually changes an answer.

const SNAPSHOT: Snapshot = {
  categories: [
    { id: 1, name: 'Blankets', clientId: null, deletedAt: null },
    { id: 2, name: 'Curtains', clientId: null, deletedAt: null },
  ],
  items: [
    // "Floral king size", bought twice. The June batch sold out entirely; the
    // July one is untouched. THE DISCRIMINATING CASE: 20 of 20 on the shelf is
    // a full shelf, but 20 against all 120 ever bought would read as low.
    {
      id: 10, categoryId: 1, specifics: 'Floral king size', minPrice: 30_000,
      quantity: 100, qtyRemaining: 0, purchaseDate: '2026-06-01', archived: false,
      clientId: null, costPrice: 20_000,
    },
    {
      id: 11, categoryId: 1, specifics: 'Floral king size', minPrice: 32_000,
      quantity: 20, qtyRemaining: 20, purchaseDate: '2026-07-01', archived: false,
      clientId: null, costPrice: 22_000,
    },
    // An archived batch of the same product: grouped, but not on the shelf.
    {
      id: 14, categoryId: 1, specifics: 'Floral king size', minPrice: 28_000,
      quantity: 5, qtyRemaining: 5, purchaseDate: '2026-05-01', archived: true,
      clientId: null, costPrice: 19_000,
    },
    // 9 left of 20: below half, so this is the one that should be flagged.
    {
      id: 12, categoryId: 1, specifics: 'Woollen double', minPrice: 30_000,
      quantity: 20, qtyRemaining: 9, purchaseDate: '2026-07-02', archived: false,
      clientId: null, costPrice: 20_000,
    },
    // Nothing left at all.
    {
      id: 13, categoryId: 2, specifics: 'Lace, cream', minPrice: 25_000,
      quantity: 4, qtyRemaining: 0, purchaseDate: '2026-07-03', archived: false,
      clientId: null, costPrice: 15_000,
    },
    // Every batch archived: the product itself is archived.
    {
      id: 15, categoryId: 2, specifics: 'Old curtain', minPrice: 9_000,
      quantity: 3, qtyRemaining: 3, purchaseDate: '2026-04-01', archived: true,
      clientId: null, costPrice: 8_000,
    },
  ],
  sales: [
    { id: 100, itemId: 10, saleDate: '2026-06-15', quantity: 100, unitPrice: 30_000, unitCost: 20_000, belowMin: false, attendantId: 1, clientId: null, createdAt: '2026-06-15T09:00:00Z', deletedAt: null },
    { id: 101, itemId: 12, saleDate: '2026-07-20', quantity: 11, unitPrice: 28_000, unitCost: 20_000, belowMin: true, attendantId: 1, clientId: null, createdAt: '2026-07-20T09:00:00Z', deletedAt: null },
    { id: 102, itemId: 13, saleDate: '2026-07-10', quantity: 4, unitPrice: 25_000, unitCost: 15_000, belowMin: false, attendantId: 1, clientId: null, createdAt: '2026-07-10T09:00:00Z', deletedAt: null },
  ],
  expenses: [],
  attendants: [{ id: 1, name: 'Nakato', active: true }],
};

/** The same shelf as an attendant's device sees it: no cost price anywhere. */
const ATTENDANT_SNAPSHOT: Snapshot = {
  ...SNAPSHOT,
  items: SNAPSHOT.items.map(({ costPrice: _costPrice, ...rest }) => rest),
};

const TODAY = '2026-07-25';

function find(products: StockProduct[], specifics: string): StockProduct {
  const found = products.find((p) => p.specifics === specifics);
  if (!found) throw new Error(`fixture problem: no product "${specifics}"`);
  return found;
}

export function runStockChecks(check: Check) {
  const projection = project(SNAPSHOT, []);
  const products = stockProducts(projection);

  const floral = find(products, 'Floral king size');
  const woollen = find(products, 'Woollen double');
  const lace = find(products, 'Lace, cream');

  // ---------------------------------------------------------------------
  console.log('\n--- The low-stock rule: below half of what is on the shelf ---');

  check('exactly half is NOT low', stockStatusFor(10, 20), 'ok');
  check('one below half is low', stockStatusFor(9, 20), 'low');
  check('one above half is fine', stockStatusFor(11, 20), 'ok');
  check('nothing left is sold out, not low', stockStatusFor(0, 20), 'out');
  check('an odd quantity needs strictly fewer than half', stockStatusFor(2, 5), 'low');
  check('and 3 of 5 is not low', stockStatusFor(3, 5), 'ok');

  // ---------------------------------------------------------------------
  console.log('\n--- The baseline is the shelf, not the history ---');

  check('four products, one of them wholly archived', products.length, 4);
  check('the sold-out June batch is excluded from the baseline', floral.liveBaseline, 20);
  check('so a full shelf reads as in stock', floral.status, 'ok');
  console.log('        -> against all 120 ever bought this would have read "Running low"');
  check('all-time demand is still counted', floral.unitsSoldAllTime, 100);
  check('and the batches behind it are still there', floral.batches.length, 2);

  check('9 of 20 is flagged', woollen.status, 'low');
  check('nothing left is flagged sold out', lace.status, 'out');
  check('a sold-out product has no baseline left', lace.liveBaseline, 0);
  check('one low and one sold out', statusCounts(products), { low: 1, out: 1 });

  // ---------------------------------------------------------------------
  console.log('\n--- Grouping batches back into products ---');

  check('two live batches merged into one row', floral.qtyRemaining, 20);
  check('the newest batch names the product', floral.latest.purchaseDate, '2026-07-01');
  check('an archived batch is grouped but set aside', floral.archivedBatches.length, 1);
  check('and does not make the product archived', floral.archived, false);

  const allArchived = find(stockProducts(projection), 'Old curtain');
  check('a product whose every batch is archived is archived', allArchived.archived, true);
  check('and still has a batch to restock from', allArchived.latest.quantity, 3);

  // Same description, different category: two products, never pooled.
  const collision = project(
    {
      ...SNAPSHOT,
      items: [
        { id: 20, categoryId: 1, specifics: 'Plain white', minPrice: 10_000, quantity: 5, qtyRemaining: 5, purchaseDate: '2026-07-01', archived: false, clientId: null, costPrice: 5_000 },
        { id: 21, categoryId: 2, specifics: 'Plain white', minPrice: 12_000, quantity: 5, qtyRemaining: 5, purchaseDate: '2026-07-01', archived: false, clientId: null, costPrice: 6_000 },
        // Same product, typed with different capitals and a stray space.
        { id: 22, categoryId: 1, specifics: '  plain WHITE ', minPrice: 11_000, quantity: 3, qtyRemaining: 3, purchaseDate: '2026-07-04', archived: false, clientId: null, costPrice: 5_500 },
      ],
      sales: [],
    },
    [],
  );
  const collided = stockProducts(collision);
  check('the same words in two categories stay two products', collided.length, 2);
  check(
    'capitals and stray spaces do not split a product',
    collided.find((p) => p.categoryId === 1)?.qtyRemaining,
    8,
  );

  // ---------------------------------------------------------------------
  console.log('\n--- Money on the shelf ---');

  // 20 left of the July batch at 22,000 each. The sold-out June batch holds
  // nothing, so it contributes nothing.
  check('value at cost counts only what is left', floral.atCost, 440_000);
  check('value at the selling price', floral.atRetail, 640_000);
  check('profit if it all sells', floral.potentialProfit, 200_000);
  check('the live price is the batch on the shelf, not the newest ever', floral.minPrice, 32_000);
  check('one live batch cannot disagree with itself', floral.costVaries, false);

  const mixed = stockProducts(
    project(
      {
        ...SNAPSHOT,
        items: [
          { id: 30, categoryId: 1, specifics: 'Two prices', minPrice: 30_000, quantity: 5, qtyRemaining: 5, purchaseDate: '2026-07-01', archived: false, clientId: null, costPrice: 20_000 },
          { id: 31, categoryId: 1, specifics: 'Two prices', minPrice: 34_000, quantity: 5, qtyRemaining: 5, purchaseDate: '2026-07-05', archived: false, clientId: null, costPrice: 24_000 },
        ],
        sales: [],
      },
      [],
    ),
  );
  check('two live batches at different costs are flagged as a summary', mixed[0].costVaries, true);
  check('and the value still totals both', mixed[0].atCost, 220_000);

  // ---------------------------------------------------------------------
  console.log('\n--- An attendant device has no cost price, and no zero standing in for one ---');

  const attendant = stockProducts(project(ATTENDANT_SNAPSHOT, []));
  const attendantFloral = find(attendant, 'Floral king size');

  check('cost price is null, not 0', attendantFloral.costPrice, null);
  check('margin is null, not the whole selling price', attendantFloral.marginPerUnit, null);
  check('money tied up is null, not 0', attendantFloral.atCost, null);
  check('potential profit is null', attendantFloral.potentialProfit, null);
  check('but what is on the shelf is still known', attendantFloral.qtyRemaining, 20);
  check('and so is the selling price', attendantFloral.atRetail, 640_000);
  check('the low-stock flag works without cost price', find(attendant, 'Woollen double').status, 'low');

  // sellableOnly mirrors getSellableItems(): nothing archived, nothing empty.
  const sellable = stockProducts(project(ATTENDANT_SNAPSHOT, []), { sellableOnly: true });
  check('the sale-form contract drops sold-out and archived rows', sellable.length, 2);
  check(
    'and the sold-out product is gone',
    sellable.some((p) => p.specifics === 'Lace, cream'),
    false,
  );

  // ---------------------------------------------------------------------
  console.log('\n--- Filtering ---');

  const all = products;
  check('no filters shows every unarchived product', filterStockProducts(all, NO_FILTERS).length, 3);
  check(
    'archived products are hidden until asked for',
    filterStockProducts(all, { ...NO_FILTERS, includeArchived: true }).length,
    4,
  );
  check(
    'by category',
    filterStockProducts(all, { ...NO_FILTERS, categoryId: 2 }).map((p) => p.specifics),
    ['Lace, cream'],
  );
  check(
    'by low stock',
    filterStockProducts(all, { ...NO_FILTERS, status: 'low' }).map((p) => p.specifics),
    ['Woollen double'],
  );
  check(
    'by sold out',
    filterStockProducts(all, { ...NO_FILTERS, status: 'out' }).map((p) => p.specifics),
    ['Lace, cream'],
  );
  check(
    'search matches the description, case-insensitively',
    filterStockProducts(all, { ...NO_FILTERS, search: 'WOOLLEN' }).map((p) => p.specifics),
    ['Woollen double'],
  );
  check(
    'search also matches the category name',
    filterStockProducts(all, { ...NO_FILTERS, search: 'curtain' }).map((p) => p.specifics),
    ['Lace, cream'],
  );
  check(
    'a price floor is inclusive',
    filterStockProducts(all, { ...NO_FILTERS, priceFrom: 30_000 }).length,
    2,
  );
  // Filtering preserves the incoming order, which is the default "recently
  // bought": Lace (3 Jul) before Woollen (2 Jul).
  check(
    'a price ceiling is inclusive',
    filterStockProducts(all, { ...NO_FILTERS, priceTo: 30_000 }).map((p) => p.specifics),
    ['Lace, cream', 'Woollen double'],
  );
  check(
    'a band takes both ends',
    filterStockProducts(all, { ...NO_FILTERS, priceFrom: 26_000, priceTo: 31_000 }).map(
      (p) => p.specifics,
    ),
    ['Woollen double'],
  );
  check(
    'filters combine rather than replace each other',
    filterStockProducts(all, { ...NO_FILTERS, categoryId: 1, status: 'low' }).map(
      (p) => p.specifics,
    ),
    ['Woollen double'],
  );
  check('the dropdown offers only categories present', categoriesPresent(all), [
    { id: 1, name: 'Blankets' },
    { id: 2, name: 'Curtains' },
  ]);

  // ---------------------------------------------------------------------
  console.log('\n--- Sorting ---');

  // The panel filters first and sorts what survives, so these run on the same
  // list the table is built from — the archived product is already gone.
  const shown = filterStockProducts(all, NO_FILTERS);

  check(
    'least left first puts the sold-out one at the top',
    sortStockProducts(shown, 'leastLeft').map((p) => p.qtyRemaining),
    [0, 9, 20],
  );
  check(
    'highest price first',
    sortStockProducts(shown, 'price').map((p) => p.minPrice),
    [32_000, 30_000, 25_000],
  );
  check(
    'most money tied up first',
    sortStockProducts(shown, 'tiedUp')[0].specifics,
    'Floral king size',
  );
  check(
    'longest unsold first: June beats July',
    sortStockProducts(shown, 'longestUnsold').map((p) => p.lastSoldDate),
    ['2026-06-15', '2026-07-10', '2026-07-20'],
  );
  check(
    'recently bought is the default order',
    sortStockProducts(shown, 'recent').map((p) => p.latest.purchaseDate),
    ['2026-07-03', '2026-07-02', '2026-07-01'],
  );
  check('sorting does not mutate the caller list', all[0].specifics, products[0].specifics);

  // ---------------------------------------------------------------------
  console.log('\n--- Sales reached through the batch ---');

  check('last sold is the newest across every batch', floral.lastSoldDate, '2026-06-15');
  check('a haggled sale is counted against the product', woollen.belowMinCount, 1);
  check('and not against one that had none', floral.belowMinCount, 0);
  check('never sold reads as such', describeLastSold(null, TODAY), 'Never sold');
  check('sold today', describeLastSold(TODAY, TODAY), 'Sold today');
  check('sold yesterday', describeLastSold('2026-07-24', TODAY), 'Sold yesterday');
  check('older than that is counted in days', describeLastSold('2026-06-15', TODAY), '40 days ago');

  // ---------------------------------------------------------------------
  console.log('\n--- The shopping list ranks by how fast things actually sell ---');

  const suggestions = restockSuggestions(products, 5, TODAY);
  check('only low and sold-out products are suggested', suggestions.length, 2);
  check(
    'the faster seller comes first, not the emptier shelf',
    suggestions.map((s) => s.product.specifics),
    ['Woollen double', 'Lace, cream'],
  );
  console.log(
    `        -> Woollen double sells ${suggestions[0].velocity.toFixed(2)}/day with 9 left; ` +
      `Lace, cream ${suggestions[1].velocity.toFixed(2)}/day with 0`,
  );
  // 11 sold over the 24 days since 2 July inclusive is 0.458/day; 9 left at
  // that rate is 19 whole days, rounded down rather than up — the shopping trip
  // wants the pessimistic figure.
  check('days of cover is whole days at that rate', suggestions[0].daysOfCover, 19);
  check('a healthy product is not on the list', suggestions.some((s) => s.product.status === 'ok'), false);
  check(
    'every suggestion has actually sold, so none divides by zero',
    suggestions.every((s) => s.velocity > 0 && s.daysOfCover !== null),
    true,
  );
  console.log(
    '        -> daysOfCover only goes null for a product that has never sold, and one of\n' +
      '           those can never be low or sold out; the guard is defensive, not reachable.',
  );

  // ---------------------------------------------------------------------
  console.log('\n--- Dead stock: bought, never sold ---');

  const dead = stockProducts(
    project(
      {
        ...SNAPSHOT,
        items: [
          { id: 40, categoryId: 1, specifics: 'Never moved', minPrice: 10_000, quantity: 10, qtyRemaining: 10, purchaseDate: '2026-03-01', archived: false, clientId: null, costPrice: 5_000 },
          { id: 41, categoryId: 1, specifics: 'Moves fine', minPrice: 10_000, quantity: 10, qtyRemaining: 8, purchaseDate: '2026-07-01', archived: false, clientId: null, costPrice: 5_000 },
        ],
        sales: [
          { id: 300, itemId: 41, saleDate: '2026-07-20', quantity: 2, unitPrice: 10_000, unitCost: 5_000, belowMin: false, attendantId: 1, clientId: null, createdAt: '2026-07-20T09:00:00Z', deletedAt: null },
        ],
      },
      [],
    ),
  );
  check('a full shelf that has never sold is not flagged low', find(dead, 'Never moved').status, 'ok');
  check('but it has no last-sold date', find(dead, 'Never moved').lastSoldDate, null);
  check(
    'and longest-unsold surfaces it above everything that has sold',
    sortStockProducts(dead, 'longestUnsold').map((p) => p.specifics),
    ['Never moved', 'Moves fine'],
  );
  console.log('        -> this is the sort that finds money asleep on the shelf');
}
