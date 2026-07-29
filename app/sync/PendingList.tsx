'use client';

import { useState } from 'react';
import { CheckCircleIcon, WarningIcon } from '@phosphor-icons/react';
import { useSync } from '@/components/offline/SyncProvider';
import { announceLocalChange } from '@/lib/offline/sync';
import * as outbox from '@/lib/offline/outbox';
import type { SaleCreateData } from '@/lib/offline/types';
import { formatUGX, pluralise } from '@/lib/format';
import { sync } from '@/lib/offline/sync';

/**
 * NEEDS ATTENTION.
 *
 * An entry lands here when the server refused it — almost always because stock
 * ran out while this phone was offline and someone else sold the last of it.
 *
 * The governing fact is that a queued sale may be the ONLY record that a
 * transaction happened. The goods left the shop; if this entry is lost, so is
 * the money from the books. So nothing here is automatic:
 *
 *   - Rejected entries are never retried on their own. Retrying an oversell
 *     every sixty seconds produces noise, not a resolution.
 *   - They are excluded from the projection, so a refused sale never quietly
 *     counts towards a total that the owner might act on.
 *   - Discarding takes a deliberate second tap, and says what will be lost.
 *
 * "Change quantity to N" is the common repair: two were sold, one is left,
 * record the one and let the person account for the other.
 */
export function PendingList() {
  const { entries, state, syncNow } = useSync();

  const attention = entries.filter((e) => e.status === 'needs_attention');
  const queued = entries.filter((e) => e.status === 'queued');

  if (attention.length === 0 && queued.length === 0) {
    return (
      <div className="surface flex flex-col items-center gap-3 px-6 py-12 text-center">
        <div
          className="flex size-11 items-center justify-center rounded-full"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}
        >
          <CheckCircleIcon size={20} weight="fill" />
        </div>
        <p className="font-medium">Everything has been sent</p>
        <p className="max-w-[38ch] text-[0.875rem] text-[var(--text-muted)]">
          Nothing is waiting and nothing needs fixing.
          {state.lastSyncAt &&
            ` Last checked ${new Date(state.lastSyncAt).toLocaleTimeString()}.`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {attention.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold">
            <WarningIcon size={17} weight="fill" style={{ color: 'var(--warn)' }} />
            {attention.length} {pluralise(attention.length, 'entry', 'entries')} need
            {attention.length === 1 ? 's' : ''} your attention
          </h2>
          <ul className="space-y-3">
            {attention.map((entry) => (
              <li key={entry.id}>
                <RejectedCard entry={entry} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {queued.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[0.9375rem] font-semibold">
              {queued.length} waiting to be sent
            </h2>
            <button
              type="button"
              onClick={() => void syncNow()}
              disabled={state.syncing}
              className="btn btn-secondary py-1.5 text-[0.875rem]"
            >
              {state.syncing ? 'Sending' : 'Send now'}
            </button>
          </div>
          <ul className="surface divide-y overflow-hidden">
            {queued.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
              >
                <span className="min-w-0 text-[0.9375rem]">{entry.label}</span>
                <span className="text-[0.8125rem] text-[var(--text-faint)]">
                  {new Date(entry.createdAt).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[0.8125rem] text-[var(--text-muted)]">
            These are saved on this phone and will be sent on their own when there is a
            signal. It is safe to close the app.
          </p>
        </section>
      )}
    </div>
  );
}

function RejectedCard({ entry }: { entry: outbox.OutboxEntry }) {
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [busy, setBusy] = useState(false);

  const isSale = entry.kind === 'sale.create';
  const saleData = isSale ? (entry.data as SaleCreateData) : null;

  // Offered only when the server told us exactly how many are left AND at
  // least one is: "change quantity to 0" is a discard wearing a disguise.
  const canReduce =
    isSale && typeof entry.remaining === 'number' && entry.remaining > 0 && saleData !== null;

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
      announceLocalChange();
      void sync({ force: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="rounded-[var(--radius-card)] border p-4"
      style={{ background: 'var(--warn-soft)', borderColor: 'var(--warn-border)' }}
    >
      <p className="font-medium">{entry.label}</p>
      <p className="mt-0.5 text-[0.8125rem] text-[var(--text-muted)]">
        Recorded {new Date(entry.createdAt).toLocaleString()}
      </p>

      <p className="mt-2 text-[0.875rem] font-medium" style={{ color: 'var(--warn)' }}>
        {entry.reason}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {canReduce && saleData && (
          <button
            type="button"
            disabled={busy}
            className="btn btn-primary py-1.5 text-[0.875rem]"
            onClick={() =>
              void act(() =>
                outbox.retry(entry, { ...saleData, quantity: entry.remaining as number }),
              )
            }
          >
            Change to {entry.remaining} and send
            <span className="ml-1 opacity-80">
              ({formatUGX(saleData.unitPrice * (entry.remaining as number))})
            </span>
          </button>
        )}

        <button
          type="button"
          disabled={busy}
          className="btn btn-secondary py-1.5 text-[0.875rem]"
          onClick={() => void act(() => outbox.retry(entry))}
        >
          Try again as recorded
        </button>

        {confirmingDiscard ? (
          <span className="inline-flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              autoFocus
              className="btn btn-danger py-1.5 text-[0.875rem]"
              onClick={() => void act(() => outbox.discard(entry.id))}
            >
              Yes, delete it
            </button>
            <button
              type="button"
              className="btn btn-ghost py-1.5 text-[0.875rem]"
              onClick={() => setConfirmingDiscard(false)}
            >
              Keep it
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={busy}
            className="btn btn-ghost py-1.5 text-[0.875rem]"
            onClick={() => setConfirmingDiscard(true)}
          >
            Discard
          </button>
        )}
      </div>

      {confirmingDiscard && (
        <p className="mt-2 text-[0.8125rem]" style={{ color: 'var(--warn)' }}>
          This entry is not saved anywhere else. Deleting it removes it from the books for
          good.
        </p>
      )}
    </div>
  );
}
