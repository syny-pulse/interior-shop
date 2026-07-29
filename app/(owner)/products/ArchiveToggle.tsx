'use client';

import { useCallback } from 'react';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { useOfflineAction, type Built } from '@/lib/offline/use-offline-action';
import type { Ref } from '@/lib/offline/types';

export function ArchiveToggle({
  id,
  clientId,
  archived,
}: {
  id: number | null;
  clientId: string | null;
  archived: boolean;
}) {
  const build = useCallback((): Built => {
    const ref: Ref | null =
      id !== null ? { id } : clientId !== null ? { clientId } : null;

    if (!ref) return { ok: false, errors: {}, message: 'Could not identify that product' };

    return {
      ok: true,
      op: { kind: 'item.archive', data: { item: ref, archived: !archived } },
      label: archived ? 'Restore a product' : 'Archive a product',
      message: archived ? 'Product restored' : 'Product archived',
    };
  }, [id, clientId, archived]);

  const [, formAction] = useOfflineAction(build);

  return (
    <form action={formAction}>
      <SubmitButton
        variant="secondary"
        pendingLabel="Saving"
        className="py-1.5 text-[0.875rem]"
      >
        {archived ? 'Restore' : 'Archive'}
      </SubmitButton>
    </form>
  );
}
