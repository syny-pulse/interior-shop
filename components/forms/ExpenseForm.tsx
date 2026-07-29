'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Field } from '@/components/ui/Field';
import { FormMessage } from '@/components/ui/Alert';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { AmountInput } from '@/components/ui/AmountInput';
import { DatePicker } from '@/components/ui/DatePicker';
import { todayInKampala } from '@/lib/dates';
import { formatUGX } from '@/lib/format';
import { expenseSchema } from '@/lib/validation';
// Not from db/schema.ts — that would pull drizzle into the phone's bundle.
import { EXPENSE_KINDS, EXPENSE_KIND_LABELS } from '@/lib/expense-kinds';
import {
  newClientId,
  parse,
  useOfflineAction,
  type Built,
} from '@/lib/offline/use-offline-action';

/**
 * Recorded straight into the outbox, like everything else. An attendant paying
 * a boda in a shop with no signal gets the same instant "Recorded" as one with
 * four bars, and the entry leaves the phone when the connection does return.
 */
export function ExpenseForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(todayInKampala());

  const build = useCallback((formData: FormData): Built => {
    const parsed = parse(expenseSchema, {
      expenseDate: formData.get('expenseDate'),
      description: formData.get('description'),
      amount: formData.get('amount'),
      kind: formData.get('kind'),
    });
    if (!parsed.ok) return { ok: false, errors: parsed.errors };

    return {
      ok: true,
      op: { kind: 'expense.create', data: { clientId: newClientId(), ...parsed.data } },
      label: `${formatUGX(parsed.data.amount)} — ${parsed.data.description}`,
      message: `Recorded ${formatUGX(parsed.data.amount)} for ${parsed.data.description}`,
    };
  }, []);

  const [state, formAction] = useOfflineAction(build);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setAmount('');
      setExpenseDate(todayInKampala());
    }
  }, [state.ok, state.nonce]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date" htmlFor="expenseDate" error={state.errors?.expenseDate}>
          <DatePicker
            id="expenseDate"
            name="expenseDate"
            required
            value={expenseDate}
            onChange={setExpenseDate}
            invalid={Boolean(state.errors?.expenseDate)}
          />
        </Field>

        <Field label="Type" htmlFor="kind" error={state.errors?.kind}>
          <select id="kind" name="kind" defaultValue="other" className="control">
            {EXPENSE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {EXPENSE_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field
        label="What was it for?"
        htmlFor="description"
        error={state.errors?.description}
        hint="For example: boda to pick up curtains from the market"
      >
        <input
          id="description"
          name="description"
          type="text"
          required
          maxLength={200}
          className="control"
        />
      </Field>

      <Field label="Amount" htmlFor="amount" error={state.errors?.amount}>
        <AmountInput
          id="amount"
          name="amount"
          required
          value={amount}
          onValueChange={setAmount}
          className="control tnum"
        />
      </Field>

      <SubmitButton pendingLabel="Recording">Record expense</SubmitButton>
    </form>
  );
}
