import { STORES, getAll, writeAll } from './db';
import type { OutboxEntry } from './outbox';
import type {
  Delta,
  ExpenseCreateData,
  ItemCreateData,
  ItemUpdateData,
  MirrorAttendant,
  MirrorCategory,
  MirrorExpense,
  MirrorItem,
  MirrorSale,
  Ref,
  SaleCreateData,
} from './types';
import { isLocalRef } from './types';

/**
 * The device's view of the books, and the one thing every screen renders from.
 *
 * Two layers:
 *
 *   the SNAPSHOT   what the server last said, in IndexedDB.
 *   the PROJECTION the snapshot with everything still sitting in the outbox
 *                  applied on top.
 *
 * The projection is what the UI sees, and it is not a nicety. An attendant who
 * records a sale on a dead connection and then opens the stock list must see
 * the count go down; a list that ignores the queue would tell them the blanket
 * they just sold is still there, and they would sell it again.
 */

// ------------------------------------------------------------- local rows

/**
 * A row that may not exist on the server yet.
 *
 * `id` is null until it does. `key` is what React lists key off, because a
 * pending row has no id and an id that appears later must not be treated as a
 * different row — that would remount the list item and lose focus mid-typing.
 */
export type Local<T> = Omit<T, 'id'> & {
  id: number | null;
  key: string;
  pending: boolean;
  /** The outbox entry behind a pending row, so "undo" can find it. */
  opId?: string;
};

export type LocalCategory = Local<MirrorCategory>;
export type LocalItem = Local<MirrorItem>;
export type LocalSale = Local<MirrorSale>;
export type LocalExpense = Local<MirrorExpense>;

export interface Snapshot {
  categories: MirrorCategory[];
  items: MirrorItem[];
  sales: MirrorSale[];
  expenses: MirrorExpense[];
  attendants: MirrorAttendant[];
}

export interface Projection {
  categories: LocalCategory[];
  items: LocalItem[];
  sales: LocalSale[];
  expenses: LocalExpense[];
  attendants: MirrorAttendant[];
  /** id -> name, for the joins the SQL used to do. */
  categoryName: (id: number | null) => string;
  attendantName: (id: number | null) => string | null;
}

export const EMPTY_SNAPSHOT: Snapshot = {
  categories: [],
  items: [],
  sales: [],
  expenses: [],
  attendants: [],
};

// ------------------------------------------------------------------ read

export async function readSnapshot(): Promise<Snapshot> {
  const [categories, items, sales, expenses, attendants] = await Promise.all([
    getAll<MirrorCategory>(STORES.categories),
    getAll<MirrorItem>(STORES.items),
    getAll<MirrorSale>(STORES.sales),
    getAll<MirrorExpense>(STORES.expenses),
    getAll<MirrorAttendant>(STORES.attendants),
  ]);
  return { categories, items, sales, expenses, attendants };
}

// ----------------------------------------------------------------- write

/**
 * Applies a delta.
 *
 * One transaction across every store, because half a delta renders as a list
 * of blank rows — sales pointing at items that did not arrive — and the cursor
 * advancing alongside it would make that permanent.
 *
 * Soft-deleted rows are removed outright rather than kept with a tombstone.
 * The server keeps the audit trail; the device only needs to stop showing them,
 * and a phone should not carry a year of deletions it will never display.
 */
export async function applyDelta(delta: Delta): Promise<void> {
  await writeAll(
    ['categories', 'items', 'sales', 'expenses', 'attendants'],
    (tx) => {
      upsert(tx, STORES.categories, delta.categories);
      upsert(tx, STORES.items, delta.items);
      upsert(tx, STORES.sales, delta.sales);
      upsert(tx, STORES.expenses, delta.expenses);
      upsert(tx, STORES.attendants, delta.attendants);
    },
  );
}

function upsert(
  tx: IDBTransaction,
  store: string,
  rows: Array<{ id: number; deletedAt?: string | null }>,
) {
  const objectStore = tx.objectStore(store);
  for (const row of rows) {
    if (row.deletedAt) objectStore.delete(row.id);
    else objectStore.put(row);
  }
}

// ------------------------------------------------------------ projection

/**
 * Everything in the outbox, laid over the snapshot.
 *
 * Ops are applied in queue order for the same reason the server replays them
 * in order: an item created offline must exist before the sale that references
 * it can be attached to it.
 *
 * Entries in `needs_attention` are deliberately EXCLUDED. They were refused —
 * showing a sale the server has rejected as though it were recorded is how a
 * shop ends up with two sets of figures. They live on the Needs attention
 * screen until someone resolves them.
 */
