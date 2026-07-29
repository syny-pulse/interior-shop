'use client';

import Link from 'next/link';
import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  CloudSlashIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import { useSync } from './SyncProvider';
import { pluralise } from '@/lib/format';

/**
 * The one place the app admits it is offline.
 *
 * It has to be visible without being alarming. An attendant recording sales in
 * a shop with no signal is not in an error state — the app is working exactly
 * as intended — so "Offline" is stated plainly and the count of what is
 * waiting is the reassurance that nothing has been lost. The only red state is
 * the one that genuinely needs a person: an entry the server refused.
 */
export function SyncStatusBadge() {
  const { state, syncNow } = useSync();

  if (state.attentionCount > 0) {
    return (
      <Link
        href="/sync"
        className="chip chip-warn flex items-center gap-1.5"
        style={{ textDecoration: 'none' }}
      >
        <WarningIcon size={14} weight="fill" />
        {state.attentionCount} to fix
      </Link>
    );
  }

  if (!state.online) {
    return (
      <span className="chip chip-muted flex items-center gap-1.5">
        <CloudSlashIcon size={14} weight="duotone" />
        Offline
        {state.pendingCount > 0 && ` · ${state.pendingCount} waiting`}
      </span>
    );
  }

  if (state.syncing) {
    return (
      <span className="chip chip-muted flex items-center gap-1.5">
        <ArrowsClockwiseIcon size={14} className="animate-spin" />
        Saving
      </span>
    );
  }

  if (state.pendingCount > 0) {
    return (
      <button
        type="button"
        onClick={() => void syncNow()}
        className="chip chip-accent flex items-center gap-1.5"
      >
        <ArrowsClockwiseIcon size={14} />
        {state.pendingCount} {pluralise(state.pendingCount, 'entry', 'entries')} waiting
      </button>
    );
  }

  /*
   * Everything is sent. Shown quietly rather than not at all: after an outage,
   * "Saved" is the only thing that tells someone their morning's sales
   * actually left the phone.
   */
  return (
    <span
      className="flex items-center gap-1.5 text-[0.75rem] text-[var(--text-faint)]"
      title={state.lastSyncAt ? `Last saved ${new Date(state.lastSyncAt).toLocaleTimeString()}` : undefined}
    >
      <CheckCircleIcon size={14} weight="fill" />
      Saved
    </span>
  );
}
