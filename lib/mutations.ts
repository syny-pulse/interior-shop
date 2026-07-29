import 'server-only';
import { randomBytes } from 'node:crypto';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { attendantLinks, categories, expenses, items, sales } from '@/db/schema';
import { attendantIdOf, type Session } from './auth';
import { clampRecordedAt } from './dates';
import { formatUGX, pluralise } from './format';
import {
  expenseSchema,
  itemSchema,
  itemUpdateSchema,
  saleSchema,
  categorySchema,
} from './validation';
import { fieldErrors } from './validation';
import { isLocalRef, type Op, type OpResult, type Ref } from './offline/types';

/**
 * ===================================================================
 * EVERY WRITE IN THE APP GOES THROUGH THIS FILE.
 *
 * It used to live in app/actions/*.ts as Server Actions. It moved here because
 * a Server Action cannot be replayed: its POST body is an encoded RSC payload
 * keyed by a build-specific action id, so a sale recorded during an outage
 * could not be stored and re-sent later. The device queues plain JSON ops
 * instead, and /api/sync feeds them to these functions.
 *
 * The guards that were at the top of each action are still the rule, just
 * moved up one level: /api/sync authenticates once, then passes the Session
 * down. applyOp() re-checks role per op — an attendant who hand-crafts an
 * item.create into the queue must be refused, exactly as before.
 *
 * These functions never throw for an expected failure. They return a rejection
 * with a message written for whoever is holding the phone, because that is
 * where it ends up, on a screen, possibly hours after the fact.
 * ===================================================================
 */

const POSTGRES_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION
  );
}

type Applied = { status: 'applied'; id?: number; clientId?: string; message?: string };
type Duplicate = { status: 'duplicate'; id?: number; clientId?: string; message?: string };
type Rejected = { status: 'rejected'; reason: string; remaining?: number; field?: string };
export type Outcome = Applied | Duplicate | Rejected;

function reject(reason: string, extra?: { remaining?: number; field?: string }): Rejected {
  return { status: 'rejected', reason, ...extra };
}

// ------------------------------------------------------------ ref resolution

/**
 * Turns a reference into a real primary key.
 *
 * A queued op may name a row the server has never seen, because the device
 * created it moments earlier while offline. That row arrives in the same batch
 * and is inserted first (ops drain in queue order), so by the time this runs
 * the client_id is present and resolvable.
 */
async function resolveRef(
  ref: Ref | undefined,
  table: typeof items | typeof categories | typeof sales | typeof expenses,
): Promise<number | null> {
  if (!ref) return null;
  if (!isLocalRef(ref)) return Number.isInteger(ref.id) && ref.id > 0 ? ref.id : null;

  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(eq(table.clientId, ref.clientId))
    .limit(1);

  return row?.id ?? null;
}

/** Has this exact row already been written by an earlier attempt? */
async function findByClientId(
  table: typeof items | typeof categories | typeof sales | typeof expenses,
  clientId: string | undefined,
): Promise<number | null> {
  if (!clientId) return null;
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(eq(table.clientId, clientId))
    .limit(1);
  return row?.id ?? null;
}

// -------------------------------------------------------------------- sales

/**
 * Recording a sale is the only place in the app with real concurrency risk:
 * two attendants can tap "Record sale" for the last blanket at the same moment,
 * and now a third can have recorded one offline an hour ago.
 *
 * The guard is unchanged and still the whole story — `WHERE qty_remaining >= n`
 * makes the decrement atomic, so exactly one racing statement matches a row and
 * the others get zero rows back and are rejected. A read-then-write would let
 * them all through and drive stock negative.
 *
 * What is new is what happens to the loser. Online, it is a message on a form
 * the person is looking at. Offline, the queued op is very possibly the only
 * record that the sale happened at all, so it is never dropped: it comes back
 * `rejected` with the remaining count and lands on the Needs attention screen.
 */
