import 'server-only';
import { and, desc, eq, gt, gte, isNull, lte, sql, asc } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '@/db';
import { categories, items, sales, expenses, attendantLinks } from '@/db/schema';
import { toNumber } from './format';
import { addDays, todayInKampala, type DateRange } from './dates';
import type { Session } from './auth';
import { MIRROR_WINDOW_DAYS, type Delta } from './offline/types';

/**
 * ===================================================================
 * THE COST-PRICE BOUNDARY
 *
 * Attendants must never receive cost price or profit. That rule is
 * enforced HERE, in the select lists — not in the templates.
 *
 * A template that simply "doesn't render" a field still ships it in the
 * RSC payload, where it is visible in devtools, in View Source, and in a
 * React error overlay. Functions below marked ATTENDANT-SAFE never put
 * items.costPrice, sales.unitCost or any profit expression into a select.
 *
 * getDelta() below is now the widest part of that boundary and the one to
 * watch hardest: what it returns is written to IndexedDB and STAYS on the
 * phone, readable by anyone holding it, long after the tab is closed. It
 * branches on role and adds costPrice/unitCost for the owner only.
 *
 * If you add a field to an ATTENDANT-SAFE function, re-check that rule.
 * ===================================================================
 *
 * SOFT DELETE. categories, sales and expenses are never removed, only stamped
 * with deleted_at — a hard DELETE is invisible to an incremental sync, so
 * devices would keep the row for ever. Every read of those three tables must
 * filter `deletedAt IS NULL`, including any you add later.
 */

const ZERO = sql`0`;

const liveSale = isNull(sales.deletedAt);
const liveExpense = isNull(expenses.deletedAt);
const liveCategory = isNull(categories.deletedAt);

// ---------------------------------------------------------------- categories

export async function getCategories() {
  return db.select().from(categories).where(liveCategory).orderBy(asc(categories.name));
}

export async function getCategoriesWithCounts() {
  return db
    .select({
      id: categories.id,
      name: categories.name,
      itemCount: sql<string>`COUNT(${items.id})`,
      unitsRemaining: sql<string>`COALESCE(SUM(${items.qtyRemaining}), 0)`,
    })
    .from(categories)
    .leftJoin(items, and(eq(items.categoryId, categories.id), eq(items.archived, false)))
    .where(liveCategory)
    .groupBy(categories.id, categories.name)
    .orderBy(asc(categories.name));
}

// -------------------------------------------------------------------- items

/** OWNER ONLY — includes cost price and margin. */
export async function getItemsWithCost() {
  return db
    .select({
      id: items.id,
      specifics: items.specifics,
      costPrice: items.costPrice,
      minPrice: items.minPrice,
      quantity: items.quantity,
      qtyRemaining: items.qtyRemaining,
      purchaseDate: items.purchaseDate,
      archived: items.archived,
      categoryId: items.categoryId,
      categoryName: categories.name,
    })
    .from(items)
    .innerJoin(categories, eq(items.categoryId, categories.id))
    .orderBy(desc(items.purchaseDate), desc(items.id));
}

/** OWNER ONLY — one batch, for the edit form. */
export async function getItemById(id: number) {
  const [row] = await db.select().from(items).where(eq(items.id, id)).limit(1);
  return row ?? null;
}

/**
 * ATTENDANT-SAFE. Deliberately used by BOTH sale forms so there is only one
 * query to audit. `minPrice` is the proposed selling price and is meant to be
 * seen; `costPrice` is absent from the select list.
 */
export async function getSellableItems() {
  return db
    .select({
      id: items.id,
      specifics: items.specifics,
      minPrice: items.minPrice,
      qtyRemaining: items.qtyRemaining,
      categoryId: items.categoryId,
      categoryName: categories.name,
    })
    .from(items)
    .innerJoin(categories, eq(items.categoryId, categories.id))
    .where(and(eq(items.archived, false), gt(items.qtyRemaining, 0), liveCategory))
    .orderBy(asc(categories.name), asc(items.specifics));
}

export type SellableItem = Awaited<ReturnType<typeof getSellableItems>>[number];

// ------------------------------------------------------------------- stock

