/**
 * Lives here rather than in db/schema.ts because both the forms and the offline
 * code import it from the browser, and db/schema.ts pulls in
 * drizzle-orm/pg-core — a server-side query builder that has no business in a
 * phone's bundle.
 */

export const EXPENSE_KINDS = [
  'rent',
  'transport',
  'stock_transport',
  'wages',
  'utilities',
  'other',
] as const;

export type ExpenseKind = (typeof EXPENSE_KINDS)[number];

export const EXPENSE_KIND_LABELS: Record<ExpenseKind, string> = {
  rent: 'Rent',
  transport: 'Transport',
  stock_transport: 'Stock transport',
  wages: 'Wages',
  utilities: 'Utilities',
  other: 'Other',
};
