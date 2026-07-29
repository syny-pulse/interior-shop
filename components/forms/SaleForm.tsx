'use client';

import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { Field } from '@/components/ui/Field';
import { FormMessage } from '@/components/ui/Alert';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { AmountInput } from '@/components/ui/AmountInput';
import { DatePicker } from '@/components/ui/DatePicker';
import { formatUGX } from '@/lib/format';
import { todayInKampala } from '@/lib/dates';
import { saleSchema } from '@/lib/validation';
import {
  newClientId,
  parse,
  useOfflineAction,
  type Built,
} from '@/lib/offline/use-offline-action';
import type { Ref } from '@/lib/offline/types';

export interface SellableOption {
  /** null while the batch itself is still queued — reference it by clientId. */
  id: number | null;
  key: string;
  specifics: string;
  minPrice: number;
  qtyRemaining: number;
  categoryId: number;
  categoryName: string;
  clientId: string | null;
}

/**
 * Shared by Sarah and by attendants. It is built from the projection, which
 * carries no cost price at all on an attendant's device, so neither side can
 * leak a margin through this component.
 *
 * Selling below the minimum warns but never blocks. Haggling is normal in this
 * trade; the sale is flagged instead so Sarah sees it on her dashboard.
 *
 * The stock figure shown is PROJECTED: what the server last said, less
 * anything sold from this phone that has not been sent yet. Without that
 * subtraction an attendant on a dead connection is told the last blanket is
 * still there immediately after selling it, and sells it twice.
 *
 * The date is captured here and travels with the queued sale. It is never
 * recomputed at sync time — a sale recorded at 23:50 and sent at 00:10 belongs
 * to the earlier day, and moving it would quietly falsify two days' takings.
 */
