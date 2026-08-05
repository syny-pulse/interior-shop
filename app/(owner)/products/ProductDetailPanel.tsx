'use client';

import { useState } from 'react';
import { formatNumber, formatUGX, pluralise } from '@/lib/format';
import { formatDate } from '@/lib/dates';
import type { StockBatch, StockProduct } from '@/lib/offline/stock';
import { STATUS_LABEL } from '@/lib/offline/stock';
import { ProductForm, type CategoryOption } from '@/components/forms/ProductForm';
import { RestockForm } from '@/components/forms/RestockForm';
import { Alert } from '@/components/ui/Alert';
import { ArchiveToggle } from './ArchiveToggle';

/**
 * What is behind a row: the purchase batches, and everything you can do to them.
 *
 * This is where the table stops summarising. A product row says "12 left, sells
 * at 65,000"; down here is the truth it was made of — which shopping trip each
 * one came from, what it cost that day, and what it is really worth now.
 *
 * It is also the detail view on a phone. Every column the table drops at 360px
 * is stated here in words, so nothing is only reachable by scrolling sideways.
 */
export function ProductDetailPanel({
  product,
  categories,
}: {
  product: StockProduct;
  categories: CategoryOption[];
}) {
  const [restocking, setRestocking] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  // A category that has not synced leaves its batches with no usable reference,
  // so a new batch cannot be attached to it. See RestockForm.
  const canRestock = product.categoryId > 0;

  const batches = [...product.batches, ...product.archivedBatches];

  return (
    <div className="space-y-4">
      <Summary product={product} />

      <div>
        <h3 className="label mb-2">
          {batches.length} {pluralise(batches.length, 'purchase', 'purchases')}
        </h3>

        <ul className="space-y-2">
          {batches.map((batch) => (
            <li key={batch.key} className="surface p-3">
              <BatchRow batch={batch} />

              <div className="mt-2.5 flex flex-wrap gap-2 border-t pt-2.5">
                <button
                  type="button"
                  onClick={() => setEditingKey(editingKey === batch.key ? null : batch.key)}
                  aria-expanded={editingKey === batch.key}
                  className="btn btn-secondary py-1.5 text-[0.875rem]"
                >
                  {editingKey === batch.key ? 'Close' : 'Edit'}
                </button>
                <ArchiveToggle
                  id={batch.id}
                  clientId={batch.clientId}
                  archived={batch.archived}
                />
              </div>

              {editingKey === batch.key && (
                <div className="mt-3 border-t pt-3">
                  {batch.unitsSold > 0 && (
                    <div className="mb-3">
                      <Alert tone="info">
                        {formatNumber(batch.unitsSold)}{' '}
                        {pluralise(batch.unitsSold, 'unit has', 'units have')} already sold from
                        this purchase. Changing the cost price will not alter the profit already
                        recorded on those sales.
                      </Alert>
                    </div>
                  )}

                  {/*
                    The same form as /products/[id], which still works as a
                    direct link. Editing here also reaches a batch that has
                    never synced — it is referenced by clientId, so it no longer
                    has to wait for an id before it can be corrected.
                  */}
                  <ProductForm
                    categories={categories}
                    item={{
                      id: batch.id,
                      clientId: batch.clientId,
                      categoryId: product.categoryId,
                      specifics: product.specifics,
                      costPrice: batch.costPrice ?? 0,
                      minPrice: batch.minPrice,
                      quantity: batch.quantity,
                      purchaseDate: batch.purchaseDate,
                    }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t pt-3">
        {!canRestock ? (
          <p className="text-[0.8125rem] text-[var(--text-faint)]">
            Restock once this has been sent — its category has not reached the server yet.
          </p>
        ) : restocking ? (
          <div className="surface p-3">
            <h3 className="mb-3 font-medium">Buy more {product.specifics}</h3>
            <RestockForm product={product} onDone={() => setRestocking(false)} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setRestocking(true)}
            className="btn btn-primary py-1.5 text-[0.875rem]"
          >
            Restock this
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The figures the table hides at narrow widths, restated in words.
 *
 * Deliberately says how many were bought ALL TIME as well as in the current
 * stocking, because those are two different numbers and the "12 of 20" in the
 * row is the second one. Leaving that unexplained is how a shopkeeper starts
 * mistrusting the whole page.
 */
function Summary({ product }: { product: StockProduct }) {
  const liveCount = product.batches.filter((b) => b.qtyRemaining > 0).length;

  return (
    <dl className="tnum grid grid-cols-2 gap-x-4 gap-y-3 text-[0.8125rem] sm:grid-cols-4">
      <Figure
        label="On the shelf"
        value={`${formatNumber(product.qtyRemaining)} of ${formatNumber(product.liveBaseline)}`}
        note={
          liveCount === 1
            ? 'from 1 purchase still in stock'
            : `across ${liveCount} purchases still in stock`
        }
      />
      <Figure
        label="Money tied up"
        value={product.atCost === null ? '—' : formatUGX(product.atCost)}
        note={product.atCost === null ? undefined : 'at what you paid'}
      />
      <Figure
        label="If it all sells"
        value={formatUGX(product.atRetail)}
        note={
          product.potentialProfit === null
            ? undefined
            : `${formatUGX(product.potentialProfit)} profit`
        }
      />
      <Figure
        label="Sold all time"
        value={`${formatNumber(product.unitsSoldAllTime)} ${pluralise(
          product.unitsSoldAllTime,
          'unit',
        )}`}
        note={`of ${formatNumber(product.quantityBought)} bought`}
      />
    </dl>
  );
}

function Figure({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div>
      <dt className="text-[var(--text-faint)]">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
      {note && <dd className="text-[0.75rem] text-[var(--text-faint)]">{note}</dd>}
    </div>
  );
}

function BatchRow({ batch }: { batch: StockBatch }) {
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-medium">
          Bought {formatDate(batch.purchaseDate)}
          {batch.pending && <span className="chip chip-muted ml-2">Not sent yet</span>}
          {batch.archived && <span className="chip chip-muted ml-2">Archived</span>}
        </p>
        <p className="tnum text-[0.8125rem]">
          <span className="font-medium">{formatNumber(batch.qtyRemaining)}</span>
          <span className="text-[var(--text-muted)]">
            {' '}
            of {formatNumber(batch.quantity)} left
          </span>
          {batch.status === 'low' && (
            <span className="chip chip-warn ml-2">{STATUS_LABEL.low}</span>
          )}
          {batch.status === 'out' && (
            <span className="chip chip-muted ml-2">{STATUS_LABEL.out}</span>
          )}
        </p>
      </div>

      <dl className="tnum mt-2 grid grid-cols-3 gap-2 text-[0.8125rem]">
        <div>
          <dt className="text-[var(--text-faint)]">Cost</dt>
          <dd className="mt-0.5">
            {batch.costPrice === null ? '—' : formatUGX(batch.costPrice)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--text-faint)]">Sells at</dt>
          <dd className="mt-0.5">{formatUGX(batch.minPrice)}</dd>
        </div>
        <div>
          <dt className="text-[var(--text-faint)]">Margin</dt>
          <dd
            className="mt-0.5 font-medium"
            style={{
              color:
                batch.marginPerUnit === null
                  ? undefined
                  : batch.marginPerUnit < 0
                    ? 'var(--negative)'
                    : 'var(--positive)',
            }}
          >
            {batch.marginPerUnit === null
              ? '—'
              : `${batch.marginPerUnit < 0 ? '−' : '+'}${formatUGX(
                  Math.abs(batch.marginPerUnit),
                )}`}
          </dd>
        </div>
      </dl>
    </>
  );
}
