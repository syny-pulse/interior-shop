/**
 * Deliberately dependency-free.
 *
 * middleware.ts runs on the edge runtime and cannot load `server-only`,
 * `next/headers`, or the Neon driver. Importing these constants from lib/auth
 * would pull that entire tree into the edge bundle and fail the build, so the
 * shared names live here on their own.
 */

export const SESSION_COOKIE = 'myshop_session';

export const SESSION_DAYS = 30;

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: SESSION_DAYS * 24 * 60 * 60,
} as const;
