'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  EMPTY_SNAPSHOT,
  project,
  readSnapshot,
  type Projection,
  type Snapshot,
} from '@/lib/offline/mirror';
import * as outbox from '@/lib/offline/outbox';
import {
  announceLocalChange,
  readState,
  startAutoSync,
  subscribe,
  sync,
  type SyncState,
} from '@/lib/offline/sync';
import { META, isIndexedDbAvailable, setMeta, getMeta, wipe } from '@/lib/offline/db';

/**
 * The single source every screen reads from.
 *
 * Data flows one way: IndexedDB -> projection -> components. Nothing renders
 * from a fetch, and nothing renders from props passed down by a Server
 * Component either. That last part is deliberate — the service worker can
 * replay a cached HTML document from days ago, and if those stale props were
 * allowed to seed the mirror they would overwrite fresher local state. The
 * mirror is only ever written from a /api/sync response.
 *
 * `ready` is what pages use to avoid rendering "no stock" for the fraction of
 * a second before IndexedDB answers. An empty shop and an unread database look
 * identical otherwise, and telling an attendant there is nothing to sell is a
 * worse failure than a spinner.
 */

interface SyncContextValue {
  projection: Projection;
  entries: outbox.OutboxEntry[];
  state: SyncState;
  ready: boolean;
  /** True when the device has never completed a sync — nothing to show yet. */
  cold: boolean;
  refresh: () => Promise<void>;
  syncNow: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function useSync(): SyncContextValue {
  const value = useContext(SyncContext);
  if (!value) throw new Error('useSync must be used inside <SyncProvider>');
  return value;
}

const EMPTY_STATE: SyncState = {
  online: true,
  syncing: false,
  pendingCount: 0,
  attentionCount: 0,
  lastSyncAt: null,
  lastError: null,
};

export function SyncProvider({
  identity,
  children,
}: {
  /** 'owner' or 'attendant:<linkId>', from the session on the server. */
  identity: string;
  children: React.ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [entries, setEntries] = useState<outbox.OutboxEntry[]>([]);
  const [state, setState] = useState<SyncState>(EMPTY_STATE);
  const [ready, setReady] = useState(false);

  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!isIndexedDbAvailable()) {
      setReady(true);
      return;
    }
    try {
      const [nextSnapshot, nextEntries, nextState] = await Promise.all([
        readSnapshot(),
        outbox.list(),
        readState(),
      ]);
      if (!mounted.current) return;
      setSnapshot(nextSnapshot);
      setEntries(nextEntries);
      setState(nextState);
    } catch (error) {
      console.error('[sync] could not read local data', error);
    } finally {
      if (mounted.current) setReady(true);
    }
  }, []);

  /*
   * Identity is checked here as well as in the sync engine, because this check
   * has to happen BEFORE anything renders. The engine catches it on the next
   * round trip; that is too late if the phone is offline, and showing one
   * attendant the previous attendant's figures — or an attendant the owner's —
   * is the one failure this app cannot have.
   */
  useEffect(() => {
    mounted.current = true;

    let cancelled = false;

    (async () => {
      if (isIndexedDbAvailable()) {
        try {
          const stored = await getMeta<string>(META.identity);
          if (stored && stored !== identity) {
            await wipe();
          }
          await setMeta(META.identity, identity);
        } catch (error) {
          console.error('[sync] identity check failed', error);
        }
      }
      if (!cancelled) await refresh();
    })();

    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [identity, refresh]);

  // The engine notifies on every change it makes; this is what turns a
  // completed background sync into a re-render.
  useEffect(() => subscribe(() => void refresh()), [refresh]);

  useEffect(() => startAutoSync(), []);

  const syncNow = useCallback(async () => {
    await sync({ force: true });
    await refresh();
  }, [refresh]);

  const projection = useMemo(() => project(snapshot, entries), [snapshot, entries]);

  const cold =
    ready &&
    state.lastSyncAt === null &&
    snapshot.items.length === 0 &&
    snapshot.categories.length === 0;

  const value = useMemo(
    () => ({ projection, entries, state, ready, cold, refresh, syncNow }),
    [projection, entries, state, ready, cold, refresh, syncNow],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

/** Re-exported so callers do not need to reach into lib/offline. */
export { announceLocalChange };