export async function createSale(
  session: Session,
  input: {
    clientId: string;
    itemId: number;
    saleDate: string;
    quantity: number;
    unitPrice: number;
    recordedAt: Date;
  },
): Promise<Outcome> {
  const existing = await findByClientId(sales, input.clientId);
  if (existing) return { status: 'duplicate', id: existing, clientId: input.clientId };

  try {
    return await db.transaction(async (tx) => {
      const decremented = await tx
        .update(items)
        .set({ qtyRemaining: sql`${items.qtyRemaining} - ${input.quantity}` })
        .where(
          and(
            eq(items.id, input.itemId),
            eq(items.archived, false),
            gte(items.qtyRemaining, input.quantity),
          ),
        )
        .returning({
          costPrice: items.costPrice,
          minPrice: items.minPrice,
          specifics: items.specifics,
          qtyRemaining: items.qtyRemaining,
        });

      if (decremented.length === 0) {
        // Work out *why* it failed so the message is actionable.
        const [current] = await tx
          .select({ qtyRemaining: items.qtyRemaining, archived: items.archived })
          .from(items)
          .where(eq(items.id, input.itemId))
          .limit(1);

        if (!current) return reject('That item no longer exists');
        if (current.archived) return reject('That item has been archived');

        return reject(
          current.qtyRemaining === 0
            ? 'That item is out of stock.'
            : `Only ${current.qtyRemaining} ${pluralise(current.qtyRemaining, 'unit')} left. Someone may have sold some.`,
          { remaining: current.qtyRemaining, field: 'quantity' },
        );
      }

      const item = decremented[0];
      const belowMin = input.unitPrice < item.minPrice;

      const [inserted] = await tx
        .insert(sales)
        .values({
          itemId: input.itemId,
          saleDate: input.saleDate,
          quantity: input.quantity,
          unitPrice: input.unitPrice,
          // Snapshot, not a join — see db/schema.ts.
          unitCost: item.costPrice,
          belowMin,
          attendantId: attendantIdOf(session),
          clientId: input.clientId,
          createdAt: input.recordedAt,
        })
        .returning({ id: sales.id });

      const total = input.unitPrice * input.quantity;
      const tail = `${item.qtyRemaining} ${pluralise(item.qtyRemaining, 'unit')} left`;

      return {
        status: 'applied' as const,
        id: inserted.id,
        clientId: input.clientId,
        message: belowMin
          ? `Recorded ${input.quantity} × ${item.specifics} for ${formatUGX(total)}. Flagged as below the minimum. ${tail}.`
          : `Recorded ${input.quantity} × ${item.specifics} for ${formatUGX(total)}. ${tail}.`,
      };
    });
  } catch (error) {
    /*
     * Two attempts at the same op raced past the findByClientId check above.
     * The unique index caught it, which is exactly its job — report it as the
     * duplicate it is rather than as a failure the person has to act on.
     */
    if (isUniqueViolation(error)) {
      const id = await findByClientId(sales, input.clientId);
      return { status: 'duplicate', id: id ?? undefined, clientId: input.clientId };
    }
    throw error;
  }
}

/**
 * Deleting a sale must put the stock back, in the same transaction, or the
 * batch is permanently short.
 *
 * The delete is soft: a hard one is invisible to an incremental pull, so every
 * other device would keep showing the sale for ever. Attendants may only undo
 * their own entries; Sarah can remove any.
 */
export async function deleteSale(session: Session, saleId: number): Promise<Outcome> {
  return db.transaction(async (tx) => {
    const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId)).limit(1);

    if (!sale) return reject('That sale has already been removed');
    // Already gone. Whoever queued this got what they wanted.
    if (sale.deletedAt) return { status: 'duplicate', id: saleId };

    if (session.role === 'attendant' && sale.attendantId !== session.linkId) {
      return reject('You can only remove sales you recorded yourself');
    }

    await tx.update(sales).set({ deletedAt: new Date() }).where(eq(sales.id, saleId));
    await tx
      .update(items)
      .set({ qtyRemaining: sql`${items.qtyRemaining} + ${sale.quantity}` })
      .where(eq(items.id, sale.itemId));

    return { status: 'applied', id: saleId, message: 'Sale removed and stock restored' };
  });
}

