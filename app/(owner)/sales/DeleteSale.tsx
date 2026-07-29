'use client';

import { useCallback } from 'react';
import { ConfirmButton } from '@/components/ui/ConfirmButton';
import { Alert } from '@/components/ui/Alert';
import { useOfflineAction, type Built } from '@/lib/offline/use-offline-action';
import type { Ref } from '@/lib/offline/types';

/**
 * Removing a sale puts the stock back; lib/mutations.ts does both in one
 * transaction, whether that happens now or at the next sync.
 */
export function DeleteSale({ id, clientId }: { id: number | null; clientId: string | null }) {
  const build = useCallback((): Built => {
    /*
     * A sale still sitting in the outbox has no id yet. It is referenced by
     * clientId, so the delete lands on the right row whichever order the two
     * ops reach the server in.
     */
    const ref: Ref | null =
      id !== null ? { id } : clientId !== null ? { clientId } : null;

    if (!ref) return { ok: false, errors: {}, message: 'Could not identify that sale' };

    return {
      ok: true,
      op: { kind: 'sale.delete', data: { sale: ref } },
      label: 'Remove a sale',
      message: 'Sale removed and stock restored',
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
