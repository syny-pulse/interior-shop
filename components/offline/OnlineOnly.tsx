'use client';

import { CloudSlashIcon } from '@phosphor-icons/react';
import { useSync } from './SyncProvider';

/**
 * Wraps the one screen that genuinely needs a connection.
 *
 * Attendant links cannot be managed offline: the token is a credential minted
 * with the server's CSPRNG, and an offline "revoke" would show a reassuring
 * green tick while the link carried on working — worse than no button at all.
 *
 * So the screen says why, plainly, instead of failing in some other way.
 */
export function OnlineOnly({
  what,
  children,
}: {
  what: string;
  children: React.ReactNode;
}) {
  const { state, syncNow } = useSync();

  if (state.online) return <>{children}</>;

  return (
    <div className="surface flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div
        className="flex size-11 items-center justify-center rounded-full"
        style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}
      >
        <CloudSlashIcon size={20} weight="duotone" />
      </div>
      <p className="font-medium">{what} needs a connection</p>
      <p className="max-w-[42ch] text-[0.875rem] text-[var(--text-muted)]">
        An attendant&apos;s link is a password the server has to issue, and revoking one
        only takes effect once the server knows. Doing either from here without a
        connection would tell you it worked when it had not.
      </p>
      <p className="max-w-[42ch] text-[0.875rem] text-[var(--text-muted)]">
        Everything else — stock, sales, expenses and the dashboard — keeps working.
      </p>
      <button type="button" onClick={() => void syncNow()} className="btn btn-primary mt-1">
        Try again
      </button>
    </div>
  );
}
