/**
 * The device's copy of the books.
 *
 * Raw IndexedDB rather than a wrapper library, for the same reason the service
 * worker is hand-written: this holds the shop's records while they exist
 * nowhere else, and it should be possible to read every line that touches them.
 *
 * BROWSER ONLY. Nothing here may be imported from a Server Component.
 *
 * The three constants below are duplicated in public/sw.js, which cannot
 * import application modules. Change them in both places or the worker will
 * quietly write its results to a database nobody reads.
 */

export const DB_NAME = 'shop-books';
export const DB_VERSION = 1;

export const STORES = {
  categories: 'categories',
  items: 'items',
  sales: 'sales',
  expenses: 'expenses',
  attendants: 'attendants',
  outbox: 'outbox',
  meta: 'meta',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

const MIRROR_STORES: StoreName[] = ['categories', 'items', 'sales', 'expenses', 'attendants'];

export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

let open: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (open) return open;

  open = new Promise((resolve, reject) => {
    if (!isIndexedDbAvailable()) {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      for (const name of MIRROR_STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      }

      if (!db.objectStoreNames.contains(STORES.outbox)) {
        const outbox = db.createObjectStore(STORES.outbox, { keyPath: 'id' });
        // Ops must be replayed in the order they were recorded: an item created
        // offline has to be inserted before the sale that references it.
        outbox.createIndex('seq', 'seq', { unique: false });
        outbox.createIndex('status', 'status', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      /*
       * Another tab is upgrading. Close this handle rather than holding the
       * upgrade hostage — the tab that survives reopens on its next call.
       */
      db.onversionchange = () => {
        db.close();
        open = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      open = null;
      reject(request.error);
    };

    // Firefox in private browsing, and Safari with storage blocked.
    request.onblocked = () => {
      open = null;
      reject(new Error('IndexedDB is blocked by another tab'));
    };
  });

  return open;
}

// -------------------------------------------------------------- primitives

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).getAll();
    request.onsuccess = () => resolve((request.result ?? []) as T[]);
    request.onerror = () => reject(request.error);
  });
}

export async function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function put(store: StoreName, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function remove(store: StoreName, key: IDBValidKey): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Several stores, one transaction.
 *
 * Applying a delta has to be atomic. Half a delta — new sales without the
 * items they point at — renders as a list of blanks, and the cursor advancing
 * alongside it would make that permanent.
 */
export async function writeAll(
  stores: StoreName[],
  work: (tx: IDBTransaction) => void,
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
    try {
      work(tx);
    } catch (error) {
      tx.abort();
      reject(error);
    }
  });
}

// ------------------------------------------------------------------- meta

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await get<{ key: string; value: T }>(STORES.meta, key);
  return row?.value;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await put(STORES.meta, { key, value });
}

export const META = {
  /** ISO timestamp handed back by the last successful pull. */
  cursor: 'cursor',
  /** 'owner' or 'attendant:<linkId>'. Guards against a shared phone. */
  identity: 'identity',
  lastSyncAt: 'lastSyncAt',
  /** Monotonic counter giving outbox entries their replay order. */
  seq: 'seq',
} as const;

/**
 * Throws the whole local copy away.
 *
 * Called when the identity changes (a different attendant picks up the same
 * phone) and when the server answers 401. The second case is the one that
 * matters: it is what finally clears the shop's figures off the device of
 * someone whose access was withdrawn while they were offline.
 *
 * The outbox goes too. Its ops belong to a session that is no longer valid, so
 * there is nowhere to send them.
 */
export async function wipe(): Promise<void> {
  const db = await openDb();
  const names = Object.values(STORES);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite');
    for (const name of names) tx.objectStore(name).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Wipes the mirror but keeps the outbox — used when the server says `reset`. */
export async function wipeMirror(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MIRROR_STORES, 'readwrite');
    for (const name of MIRROR_STORES) tx.objectStore(name).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Next value of the replay counter. Read-modify-write, so it is transactional. */
export async function nextSeq(): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.meta, 'readwrite');
    const store = tx.objectStore(STORES.meta);
    const read = store.get(META.seq);

    read.onsuccess = () => {
      const current = (read.result as { value?: number } | undefined)?.value ?? 0;
      const next = current + 1;
      store.put({ key: META.seq, value: next });
      tx.oncomplete = () => resolve(next);
    };

    tx.onerror = () => reject(tx.error);
  });
}