// ----------------------------------------------------------------- expenses

export async function createExpense(
  session: Session,
  input: {
    clientId: string;
    expenseDate: string;
    description: string;
    amount: number;
    kind: string;
    recordedAt: Date;
  },
): Promise<Outcome> {
  const existing = await findByClientId(expenses, input.clientId);
  if (existing) return { status: 'duplicate', id: existing, clientId: input.clientId };

  try {
    const [inserted] = await db
      .insert(expenses)
      .values({
        expenseDate: input.expenseDate,
        description: input.description,
        amount: input.amount,
        kind: input.kind,
        attendantId: attendantIdOf(session),
        clientId: input.clientId,
        createdAt: input.recordedAt,
      })
      .returning({ id: expenses.id });

    return {
      status: 'applied',
      id: inserted.id,
      clientId: input.clientId,
      message: `Recorded ${formatUGX(input.amount)} for ${input.description}`,
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const id = await findByClientId(expenses, input.clientId);
      return { status: 'duplicate', id: id ?? undefined, clientId: input.clientId };
    }
    throw error;
  }
}

/** Attendants may only remove expenses they entered themselves. */
export async function deleteExpense(session: Session, expenseId: number): Promise<Outcome> {
  const [expense] = await db
    .select()
    .from(expenses)
    .where(eq(expenses.id, expenseId))
    .limit(1);

  if (!expense) return reject('That expense has already been removed');
  if (expense.deletedAt) return { status: 'duplicate', id: expenseId };

  if (session.role === 'attendant' && expense.attendantId !== session.linkId) {
    return reject('You can only remove expenses you recorded yourself');
  }

  await db.update(expenses).set({ deletedAt: new Date() }).where(eq(expenses.id, expenseId));
  return { status: 'applied', id: expenseId, message: 'Expense removed' };
}

// -------------------------------------------------------------------- items

/** The shopping-day form. Owner only — this is where cost price enters the system. */
export async function createItem(input: {
  clientId: string;
  categoryId: number;
  specifics: string;
  costPrice: number;
  minPrice: number;
  quantity: number;
  purchaseDate: string;
  recordedAt: Date;
}): Promise<Outcome> {
  const existing = await findByClientId(items, input.clientId);
  if (existing) return { status: 'duplicate', id: existing, clientId: input.clientId };

  try {
    const [inserted] = await db
      .insert(items)
      .values({
        categoryId: input.categoryId,
        specifics: input.specifics,
        costPrice: input.costPrice,
        minPrice: input.minPrice,
        quantity: input.quantity,
        // A new batch starts entirely unsold.
        qtyRemaining: input.quantity,
        purchaseDate: input.purchaseDate,
        clientId: input.clientId,
        createdAt: input.recordedAt,
      })
      .returning({ id: items.id });

    const estimatedProfit = (input.minPrice - input.costPrice) * input.quantity;
    return {
      status: 'applied',
      id: inserted.id,
      clientId: input.clientId,
      message: `Added ${input.quantity} × ${input.specifics}. Estimated profit ${formatUGX(estimatedProfit)}.`,
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const id = await findByClientId(items, input.clientId);
      return { status: 'duplicate', id: id ?? undefined, clientId: input.clientId };
    }
    throw error;
  }
}

/**
 * Editing a batch has to keep `qtyRemaining` consistent with what has already
 * been sold. Units sold is derived (quantity − qtyRemaining) rather than
 * counted from the sales table, so it stays correct even if a sale row was
 * removed and the stock restored.
 */
