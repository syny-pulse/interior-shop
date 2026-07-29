import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { attendantLinks } from '@/db/schema';
import { SESSION_COOKIE, signSession } from '@/lib/auth';

/**
 * Exchanges an attendant's link for a session cookie, then sends them to the
 * shop view. The token stays in the URL only for this one request.
 *
 * A missing, revoked or malformed token lands on the sign-in page with an
 * explanation rather than an error, because the person holding a dead link is
 * usually an attendant whose access was withdrawn, not an attacker.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const dead = NextResponse.redirect(new URL('/login?revoked=1', request.url));

  if (!token || token.length < 20) return dead;

  const [link] = await db
    .select()
    .from(attendantLinks)
    .where(eq(attendantLinks.token, token))
    .limit(1);

  if (!link || !link.active) return dead;

  await db
    .update(attendantLinks)
    .set({ lastUsedAt: new Date() })
    .where(eq(attendantLinks.id, link.id));

  const response = NextResponse.redirect(new URL('/shop', request.url));

  response.cookies.set(
    SESSION_COOKIE,
    await signSession({ role: 'attendant', linkId: link.id, name: link.name }),
    {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    },
  );

  return response;
}
