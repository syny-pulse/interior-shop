'use client';

import { useCallback } from 'react';
import { ConfirmButton } from '@/components/ui/ConfirmButton';
import { Alert } from '@/components/ui/Alert';
import { useOfflineAction, type Built } from '@/lib/offline/use-offline-action';
import type { Ref } from '@/lib/offline/types';

export function DeleteExpense({
  id,
  clientId,
}: {
  id: number | null;
  clientId: string | null;
}) {
  const build = useCallback((): Built => {
    const ref: Ref | null =
      id !== null ? { id } : clientId !== null ? { clientId } : null;

    if (!ref) return { ok: false, errors: {}, message: 'Could not identify that expense' };

    return {
      ok: true,
      op: { kind: 'expense.delete', data: { expense: ref } },
      label: 'Remove an expense',
      message: 'Expense removed',
    };
  }, [id, clientId]);

  const [state, formAction] = useOfflineAction(build);

  return (
    <>
      <form action={formAction}>
        <ConfirmButton
          label="Remove"
          confirmLabel="Tap again to remove"
          className="btn btn-ghost px-2 py-1 text-[0.8125rem]"
        />
      </form>
      {state.message && !state.ok && (
        <div className="mt-2">
          <Alert tone="error">{state.message}</Alert>
        </div>
      )}
    </>
  );
}
