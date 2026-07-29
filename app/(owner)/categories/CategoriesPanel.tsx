'use client';

import { useCallback } from 'react';
import { useSync } from '@/components/offline/SyncProvider';
import { MirrorGate } from '@/components/offline/MirrorGate';
import { categoriesWithCounts } from '@/lib/offline/aggregates';
import { categorySchema } from '@/lib/validation';
import {
  newClientId,
  parse,
  useOfflineAction,
  type Built,
} from '@/lib/offline/use-offline-action';
import { formatNumber, pluralise } from '@/lib/format';
import { Field } from '@/components/ui/Field';
import { FormMessage } from '@/components/ui/Alert';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { CategoryRow } from './CategoryRow';

export function CategoriesPanel() {
  return (
    <MirrorGate>
      <CategoriesPanelInner />
    </MirrorGate>
  );
}

function CategoriesPanelInner() {
  const { projection } = useSync();
  const categories = categoriesWithCounts(projection);

  return (
    <>
      <div className="surface mb-5 p-5">
        <CreateCategoryForm />
      </div>

      {categories.length === 0 ? (
        <p className="surface px-4 py-8 text-center text-[0.875rem] text-[var(--text-muted)]">
          No categories yet. Add your first one above.
        </p>
      ) : (
        <ul className="surface divide-y overflow-hidden">
          {categories.map((c) => (
            <li key={c.key}>
              <CategoryRow
                id={c.id}
                clientId={c.clientId ?? null}
                name={c.name}
                pending={c.pending}
                detail={
                  c.itemCount === 0
                    ? 'Nothing in stock'
                    : `${formatNumber(c.unitsRemaining)} ${pluralise(c.unitsRemaining, 'item')} across ${formatNumber(c.itemCount)} ${pluralise(c.itemCount, 'batch', 'batches')}`
                }
                deletable={c.itemCount === 0}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * Was InlineForm driven by a Server Action. It is its own component now because
 * the two callers of InlineForm diverged: categories queue offline, attendant
 * links cannot (their token is a server-generated credential), so pretending
 * they are the same "type a name, press add" form would hide a real difference.
 */
function CreateCategoryForm() {
  const build = useCallback((formData: FormData): Built => {
    const parsed = parse(categorySchema, { name: formData.get('name') });
    if (!parsed.ok) return { ok: false, errors: parsed.errors };

    return {
      ok: true,
      op: { kind: 'category.create', data: { clientId: newClientId(), name: parsed.data.name } },
      label: `Add category "${parsed.data.name}"`,
      message: `Added "${parsed.data.name}"`,
    };
  }, []);

  const [state, formAction] = useOfflineAction(build);

  return (
    <form
      action={async (formData) => {
        await formAction(formData);
      }}
      key={state.nonce ?? 'idle'}
      className="space-y-3"
    >
      <FormMessage state={state} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="New category" htmlFor="name" error={state.errors?.name} className="flex-1">
          <input
            id="name"
            name="name"
            type="text"
            required
            maxLength={60}
            placeholder="Blankets"
            className="control"
          />
        </Field>
        <SubmitButton pendingLabel="Adding" className="sm:mb-px">
          Add category
        </SubmitButton>
      </div>
    </form>
  );
}
