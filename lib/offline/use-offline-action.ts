'use client';

import { useCallback, useState } from 'react';
import { z } from 'zod';
import { failure, idle, success, type ActionState } from '../action-state';
import { fieldErrors } from '../validation';
import { enqueueAndSync } from './sync';
import { newId } from './outbox';
import type { OpData } from './types';

/**
 * The replacement for useActionState.
 *
 * Same shape on purpose — `const [state, action] = ...`, and the same
 * ActionState object — so FormMessage, SubmitButton, ConfirmButton and every
 * reset-on-success effect keep working untouched. React 19 reports pending for
 * a plain async function passed to <form action>, exactly as it does for a
 * Server Action, so useFormStatus needs no change either.
 *
 * What IS different is when it resolves. A Server Action resolved when the
 * database had the row. This resolves when the DEVICE has it. That is the whole
 * point: an attendant gets "Recorded" the instant they tap, on any connection
 * or none, and the outbox takes responsibility for the rest. The badge in the
 * header is what tells them it has actually left the phone.
 *
 * A failure here therefore means the phone could not store it — out of disk,
 * or private browsing with IndexedDB blocked. That is worth saying plainly,
 * because it is the one case where the entry really is lost.
 */

export type Built =
  | { ok: true; op: OpData; label: string; message: string }
  | { ok: false; errors: Record<string, string>; message?: string };

export type Builder = (formData: FormData) => Built;

export function useOfflineAction(
  build: Builder,
): [ActionState, (formData: FormData) => Promise<void>] {
  const [state, setState] = useState<ActionState>(idle);

  const action = useCallback(
    async (formData: FormData) => {
      let built: Built;
      try {
        built = build(formData);
      } catch (error) {
        console.error('[offline-action] could not build op', error);
        setState(failure('Something about that entry could not be read. Please try again.'));
        return;
      }

      if (!built.ok) {
        setState({
          ok: false,
          message: built.message ?? 'Please check the highlighted fields',
          errors: built.errors,
        });
        return;
      }

      try {
        await enqueueAndSync({ ...built.op, label: built.label });
        setState(success(built.message));
      } catch (error) {
        console.error('[offline-action] could not queue op', error);
        setState(
          failure(
            'This phone could not save that entry. Check that storage is not full, then try again.',
          ),
        );
      }
    },
    [build],
  );

  return [state, action];
}

/**
 * Runs a zod schema and returns either the parsed data or the same
 * field-keyed errors the server produces, so a message reads identically
 * whether it was caught here or three hours later at sync time.
 */
export function parse<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
): { ok: true; data: z.infer<T> } | { ok: false; errors: Record<string, string> } {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, errors: fieldErrors(result.error) };
}

/** Every row a device creates needs one of these before it has an id. */
export { newId as newClientId };
