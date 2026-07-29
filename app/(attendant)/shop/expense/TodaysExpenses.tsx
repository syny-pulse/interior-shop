'use client';

import { useSync } from '@/components/offline/SyncProvider';
import { MirrorGate } from '@/components/offline/MirrorGate';
import { expensesInRange } from '@/lib/offline/mirror';
import { formatUGX } from '@/lib/format';
import { formatDateShort, todayInKampala } from '@/lib/dates';
import { EXPENSE_KIND_LABELS, type ExpenseKind } from '@/lib/expense-kinds';

/**
 * Today only: attendants log what they spend as they spend it.
 *
 * "Today" is recomputed on the device in Africa/Kampala, never from a server
 * clock — same rule as everywhere else, and it matters more here because this
 * component may render hours after the page HTML was cached.
 */
export function TodaysExpenses() {
  return (
    <MirrorGate>
      <TodaysExpensesInner />
    </MirrorGate>
  );
}

function TodaysExpensesInner() {
  const { projection } = useSync();
  const today = todayInKampala();
  const expenses = expensesInRange(projection, today, today);

  if (expenses.length === 0) {
    return (
      <p className="surface px-4 py-6 text-center text-[0.875rem] text-[var(--text-muted)]">
        Nothing recorded today.
      </p>
    );
  }

  return (
    <ul className="surface divide-y overflow-hidden">
      {expenses.map((expense) => (
        <li
          key={expense.key}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
        >
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium leading-snug">
              {expense.description}
              {expense.pending && <span className="chip chip-muted">Not sent yet</span>}
            </p>
            <p className="text-[0.8125rem] text-[var(--text-muted)]">
              {formatDateShort(expense.expenseDate)} ·{' '}
              {EXPENSE_KIND_LABELS[expense.kind as ExpenseKind] ?? 'Other'} ·{' '}
              {projection.attendantName(expense.attendantId) ?? 'you'}
            </p>
          </div>
          <p className="tnum font-medium">{formatUGX(expense.amount)}</p>
        </li>
      ))}
    </ul>
  );
}