export function project(snapshot: Snapshot, outbox: OutboxEntry[]): Projection {
  const categories = new Map<string, LocalCategory>();
  const items = new Map<string, LocalItem>();
  const sales = new Map<string, LocalSale>();
  const expenses = new Map<string, LocalExpense>();

  for (const row of snapshot.categories) categories.set(String(row.id), toLocal(row));
  for (const row of snapshot.items) items.set(String(row.id), toLocal(row));
  for (const row of snapshot.sales) sales.set(String(row.id), toLocal(row));
  for (const row of snapshot.expenses) expenses.set(String(row.id), toLocal(row));

  // clientId -> key, so a queued op that names a locally created row finds it.
  const byClientId = new Map<string, string>();
  for (const [key, row] of items) if (row.clientId) byClientId.set(row.clientId, key);
  for (const [key, row] of categories) if (row.clientId) byClientId.set(row.clientId, key);

  const resolve = (ref: Ref | undefined, map: Map<string, { id: number | null }>): string | null => {
    if (!ref) return null;
    if (isLocalRef(ref)) {
      const key = byClientId.get(ref.clientId) ?? `local:${ref.clientId}`;
      return map.has(key) ? key : null;
    }
    return map.has(String(ref.id)) ? String(ref.id) : null;
  };

  for (const entry of outbox) {
    if (entry.status !== 'queued') continue;

    switch (entry.kind) {
      case 'sale.create': {
        const data = entry.data as SaleCreateData;
        const itemKey = resolve(data.item, items);
        const item = itemKey ? items.get(itemKey) : undefined;
        if (!item) break;

        // The whole point of the projection: stock the person can trust.
        item.qtyRemaining = Math.max(0, item.qtyRemaining - data.quantity);

        const key = `local:${data.clientId}`;
        sales.set(key, {
          key,
          id: null,
          pending: true,
          opId: entry.id,
          itemId: item.id ?? -1,
          saleDate: data.saleDate,
          quantity: data.quantity,
          unitPrice: data.unitPrice,
          belowMin: data.unitPrice < item.minPrice,
          // Stamped by the server from the session; unknown until then, and
          // "you" is what the person recording it would call themselves.
          attendantId: null,
          clientId: data.clientId,
          createdAt: entry.createdAt,
          deletedAt: null,
        });
        break;
      }

      case 'sale.delete': {
        const ref = (entry.data as { sale: Ref }).sale;
        const key = resolve(ref, sales);
        const sale = key ? sales.get(key) : undefined;
        if (!sale) break;

        const item = items.get(String(sale.itemId));
        if (item) item.qtyRemaining += sale.quantity;
        sales.delete(key!);
        break;
      }

      case 'expense.create': {
        const data = entry.data as ExpenseCreateData;
        const key = `local:${data.clientId}`;
        expenses.set(key, {
          key,
          id: null,
          pending: true,
          opId: entry.id,
          expenseDate: data.expenseDate,
          description: data.description,
          amount: data.amount,
          kind: data.kind,
          attendantId: null,
          clientId: data.clientId,
          createdAt: entry.createdAt,
          deletedAt: null,
        });
        break;
      }

      case 'expense.delete': {
        const key = resolve((entry.data as { expense: Ref }).expense, expenses);
        if (key) expenses.delete(key);
        break;
      }

      case 'item.create': {
        const data = entry.data as ItemCreateData;
        const categoryKey = resolve(data.category, categories);
        const key = `local:${data.clientId}`;
        byClientId.set(data.clientId, key);

        items.set(key, {
          key,
          id: null,
          pending: true,
          opId: entry.id,
          categoryId: categoryKey ? (categories.get(categoryKey)!.id ?? -1) : -1,
          specifics: data.specifics,
          minPrice: data.minPrice,
          quantity: data.quantity,
          // A new batch starts entirely unsold.
          qtyRemaining: data.quantity,
          purchaseDate: data.purchaseDate,
          archived: false,
          clientId: data.clientId,
          costPrice: data.costPrice,
        });
        break;
      }

      case 'item.update': {
        const data = entry.data as ItemUpdateData;
        const key = resolve(data.item, items);
        const item = key ? items.get(key) : undefined;
        if (!item) break;

        // Mirrors the server: units already sold are derived, never re-counted.
        const unitsSold = item.quantity - item.qtyRemaining;
        const categoryKey = resolve(data.category, categories);

        Object.assign(item, {
          categoryId: categoryKey ? (categories.get(categoryKey)!.id ?? item.categoryId) : item.categoryId,
          specifics: data.specifics,
          costPrice: data.costPrice,
          minPrice: data.minPrice,
          quantity: data.quantity,
          qtyRemaining: Math.max(0, data.quantity - unitsSold),
          purchaseDate: data.purchaseDate,
          pending: true,
        });
        break;
      }

      case 'item.archive': {
        const data = entry.data as { item: Ref; archived: boolean };
        const key = resolve(data.item, items);
        const item = key ? items.get(key) : undefined;
        if (item) {
          item.archived = data.archived;
          item.pending = true;
        }
        break;
      }

      case 'category.create': {
        const data = entry.data as { clientId: string; name: string };
        const key = `local:${data.clientId}`;
        byClientId.set(data.clientId, key);
        categories.set(key, {
          key,
          id: null,
          pending: true,
          opId: entry.id,
          name: data.name,
          clientId: data.clientId,
          deletedAt: null,
        });
        break;
      }

      case 'category.rename': {
        const data = entry.data as { category: Ref; name: string };
        const key = resolve(data.category, categories);
        const category = key ? categories.get(key) : undefined;
        if (category) {
          category.name = data.name;
          category.pending = true;
        }
        break;
      }

      case 'category.delete': {
        const key = resolve((entry.data as { category: Ref }).category, categories);
        if (key) categories.delete(key);
        break;
      }
    }
  }

  const categoryList = [...categories.values()];
  const nameById = new Map(categoryList.map((c) => [c.id, c.name] as const));
  const attendantById = new Map(snapshot.attendants.map((a) => [a.id, a.name] as const));

  return {
    categories: categoryList.sort((a, b) => a.name.localeCompare(b.name)),
    items: [...items.values()],
    sales: [...sales.values()],
    expenses: [...expenses.values()],
    attendants: snapshot.attendants,
    categoryName: (id) => (id === null ? 'Uncategorised' : (nameById.get(id) ?? 'Uncategorised')),
    attendantName: (id) => (id === null ? null : (attendantById.get(id) ?? null)),
  };
}

