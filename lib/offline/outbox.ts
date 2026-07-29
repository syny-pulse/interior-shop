import { STORES, getAll, nextSeq, put, remove } from './db';
import type { Op, OpData, OpKind } from './types';

/**
 * The queue of mutations that have not reached the server.
 *
 * Everything the app writes goes in here first, online or not. There is no
 * "fast path" that skips the queue when the connection looks fine, because a
 * connection that looks fine in a Kampala shop is a connection that has not
 * been tested yet. One path means one set of behaviour to reason about, and
 * the pending marker simply disappears within a second when there is signal.
 */

export type OutboxStatus =
  | 'queued'
  /**
   * The server refused it and a person has to decide what to do. It is NOT
   * retried automatically — retrying an oversell forever would be noise, and
   * the entry may be the only surviving record of a sale.
   */
  | 'needs_attention';

export interface OutboxEntry {
  id: string;
  seq: number;
  kind: OpKind;
  data: OpData['data'];
  status: OutboxStatus;
  /** When the device recorded it. Becomes the row's created_at. */
  createdAt: string;
  attempts: number;
  /** The server's words, shown on the Needs attention screen. */
  reason?: string;
  /** Units actually left, on an oversell. Drives "change quantity to N". */
  remaining?: number;
  field?: string;
  /** What this was, in one line, for a screen shown hours later. */
  label: string;
}

export function newId(): string {
  // crypto.randomUUID needs a secure context; localhost and https both qualify,
  // which covers everywhere this app runs. The fallback is for old WebViews.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function enqueue(op: OpData & { label: string }): Promise<OutboxEntry> {
  const entry: OutboxEntry = {
    id: newId(),
    seq: await nextSeq(),
    kind: op.kind,
    data: op.data,
    status: 'queued',
    createdAt: new Date().toISOString(),
    attempts: 0,
    label: op.label,
  };

  await put(STORES.outbox, entry);
  return entry;
}

export async function list(): Promise<OutboxEntry[]> {
  const entries = await getAll<OutboxEntry>(STORES.outbox);
  return entries.sort((a, b) => a.seq - b.seq);
}

/** Ready to send. Excludes anything waiting on a person. */
export async function pending(): Promise<OutboxEntry[]> {
  return (await list()).filter((entry) => entry.status === 'queued');
}

export async function needsAttention(): Promise<OutboxEntry[]> {
  return (await list()).filter((entry) => entry.status === 'needs_attention');
}

export async function discard(id: string): Promise<void> {
  await remove(STORES.outbox, id);
}

export async function markRejected(
  entry: OutboxEntry,
  rejection: { reason: string; remaining?: number; field?: string },
): Promise<void> {
  await put(STORES.outbox, {
    ...entry,
    status: 'needs_attention',
    attempts: entry.attempts + 1,
    reason: rejection.reason,
    remaining: rejection.remaining,
    field: rejection.field,
  } satisfies OutboxEntry);
}

/**
 * Puts a rejected entry back in the queue, optionally with corrections.
 *
 * Keeps the same op id, so if the original did in fact land before the
 * connection dropped, the server recognises it as a duplicate instead of
 * recording the sale twice. Corrections to a sale's quantity change what will
 * be written but never who wrote it or when.
 */
export async function retry(
  entry: OutboxEntry,
  patch?: Partial<OutboxEntry['data']>,
): Promise<void> {
  await put(STORES.outbox, {
    ...entry,
    data: patch ? { ...entry.data, ...patch } : entry.data,
    status: 'queued',
    reason: undefined,
    remaining: undefined,
    field: undefined,
  } satisfies OutboxEntry);
}

/** The wire form. Strips the local bookkeeping the server has no use for. */
export function toOp(entry: OutboxEntry): Op {
  return {
    id: entry.id,
    kind: entry.kind,
    data: entry.data,
    at: entry.createdAt,
  } as Op;
}
