import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { SESSION_COOKIE } from '@/lib/session-constants';

/**
 * UX-level routing only: it sends people to the right home and keeps signed-out
 * visitors off the app.
 *
 * This is NOT the security boundary. Middleware cannot reach the database, so
 * it cannot tell whether an attendant link has been revoked. Real enforcement
 * lives in requireOwner()/requireUser(), which every page and every Server
 * Action calls.
 */

const OWNER_PREFIXES = [
  '/dashboard',
  '/products',
  '/categories',
  '/sales',
  '/expenses',
  '/attendants',
];

async function readRole(request: NextRequest): Promise<'owner' | 'attendant' | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (payload.role === 'owner') return 'owner';
    if (payload.role === 'attendant') return 'attendant';
    return null;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const role = await readRole(request);

  if (!role) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const wantsOwnerArea = OWNER_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (role === 'attendant' && wantsOwnerArea) {
    return NextResponse.redirect(new URL('/shop', request.url));
  }

  if (role === 'owner' && pathname.startsWith('/shop')) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except the sign-in page, the attendant link exchange,
     * Next internals and static files.
     *
     * The PWA entries are not optional:
     *
     *   sw.js               a service worker that 302s to /login is served as
     *                       HTML and registration fails on a MIME-type error,
     *                       silently taking the whole offline story with it.
     *   manifest.webmanifest same, minus the error: the app just stops being
     *                       installable with nothing in the console.
     *   offline             the fallback page must render for a signed-out or
     *                       expired session, since that is when it is needed.
     *   api/                these answer with 401 JSON. An HTML redirect to
     *                       the login page would arrive at fetch() as an
     *                       opaque success and be parsed as a sync response.
     */
    '/((?!login|a/|api/|sw\\.js|manifest\\.webmanifest|offline|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
