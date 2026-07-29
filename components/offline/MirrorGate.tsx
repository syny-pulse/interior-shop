'use client';

import { CloudSlashIcon } from '@phosphor-icons/react';
import { useSync } from './SyncProvider';

/**
 * Stands between a screen and its data for the moment IndexedDB takes to
 * answer.
 *
 * Worth a component of its own because "still reading the device" and "the
 * shop has nothing" render identically otherwise, and telling an attendant
 * there is no stock to sell — when there is — is the kind of wrong answer that
 * gets an app abandoned. A brief skeleton is the honest state.
 *
 * `cold` is the other honest state: a device that has never completed a sync
 * has nothing to show and no way to get it until there is a connection. Saying
 * so beats an empty list that looks like an empty shop.
 */
export function MirrorGate({ children }: { children: React.ReactNode }) {
  const { ready, cold, state, syncNow } = useSync();

  if (!ready) {
    return (
      <div className="space-y-3" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading</span>
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="surface h-16 animate-pulse"
            style={{ opacity: 1 - row * 0.25 }}
          />
        ))}
      </div>
    );
  }

  if (cold) {
    return (
      <div className="surface flex flex-col items-center gap-3 px-6 py-12 text-center">
        <div
          className="flex size-11 items-center justify-center rounded-full"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}
        >
          <CloudSlashIcon size={20} weight="duotone" />
        </div>
        <p className="font-medium">Nothing saved on this phone yet</p>
        <p className="max-w-[38ch] text-[0.875rem] text-[var(--text-muted)]">
          Connect once and the books will be copied here. After that the app works
          without a connection.
        </p>
        <button
          type="button"
          onClick={() => void syncNow()}
          disabled={state.syncing}
          className="btn btn-primary mt-1"
        >
          {state.syncing ? 'Trying' : 'Try now'}
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
