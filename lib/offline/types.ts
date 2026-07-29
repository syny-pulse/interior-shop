/**
 * The wire format between the device and /api/sync.
 *
 * Imported by BOTH the route handler and the browser, so there is exactly one
 * definition of what a queued mutation looks like. If these two drifted, the
 * failure mode would be a sale that leaves the phone and quietly never arrives.
 *
 * No imports from db/schema.ts or drizzle here — this file is loaded in the
 * browser.
 */

import type { ExpenseKind } from '@/lib/expense-kinds';

// ------------------------------------------------------------- references
//
// A queued op may name a row that does not exist on the server yet: the owner
// adds a batch of blankets offline, then sells two of them, still offline.
// Both ops sync together and the sale must find the item.
//
// So a reference is EITHER a server id (the normal case) OR the clientId of a
// row created on this device. The server resolves the second form via the
// unique client_id index.

export type Ref = { id: number } | { clientId: string };

export function isLocalRef(ref: Ref): ref is { clientId: string } {
  return 'clientId' in ref;
}

// -------------------------------------------------------------------- ops

export interface SaleCreateData {
  clientId: string;
  item: Ref;
  saleDate: string;
  quantity: number;
  unitPrice: number;
}

export interface ExpenseCreateData {
  clientId: string;
  expenseDate: string;
  description: string;
  amount: number;
  kind: ExpenseKind;
}

export interface ItemCreateData {
  clientId: string;
  category: Ref;
  specifics: string;
  costPrice: number;
  minPrice: number;
  quantity: number;
  purchaseDate: string;
}

export interface ItemUpdateData {
  item: Ref;
  category: Ref;
  specifics: string;
  costPrice: number;
  minPrice: number;
  quantity: number;
  purchaseDate: string;
}

export type OpData =
  | { kind: 'sale.create'; data: SaleCreateData }
  | { kind: 'sale.delete'; data: { sale: Ref } }
  | { kind: 'expense.create'; data: ExpenseCreateData }
  | { kind: 'expense.delete'; data: { expense: Ref } }
  | { kind: 'item.create'; data: ItemCreateData }
  | { kind: 'item.update'; data: ItemUpdateData }
  | { kind: 'item.archive'; data: { item: Ref; archived: boolean } }
  | { kind: 'category.create'; data: { clientId: string; name: string } }
  | { kind: 'category.rename'; data: { category: Ref; name: string } }
  | { kind: 'category.delete'; data: { category: Ref } };

export type OpKind = OpData['kind'];

export type Op = OpData & {
  /** Idempotency key for the OPERATION, distinct from any row's clientId. */
  id: string;
  /**
   * When the device recorded it, ISO 8601.
   *
   * The server writes this into created_at rather than defaulting to now(), or
   * a day of queued sales would all appear to have happened in the same second
   * at reconnection. It is clamped server-side — a phone with a wrong clock
   * must not be able to file a sale in the future.
   */
  at: string;
};

/** Ops the owner alone may enqueue. Attendants record sales and expenses only. */
export const OWNER_ONLY_OPS: readonly OpKind[] = [
  'item.create',
  'item.update',
  'item.archive',
  'category.create',
  'category.rename',
  'category.delete',
];

// ---------------------------------------------------------------- results

export type OpResult =
  | { opId: string; status: 'applied'; id?: number; clientId?: string; message?: string }
  /** Already applied on an earlier attempt. Same outcome as applied, drop it. */
  | { opId: string; status: 'duplicate'; id?: number; clientId?: string }
  /**
   * The server refused it. `reason` is written for the person holding the
   * phone, because that is where it is displayed. `remaining` is set on an
   * oversell so the conflict screen can offer "change quantity to N".
   */
  | { opId: string; status: 'rejected'; reason: string; remaining?: number; field?: string };

// ------------------------------------------------------------------ delta

/**
 * ATTENDANT-SAFE ROWS.
 *
 * These shapes are what an attendant's device stores. IndexedDB is readable by
 * anyone holding the phone, so the cost-price boundary described in
 * lib/queries.ts applies here with full force: no costPrice, no unitCost, no
 * profit. The boundary is enforced server-side in getDelta(); these types are
 * how it is stated.
 */

export interface MirrorCategory {
  id: number;
  name: string;
  clientId: string | null;
  deletedAt: string | null;
}

export interface MirrorItem {
  id: number;
  categoryId: number;
  specifics: string;
  minPrice: number;
  quantity: number;
  qtyRemaining: number;
  purchaseDate: string;
  archived: boolean;
  clientId: string | null;
  /** OWNER ONLY. Absent from every row an attendant's device receives. */
  costPrice?: number;
}

export interface MirrorSale {
  id: number;
  itemId: number;
  saleDate: string;
  quantity: number;
  unitPrice: number;
  belowMin: boolean;
  attendantId: number | null;
  clientId: string | null;
  createdAt: string;
  deletedAt: string | null;
  /** OWNER ONLY. Absent from every row an attendant's device receives. */
  unitCost?: number;
}

export interface MirrorExpense {
  id: number;
  expenseDate: string;
  description: string;
  amount: number;
  kind: string;
  attendantId: number | null;
  clientId: string | null;
  createdAt: string;
  deletedAt: string | null;
}

export interface MirrorAttendant {
  id: number;
  name: string;
  active: boolean;
}

export interface Delta {
  categories: MirrorCategory[];
  items: MirrorItem[];
  sales: MirrorSale[];
  expenses: MirrorExpense[];
  attendants: MirrorAttendant[];
}

// -------------------------------------------------------------- envelopes

export interface SyncRequest {
  /**
   * ISO timestamp of the last successful pull, or null for a first sync.
   * Null also means "send me everything" unless pushOnly is set.
   */
  since: string | null;
  ops: Op[];
  /**
   * Set by the service worker's background drain, which has no mirror to apply
   * a delta to and deliberately leaves the cursor alone. See public/sw.js.
   */
  pushOnly?: boolean;
}

export interface SyncResponse {
  /** Feed back as `since` next time. */
  cursor: string;
  results: OpResult[];
  /** clientId -> server id, for rows this device created. */
  idMap: Record<string, number>;
  delta: Delta;
  /**
   * The device must throw its mirror away and take this delta as the whole
   * truth. Sent when the session identity changed — a different attendant, or
   * the owner, on a shared phone.
   */
  reset: boolean;
  /** Who the server thinks is asking. The device compares it with its own. */
  identity: string;
}

export interface SyncError {
  error: 'unauthenticated' | 'revoked' | 'bad_request';
  message: string;
}

/**
 * How far back a device is allowed to be behind before the server stops
 * computing a delta and just sends everything. Also bounds a first sync.
 */
export const MIRROR_WINDOW_DAYS = 120;
