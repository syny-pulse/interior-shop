'use client';

import { useCallback, useState } from 'react';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { ConfirmButton } from '@/components/ui/ConfirmButton';
import { Alert } from '@/components/ui/Alert';
import { categorySchema } from '@/lib/validation';
import { parse, useOfflineAction, type Built } from '@/lib/offline/use-offline-action';
import type { Ref } from '@/lib/offline/types';

export function CategoryRow({
  id,
  clientId,
  name,
  detail,
  deletable,
  pending,
}: {
  id: number | null;
  clientId: string | null;
  name: string;
  detail: string;
  deletable: boolean;
  pending: boolean;
}) {
  const [editing, setEditing] = useState(false);

  const ref = useCallback((): Ref | null => {
    if (id !== null) return { id };
    if (clientId !== null) return { clientId };
    return null;
  }, [id, clientId]);

  const buildRename = useCallback(
    (formData: FormData): Built => {
      const category = ref();
      if (!category) {
        return { ok: false, errors: {}, message: 'Could not identify that category' };
      }

      const parsed = parse(categorySchema, { name: formData.get('name') });
      if (!parsed.ok) return { ok: false, errors: parsed.errors };

      return {
        ok: true,
        op: { kind: 'category.rename', data: { category, name: parsed.data.name } },
        label: `Rename "${name}" to "${parsed.data.name}"`,
        message: 'Category renamed',
      };
    },
    [ref, name],
  );

  const buildDelete = useCallback((): Built => {
    const category = ref();
    if (!category) {
      return { ok: false, errors: {}, message: 'Could not identify that category' };
    }
    return {
      ok: true,
      op: { kind: 'category.delete', data: { category } },
      label: `Delete "${name}"`,
      message: 'Category deleted',
    };
  }, [ref, name]);

  const [renameState, renameAction] = useOfflineAction(buildRename);
  const [deleteState, deleteAction] = useOfflineAction(buildDelete);

  if (editing) {
    return (
      <form
        action={async (formData) => {
          await renameAction(formData);
          setEditing(false);
        }}
        className="flex flex-wrap items-center gap-2 px-4 py-3"
      >
        <input
          name="name"
          defaultValue={name}
          required
          maxLength={60}
          autoFocus
          aria-label="Category name"
          className="control flex-1 py-1.5"
        />
        <SubmitButton pendingLabel="Saving" className="py-1.5 text-[0.875rem]">
          Save
        </SubmitButton>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="btn btn-ghost py-1.5 text-[0.875rem]"
        >
          Cancel
        </button>
      </form>
    );
  }

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium">
            {name}
            {pending && <span className="chip chip-muted">Not sent yet</span>}
          </p>
          <p className="text-[0.8125rem] text-[var(--text-muted)]">{detail}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="btn btn-ghost py-1.5 text-[0.875rem]"
          >
            Rename
          </button>
          {deletable && (
            <form action={deleteAction}>
              <ConfirmButton
                label="Delete"
                className="btn btn-danger py-1.5 text-[0.875rem]"
              />
            </form>
          )}
        </div>
      </div>

      {renameState.message && !renameState.ok && (
        <div className="mt-2">
          <Alert tone="error">{renameState.message}</Alert>
        </div>
      )}
      {deleteState.message && !deleteState.ok && (
        <div className="mt-2">
          <Alert tone="error">{deleteState.message}</Alert>
        </div>
      )}
    </div>
  );
}
