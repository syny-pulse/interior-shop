'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { StorefrontIcon } from '@phosphor-icons/react';
import { useSync } from '@/components/offline/SyncProvider';
import { MirrorGate } from '@/components/offline/MirrorGate';
import { EmptyState } from '@/components/ui/EmptyState';
import { StockTable } from '@/components/stock/StockTable';
import { StockFilterBar } from '@/components/stock/StockFilterBar';
import { stockUnits } from '@/lib/offline/mirror';
import {
  NO_FILTERS,
  categoriesPresent,
  filterStockProducts,
  sortStockProducts,
  statusCounts,
  stockProducts,
  type StockFilters,
  type StockSort,
} from '@/lib/offline/stock';
import { formatNumber, formatUGX, pluralise } from '@/lib/format';
import { formatDate } from '@/lib/dates';

/**
 * ATTENDANT VIEW.
 *
 * Rendered entirely from the device's own copy, which for an attendant is
 * populated by the attendant branch of getDelta() — no cost price ever reaches
 * it. That matters more here than it did in the RSC payload: IndexedDB
 * survives the tab closing, so anything that lands in it stays on the phone.
 *
 * The counts are projected, so a sale recorded seconds ago on a dead
 * connection has already come off the shelf here.
 *
 * Same table as the owner's, with the cost, margin and stock-value columns
 * absent rather than blanked — see StockTable. What an attendant gains over the
 * old plain list is the ability to FIND something ("do we have the grey fleece?"
 * while a customer waits) and to see what is nearly gone, which is the thing
 * they are best placed to notice and the owner is not.
 */
export function StockList() {
  return (
    <MirrorGate>
      <StockListInner />
    </MirrorGate>
  );
}

function StockListInner() {
  const { projection } = useSync();

  const [filters, setFilters] = useState<StockFilters>(NO_FILTERS);
  const [sort, setSort] = useState<StockSort>('name');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // sellableOnly applies the same rule as sellableItems(), which mirrors
  // getSellableItems(): nothing archived, nothing empty, no dead categories. The
  // sale form and this list must never disagree about what can be sold.
  const products = useMemo(
    () => stockProducts(projection, { sellableOnly: true }),
    [projection],
  );

  const visible = useMemo(
    () => sortStockProducts(filterStockProducts(products, filters), sort),
    [products, filters, sort],
  );

  const categories = useMemo(() => categoriesPresent(products), [products]);
  const counts = useMemo(() => statusCounts(products), [products]);
  const stock = stockUnits(projection);

  function toggle(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (products.length === 0) {
    return (
      <EmptyState
        icon={StorefrontIcon}
        title="Nothing in stock right now"
        body="The owner has not added any stock, or everything has sold."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="surface flex items-baseline justify-between gap-4 px-4 py-3.5">
        <span className="text-[0.8125rem] font-medium text-[var(--text-muted)]">
          Items on hand
        </span>
        <span className="tnum text-[1.35rem] font-semibold tracking-tight">
          {formatNumber(stock.units)}
        </span>
      </div>

      {counts.low > 0 && (
        <div
          className="rounded-[var(--radius-card)] border px-4 py-3"
          style={{ background: 'var(--warn-soft)', borderColor: 'var(--warn-border)' }}
        >
          <p className="text-[0.875rem] font-medium" style={{ color: 'var(--warn)' }}>
            {formatNumber(counts.low)} {pluralise(counts.low, 'item is', 'items are')} running
            low
          </p>
          <p className="mt-0.5 text-[0.8125rem]" style={{ color: 'var(--warn)' }}>
            Worth telling the owner before it sells out.
          </p>
        </div>
      )}

      <StockFilterBar
        filters={filters}
        onChange={setFilters}
        sort={sort}
        onSort={setSort}
        categories={categories}
        variant="attendant"
        shown={visible.length}
        total={products.length}
      />

      {visible.length === 0 ? (
        <div className="surface px-4 py-8 text-center">
          <p className="font-medium">Nothing matches that search</p>
          <button
            type="button"
            onClick={() => setFilters(NO_FILTERS)}
            className="btn btn-secondary mt-3"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <StockTable
          products={visible}
          variant="attendant"
          expanded={expanded}
          onToggle={toggle}
          sort={sort}
          onSort={setSort}
          renderDetail={(product) => (
            <div className="space-y-2">
              <p className="text-[0.8125rem] text-[var(--text-muted)]">
                {formatNumber(product.qtyRemaining)} left of{' '}
                {formatNumber(product.liveBaseline)}. The price shown is the lowest you
                should sell for.
              </p>
              <ul className="space-y-1 text-[0.875rem]">
                {product.batches
                  .filter((batch) => batch.qtyRemaining > 0)
                  .map((batch) => (
                    <li
                      key={batch.key}
                      className="tnum flex flex-wrap items-baseline justify-between gap-x-3"
                    >
                      <span className="text-[var(--text-muted)]">
                        In since {formatDate(batch.purchaseDate)}
                      </span>
                      <span>
                        {formatNumber(batch.qtyRemaining)}{' '}
                        {pluralise(batch.qtyRemaining, 'left', 'left')} · from{' '}
                        {formatUGX(batch.minPrice)}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        />
      )}

      <Link href="/shop/sale" className="btn btn-primary w-full">
        Record a sale
      </Link>
    </div>
  );
}
