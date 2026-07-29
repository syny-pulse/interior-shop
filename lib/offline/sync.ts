import { META, getMeta, isIndexedDbAvailable, setMeta, wipe, wipeMirror } from './db';
import { applyDelta } from './mirror';
import * as outbox from './outbox';
import type { SyncError, SyncResponse } from './types';

/**
 * The engine: push the outbox, pull what changed, apply it.
 *
 * Everything about this file is shaped by one fact — the connection it runs on
 * is not merely slow, it is intermittent and lies about being available.
 * navigator.onLine says "online" for a phone attached to a wifi router with no
 * upstream, so it is used as a hint about when to TRY, never as permission.
 * The only real evidence of connectivity is a completed round trip.
 */

const ENDPOINT = '/api/sync';
const SYNC_TAG = 'shop-books-outbox';

/** Long enough for a bad connection, short enough not to pile up. */
const REQUEST_TIMEOUT_MS = 20_000;

const BACKOFF_MIN_MS = 2_000;
const BACKOFF_MAX_MS = 5 * 60_000;

export type SyncOutcome =
  | { ok: true; pushed: number; rejected: number; pulled: number }
  | { ok: false; reason: 'offline' | 'auth' | 'error'; message?: string };

export interface SyncState {
  online: boolean;
  syncing: boolean;
  pendingCount: number;
  attentionCount: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

// ------------------------------------------------------------ single flight

/**
 * Two syncs at once would send the same ops twice. The server's idempotency
 * keys would catch that, but the second request would also apply a delta on
 * top of the first's, and the cursor would end up wherever the slower response
 * left it — behind. One at a time.
 */
let inFlight: Promise<SyncOutcome> | null = null;

let failures = 0;
let nextAttemptAt = 0;

const listeners = new Set<() => void>();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) listener();
}

/** Called when the local data changes so every open screen re-reads it. */
export function announceLocalChange() {
  notify();
}

export async function readState(): Promise<SyncState> {
  if (!isIndexedDbAvailable()) {
    return {
      online: true,
      syncing: false,
      pendingCount: 0,
      attentionCount: 0,
      lastSyncAt: null,
      lastError: null,
    };
  }

  const [entries, lastSyncAt] = await Promise.all([
    outbox.list(),
    getMeta<string>(META.lastSyncAt),
  ]);

  return {
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    syncing: inFlight !== null,
    pendingCount: entries.filter((e) => e.status === 'queued').length,
    attentionCount: entries.filter((e) => e.status === 'needs_attention').length,
    lastSyncAt: lastSyncAt ?? null,
    lastError: null,
  };
}

// -------------------------------------------------------------------- sync