/** OWNER ONLY — stock valued at cost and at retail. */
export async function getStockValue() {
  const [row] = await db
    .select({
      atCost: sql<string>`COALESCE(SUM(${items.qtyRemaining} * ${items.costPrice}), 0)`,
      atRetail: sql<string>`COALESCE(SUM(${items.qtyRemaining} * ${items.minPrice}), 0)`,
      units: sql<string>`COALESCE(SUM(${items.qtyRemaining}), 0)`,
      batches: sql<string>`COUNT(*) FILTER (WHERE ${items.qtyRemaining} > 0)`,
    })
    .from(items)
    .where(eq(items.archived, false));

  return {
    atCost: toNumber(row?.atCost),
    atRetail: toNumber(row?.atRetail),
    units: toNumber(row?.units),
    batches: toNumber(row?.batches),
  };
}

/** ATTENDANT-SAFE — a unit count and nothing else. No money figure at all. */
export async function getStockUnitCount() {
  const [row] = await db
    .select({
      units: sql<string>`COALESCE(SUM(${items.qtyRemaining}), 0)`,
      batches: sql<string>`COUNT(*) FILTER (WHERE ${items.qtyRemaining} > 0)`,
    })
    .from(items)
    .where(eq(items.archived, false));

  return { units: toNumber(row?.units), batches: toNumber(row?.batches) };
}

// --------------------------------------------------------------- dashboard

/**
 * OWNER ONLY.
 *
 * Note that stock value is POINT-IN-TIME — it answers "what am I holding
 * right now" and deliberately ignores the date range. The UI must label it
 * "as of today" so it is never read as belonging to the selected period.
 */
