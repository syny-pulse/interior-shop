import { z } from 'zod';
import { fieldErrors } from './validation';

export interface ActionState {
  ok: boolean;
  message?: string;
  /** Keyed by form field name; `_form` holds errors with no single field. */
  errors?: Record<string, string>;
  /** Bumped on success so client forms can reset themselves. */
  nonce?: number;
}

export const idle: ActionState = { ok: false };

export function failure(message: string, errors?: Record<string, string>): ActionState {
  return { ok: false, message, errors };
}

export function invalid(error: z.ZodError): ActionState {
  const errors = fieldErrors(error);
  return {
    ok: false,
    message: errors._form ?? 'Please check the highlighted fields',
    errors,
  };
}

export function success(message: string): ActionState {
  return { ok: true, message, nonce: Date.now() };
}

/**
 * Server Actions must never leak a raw database error to the browser — the
 * message can contain table names, the connection string host, or a value from
 * another row. Log the detail server-side, return something Sarah can act on.
 */
export function unexpected(error: unknown, context: string): ActionState {
  console.error(`[action:${context}]`, error);
  return failure('Something went wrong saving that. Please try again.');
}