export async function updateItem(input: {
  id: number;
  categoryId: number;
  specifics: string;
  costPrice: number;
  minPrice: number;
  quantity: number;
  purchaseDate: string;
}): Promise<Outcome> {
  const [existing] = await db.select().from(items).where(eq(items.id, input.id)).limit(1);
  if (!existing) return reject('That product batch no longer exists');

  const unitsSold = existing.quantity - existing.qtyRemaining;

  if (input.quantity < unitsSold) {
    return reject(
      `${unitsSold} ${unitsSold === 1 ? 'unit has' : 'units have'} already been sold from this batch, ` +
        `so the quantity cannot be less than ${unitsSold}.`,
      { field: 'quantity' },
    );
  }

  await db
    .update(items)
    .set({
      categoryId: input.categoryId,
      specifics: input.specifics,
      costPrice: input.costPrice,
      minPrice: input.minPrice,
      quantity: input.quantity,
      qtyRemaining: input.quantity - unitsSold,
      purchaseDate: input.purchaseDate,
    })
    .where(eq(items.id, input.id));

  // Past sales keep their snapshotted unit_cost, so historical profit is unchanged.
  return {
    status: 'applied',
    id: input.id,
    message: 'Product updated. Past sales keep the cost they were recorded with.',
  };
}

/** Archiving hides a batch from sale lists and stock value without destroying history. */
export async function archiveItem(id: number, archived: boolean): Promise<Outcome> {
  const [existing] = await db
    .select({ id: items.id })
    .from(items)
    .where(eq(items.id, id))
    .limit(1);
  if (!existing) return reject('That product no longer exists');

  await db.update(items).set({ archived }).where(eq(items.id, id));
  return { status: 'applied', id, message: archived ? 'Product archived' : 'Product restored' };
}

// --------------------------------------------------------------- categories

export async function createCategory(input: {
  clientId: string;
  name: string;
}): Promise<Outcome> {
  const existing = await findByClientId(categories, input.clientId);
  if (existing) return { status: 'duplicate', id: existing, clientId: input.clientId };

  /*
   * Two devices can both create "curtains" offline. Neither is wrong, and
   * refusing the second one leaves the person staring at an error for something
   * that already exists. Adopt the live row instead: the op reports applied
   * against the existing id, and the device's local reference is remapped onto
   * it by the same idMap that handles ordinary creates.
   */
  const [live] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.name, input.name), isNull(categories.deletedAt)))
    .limit(1);

  if (live) {
    return {
      status: 'applied',
      id: live.id,
      clientId: input.clientId,
      message: `"${input.name}" already exists`,
    };
  }

  try {
    const [inserted] = await db
      .insert(categories)
      .values({ name: input.name, clientId: input.clientId })
      .returning({ id: categories.id });

    return {
      status: 'applied',
      id: inserted.id,
      clientId: input.clientId,
      message: `Added "${input.name}"`,
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const byClient = await findByClientId(categories, input.clientId);
      if (byClient) return { status: 'duplicate', id: byClient, clientId: input.clientId };

      const [raced] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.name, input.name), isNull(categories.deletedAt)))
        .limit(1);
      if (raced) {
        return { status: 'applied', id: raced.id, clientId: input.clientId };
      }
      return reject(`"${input.name}" already exists`, { field: 'name' });
    }
    throw error;
  }
}

export async function renameCategory(id: number, name: string): Promise<Outcome> {
  const [existing] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
    .limit(1);
  if (!existing) return reject('That category no longer exists');

  try {
    await db.update(categories).set({ name }).where(eq(categories.id, id));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return reject('Another category already has that name', { field: 'name' });
    }
    throw error;
  }

  return { status: 'applied', id, message: 'Category renamed' };
}

/**
 * Deleting a category that still has stock would orphan the batches, so we
 * check first and give a message that says what to do rather than surfacing a
 * constraint error. (The FK is still ON DELETE RESTRICT; this delete is soft,
 * so the FK would no longer catch it on its own.)
 */
