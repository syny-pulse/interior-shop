'use client';

import { useCallback, useState } from 'react';
import { Field } from '@/components/ui/Field';
import { FormMessage } from '@/components/ui/Alert';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { AmountInput } from '@/components/ui/AmountInput';
import { DatePicker } from '@/components/ui/DatePicker';
import { formatUGX } from '@/lib/format';
import { todayInKampala } from '@/lib/dates';
import { itemSchema, itemUpdateSchema } from '@/lib/validation';
import {
  newClientId,
  parse,
  useOfflineAction,
  type Built,
} from '@/lib/offline/use-offline-action';
import type { Ref } from '@/lib/offline/types';

export interface CategoryOption {
  id: number | null;
  key: string;
  name: string;
  clientId: string | null;
}

export interface ItemDraft {
  id: number | null;
  clientId: string | null;
  categoryId: number;
  specifics: string;
  costPrice: number;
  minPrice: number;
  quantity: number;
  purchaseDate: string;
}

/**
 * The shopping-day form. The live estimated-profit footer is the whole point:
 * it tells Sarah whether a batch is worth buying while she is still standing
 * at the supplier, not after she has already paid — which is exactly the moment
 * she is least likely to have a signal, hence the queue.
 */
export function ProductForm({
  categories,
  item,
}: {
  categories: CategoryOption[];
  item?: ItemDraft;
}) {
  const editing = Boolean(item);

  const build = useCallback(
    (formData: FormData): Built => {
      const categoryKey = String(formData.get('categoryKey') ?? '');
      const category = categories.find((c) => c.key === categoryKey);
      if (!category) return { ok: false, errors: { categoryKey: 'Choose a category' } };

      const categoryRef: Ref =
        category.id !== null ? { id: category.id } : { clientId: category.clientId as string };

      const fields = {
        // Placeholders where a locally created row has no id yet; the wire
        // form carries the clientId and the server resolves it.
        categoryId: category.id ?? 1,
        specifics: formData.get('specifics'),
        costPrice: formData.get('costPrice'),
        minPrice: formData.get('minPrice'),
        quantity: formData.get('quantity'),
        purchaseDate: formData.get('purchaseDate'),
      };

      if (editing && item) {
        const parsed = parse(itemUpdateSchema, { id: item.id ?? 1, ...fields });
        if (!parsed.ok) return { ok: false, errors: parsed.errors };

        const itemRef: Ref =
          item.id !== null ? { id: item.id } : { clientId: item.clientId as string };

        return {
          ok: true,
          op: {
            kind: 'item.update',
            data: {
              item: itemRef,
              category: categoryRef,
              specifics: parsed.data.specifics,
              costPrice: parsed.data.costPrice,
              minPrice: parsed.data.minPrice,
              quantity: parsed.data.quantity,
              purchaseDate: parsed.data.purchaseDate,
            },
          },
          label: `Edit ${parsed.data.specifics}`,
          message: 'Product updated. Past sales keep the cost they were recorded with.',
        };
      }

      const parsed = parse(itemSchema, fields);
      if (!parsed.ok) return { ok: false, errors: parsed.errors };

      const estimatedProfit =
        (parsed.data.minPrice - parsed.data.costPrice) * parsed.data.quantity;

      return {
        ok: true,
        op: {
          kind: 'item.create',
          data: {
            clientId: newClientId(),
            category: categoryRef,
            specifics: parsed.data.specifics,
            costPrice: parsed.data.costPrice,
            minPrice: parsed.data.minPrice,
            quantity: parsed.data.quantity,
            purchaseDate: parsed.data.purchaseDate,
          },
        },
        label: `${parsed.data.quantity} × ${parsed.data.specifics}`,
        message: `Added ${parsed.data.quantity} × ${parsed.data.specifics}. Estimated profit ${formatUGX(estimatedProfit)}.`,
      };
    },
    [categories, editing, item],
  );

  const [state, formAction] = useOfflineAction(build);

  const [costPrice, setCostPrice] = useState(item ? String(item.costPrice) : '');
  const [minPrice, setMinPrice] = useState(item ? String(item.minPrice) : '');
  const [quantity, setQuantity] = useState(item ? String(item.quantity) : '1');
  const [purchaseDate, setPurchaseDate] = useState(item?.purchaseDate ?? todayInKampala());

  const cost = Number(costPrice) || 0;
  const sell = Number(minPrice) || 0;
  const qty = Number(quantity) || 0;

  const perUnit = sell - cost;
  const total = perUnit * qty;
  const hasFigures = cost > 0 && sell > 0 && qty > 0;
  const losesMoney = hasFigures && perUnit < 0;

  if (categories.length === 0) {
    return (
      <div className="surface p-5 text-[0.9375rem] text-[var(--text-muted)]">
        Add a category first, then come back to record what you bought.
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Shopping day" htmlFor="purchaseDate" error={state.errors?.purchaseDate}>
          <DatePicker
            id="purchaseDate"
            name="purchaseDate"
            required
            value={purchaseDate}
            onChange={setPurchaseDate}
            invalid={Boolean(state.errors?.purchaseDate)}
          />
        </Field>

        <Field
          label="Category"
          htmlFor="categoryKey"
          error={state.errors?.categoryKey ?? state.errors?.categoryId}
        >
          <select
            id="categoryKey"
            name="categoryKey"
            required
            defaultValue={
              categories.find((c) => c.id === item?.categoryId)?.key ?? ''
            }
            className="control"
          >
            <option value="" disabled>
              Choose a category
            </option>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field
        label="What is it?"
        htmlFor="specifics"
        error={state.errors?.specifics}
        hint="Be specific enough to recognise it later, for example: Cotton king size, floral"
      >
        <input
          id="specifics"
          name="specifics"
          type="text"
          required
          maxLength={200}
          defaultValue={item?.specifics ?? ''}
          className="control"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Cost price (per item)"
          htmlFor="costPrice"
          error={state.errors?.costPrice}
        >
          <AmountInput
            id="costPrice"
            name="costPrice"
            required
            value={costPrice}
            onValueChange={setCostPrice}
            className="control tnum"
          />
        </Field>

        <Field
          label="Selling price (per item)"
          htmlFor="minPrice"
          error={state.errors?.minPrice}
          hint="Attendants see this as the minimum"
        >
          <AmountInput
            id="minPrice"
            name="minPrice"
            required
            value={minPrice}
            onValueChange={setMinPrice}
            className="control tnum"
          />
        </Field>

        <Field label="How many?" htmlFor="quantity" error={state.errors?.quantity}>
          <input
            id="quantity"
            name="quantity"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="control tnum"
          />
        </Field>
      </div>

      <div
        className="rounded-[var(--radius-card)] border px-4 py-3.5"
        style={{
          background: losesMoney ? 'var(--warn-soft)' : 'var(--accent-soft)',
          borderColor: losesMoney ? 'var(--warn-border)' : 'var(--accent-border)',
        }}
      >
        {hasFigures ? (
          <>
            <p
              className="text-[0.8125rem] font-medium"
              style={{ color: losesMoney ? 'var(--warn)' : 'var(--accent-text)' }}
            >
              {losesMoney ? 'This batch would lose money' : 'Estimated profit'}
            </p>
            <p
              className="tnum mt-0.5 text-[1.5rem] font-semibold tracking-tight"
              style={{ color: losesMoney ? 'var(--warn)' : 'var(--accent-text)' }}
            >
              {formatUGX(total)}
            </p>
            <p
              className="tnum mt-0.5 text-[0.8125rem]"
              style={{ color: losesMoney ? 'var(--warn)' : 'var(--accent-text)' }}
            >
              {formatUGX(perUnit)} per item across {qty} {qty === 1 ? 'item' : 'items'}
            </p>
          </>
        ) : (
          <p className="text-[0.875rem] text-[var(--text-muted)]">
            Fill in cost, selling price and quantity to see the estimated profit.
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <SubmitButton pendingLabel={editing ? 'Saving' : 'Adding'}>
          {editing ? 'Save changes' : 'Add to stock'}
        </SubmitButton>
      </div>
    </form>
  );
}