export async function getDashboardMetrics(range: DateRange) {
  const inRange = and(
    gte(sales.saleDate, range.from),
    lte(sales.saleDate, range.to),
    liveSale,
  );

  const [salesAgg] = await db
    .select({
      revenue: sql<string>`COALESCE(SUM(${sales.quantity} * ${sales.unitPrice}), 0)`,
      grossProfit: sql<string>`COALESCE(SUM(${sales.quantity} * (${sales.unitPrice} - ${sales.unitCost})), 0)`,
      unitsSold: sql<string>`COALESCE(SUM(${sales.quantity}), 0)`,
      transactions: sql<string>`COUNT(*)`,
      belowMinCount: sql<string>`COUNT(*) FILTER (WHERE ${sales.belowMin})`,
    })
    .from(sales)
    .where(inRange);

  const [expenseAgg] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)`,
      count: sql<string>`COUNT(*)`,
    })
    .from(expenses)
    .where(
      and(
        gte(expenses.expenseDate, range.from),
        lte(expenses.expenseDate, range.to),
        liveExpense,
      ),
    );

  const stock = await getStockValue();

  const revenue = toNumber(salesAgg?.revenue);
  const grossProfit = toNumber(salesAgg?.grossProfit);
  const expensesTotal = toNumber(expenseAgg?.total);

  return {
    revenue,
    grossProfit,
    expensesTotal,
    /** The bottom line Sarah actually cares about. */
    netProfit: grossProfit - expensesTotal,
    costOfGoodsSold: revenue - grossProfit,
    unitsSold: toNumber(salesAgg?.unitsSold),
    transactions: toNumber(salesAgg?.transactions),
    belowMinCount: toNumber(salesAgg?.belowMinCount),
    expenseCount: toNumber(expenseAgg?.count),
    stock,
  };
}

/** ATTENDANT-SAFE — revenue and volume only. No profit, no stock value. */
export async function getAttendantSummary(range: DateRange) {
  const [row] = await db
    .select({
      revenue: sql<string>`COALESCE(SUM(${sales.quantity} * ${sales.unitPrice}), 0)`,
      unitsSold: sql<string>`COALESCE(SUM(${sales.quantity}), 0)`,
      transactions: sql<string>`COUNT(*)`,
    })
    .from(sales)
    .where(and(gte(sales.saleDate, range.from), lte(sales.saleDate, range.to), liveSale));

  const stock = await getStockUnitCount();

  return {
    revenue: toNumber(row?.revenue),
    unitsSold: toNumber(row?.unitsSold),
    transactions: toNumber(row?.transactions),
    stockUnits: stock.units,
  };
}

/** OWNER ONLY — daily revenue/profit series for the chart. */
export async function getDailySeries(range: DateRange) {
  const rows = await db
    .select({
      day: sales.saleDate,
      revenue: sql<string>`COALESCE(SUM(${sales.quantity} * ${sales.unitPrice}), 0)`,
      profit: sql<string>`COALESCE(SUM(${sales.quantity} * (${sales.unitPrice} - ${sales.unitCost})), 0)`,
    })
    .from(sales)
    .where(and(gte(sales.saleDate, range.from), lte(sales.saleDate, range.to), liveSale))
    .groupBy(sales.saleDate)
    .orderBy(asc(sales.saleDate));

  return rows.map((r) => ({
    day: r.day,
    revenue: toNumber(r.revenue),
    profit: toNumber(r.profit),
  }));
}

/** ATTENDANT-SAFE version of the series — revenue only. */
export async function getDailyRevenueSeries(range: DateRange) {
  const rows = await db
    .select({
      day: sales.saleDate,
      revenue: sql<string>`COALESCE(SUM(${sales.quantity} * ${sales.unitPrice}), 0)`,
    })
    .from(sales)
    .where(and(gte(sales.saleDate, range.from), lte(sales.saleDate, range.to), liveSale))
    .groupBy(sales.saleDate)
    .orderBy(asc(sales.saleDate));

  return rows.map((r) => ({ day: r.day, revenue: toNumber(r.revenue) }));
}

/** OWNER ONLY — which categories are actually earning. */
export async function getCategoryBreakdown(range: DateRange) {
  const rows = await db
    .select({
      categoryId: categories.id,
      categoryName: categories.name,
      revenue: sql<string>`COALESCE(SUM(${sales.quantity} * ${sales.unitPrice}), 0)`,
      profit: sql<string>`COALESCE(SUM(${sales.quantity} * (${sales.unitPrice} - ${sales.unitCost})), 0)`,
      unitsSold: sql<string>`COALESCE(SUM(${sales.quantity}), 0)`,
    })
    .from(sales)
    .innerJoin(items, eq(sales.itemId, items.id))
    .innerJoin(categories, eq(items.categoryId, categories.id))
    .where(and(gte(sales.saleDate, range.from), lte(sales.saleDate, range.to), liveSale))
    .groupBy(categories.id, categories.name)
    .orderBy(desc(sql`COALESCE(SUM(${sales.quantity} * ${sales.unitPrice}), 0)`));

  return rows.map((r) => ({
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    revenue: toNumber(r.revenue),
    profit: toNumber(r.profit),
    unitsSold: toNumber(r.unitsSold),
  }));
}

// -------------------------------------------------------------------- sales

/** OWNER ONLY — includes unit cost and per-line profit. */
export async function getSalesForOwner(range: DateRange, limit = 500) {
  return db
    .select({
      id: sales.id,
      saleDate: sales.saleDate,
      quantity: sales.quantity,
      unitPrice: sales.unitPrice,
      unitCost: sales.unitCost,
      belowMin: sales.belowMin,
      specifics: items.specifics,
      minPrice: items.minPrice,
      categoryName: categories.name,
      attendantName: attendantLinks.name,
      createdAt: sales.createdAt,
    })
    .from(sales)
    .innerJoin(items, eq(sales.itemId, items.id))
    .innerJoin(categories, eq(items.categoryId, categories.id))
    .leftJoin(attendantLinks, eq(sales.attendantId, attendantLinks.id))
    .where(and(gte(sales.saleDate, range.from), lte(sales.saleDate, range.to), liveSale))
    .orderBy(desc(sales.saleDate), desc(sales.id))
    .limit(limit);
}

/** ATTENDANT-SAFE — no unitCost, no profit expression. */
export async function getSalesForAttendant(range: DateRange, limit = 200) {
  return db
    .select({
      id: sales.id,
      saleDate: sales.saleDate,
      quantity: sales.quantity,
      unitPrice: sales.unitPrice,
      specifics: items.specifics,
      categoryName: categories.name,
      attendantName: attendantLinks.name,
    })
    .from(sales)
    .innerJoin(items, eq(sales.itemId, items.id))
    .innerJoin(categories, eq(items.categoryId, categories.id))
    .leftJoin(attendantLinks, eq(sales.attendantId, attendantLinks.id))
    .where(and(gte(sales.saleDate, range.from), lte(sales.saleDate, range.to), liveSale))
    .orderBy(desc(sales.saleDate), desc(sales.id))
    .limit(limit);
}

/** OWNER ONLY — the flagged-sale callout on the dashboard. */
export async function getBelowMinSales(range: DateRange) {
  return db
    .select({
      id: sales.id,
      saleDate: sales.saleDate,
      quantity: sales.quantity,
      unitPrice: sales.unitPrice,
      minPrice: items.minPrice,
      specifics: items.specifics,
      attendantName: attendantLinks.name,
    })
    .from(sales)
    .innerJoin(items, eq(sales.itemId, items.id))
    .leftJoin(attendantLinks, eq(sales.attendantId, attendantLinks.id))
    .where(
      and(
        eq(sales.belowMin, true),
        gte(sales.saleDate, range.from),
        lte(sales.saleDate, range.to),
        liveSale,
      ),
    )
    .orderBy(desc(sales.saleDate), desc(sales.id))
    .limit(50);
}

// ----------------------------------------------------------------- expenses

export async function getExpenses(range: DateRange, limit = 500) {
  return db
    .select({
      id: expenses.id,
      expenseDate: expenses.expenseDate,
      description: expenses.description,
      amount: expenses.amount,
      kind: expenses.kind,
      attendantName: attendantLinks.name,
    })
    .from(expenses)
    .leftJoin(attendantLinks, eq(expenses.attendantId, attendantLinks.id))
    .where(
      and(
        gte(expenses.expenseDate, range.from),
        lte(expenses.expenseDate, range.to),
        liveExpense,
      ),
    )
    .orderBy(desc(expenses.expenseDate), desc(expenses.id))
    .limit(limit);
}

export async function getExpenseTotal(range: DateRange) {
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)` })
    .from(expenses)
    .where(
      and(
        gte(expenses.expenseDate, range.from),
        lte(expenses.expenseDate, range.to),
        liveExpense,
      ),
    );
  return toNumber(row?.total);
}

