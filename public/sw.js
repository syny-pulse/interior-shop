/**
 * Shop Books service worker.
 *
 * Hand-written on purpose. The alternative (a build plugin generating a
 * precache manifest) hides what actually ships and is one more thing to break
 * on a Next upgrade; this file is short enough to read in full before trusting
 * it with the shop's books.
 *
 * It deliberately does NOT try to make the app work offline on its own. The
 * data lives in IndexedDB (lib/offline/) and the pages render from there. All
 * this worker does is make sure the HTML, JS and CSS needed to boot those pages
 * are on the device, and wake the sync engine when connectivity returns.
 *
 * Bump CACHE_VERSION to evict everything on the next deploy.
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `shop-books-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `shop-books-static-${CACHE_VERSION}`;
const PAGES_CACHE = `shop-books-pages-${CACHE_VERSION}`;

const OFFLINE_URL = '/offline';

/** How long to wait for the network on a navigation before serving the cache. */
const NAVIGATION_TIMEOUT_MS = 3000;

/** Matches the tag registered by lib/offline/sync.ts. */
const SYNC_TAG = 'shop-books-outbox';

const SHELL_ASSETS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon-180.png',
];

// ---------------------------------------------------------------- lifecycle

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, so one 404 during a deploy does not fail the whole install.
      await Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {}),
        ),
      );
      // Take over as soon as possible; there is no old worker whose in-flight
      // requests we need to protect.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, STATIC_CACHE, PAGES_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((name) => !keep.has(name)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  // Sent by ServiceWorkerRegistrar when the user accepts a waiting update.
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ------------------------------------------------------------------- fetch

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never touch anything that changes server state.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-origin requests are left entirely alone. next/font/google is
  // self-hosted at build time into /_next/static/media, so in practice there
  // are none.
  if (url.origin !== self.location.origin) return;

  /*
   * The sync endpoint must never be served from a cache, and must never be
   * queued for replay by the worker — the outbox in IndexedDB is the only
   * retry mechanism, and two of them would double-apply mutations.
   */
  if (url.pathname.startsWith('/api/')) return;

  /*
   * RSC payload requests (Next's client-side navigation and prefetches) carry
   * an RSC header. A stale one is worse than none: it renders a page from data
   * that no longer matches the HTML React is hydrating, so we let these fail
   * offline. Next then falls back to a full navigation, which IS cached below.
   */
  if (request.headers.get('RSC') === '1' || url.searchParams.has('_rsc')) return;

  // Immutable, hash-named build output. Cache-first is safe and is what makes
  // a cold offline boot fast.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request));
    return;
  }
});

/** Immutable assets: serve from cache, fall back to network, store what we fetch. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    // A missing chunk offline is unrecoverable; let it surface as a failure
    // rather than pretending with an empty 200.
    return Response.error();
  }
}

/**
 * Navigations: network first, but only for NAVIGATION_TIMEOUT_MS.
 *
 * Network-first matters because the HTML carries the server-rendered first
 * paint. The timeout matters more: on the kind of connection this shop
 * actually has, a request can hang for thirty seconds before failing, and a
 * blank screen for thirty seconds is indistinguishable from a broken app. We
 * would rather show slightly stale HTML immediately — the page corrects itself
 * from IndexedDB as soon as it hydrates.
 */
async function navigationHandler(request) {
  const cache = await caches.open(PAGES_CACHE);

  try {
    const response = await withTimeout(fetch(request), NAVIGATION_TIMEOUT_MS);

    /*
     * Only cache real pages. A 302 to /login is followed transparently by
     * fetch(), so response.redirected tells us this HTML is the sign-in page
     * rather than the page that was asked for — caching it under the original
     * URL would pin a signed-out user's browser to the login screen.
     */
    if (response.ok && !response.redirected) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;

    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;

    return Response.error();
  }
}

function withTimeout(promise, ms) {
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

// -------------------------------------------------------------- background

/**
 * Fires when the browser decides connectivity is back, even if the app was
 * closed in the meantime. This is what delivers a sale recorded in aeroplane
 * mode without anyone reopening the app.
 *
 * Chrome and Samsung Internet on Android support this. iOS Safari does not, at
 * all — there, sync happens when the app is next opened, which lib/offline/sync.ts
 * covers with its online/visibilitychange triggers.
 */
self.addEventListener('sync', (event) => {
  if (event.tag !== SYNC_TAG) return;
  event.waitUntil(backgroundSync());
});

/**
 * If a window is open it does the sync, because it has the full engine: it
 * applies the delta to the mirror and re-renders. The worker only takes over
 * when there is no window, which is the case Background Sync exists for.
 */
async function backgroundSync() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

  if (clients.length > 0) {
    for (const client of clients) client.postMessage({ type: 'SYNC_NOW' });
    return;
  }

  await pushOutbox();
}

/*
 * PUSH ONLY.
 *
 * The worker sends queued ops and records what the server said about each. It
 * deliberately does NOT advance the sync cursor or apply the returned delta —
 * that is the mirror's job and reimplementing it here would be a second copy
 * of the one piece of logic in this app that must not have two.
 *
 * Leaving the cursor alone costs nothing: the next foreground sync re-pulls
 * from the old cursor, which returns the rows we just wrote, and the mirror
 * upserts by primary key. Re-fetching a few rows is the cheap half of the
 * trade; a sale sitting undelivered on a phone in a drawer is the expensive one.
 */
async function pushOutbox() {
  let db;
  try {
    db = await openOfflineDb();
  } catch {
    return;
  }

  try {
    const queued = (await getAll(db, 'outbox'))
      .filter((op) => op.status === 'queued' || op.status === 'sending')
      .sort((a, b) => a.seq - b.seq);

    if (queued.length === 0) return;

    const response = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The session cookie is httpOnly; same-origin credentials are what
      // authenticate this request exactly as they do from the page.
      credentials: 'same-origin',
      body: JSON.stringify({
        since: null, // tells the server not to bother computing a delta
        pushOnly: true,
        ops: queued.map((op) => ({ id: op.id, kind: op.kind, at: op.createdAt, data: op.data })),
      }),
    });

    if (!response.ok) return; // 401 and 5xx both: leave the queue alone, retry later.

    const body = await response.json();
    const results = Array.isArray(body.results) ? body.results : [];

    for (const result of results) {
      const op = queued.find((o) => o.id === result.opId);
      if (!op) continue;

      if (result.status === 'applied' || result.status === 'duplicate') {
        await remove(db, 'outbox', op.id);
      } else if (result.status === 'rejected') {
        await put(db, 'outbox', {
          ...op,
          status: 'needs_attention',
          reason: result.reason,
          remaining: result.remaining,
          attempts: (op.attempts ?? 0) + 1,
        });
      }
    }
  } catch {
    // Offline again mid-flight. The queue is unchanged, so nothing is lost.
  } finally {
    db.close();
  }
}

// ------------------------------------------------------- minimal IndexedDB
//
// Raw IDB rather than the wrapper in lib/offline/db.ts, because a service
// worker cannot import application modules. These three constants MUST stay in
// step with that file — changing the database name or bumping its version
// without changing them here leaves the worker writing to a database nobody
// reads.

const DB_NAME = 'shop-books';
const DB_VERSION = 1;

function openOfflineDb() {
  return new Promise((resolve, reject) => {
    // Never upgrade from here. If the page has not created the schema yet
    // there is nothing queued to send anyway.
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('blocked'));
  });
}

function getAll(db, store) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
}

function put(db, store, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function remove(db, store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
