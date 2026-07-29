import { eachDay } from '../dates';
import type { LocalExpense, LocalItem, LocalSale, Projection } from './mirror';

/**
 * ===================================================================
 * THE DASHBOARD MATHS, A SECOND TIME.
 *
 * These are TypeScript twins of the SQL aggregates in lib/queries.ts, so the
 * owner's dashboard works with no connection and counts sales still sitting in
 * the outbox.
 *
 * TWO IMPLEMENTATIONS OF THE PROFIT MATHS IS A REAL RISK and the reason
 * scripts/check-logic.ts runs a fixture through both and asserts they agree.
 * If you change a formula in lib/queries.ts, change it here, and the check
 * will tell you if you did not.
 *
 * The rules that must hold on both sides:
 *
 *   - Money is integer UGX end to end. No division except in marginPercent(),
 *     which is display-only.
 *   - unitCost is the SNAPSHOT stored on the sale, never the item's current
 *     cost. Correcting a typo in a batch's cost must not rewrite last month's
 *     profit.
 *   - Ranges include both endpoints.
 *   - Stock value is point-in-time and ignores the range entirely.
 * ===================================================================
 */

export interface DashboardMetrics {
  revenue: number;
  grossProfit: number;
  expensesTotal: number;
  netProfit: number;
  costOfGoodsSold: number;
  unitsSold: number;
  transactions: number;
  belowMinCount: number;
  expenseCount: number;
  stock: StockValue;
}

export interface StockValue {
  atCost: number;
  atRetail: number;
  units: number;
  batches: number;
}

/**
 * Mirrors getStockValue(). Point-in-time: it answers "what am I holding right
 * now", so it deliberately takes no range.
 *
 * costPrice is optional on a mirror item because an attendant's device never
 * receives it. This function is only ever called on the owner's side; the ?? 0
 * is there so a missing cost reads as zero value rather than NaN poisoning the
 * whole total.
 */
export function stockValue(items: LocalItem[]): StockValue {
  const live = items.filter((item) => !item.archived);

  return {
    atCost: live.reduce((total, item) => total + item.qtyRemaining * (item.costPrice ?? 0), 0),
    atRetail: live.reduce((total, item) => total + item.qtyRemaining * item.minPrice, 0),
    units: live.reduce((total, item) => total + item.qtyRemaining, 0),
    batches: live.filter((item) => item.qtyRemaining > 0).length,
  };
}

/** Mirrors getDashboardMetrics(). OWNER ONLY — reads unitCost. */
export function dashboardMetrics(
  sales: LocalSale[],
  expenses: LocalExpense[],
  items: LocalItem[],
): DashboardMetrics {
  let revenue = 0;
  let grossProfit = 0;
  let unitsSold = 0;
  let belowMinCount = 0;

  for (const sale of sales) {
    revenue += sale.quantity * sale.unitPrice;
    grossProfit += sale.quantity * (sale.unitPrice - (sale.unitCost ?? 0));
    unitsSold += sale.quantity;
    if (sale.belowMin) belowMinCount++;
  }

  const expensesTotal = expenses.reduce((total, expense) => total + expense.amount, 0);

  return {
    revenue,
    grossProfit,
    expensesTotal,
    /** The bottom line Sarah actually cares about. */
    netProfit: grossProfit - expensesTotal,
    costOfGoodsSold: revenue - grossProfit,
    unitsSold,
    transactions: sales.length,
    belowMinCount,
    expenseCount: expenses.length,
    stock: stockValue(items),
  };
}

/** Mirrors getAttendantSummary(). ATTENDANT-SAFE — no profit, no stock value. */
export function attendantSummary(sales: LocalSale[], items: LocalItem[]) {
  let revenue = 0;
  let unitsSold = 0;

  for (const sale of sales) {
    revenue += sale.quantity * sale.unitPrice;
    unitsSold += sale.quantity;
  }

  return {
    revenue,
    unitsSold,
    transactions: sales.length,
    stockUnits: items
      .filter((item) => !item.archived)
      .reduce((total, item) => total + item.qtyRemaining, 0),
  };
}

