'use client';

import { useActionState } from 'react';
import { login } from '@/app/actions/auth';
import { idle } from '@/lib/action-state';
import { Field } from '@/components/ui/Field';
import { FormMessage } from '@/components/ui/Alert';
import { SubmitButton } from '@/components/ui/SubmitButton';

export function LoginForm() {
  const [state, formAction] = useActionState(login, idle);

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <Field label="Shop password" htmlFor="password" error={state.errors?.password}>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          className="control"
        />
      </Field>

      <SubmitButton pendingLabel="Signing in" className="w-full">
        Sign in
      </SubmitButton>
    </form>
  );
}
