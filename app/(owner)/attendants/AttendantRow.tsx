'use client';

import { useActionState } from 'react';
import { regenerateLink, revokeLink } from '@/app/actions/attendants';
import { idle } from '@/lib/action-state';
import { CopyButton } from '@/components/ui/CopyButton';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { ConfirmButton } from '@/components/ui/ConfirmButton';
import { Alert } from '@/components/ui/Alert';

export function AttendantRow({
  id,
  name,
  url,
  active,
  lastUsedAt,
  salesLabel,
}: {
  id: number;
  name: string;
  url: string;
  active: boolean;
  lastUsedAt: string | null;
  salesLabel: string;
}) {
  const [revokeState, revokeAction] = useActionState(revokeLink, idle);
  const [regenState, regenAction] = useActionState(regenerateLink, idle);

  return (
    <div className="surface space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{name}</p>
          <p className="text-[0.8125rem] text-[var(--text-muted)]">
            {salesLabel}
            {lastUsedAt
              ? ` · last opened ${new Date(lastUsedAt).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                })}`
              : ' · never opened'}
          </p>
        </div>
        <span className={active ? 'chip chip-accent' : 'chip chip-muted'}>
          {active ? 'Active' : 'Revoked'}
        </span>
      </div>

      {active && (
        <div className="flex flex-wrap items-center gap-2">
          <code
            className="min-w-0 flex-1 truncate rounded-[var(--radius-chip)] px-2.5 py-2 font-mono text-[0.75rem]"
            style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}
          >
            {url}
          </code>
          <CopyButton
            value={url}
            className="btn btn-secondary py-1.5 text-[0.875rem]"
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t pt-3">
        <form action={revokeAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="active" value={String(active)} />
          {active ? (
            <ConfirmButton
              label="Revoke"
              confirmLabel="Tap again to revoke"
              className="btn btn-danger py-1.5 text-[0.875rem]"
            />
          ) : (
            <SubmitButton
              variant="secondary"
              pendingLabel="Saving"
              className="py-1.5 text-[0.875rem]"
            >
              Re-activate
            </SubmitButton>
          )}
        </form>

        {active && (
          <form action={regenAction}>
            <input type="hidden" name="id" value={id} />
            <ConfirmButton
              label="New link"
              confirmLabel="Tap again to replace"
              className="btn btn-secondary py-1.5 text-[0.875rem]"
            />
          </form>
        )}
      </div>

      {revokeState.message && <Alert tone={revokeState.ok ? 'success' : 'error'}>{revokeState.message}</Alert>}
      {regenState.message && <Alert tone={regenState.ok ? 'success' : 'error'}>{regenState.message}</Alert>}
    </div>
  );
}
