'use server';

import { redirect } from 'next/navigation';
import { clearSessionCookie, safeEqual, setSessionCookie } from '@/lib/auth';
import { failure, type ActionState } from '@/lib/action-state';

export async function login(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const password = String(formData.get('password') ?? '');
  const expected = process.env.OWNER_PASSWORD;

  if (!expected) {
    console.error('[action:login] OWNER_PASSWORD is not set');
    return failure('The shop password has not been set up yet.');
  }

  if (!password) return failure('Enter your password', { password: 'Enter your password' });

  if (!safeEqual(password, expected)) {
    // Small delay to blunt rapid guessing; message stays deliberately vague.
    await new Promise((r) => setTimeout(r, 400));
    return failure('That password is not correct', { password: 'Incorrect password' });
  }

  await setSessionCookie({ role: 'owner' });
  // redirect() works by throwing — it must never sit inside a try/catch.
  redirect('/dashboard');
}

export async function logout(): Promise<void> {
  await clearSessionCookie();
  redirect('/login');
}