export interface DayPoint {
  day: string;
  revenue: number;
  profit: number;
}

/**
 * Mirrors getDailySeries().
 *
 * The SQL returns only days that had sales; the chart pads the gaps. Doing the
 * padding here instead keeps DailySalesChart unchanged and means a flat day
 * reads as zero rather than as a missing point the line jumps over.
 */
export function dailySeries(sales: LocalSale[], from: string, to: string): DayPoint[] {
  const byDay = new Map<string, DayPoint>();

  for (const sale of sales) {
    const point = byDay.get(sale.saleDate) ?? { day: sale.saleDate, revenue: 0, profit: 0 };
    point.revenue += sale.quantity * sale.unitPrice;
    point.profit += sale.quantity * (sale.unitPrice - (sale.unitCost ?? 0));
    byDay.set(sale.saleDate, point);
  }

  return eachDay(from, to).map(
    (day) => byDay.get(day) ?? { day, revenue: 0, profit: 0 },
  );
}

/** ATTENDANT-SAFE version of the series — revenue only. */
export function dailyRevenueSeries(sales: LocalSale[], from: string, to: string) {
  return dailySeries(sales, from, to).map(({ day, revenue }) => ({ day, revenue }));
}

export interface CategoryRow {
  categoryId: number;
  categoryName: string;
  revenue: number;
  profit: number;
  unitsSold: number;
}

/**
 * Mirrors getCategoryBreakdown(). The SQL reaches a category through the item,
 * so a sale whose item is no longer in the mirror contributes nothing —
 * matching the INNER JOINs rather than inventing an "unknown" bucket.
 */
export function categoryBreakdown(sales: LocalSale[], projection: Projection): CategoryRow[] {
  const itemById = new Map(projection.items.filter((i) => i.id !== null).map((i) => [i.id, i]));
  const rows = new Map<number, CategoryRow>();

  for (const sale of sales) {
    const item = itemById.get(sale.itemId);
    if (!item) continue;

    const row = rows.get(item.categoryId) ?? {
      categoryId: item.categoryId,
      categoryName: projection.categoryName(item.categoryId),
      revenue: 0,
      profit: 0,
      unitsSold: 0,
    };

    row.revenue += sale.quantity * sale.unitPrice;
    row.profit += sale.quantity * (sale.unitPrice - (sale.unitCost ?? 0));
    row.unitsSold += sale.quantity;
    rows.set(item.categoryId, row);
  }

  return [...rows.values()].sort((a, b) => b.revenue - a.revenue);
}

/** Mirrors getBelowMinSales(): the flagged-sale callout, newest first, capped. */
export function belowMinSales(sales: LocalSale[], projection: Projection, limit = 50) {
  const itemById = new Map(projection.items.filter((i) => i.id !== null).map((i) => [i.id, i]));

  return sales
    .filter((sale) => sale.belowMin)
    .map((sale) => {
      const item = itemById.get(sale.itemId);
      return {
        key: sale.key,
        saleDate: sale.saleDate,
        quantity: sale.quantity,
        unitPrice: sale.unitPrice,
        minPrice: item?.minPrice ?? 0,
        specifics: item?.specifics ?? 'Unknown item',
        attendantName: projection.attendantName(sale.attendantId),
        pending: sale.pending,
      };
    })
    .sort((a, b) => b.saleDate.localeCompare(a.saleDate))
    .slice(0, limit);
}

/** Mirrors getCategoriesWithCounts(). Archived batches do not count. */
export function categoriesWithCounts(projection: Projection) {
  return projection.categories.map((category) => {
    const batches = projection.items.filter(
      (item) => item.categoryId === category.id && !item.archived,
    );
    return {
      id: category.id,
      key: category.key,
      // Carried through because a category created offline has no id yet and
      // can only be renamed or deleted by the reference it does have.
      clientId: category.clientId,
      name: category.name,
      pending: category.pending,
      itemCount: batches.length,
      unitsRemaining: batches.reduce((total, item) => total + item.qtyRemaining, 0),
    };
  });
}
