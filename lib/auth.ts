import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import { isAttendantActive } from './queries';
import { SESSION_COOKIE, SESSION_DAYS } from './session-constants';

export { SESSION_COOKIE };

export type Session =
  | { role: 'owner' }
  | { role: 'attendant'; linkId: number; name: string };

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) {
    throw new Error(
      'SESSION_SECRET is missing or too short. Generate one with:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
    );
  }
  return new TextEncoder().encode(value);
}

export async function signSession(session: Session): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
}

export async function setSessionCookie(session: Session): Promise<void> {
  const token = await signSession(session);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Returns null for anonymous or tampered cookies. Never throws. */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    if (payload.role === 'owner') return { role: 'owner' };
    if (
      payload.role === 'attendant' &&
      typeof payload.linkId === 'number' &&
      typeof payload.name === 'string'
    ) {
      return { role: 'attendant', linkId: payload.linkId, name: payload.name };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * ===================================================================
 * GUARDS — call one of these as the FIRST statement of every page and
 * every Server Action.
 *
 * Layout guards protect *pages* only. A Server Action is a POST endpoint
 * that any authenticated client can invoke directly by its action id,
 * regardless of which UI is rendered. An attendant who never sees the
 * "Add product" button can still call createItem() unless the action
 * itself checks. This is the single most likely security hole here.
 * ===================================================================
 */

export async function requireOwner(): Promise<{ role: 'owner' }> {
  const session = await getSession();
  if (session?.role !== 'owner') redirect('/login');
  return session;
}

/**
 * Owner or attendant — for sales and expenses, which both sides record.
 *
 * An attendant's session is re-checked against the database on every guarded
 * request. The cookie stays cryptographically valid for 30 days, so without
 * this lookup, revoking a link would not actually lock anyone out until it
 * expired. Correct revocation is worth one indexed read per request.
 */
export async function requireUser(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'attendant' && !(await isAttendantActive(session.linkId))) {
    await clearSessionCookie();
    redirect('/login?revoked=1');
  }
  return session;
}

export async function requireAttendant(): Promise<{
  role: 'attendant';
  linkId: number;
  name: string;
}> {
  const session = await getSession();
  if (session?.role !== 'attendant') redirect('/login');
  if (!(await isAttendantActive(session.linkId))) {
    await clearSessionCookie();
    redirect('/login?revoked=1');
  }
  return session;
}

/**
 * The attendant id to stamp on a sale or expense.
 * Owner-recorded rows carry null, which is what the dashboard uses to say
 * "recorded by Sarah".
 */
export function attendantIdOf(session: Session): number | null {
  return session.role === 'attendant' ? session.linkId : null;
}

/** Constant-time string compare so the owner password can't be timing-probed. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