function toLocal<T extends { id: number; clientId?: string | null }>(row: T): Local<T> {
  return { ...row, id: row.id, key: String(row.id), pending: false } as Local<T>;
}

// --------------------------------------------------------------- selectors
//
// The SQL each screen used to run, rewritten over the projection. Kept here
// rather than in components so there is one definition of, for example, what
// counts as sellable — the answer has to match lib/queries.ts exactly or the
// same screen shows different stock depending on whether it is online.

/** Mirrors getSellableItems(): not archived, something left, category alive. */
export function sellableItems(projection: Projection) {
  const liveCategories = new Set(projection.categories.map((c) => c.id));

  return projection.items
    .filter((item) => !item.archived && item.qtyRemaining > 0 && liveCategories.has(item.categoryId))
    .map((item) => ({
      id: item.id,
      key: item.key,
      specifics: item.specifics,
      minPrice: item.minPrice,
      qtyRemaining: item.qtyRemaining,
      categoryId: item.categoryId,
      categoryName: projection.categoryName(item.categoryId),
      clientId: item.clientId,
      pending: item.pending,
    }))
    .sort(
      (a, b) =>
        a.categoryName.localeCompare(b.categoryName) || a.specifics.localeCompare(b.specifics),
    );
}

/** Mirrors getStockUnitCount() / the units half of getStockValue(). */
export function stockUnits(projection: Projection) {
  const live = projection.items.filter((item) => !item.archived);
  return {
    units: live.reduce((total, item) => total + item.qtyRemaining, 0),
    batches: live.filter((item) => item.qtyRemaining > 0).length,
  };
}

export function salesInRange(projection: Projection, from: string, to: string) {
  // Ranges are inclusive of both endpoints, as in lib/dates.ts.
  return projection.sales
    .filter((sale) => sale.saleDate >= from && sale.saleDate <= to)
    .sort((a, b) => b.saleDate.localeCompare(a.saleDate) || (b.id ?? 0) - (a.id ?? 0));
}

export function expensesInRange(projection: Projection, from: string, to: string) {
  return projection.expenses
    .filter((expense) => expense.expenseDate >= from && expense.expenseDate <= to)
    .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate) || (b.id ?? 0) - (a.id ?? 0));
}