// --------------------------------------------------------- attendant links

export async function getAttendantLinks() {
  return db
    .select({
      id: attendantLinks.id,
      name: attendantLinks.name,
      token: attendantLinks.token,
      active: attendantLinks.active,
      createdAt: attendantLinks.createdAt,
      lastUsedAt: attendantLinks.lastUsedAt,
      salesCount: sql<string>`(SELECT COUNT(*) FROM ${sales} WHERE ${sales.attendantId} = ${attendantLinks.id} AND ${sales.deletedAt} IS NULL)`,
    })
    .from(attendantLinks)
    .orderBy(desc(attendantLinks.active), asc(attendantLinks.name));
}

/**
 * Revalidates an attendant's session on every guarded request. A revoked link
 * must stop working immediately — the signed cookie alone is not enough,
 * because it stays cryptographically valid for 30 days after revocation.
 */
export async function isAttendantActive(linkId: number): Promise<boolean> {
  const [row] = await db
    .select({ active: attendantLinks.active })
    .from(attendantLinks)
    .where(eq(attendantLinks.id, linkId))
    .limit(1);
  return row?.active === true;
}

// -------------------------------------------------------------------- sync

/**
 * A cursor is only meaningful against the database's own clock, because
 * updated_at is set by a trigger using now(). Reading it from Node would drift.
 */
export async function serverNow(): Promise<Date> {
  const result = await db.execute<{ now: Date }>(sql`SELECT now() AS now`);
  const value = result.rows[0]?.now;
  return value ? new Date(value) : new Date();
}

/**
 * Rows changed since `since`, scoped to who is asking.
 *
 * WHAT AN ATTENDANT'S DEVICE GETS. This is the cost-price boundary's furthest
 * reach: unlike an RSC payload, which lives as long as the tab, this lands in
 * IndexedDB and stays there. costPrice and unitCost are added to the select
 * only on the owner branch. Do not "simplify" this into one query that fetches
 * both and strips fields afterwards — that is exactly the mistake the boundary
 * comment at the top of this file exists to prevent.
 *
 * On a first sync (`since === null`) sales and expenses are bounded to
 * MIRROR_WINDOW_DAYS. A phone does not need three years of history, and a first
 * sync happens on whatever connection the shop has that morning.
 */
