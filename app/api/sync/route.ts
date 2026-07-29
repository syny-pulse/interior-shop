import { NextResponse, type NextRequest } from 'next/server';
import { getSession, clearSessionCookie } from '@/lib/auth';
import { getDelta, isAttendantActive, serverNow } from '@/lib/queries';
import { applyOp } from '@/lib/mutations';
import {
  MIRROR_WINDOW_DAYS,
  type Op,
  type OpResult,
  type SyncRequest,
  type SyncResponse,
} from '@/lib/offline/types';

/**
 * THE ONLY WRITE PATH IN THE APP, and the only read path a device trusts.
 *
 * One round trip does both directions: push the outbox, then pull what
 * changed. In that order on purpose — the delta that comes back already
 * contains the caller's own writes, so a phone that has just synced never
 * shows a moment where a sale it recorded has vanished.
 *
 * This exists instead of Server Actions because a Server Action cannot be
 * replayed. Its POST body is an encoded RSC payload keyed by a build-specific
 * action id, so a sale recorded during an outage could not be stored on the
 * device and re-sent an hour later, which is the entire requirement.
 */

/** Never prerender, never cache. Node runtime: the mutations use pg over WebSockets. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Refuse absurd batches outright rather than spending a database round trip on them. */
const MAX_OPS_PER_SYNC = 500;

/**
 * The cursor handed back is deliberately a little behind the server's clock.
 *
 * updated_at is stamped when a row is written, but a transaction that started
 * before another can commit after it. A cursor set to exactly now() would skip
 * such a row for ever. Rewinding two seconds means the next pull re-sends a
 * handful of rows the device already has, which costs nothing because the
 * mirror upserts by primary key.
 */
const CURSOR_SAFETY_MS = 2000;

function unauthorised(error: 'unauthenticated' | 'revoked', message: string) {
  return NextResponse.json({ error, message }, { status: 401 });
}

export async function POST(request: NextRequest) {
  /*
   * Authentication is done here rather than in middleware because middleware
   * can only redirect, and a 302 to /login arrives at fetch() looking like a
   * successful HTML response that the client would try to parse as a sync
   * result. A JSON 401 is something the sync engine can act on: it wipes the
   * mirror and sends the person to sign in.
   */
  const session = await getSession();
  if (!session) {
    return unauthorised('unauthenticated', 'Please sign in again.');
  }

  /*
   * Re-check the link against the database on every sync, exactly as
   * requireUser() does for pages. The cookie stays cryptographically valid for
   * 30 days after a link is revoked, so this lookup is the only thing that
   * actually locks a revoked attendant out — and, because the response wipes
   * their mirror, it is also what finally clears the shop's data off a phone
   * that has been offline since the revocation.
   */
  if (session.role === 'attendant' && !(await isAttendantActive(session.linkId))) {
    await clearSessionCookie();
    return unauthorised('revoked', 'This link has been withdrawn.');
  }

  let body: SyncRequest;
  try {
    body = (await request.json()) as SyncRequest;
  } catch {
    return NextResponse.json(
      { error: 'bad_request', message: 'Could not read that request.' },
      { status: 400 },
    );
  }

  // Typed as unknown deliberately: this array arrived over the wire from a
  // device the shop does not control. isWellFormed() and the zod schemas
  // inside applyOp() are what turn it into an Op.
  const ops: unknown[] = Array.isArray(body.ops) ? body.ops.slice(0, MAX_OPS_PER_SYNC) : [];
  const identity = session.role === 'owner' ? 'owner' : `attendant:${session.linkId}`;

  const now = await serverNow();

  /*
   * Ops drain IN ORDER, ONE TRANSACTION EACH.
   *
   * In order, because a batch can contain an item created offline followed by
   * a sale of it, and the sale can only resolve the reference once the item
   * exists.
   *
   * One transaction each, because a single rejected op must not take the rest
   * with it. A day of an attendant's work can be in this array; if the third
   * sale oversells, the other nineteen still have to land. The rejected one
   * comes back with a reason and is held on the device for the person to fix.
   */
  const results: OpResult[] = [];
  const idMap: Record<string, number> = {};

  for (const op of ops) {
    if (!isWellFormed(op)) {
      const opId =
        typeof op === 'object' && op !== null && typeof (op as Op).id === 'string'
          ? (op as Op).id
          : 'unknown';
      results.push({
        opId,
        status: 'rejected',
        reason: 'That entry could not be read and has to be recorded again.',
      });
      continue;
    }

    try {
      const result = await applyOp(session, op);
      results.push(result);

      if (
        (result.status === 'applied' || result.status === 'duplicate') &&
        result.clientId &&
        typeof result.id === 'number'
      ) {
        idMap[result.clientId] = result.id;
      }
    } catch (error) {
      /*
       * An unexpected database error. Never surface it — the message can carry
       * table names, the connection host, or a value from another row. Log it
       * and report something retryable, so the op stays queued and is tried
       * again rather than being lost or dumped on the person as a conflict
       * they cannot act on.
       */
      console.error(`[sync:${op.kind}]`, error);
      results.push({
        opId: op.id,
        status: 'rejected',
        reason: 'The server could not save this. It will be retried.',
      });
    }
  }

  /*
   * The service worker's background drain sets this. It has no mirror to apply
   * a delta to and deliberately leaves the cursor alone, so computing one
   * would be pure waste on a connection that just came back.
   */
  if (body.pushOnly) {
    return NextResponse.json(
      {
        cursor: '',
        results,
        idMap,
        delta: { categories: [], items: [], sales: [], expenses: [], attendants: [] },
        reset: false,
        identity,
      } satisfies SyncResponse,
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const since = parseCursor(body.since, now);
  const delta = await getDelta(session, since);

  return NextResponse.json(
    {
      cursor: new Date(now.getTime() - CURSOR_SAFETY_MS).toISOString(),
      results,
      idMap,
      delta,
      // A null cursor means the device has no mirror, or has decided its mirror
      // is not trustworthy. Either way this delta is the whole truth.
      reset: since === null,
      identity,
    } satisfies SyncResponse,
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * A cursor older than the mirror window is treated as no cursor at all.
 *
 * A phone that has been in a drawer for six months would otherwise ask for
 * every row changed since, which on a first reconnection is the worst possible
 * moment for a large response. Starting over is both smaller and more correct.
 */
function parseCursor(value: string | null | undefined, now: Date): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getTime() > now.getTime()) return null;

  const oldest = now.getTime() - MIRROR_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (parsed.getTime() < oldest) return null;

  return parsed;
}

/**
 * Shape check only. The real validation is the zod schemas inside applyOp() —
 * the same ones the forms use, run again here because a queued op is plain
 * JSON in IndexedDB that anyone holding the phone can edit before it is sent.
 */
function isWellFormed(value: unknown): value is Op {
  if (typeof value !== 'object' || value === null) return false;
  const op = value as Partial<Op>;
  return (
    typeof op.id === 'string' &&
    op.id.length > 0 &&
    typeof op.kind === 'string' &&
    typeof op.data === 'object' &&
    op.data !== null
  );
}
