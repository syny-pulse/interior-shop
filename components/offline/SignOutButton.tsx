'use client';

import { useState, useTransition } from 'react';
import { SignOutIcon } from '@phosphor-icons/react';
import { logout } from '@/app/actions/auth';
import { clearLocalData } from '@/lib/offline/sync';
import { pluralise } from '@/lib/format';
import { useSync } from './SyncProvider';

/**
 * Signing out has to take the local copy with it.
 *
 * Without this, clearing the cookie leaves the whole mirror — every sale,
 * every cost price — sitting in IndexedDB for whoever opens the browser next.
 * On a shared shop phone that is the entire threat model.
 *
 * It also refuses to leave quietly with unsent entries. Those ops are signed
 * for by this session; once the cookie is gone there is nothing to send them
 * with and no one to attribute them to, so they would be lost silently.
 */
export function SignOutButton() {
  const { state } = useSync();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const unsent = state.pendingCount + state.attentionCount;

  const signOut = () => {
    startTransition(async () => {
      await clearLocalData();
      await logout();
    });
  };

  if (confirming && unsent > 0) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[0.75rem] text-[var(--warn)]">
          {unsent} {pluralise(unsent, 'entry', 'entries')} not sent yet. Sign out anyway?
        </span>
        <button
          type="button"
          onClick={signOut}
          disabled={pending}
          className="btn btn-danger px-2.5 py-1.5 text-[0.8125rem]"
        >
          Sign out
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="btn btn-ghost px-2.5 py-1.5 text-[0.8125rem]"
        >
          Stay
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => (unsent > 0 ? setConfirming(true) : signOut())}
      className="btn btn-ghost px-2.5 py-1.5"
    >
      <SignOutIcon size={16} />
      <span className="sr-only sm:not-sr-only">Sign out</span>
    </button>
  );
}