export async function deleteCategory(id: number): Promise<Outcome> {
  const [existing] = await db
    .select({ id: categories.id, deletedAt: categories.deletedAt })
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1);

  if (!existing) return reject('That category no longer exists');
  if (existing.deletedAt) return { status: 'duplicate', id };

  const [{ count }] = await db
    .select({ count: sql<string>`COUNT(*)` })
    .from(items)
    .where(eq(items.categoryId, id));

  if (Number(count) > 0) {
    return reject(
      `That category still has ${count} product ${Number(count) === 1 ? 'batch' : 'batches'}. ` +
        'Move or archive them before deleting it.',
    );
  }

  await db.update(categories).set({ deletedAt: new Date() }).where(eq(categories.id, id));
  return { status: 'applied', id, message: 'Category deleted' };
}

// ---------------------------------------------------------- attendant links
//
// Online only, and not reachable from applyOp() at all. The token IS the
// attendant's whole credential and is generated here with the server's CSPRNG;
// and revoking a link from a device that cannot reach the server would be
// security theatre, since it takes effect only once the server hears about it.

/**
 * 32 bytes of CSPRNG entropy, base64url so it survives being pasted into
 * WhatsApp without escaping.
 */
function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createLink(name: string): Promise<Outcome> {
  await db.insert(attendantLinks).values({ name, token: newToken() });
  return { status: 'applied', message: `Created a link for ${name}` };
}

/**
 * Revoking flips `active` to false. lib/auth.ts re-checks this on every
 * attendant request, so an open tab stops working on its next action rather
 * than when the 30-day cookie eventually expires. A device that is offline
 * keeps working until its next sync, which then wipes its mirror — see
 * lib/offline/sync.ts.
 */
export async function setLinkActive(id: number, active: boolean): Promise<Outcome> {
  await db.update(attendantLinks).set({ active }).where(eq(attendantLinks.id, id));
  return {
    status: 'applied',
    id,
    message: active ? 'Link re-activated' : 'Link revoked. It no longer works.',
  };
}

/** Issues a fresh token for the same person, instantly invalidating the old URL. */
export async function regenerateLink(id: number): Promise<Outcome> {
  await db
    .update(attendantLinks)
    .set({ token: newToken(), active: true, lastUsedAt: null })
    .where(eq(attendantLinks.id, id));
  return { status: 'applied', id, message: 'New link generated. The old one has stopped working.' };
}

// ------------------------------------------------------------------ applyOp

/**
 * Validates, authorises and applies one queued op.
 *
 * Validation is the SAME zod schemas the forms use, run again here. The device
 * already checked, but the device is not a trustworthy place to check: a
 * queued op is plain JSON in IndexedDB that anyone with the phone can edit
 * before it is sent.
 */
