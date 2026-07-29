'use client';

import { useSync } from '@/components/offline/SyncProvider';
import { MirrorGate } from '@/components/offline/MirrorGate';
import { expensesInRange } from '@/lib/offline/mirror';
import { useRange } from '@/lib/offline/use-range';
import { formatUGX, formatNumber, pluralise } from '@/lib/format';
import { formatDateShort } from '@/lib/dates';
import { EXPENSE_KIND_LABELS, type ExpenseKind } from '@/lib/expense-kinds';
import { RangePicker } from '@/components/RangePicker';
import { ExpenseForm } from '@/components/forms/ExpenseForm';
import { DeleteExpense } from './DeleteExpense';

export function ExpensesPanel() {
  return (
    <MirrorGate>
      <ExpensesPanelInner />
    </MirrorGate>
  );
}

function ExpensesPanelInner() {
  const { projection } = useSync();
  const range = useRange();

  const expenses = expensesInRange(projection, range.from, range.to);
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="space-y-6">
      <div className="surface p-5">
        <h2 className="mb-4 text-[0.9375rem] font-semibold">Record an expense</h2>
        <ExpenseForm />
      </div>

      <div className="space-y-3">
        <h2 className="text-[0.9375rem] font-semibold">Expense history</h2>
        <RangePicker />
      </div>

      {expenses.length === 0 ? (
        <p className="surface px-4 py-8 text-center text-[0.875rem] text-[var(--text-muted)]">
          No expenses recorded for {range.label.toLowerCase()}.
        </p>
      ) : (
        <>
          <div className="surface flex items-baseline justify-between gap-4 px-4 py-3.5">
            <p className="text-[0.8125rem] text-[var(--text-muted)]">
              {formatNumber(expenses.length)} {pluralise(expenses.length, 'expense')}
            </p>
            <p className="tnum text-[1.25rem] font-semibold tracking-tight">
              {formatUGX(total)}
            </p>
          </div>

          <ul className="surface divide-y overflow-hidden">
            {expenses.map((expense) => (
              <li key={expense.key} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium leading-snug">
                      {expense.description}
                      {expense.pending && (
                        <span className="chip chip-muted">Not sent yet</span>
                      )}
                    </p>
                    <p className="text-[0.8125rem] text-[var(--text-muted)]">
                      {formatDateShort(expense.expenseDate)} ·{' '}
                      {EXPENSE_KIND_LABELS[expense.kind as ExpenseKind] ?? 'Other'} ·{' '}
                      {projection.attendantName(expense.attendantId) ?? 'you'}
                    </p>
                  </div>
                  <p className="tnum font-medium">{formatUGX(expense.amount)}</p>
                </div>
                <div className="mt-2">
                  <DeleteExpense id={expense.id} clientId={expense.clientId} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