export function sync(options: { force?: boolean } = {}): Promise<SyncOutcome> {
  if (inFlight) return inFlight;

  // A manual "sync now" ignores the backoff. Someone tapping the button has
  // information the timer does not — they can see the signal bars.
  if (!options.force && Date.now() < nextAttemptAt) {
    return Promise.resolve({ ok: false, reason: 'offline' });
  }

  inFlight = run()
    .then((outcome) => {
      if (outcome.ok) {
        failures = 0;
        nextAttemptAt = 0;
      } else if (outcome.reason !== 'auth') {
        /*
         * Exponential backoff, because the failure mode this protects against
         * is not a busy server — it is a phone with no signal retrying every
         * two seconds for an hour and flattening its battery.
         */
        failures++;
        const delay = Math.min(BACKOFF_MIN_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
        nextAttemptAt = Date.now() + delay;
      }
      return outcome;
    })
    .finally(() => {
      inFlight = null;
      notify();
    });

  notify();
  return inFlight;
}

async function run(): Promise<SyncOutcome> {
  if (!isIndexedDbAvailable()) return { ok: false, reason: 'error' };

  const queued = await outbox.pending();
  const since = (await getMeta<string>(META.cursor)) ?? null;

  let response: Response;
  try {
    response = await withTimeout(
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ since, ops: queued.map(outbox.toOp) }),
      }),
      REQUEST_TIMEOUT_MS,
    );
  } catch {
    return { ok: false, reason: 'offline' };
  }

  if (response.status === 401) {
    /*
     * The session is gone, or the link was revoked while this phone was
     * offline. Wiping is the point: it is the only thing that ever removes the
     * shop's figures from a device whose access has been withdrawn.
     *
     * The outbox goes with it. Those ops belong to a session that no longer
     * exists, so there is nowhere to send them and no one to attribute them to.
     */
    const body = (await response.json().catch(() => null)) as SyncError | null;
    await wipe();
    notify();

    if (typeof window !== 'undefined') {
      window.location.href = body?.error === 'revoked' ? '/login?revoked=1' : '/login';
    }
    return { ok: false, reason: 'auth', message: body?.message };
  }

  if (!response.ok) {
    return { ok: false, reason: 'error', message: `Server returned ${response.status}` };
  }

  let body: SyncResponse;
  try {
    body = (await response.json()) as SyncResponse;
  } catch {
    return { ok: false, reason: 'error', message: 'Could not read the sync response' };
  }

  /*
   * Identity check BEFORE anything is written.
   *
   * A shared phone in a shop is normal: one attendant hands it to another, or
   * the owner signs in on it. If the person the server is answering is not the
   * person this mirror belongs to, the mirror is not ours to add to — start
   * over rather than blending two people's books.
   */
  const storedIdentity = await getMeta<string>(META.identity);
  if (storedIdentity && storedIdentity !== body.identity) {
    await wipe();
    await setMeta(META.identity, body.identity);
    notify();
    // Re-sync from scratch. The delta just fetched was computed against a
    // cursor belonging to somebody else.
    return sync({ force: true });
  }

  let rejected = 0;

  for (const result of body.results) {
    const entry = queued.find((e) => e.id === result.opId);
    if (!entry) continue;

    if (result.status === 'applied' || result.status === 'duplicate') {
      await outbox.discard(entry.id);
    } else {
      rejected++;
      await outbox.markRejected(entry, {
        reason: result.reason,
        remaining: result.remaining,
        field: result.field,
      });
    }
  }

  // The server sends `reset` when it computed the delta from nothing, which
  // makes it the whole truth rather than an increment.
  if (body.reset) await wipeMirror();

  await applyDelta(body.delta);

  await setMeta(META.cursor, body.cursor);
  await setMeta(META.identity, body.identity);
  await setMeta(META.lastSyncAt, new Date().toISOString());

  notify();

  return {
    ok: true,
    pushed: queued.length - rejected,
    rejected,
    pulled:
      body.delta.categories.length +
      body.delta.items.length +
      body.delta.sales.length +
      body.delta.expenses.length,
  };
}

function withTimeout(promise: Promise<Response>, ms: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// ---------------------------------------------------------------- triggers

/**
 * Asks the browser to finish this for us if the app is closed.
 *
 * Chrome and Samsung Internet on Android honour it. iOS Safari has no
 * Background Sync at all — on an iPhone the queue drains when the app is next
 * opened, which the listeners below cover. Worth knowing before promising an
 * attendant their sales will arrive on their own.
 */
export async function requestBackgroundSync(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const manager = (registration as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    }).sync;
    await manager?.register(SYNC_TAG);
  } catch {
    // Unsupported, or permission denied. The in-page triggers still apply.
  }
}

/**
 * Every reason to try, in one place.
 *
 * `online` alone is not enough: it fires when the OS thinks an interface came
 * up, which in a shop is frequently a wifi network that goes nowhere. The
 * visibility and interval triggers are what actually catch a connection that
 * came back quietly while the phone was in a pocket.
 */
export function startAutoSync(intervalMs = 60_000): () => void {
  if (typeof window === 'undefined') return () => {};

  const attempt = () => {
    if (document.visibilityState === 'hidden') return;
    void sync();
  };

  const onOnline = () => {
    // A fresh connection deserves a fresh attempt, not the backoff earned by
    // failures from before it existed.
    failures = 0;
    nextAttemptAt = 0;
    void sync({ force: true });
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') attempt();
  };

  const onWorkerMessage = (event: MessageEvent) => {
    if (event.data?.type === 'SYNC_NOW') void sync({ force: true });
  };

  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  navigator.serviceWorker?.addEventListener('message', onWorkerMessage);

  const timer = window.setInterval(attempt, intervalMs);

  void sync({ force: true });

  return () => {
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    navigator.serviceWorker?.removeEventListener('message', onWorkerMessage);
    window.clearInterval(timer);
  };
}

/**
 * Queue a mutation and try to send it immediately.
 *
 * The send is deliberately not awaited by callers: the entry is durable in
 * IndexedDB the moment enqueue() resolves, so the form can clear itself for the
 * next customer without waiting on a network that may take twenty seconds to
 * admit it is not there.
 */
export async function enqueueAndSync(
  op: Parameters<typeof outbox.enqueue>[0],
): Promise<void> {
  await outbox.enqueue(op);
  notify();

  void requestBackgroundSync();
  void sync({ force: true });
}

/** Clears the local copy on sign-out. See components/offline/SignOutButton.tsx. */
export async function clearLocalData(): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    await wipe();
  } catch {
    // Nothing to do — the session is ending regardless.
  }
  notify();
}
