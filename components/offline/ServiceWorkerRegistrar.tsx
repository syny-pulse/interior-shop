'use client';

import { useEffect, useState } from 'react';

/**
 * Registers public/sw.js and surfaces waiting updates.
 *
 * The prompt is not politeness. A service worker keeps serving the old build
 * until every tab is closed, and a phone in a shop is never closed — an
 * attendant would sit on a month-old bundle indefinitely. Asking is the only
 * way to reload at a moment that will not throw away a half-typed sale.
 */
export function ServiceWorkerRegistrar() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // A worker registered against a dev build caches Turbopack chunks that stop
    // existing on the next edit, which looks exactly like a corrupted app.
    if (process.env.NODE_ENV !== 'production') return;

    let cancelled = false;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        if (cancelled) return;

        if (registration.waiting) setWaiting(registration.waiting);

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;

          installing.addEventListener('statechange', () => {
            // controller === null means this is the first install, not an
            // update; there is nothing for the user to accept.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              setWaiting(installing);
            }
          });
        });
      })
      .catch((error) => {
        console.error('[sw] registration failed', error);
      });

    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  if (!waiting) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-[var(--radius-card)] border px-4 py-3 shadow-lg"
      style={{ background: 'var(--surface)', borderColor: 'var(--border-strong)' }}
    >
      <span className="text-[0.875rem]">A new version is ready.</span>
      <button
        type="button"
        className="btn btn-primary px-3 py-1.5 text-[0.875rem]"
        onClick={() => waiting.postMessage({ type: 'SKIP_WAITING' })}
      >
        Update
      </button>
    </div>
  );
}
