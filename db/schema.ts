import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  date,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

/**
 * MONEY IS STORED AS INTEGER UGX (whole shillings).
 *
 * The Ugandan Shilling has no subunit in practice, so integers sidestep
 * floating-point drift and decimal-string handling entirely. Never introduce
 * a numeric/decimal money column here — format for display in lib/format.ts.
 *
 * DATES are `date` columns (no time component) so a stored row never shifts
 * across a timezone boundary. "Today" is always computed via
 * todayInKampala() in lib/dates.ts, never from the UTC server clock.
 *
 * ===================================================================
 * THREE COLUMNS EXIST FOR OFFLINE SYNC. All three are load-bearing.
 *
 * `clientId`   A UUID minted on the device before the row ever reaches the
 *              server, with a unique index. Two things depend on it:
 *              retries are idempotent (a flaky connection re-sends the same
 *              sale and the second one is recognised rather than decrementing
 *              stock twice), and a sale recorded offline can name an item that
 *              was also created offline, because it references the item's
 *              clientId and the server resolves it. Null on rows created
 *              before this existed; Postgres allows any number of NULLs in a
 *              unique index.
 *
 * `updatedAt`  Maintained by a Postgres trigger, NOT by the mutation code —
 *              see drizzle/0001_offline_sync.sql. A column that every writer
 *              has to remember to set is a column that is eventually wrong,
 *              and this one decides whether a device ever learns about a row.
 *
 * `deletedAt`  Deletion is soft on every table a device mirrors. A hard DELETE
 *              is invisible to an incremental pull — the row simply stops
 *              being returned, which a device cannot distinguish from "not
 *              changed", so it would keep the deleted row for ever. Every
 *              query that reads these tables must filter `deletedAt IS NULL`.
 * ===================================================================
 */

export const categories = pgTable(
  'categories',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    clientId: text('client_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    /*
     * Partial on purpose. A plain unique index would keep a deleted category's
     * name reserved for ever, so "curtains" could never be re-created after a
     * mistaken delete.
     */
    nameUnique: uniqueIndex('categories_name_unique')
      .on(t.name)
      .where(sql`deleted_at IS NULL`),
    clientIdUnique: uniqueIndex('categories_client_id_unique').on(t.clientId),
    byUpdatedAt: index('categories_updated_at_idx').on(t.updatedAt),
  }),
);

/** One row = one purchase batch bought on a shopping day. */
export const items = pgTable(
  'items',
  {
    id: serial('id').primaryKey(),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    specifics: text('specifics').notNull(),
    /** Per unit, in whole shillings. Never exposed to attendants. */
    costPrice: integer('cost_price').notNull(),
    /** Per unit. The "estimated selling price" — doubles as the minimum shown to attendants. */
    minPrice: integer('min_price').notNull(),
    /** How many were bought. */
    quantity: integer('quantity').notNull(),
    /** Decremented by each sale. The oversell guard reads this. */
    qtyRemaining: integer('qty_remaining').notNull(),
    purchaseDate: date('purchase_date').notNull(),
    archived: boolean('archived').notNull().default(false),
    clientId: text('client_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCategory: index('items_category_idx').on(t.categoryId),
    byPurchaseDate: index('items_purchase_date_idx').on(t.purchaseDate),
    clientIdUnique: uniqueIndex('items_client_id_unique').on(t.clientId),
    byUpdatedAt: index('items_updated_at_idx').on(t.updatedAt),
  }),
);

export const attendantLinks = pgTable(
  'attendant_links',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    /** 32 random bytes, base64url. The whole of an attendant's credential. */
    token: text('token').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({
    tokenUnique: uniqueIndex('attendant_links_token_unique').on(t.token),
    byUpdatedAt: index('attendant_links_updated_at_idx').on(t.updatedAt),
  }),
);

export const sales = pgTable(
  'sales',
  {
    id: serial('id').primaryKey(),
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    saleDate: date('sale_date').notNull(),
    quantity: integer('quantity').notNull().default(1),
    /** What it actually sold for, per unit. */
    unitPrice: integer('unit_price').notNull(),
    /**
     * SNAPSHOT of items.costPrice at the moment of sale — deliberately not a join.
     * If Sarah later corrects a typo in a batch's cost, historical profit must not
     * silently change. It also makes profit a single-table aggregate.
     */
    unitCost: integer('unit_cost').notNull(),
    /** True when unitPrice < items.minPrice at the time of sale. */
    belowMin: boolean('below_min').notNull().default(false),
    /** null = recorded by Sarah herself. */
    attendantId: integer('attendant_id').references(() => attendantLinks.id, {
      onDelete: 'set null',
    }),
    clientId: text('client_id'),
    /**
     * When the sale was recorded ON THE DEVICE, which for an offline sale is
     * hours before it reached this table. Set from the client rather than
     * defaulting to now(), or a day's worth of queued sales would all appear
     * to have happened in the same second at reconnection.
     */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    bySaleDate: index('sales_sale_date_idx').on(t.saleDate),
    byItem: index('sales_item_idx').on(t.itemId),
    clientIdUnique: uniqueIndex('sales_client_id_unique').on(t.clientId),
    byUpdatedAt: index('sales_updated_at_idx').on(t.updatedAt),
  }),
);

export const expenses = pgTable(
  'expenses',
  {
    id: serial('id').primaryKey(),
    expenseDate: date('expense_date').notNull(),
    description: text('description').notNull(),
    amount: integer('amount').notNull(),
    /** rent | transport | stock_transport | wages | utilities | other */
    kind: text('kind').notNull().default('other'),
    attendantId: integer('attendant_id').references(() => attendantLinks.id, {
      onDelete: 'set null',
    }),
    clientId: text('client_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    byExpenseDate: index('expenses_expense_date_idx').on(t.expenseDate),
    clientIdUnique: uniqueIndex('expenses_client_id_unique').on(t.clientId),
    byUpdatedAt: index('expenses_updated_at_idx').on(t.updatedAt),
  }),
);

export const categoriesRelations = relations(categories, ({ many }) => ({
  items: many(items),
}));

export const itemsRelations = relations(items, ({ one, many }) => ({
  category: one(categories, { fields: [items.categoryId], references: [categories.id] }),
  sales: many(sales),
}));

export const salesRelations = relations(sales, ({ one }) => ({
  item: one(items, { fields: [sales.itemId], references: [items.id] }),
  attendant: one(attendantLinks, {
    fields: [sales.attendantId],
    references: [attendantLinks.id],
  }),
}));

export const expensesRelations = relations(expenses, ({ one }) => ({
  attendant: one(attendantLinks, {
    fields: [expenses.attendantId],
    references: [attendantLinks.id],
  }),
}));

export type Category = typeof categories.$inferSelect;
export type Item = typeof items.$inferSelect;
export type Sale = typeof sales.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type AttendantLink = typeof attendantLinks.$inferSelect;

/**
 * Re-exported for the server, which has always imported them from here.
 * The definitions moved to lib/expense-kinds.ts so the browser can read them
 * without dragging drizzle-orm/pg-core into the bundle.
 */
export {
  EXPENSE_KINDS,
  EXPENSE_KIND_LABELS,
  type ExpenseKind,
} from '@/lib/expense-kinds';