export function SaleForm({ items }: { items: SellableOption[] }) {
  const formRef = useRef<HTMLFormElement>(null);

  const [saleDate, setSaleDate] = useState(todayInKampala());
  const [categoryId, setCategoryId] = useState('');
  const [itemKey, setItemKey] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');

  const selected = items.find((i) => i.key === itemKey);

  const build = useCallback(
    (formData: FormData): Built => {
      const key = String(formData.get('itemKey') ?? '');
      const item = items.find((i) => i.key === key);
      if (!item) return { ok: false, errors: { itemKey: 'Choose an item' } };

      const parsed = parse(saleSchema, {
        /*
         * The schema wants a positive integer id, but a batch that exists only
         * on this phone has none yet. Validate against a placeholder and put
         * the clientId on the wire instead; the server resolves it.
         */
        itemId: item.id ?? 1,
        saleDate: formData.get('saleDate'),
        quantity: formData.get('quantity'),
        unitPrice: formData.get('unitPrice'),
      });
      if (!parsed.ok) return { ok: false, errors: parsed.errors };

      const ref: Ref =
        item.id !== null ? { id: item.id } : { clientId: item.clientId as string };

      const total = parsed.data.unitPrice * parsed.data.quantity;
      const flagged = parsed.data.unitPrice < item.minPrice;

      return {
        ok: true,
        op: {
          kind: 'sale.create',
          data: {
            clientId: newClientId(),
            item: ref,
            saleDate: parsed.data.saleDate,
            quantity: parsed.data.quantity,
            unitPrice: parsed.data.unitPrice,
          },
        },
        label: `${parsed.data.quantity} × ${item.specifics} for ${formatUGX(total)}`,
        message: flagged
          ? `Recorded ${parsed.data.quantity} × ${item.specifics} for ${formatUGX(total)}. Flagged as below the minimum.`
          : `Recorded ${parsed.data.quantity} × ${item.specifics} for ${formatUGX(total)}.`,
      };
    },
    [items],
  );

  const [state, formAction] = useOfflineAction(build);

  const categories = useMemo(() => {
    const seen = new Map<number, string>();
    for (const item of items) seen.set(item.categoryId, item.categoryName);
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const visibleItems = useMemo(
    () => (categoryId ? items.filter((i) => i.categoryId === Number(categoryId)) : items),
    [items, categoryId],
  );

  // Clear a selection that the new category filter no longer contains.
  useEffect(() => {
    if (selected && categoryId && selected.categoryId !== Number(categoryId)) {
      setItemKey('');
      setUnitPrice('');
    }
  }, [categoryId, selected]);

  // Reset for the next customer once a sale is recorded.
  useEffect(() => {
    if (state.ok) {
      setItemKey('');
      setQuantity('1');
      setUnitPrice('');
    }
  }, [state.ok, state.nonce]);

  const price = Number(unitPrice) || 0;
  const qty = Number(quantity) || 0;
  const belowMin = Boolean(selected) && price > 0 && price < selected!.minPrice;
  const overStock = Boolean(selected) && qty > selected!.qtyRemaining;
  const total = price * qty;

  if (items.length === 0) {
    return (
      <div className="surface p-5 text-[0.9375rem] text-[var(--text-muted)]">
        There is nothing in stock to sell right now.
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date of sale" htmlFor="saleDate" error={state.errors?.saleDate}>
          <DatePicker
            id="saleDate"
            name="saleDate"
            required
            value={saleDate}
            onChange={setSaleDate}
            invalid={Boolean(state.errors?.saleDate)}
          />
        </Field>

        <Field label="Category" htmlFor="saleCategory">
          <select
            id="saleCategory"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="control"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field
        label="Item"
        htmlFor="itemKey"
        error={state.errors?.itemKey ?? state.errors?.itemId}
      >
        <select
          id="itemKey"
          name="itemKey"
          required
          value={itemKey}
          onChange={(e) => {
            setItemKey(e.target.value);
            const next = items.find((i) => i.key === e.target.value);
            // Pre-fill with the proposed price; it is the common case.
            setUnitPrice(next ? String(next.minPrice) : '');
          }}
          className="control"
        >
          <option value="" disabled>
            Choose an item
          </option>
          {visibleItems.map((i) => (
            <option key={i.key} value={i.key}>
              {i.specifics} ({i.qtyRemaining} left)
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="How many?"
          htmlFor="quantity"
          error={state.errors?.quantity}
          hint={selected ? `${selected.qtyRemaining} in stock` : undefined}
        >
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
            aria-invalid={overStock || undefined}
            className="control tnum"
          />
        </Field>

        <Field
          label="Selling price (per item)"
          htmlFor="unitPrice"
          error={state.errors?.unitPrice}
        >
          <AmountInput
            id="unitPrice"
            name="unitPrice"
            required
            value={unitPrice}
            onValueChange={setUnitPrice}
            aria-describedby={selected ? 'min-price-tag' : undefined}
            className="control tnum"
          />
          {selected && (
            <p id="min-price-tag" className="mt-2 flex flex-wrap items-center gap-2">
              <span className={belowMin ? 'chip chip-warn' : 'chip chip-accent'}>
                Minimum {formatUGX(selected.minPrice)}
              </span>
              {belowMin && (
                <span className="text-[0.8125rem] font-medium text-[var(--warn)]">
                  Below the minimum. This sale will be flagged.
                </span>
              )}
            </p>
          )}
        </Field>
      </div>

      {overStock && selected && (
        <p className="text-[0.875rem] font-medium text-[var(--negative)]" role="alert">
          Only {selected.qtyRemaining} in stock. Reduce the quantity to continue.
        </p>
      )}

      <div className="surface flex items-center justify-between gap-3 px-4 py-3.5">
        <span className="text-[0.8125rem] font-medium text-[var(--text-muted)]">
          Total for this sale
        </span>
        <span className="tnum text-[1.35rem] font-semibold tracking-tight">
          {formatUGX(total)}
        </span>
      </div>

      <SubmitButton pendingLabel="Recording" disabled={overStock}>
        Record sale
      </SubmitButton>
    </form>
  );
}
