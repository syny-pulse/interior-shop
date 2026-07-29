'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/auth';
import * as mutations from '@/lib/mutations';
import { attendantSchema, idSchema } from '@/lib/validation';
import {
  failure,
  invalid,
  success,
  unexpected,
  type ActionState,
} from '@/lib/action-state';

/**
 * THE ONLY SERVER ACTIONS LEFT, apart from signing in.
 *
 * Every other mutation moved to lib/mutations.ts behind /api/sync, so it can be
 * queued on a device and replayed later. Attendant links deliberately did not:
 *
 *   - The token IS the attendant's whole credential and is generated with the
 *     server's CSPRNG. It has no business being minted on a phone.
 *   - Revoking a link from a device that cannot reach the server would be
 *     security theatre. It takes effect when the server hears about it, so an
 *     offline "revoke" would show a reassuring green tick while the link
 *     carried on working.
 *   - A link is useless until it can be sent, which needs a connection anyway.
 *
 * So this page needs the network, and says so rather than pretending.
 */

export async function createLink(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOwner();

  const parsed = attendantSchema.safeParse({ name: formData.get('name') });
  if (!parsed.success) return invalid(parsed.error);

  try {
    const result = await mutations.createLink(parsed.data.name);
    if (result.status === 'rejected') return failure(result.reason);
    revalidatePath('/attendants');
    return success(result.message ?? `Created a link for ${parsed.data.name}`);
  } catch (error) {
    return unexpected(error, 'createLink');
  }
}

export async function revokeLink(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOwner();

  const parsed = idSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return failure('Could not identify that link');

  const active = formData.get('active') !== 'true';

  try {
    const result = await mutations.setLinkActive(parsed.data.id, active);
    if (result.status === 'rejected') return failure(result.reason);
    revalidatePath('/attendants');
    return success(result.message ?? 'Saved');
  } catch (error) {
    return unexpected(error, 'revokeLink');
  }
}

/**
 * Issues a fresh token for the same person, instantly invalidating the old URL.
 * This is what to use when a link has been forwarded to someone it shouldn't
 * have been.
 */
export async function regenerateLink(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOwner();

  const parsed = idSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return failure('Could not identify that link');

  try {
    const result = await mutations.regenerateLink(parsed.data.id);
    if (result.status === 'rejected') return failure(result.reason);
    revalidatePath('/attendants');
    return success(result.message ?? 'New link generated');
  } catch (error) {
    return unexpected(error, 'regenerateLink');
  }
}
