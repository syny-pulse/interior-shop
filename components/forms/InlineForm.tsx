'use client';

import { useActionState, useEffect, useRef } from 'react';
import type { ActionState } from '@/lib/action-state';
import { idle } from '@/lib/action-state';
import { Field } from '@/components/ui/Field';
import { FormMessage } from '@/components/ui/Alert';
import { SubmitButton } from '@/components/ui/SubmitButton';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * One-field create form driven by a Server Action.
 *
 * Only attendant links use it now. Categories used to share it, but the two
 * diverged when categories moved to the offline queue and links stayed
 * online-only — see app/actions/attendants.ts for why. Keeping them on one
 * component would have hidden that difference behind an identical-looking box.
 * The category version lives in app/(owner)/categories/CategoriesPanel.tsx.
 */
export function InlineForm({
  action,
  label,
  name,
  placeholder,
  submitLabel,
  hint,
}: {
  action: Action;
  label: string;
  name: string;
  placeholder?: string;
  submitLabel: string;
  hint?: string;
}) {
  const [state, formAction] = useActionState(action, idle);
  const formRef = useRef<HTMLFormElement>(null);
  const error = state.errors?.[name];

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok, state.nonce]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <FormMessage state={state} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        {/* Hint/error live outside the Field so they don't add height to this
            row — otherwise sm:items-end would push the button down to match
            the taller side instead of aligning it with the input. */}
        <Field label={label} htmlFor={name} className="flex-1">
          <input
            id={name}
            name={name}
            type="text"
            required
            maxLength={60}
            placeholder={placeholder}
            aria-invalid={Boolean(error) || undefined}
            className="control"
          />
        </Field>
        <SubmitButton pendingLabel="Adding" className="sm:mb-px">
          {submitLabel}
        </SubmitButton>
      </div>
      {error ? (
        <p role="alert" className="text-[0.8125rem] font-medium text-[var(--negative)]">
          {error}
        </p>
      ) : (
        hint && <p className="text-[0.8125rem] text-[var(--text-muted)]">{hint}</p>
      )}
    </form>
  );
}