export async function getDelta(session: Session, since: Date | null): Promise<Delta> {
  const owner = session.role === 'owner';

  // `> since` on an indexed timestamp. The caller hands back a cursor a couple
  // of seconds behind the real server time, so a transaction that committed
  // out of order is picked up on the following pull rather than lost.
  const changed = (column: AnyPgColumn) => (since ? gt(column, since) : undefined);

  const windowStart = since ? null : addDays(todayInKampala(), -MIRROR_WINDOW_DAYS);

  const categoryRows = await db
    .select({
      id: categories.id,
      name: categories.name,
      clientId: categories.clientId,
      deletedAt: categories.deletedAt,
    })
    .from(categories)
    .where(changed(categories.updatedAt))
    .orderBy(asc(categories.id));

  const itemRows = await db
    .select({
      id: items.id,
      categoryId: items.categoryId,
      specifics: items.specifics,
      minPrice: items.minPrice,
      quantity: items.quantity,
      qtyRemaining: items.qtyRemaining,
      purchaseDate: items.purchaseDate,
      archived: items.archived,
      clientId: items.clientId,
      // OWNER ONLY. ZERO keeps the row shape uniform without disclosing
      // anything; it is stripped below rather than stored as a fake cost.
      costPrice: owner ? items.costPrice : ZERO,
    })
    .from(items)
    .where(changed(items.updatedAt))
    .orderBy(asc(items.id));

  const saleRows = await db
    .select({
      id: sales.id,
      itemId: sales.itemId,
      saleDate: sales.saleDate,
      quantity: sales.quantity,
      unitPrice: sales.unitPrice,
      belowMin: sales.belowMin,
      attendantId: sales.attendantId,
      clientId: sales.clientId,
      createdAt: sales.createdAt,
      deletedAt: sales.deletedAt,
      unitCost: owner ? sales.unitCost : ZERO,
    })
    .from(sales)
    .where(
      and(changed(sales.updatedAt), windowStart ? gte(sales.saleDate, windowStart) : undefined),
    )
    .orderBy(asc(sales.id));

  const expenseRows = await db
    .select({
      id: expenses.id,
      expenseDate: expenses.expenseDate,
      description: expenses.description,
      amount: expenses.amount,
      kind: expenses.kind,
      attendantId: expenses.attendantId,
      clientId: expenses.clientId,
      createdAt: expenses.createdAt,
      deletedAt: expenses.deletedAt,
    })
    .from(expenses)
    .where(
      and(
        changed(expenses.updatedAt),
        windowStart ? gte(expenses.expenseDate, windowStart) : undefined,
      ),
    )
    .orderBy(asc(expenses.id));

  /*
   * Names only. Never the token — that is an attendant's entire credential,
   * and an owner's device holding every attendant's token in IndexedDB would
   * turn a stolen phone into a permanent back door. /attendants is online-only
   * for exactly this reason.
   */
  const attendantRows = await db
    .select({ id: attendantLinks.id, name: attendantLinks.name, active: attendantLinks.active })
    .from(attendantLinks)
    .where(changed(attendantLinks.updatedAt))
    .orderBy(asc(attendantLinks.id));

  return {
    categories: categoryRows.map((r) => ({
      id: r.id,
      name: r.name,
      clientId: r.clientId,
      deletedAt: iso(r.deletedAt),
    })),
    items: itemRows.map((r) => ({
      id: r.id,
      categoryId: r.categoryId,
      specifics: r.specifics,
      minPrice: r.minPrice,
      quantity: r.quantity,
      qtyRemaining: r.qtyRemaining,
      purchaseDate: r.purchaseDate,
      archived: r.archived,
      clientId: r.clientId,
      ...(owner ? { costPrice: Number(r.costPrice) } : {}),
    })),
    sales: saleRows.map((r) => ({
      id: r.id,
      itemId: r.itemId,
      saleDate: r.saleDate,
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      belowMin: r.belowMin,
      attendantId: r.attendantId,
      clientId: r.clientId,
      createdAt: iso(r.createdAt) ?? '',
      deletedAt: iso(r.deletedAt),
      ...(owner ? { unitCost: Number(r.unitCost) } : {}),
    })),
    expenses: expenseRows.map((r) => ({
      id: r.id,
      expenseDate: r.expenseDate,
      description: r.description,
      amount: r.amount,
      kind: r.kind,
      attendantId: r.attendantId,
      clientId: r.clientId,
      createdAt: iso(r.createdAt) ?? '',
      deletedAt: iso(r.deletedAt),
    })),
    attendants: attendantRows,
  };
}

function iso(value: Date | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

export { ZERO };