export async function applyOp(session: Session, op: Op): Promise<OpResult> {
  const recordedAt = clampRecordedAt(op.at);

  const denied = (reason: string): OpResult => ({ opId: op.id, status: 'rejected', reason });
  const done = (outcome: Outcome): OpResult =>
    outcome.status === 'rejected'
      ? { opId: op.id, ...outcome }
      : { opId: op.id, ...outcome };

  switch (op.kind) {
    case 'sale.create': {
      const itemId = await resolveRef(op.data.item, items);
      if (!itemId) return denied('That item no longer exists');

      const parsed = saleSchema.safeParse({
        itemId,
        saleDate: op.data.saleDate,
        quantity: op.data.quantity,
        unitPrice: op.data.unitPrice,
      });
      if (!parsed.success) return denied(firstMessage(parsed.error));

      return done(
        await createSale(session, {
          clientId: op.data.clientId,
          ...parsed.data,
          recordedAt,
        }),
      );
    }

    case 'sale.delete': {
      const saleId = await resolveRef(op.data.sale, sales);
      if (!saleId) return denied('That sale has already been removed');
      return done(await deleteSale(session, saleId));
    }

    case 'expense.create': {
      const parsed = expenseSchema.safeParse({
        expenseDate: op.data.expenseDate,
        description: op.data.description,
        amount: op.data.amount,
        kind: op.data.kind,
      });
      if (!parsed.success) return denied(firstMessage(parsed.error));

      return done(
        await createExpense(session, {
          clientId: op.data.clientId,
          ...parsed.data,
          recordedAt,
        }),
      );
    }

    case 'expense.delete': {
      const expenseId = await resolveRef(op.data.expense, expenses);
      if (!expenseId) return denied('That expense has already been removed');
      return done(await deleteExpense(session, expenseId));
    }

    /*
     * Owner-only from here. Hiding a button is not access control, and neither
     * is an attendant's UI never building these ops — the queue is editable
     * JSON on a device the shop does not control.
     */
    case 'item.create': {
      if (session.role !== 'owner') return denied('Only the owner can add stock');

      const categoryId = await resolveRef(op.data.category, categories);
      if (!categoryId) return denied('That category no longer exists');

      const parsed = itemSchema.safeParse({
        categoryId,
        specifics: op.data.specifics,
        costPrice: op.data.costPrice,
        minPrice: op.data.minPrice,
        quantity: op.data.quantity,
        purchaseDate: op.data.purchaseDate,
      });
      if (!parsed.success) return denied(firstMessage(parsed.error));

      return done(await createItem({ clientId: op.data.clientId, ...parsed.data, recordedAt }));
    }

    case 'item.update': {
      if (session.role !== 'owner') return denied('Only the owner can edit stock');

      const id = await resolveRef(op.data.item, items);
      const categoryId = await resolveRef(op.data.category, categories);
      if (!id) return denied('That product batch no longer exists');
      if (!categoryId) return denied('That category no longer exists');

      const parsed = itemUpdateSchema.safeParse({
        id,
        categoryId,
        specifics: op.data.specifics,
        costPrice: op.data.costPrice,
        minPrice: op.data.minPrice,
        quantity: op.data.quantity,
        purchaseDate: op.data.purchaseDate,
      });
      if (!parsed.success) return denied(firstMessage(parsed.error));

      return done(await updateItem(parsed.data));
    }

    case 'item.archive': {
      if (session.role !== 'owner') return denied('Only the owner can archive stock');
      const id = await resolveRef(op.data.item, items);
      if (!id) return denied('That product no longer exists');
      return done(await archiveItem(id, Boolean(op.data.archived)));
    }

    case 'category.create': {
      if (session.role !== 'owner') return denied('Only the owner can add categories');
      const parsed = categorySchema.safeParse({ name: op.data.name });
      if (!parsed.success) return denied(firstMessage(parsed.error));
      return done(await createCategory({ clientId: op.data.clientId, name: parsed.data.name }));
    }

    case 'category.rename': {
      if (session.role !== 'owner') return denied('Only the owner can rename categories');
      const id = await resolveRef(op.data.category, categories);
      if (!id) return denied('That category no longer exists');
      const parsed = categorySchema.safeParse({ name: op.data.name });
      if (!parsed.success) return denied(firstMessage(parsed.error));
      return done(await renameCategory(id, parsed.data.name));
    }

    case 'category.delete': {
      if (session.role !== 'owner') return denied('Only the owner can delete categories');
      const id = await resolveRef(op.data.category, categories);
      if (!id) return denied('That category no longer exists');
      return done(await deleteCategory(id));
    }

    default: {
      // Exhaustiveness: a new op kind added to types.ts without a case here is
      // a compile error, not a silently dropped mutation.
      const exhaustive: never = op;
      void exhaustive;
      return denied('That kind of entry is not recognised by the server');
    }
  }
}

function firstMessage(error: { issues: { message: string }[] }): string {
  const errors = fieldErrors(error as never);
  return errors._form ?? Object.values(errors)[0] ?? 'That entry is not valid';
}
