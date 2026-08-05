'use client';

import { useCallback, useState } from 'react';
import { Field } from '@/components/ui/Field';
import { FormMessage } from '@/components/ui/Alert';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { AmountInput } from '@/components/ui/AmountInput';
import { DatePicker } from '@/components/ui/DatePicker';
import { formatUGX } from '@/lib/format';
import { todayInKampala } from '@/lib/dates';
import { itemSchema } from '@/lib/validation';
import {
  newClientId,
  parse,
  useOfflineAction,
  type Built,
} from '@/lib/offline/use-offline-action';
import type { Ref } from '@/lib/offline/types';
import type { StockProduct } from '@/lib/offline/stock';

/**
 * Buying more of something already stocked.
 *
 * A restock is a NEW BATCH, never a bigger old one. The cost you paid this
 * month is not the cost you paid last month, and every sale already recorded
 * measured its profit against the batch it came out of — bumping a quantity
 * would mix two buying prices into one figure and quietly restate history.
 *
 * So this is an item.create with the description and category held fixed, and
 * only the four things that actually change on a shopping trip left to fill in.
 * Prefilled from the newest batch, because "the same again" is the common case
 * and typing the price back in from memory is how a digit goes missing.
 */
export function RestockForm({
  product,
  onDone,
}: {
  product: StockProduct;
  /** Lets the caller close the form. The success message stays either way. */
  onDone?: () => void;
}) {
  const build = useCallback(
    (formData: FormData): Built => {
      /*
       * A batch created offline inside a category that is ALSO still queued has
       * no category id — the projection keeps the id it has, which is -1, and
       * the reference to the pending category is not recoverable from it. The
       * caller disables restock in that case; this is the backstop.
       */
      if (product.categoryId <= 0) {
        return {
          ok: false,
          errors: {},
          message: 'This product has not been sent yet. Restock once it has synced.',
        };
      }

      const category: Ref = { id: product.categoryId };

      const parsed = parse(itemSchema, {
        categoryId: product.categoryId,
        specifics: product.specifics,
        costPrice: formData.get('costPrice'),
        minPrice: formData.get('minPrice'),
        quantity: formData.get('quantity'),
        purchaseDate: formData.get('purchaseDate'),
      });

      if (!parsed.ok) return { ok: false, errors: parsed.errors };

      const spend = parsed.data.costPrice * parsed.data.quantity;

      return {
        ok: true,
        op: {
          kind: 'item.create',
          data: {
            clientId: newClientId(),
            category,
            specifics: parsed.data.specifics,
            costPrice: parsed.data.costPrice,
            minPrice: parsed.data.minPrice,
            quantity: parsed.data.quantity,
            purchaseDate: parsed.data.purchaseDate,
          },
        },
        label: `Restock ${parsed.data.quantity} × ${parsed.data.specifics}`,
        message: `Added ${parsed.data.quantity} more. This trip cost ${formatUGX(spend)}.`,
      };
    },
    [product.categoryId, product.specifics],
  );

  const [state, formAction] = useOfflineAction(build);

  const [quantity, setQuantity] = useState(String(product.latest.quantity));
  const [costPrice, setCostPrice] = useState(
    product.latest.costPrice === null ? '' : String(product.latest.costPrice),
  );
  const [minPrice, setMinPrice] = useState(String(product.latest.minPrice));
  const [purchaseDate, setPurchaseDate] = useState(todayInKampala());

  const cost = Number(costPrice) || 0;
  const sell = Number(minPrice) || 0;
  const qty = Number(quantity) || 0;

  const spend = cost * qty;
  const perUnit = sell - cost;
  const hasFigures = cost > 0 && sell > 0 && qty > 0;
  const losesMoney = hasFigures && perUnit < 0;
  const priceChanged =
    product.latest.costPrice !== null && cost > 0 && cost !== product.latest.costPrice;

  return (
    <form action={formAction} className="space-y-3">
      <FormMessage state={state} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="How many more?" htmlFor={`re-qty-${product.key}`} error={state.errors?.quantity}>
          <input
            id={`re-qty-${product.key}`}
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

        <Field label="Shopping day" htmlFor={`re-date-${product.key}`} error={state.errors?.purchaseDate}>
          <DatePicker
            id={`re-date-${product.key}`}
            name="purchaseDate"
            required
            value={purchaseDate}
            onChange={setPurchaseDate}
            invalid={Boolean(state.errors?.purchaseDate)}
          />
        </Field>

        <Field
          label="Cost price (per item)"
          htmlFor={`re-cost-${product.key}`}
          error={state.errors?.costPrice}
          hint={
            priceChanged
              ? `Last time you paid ${formatUGX(product.latest.costPrice ?? 0)}`
              : undefined
          }
        >
          <AmountInput
            id={`re-cost-${product.key}`}
            name="costPrice"
            required
            value={costPrice}
            onValueChange={setCostPrice}
            className="control tnum"
          />
        </Field>

        <Field
          label="Selling price (per item)"
          htmlFor={`re-sell-${product.key}`}
          error={state.errors?.minPrice}
        >
          <AmountInput
            id={`re-sell-${product.key}`}
            name="minPrice"
            required
            value={minPrice}
            onValueChange={setMinPrice}
            className="control tnum"
          />
        </Field>
      </div>

      {/*
        The same figure ProductForm shows, for the same reason: this is the
        moment the decision is made, standing at the supplier — and it is
        exactly the moment there is least likely to be a signal.
      */}
      <div
        className="rounded-[var(--radius-control)] border px-3.5 py-3"
        style={{
          background: losesMoney ? 'var(--warn-soft)' : 'var(--accent-soft)',
          borderColor: losesMoney ? 'var(--warn-border)' : 'var(--accent-border)',
        }}
      >
        {hasFigures ? (
          <p
            className="tnum text-[0.875rem] leading-relaxed"
            style={{ color: losesMoney ? 'var(--warn)' : 'var(--accent-text)' }}
          >
            {losesMoney ? (
              <>
                This would sell at a loss of {formatUGX(Math.abs(perUnit))} per item.
              </>
            ) : (
              <>
                This trip costs <strong>{formatUGX(spend)}</strong> and should return{' '}
                <strong>{formatUGX(perUnit * qty)}</strong> profit
                {' '}({formatUGX(perUnit)} per item).
              </>
            )}
          </p>
        ) : (
          <p className="text-[0.875rem] text-[var(--text-muted)]">
            Fill in the figures to see what this trip costs and returns.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <SubmitButton pendingLabel="Adding" className="py-1.5 text-[0.875rem]">
          Add to stock
        </SubmitButton>
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="btn btn-ghost py-1.5 text-[0.875rem]"
          >
            {state.ok ? 'Done' : 'Cancel'}
          </button>
        )}
      </div>
    </form>
  );
}
