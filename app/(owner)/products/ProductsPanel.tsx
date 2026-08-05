'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { PackageIcon } from '@phosphor-icons/react';
import { useSync } from '@/components/offline/SyncProvider';
import { MirrorGate } from '@/components/offline/MirrorGate';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatCard } from '@/components/ui/StatCard';
import { StockTable } from '@/components/stock/StockTable';
import { StockFilterBar } from '@/components/stock/StockFilterBar';
import type { CategoryOption } from '@/components/forms/ProductForm';
import { stockValue } from '@/lib/offline/aggregates';
import {
  NO_FILTERS,
  categoriesPresent,
  filterStockProducts,
  restockSuggestions,
  sortStockProducts,
  statusCounts,
  stockProducts,
  type StockFilters,
  type StockSort,
  type StockStatusFilter,
} from '@/lib/offline/stock';
import { formatCompactUGX, formatNumber, pluralise } from '@/lib/format';
import { ProductDetailPanel } from './ProductDetailPanel';

/**
 * OWNER VIEW — cost price, margin, and what the shelf is worth.
 *
 * The page is built around three questions a shopkeeper actually arrives with:
 * what is my stock worth, what is running out, and what money is asleep on the
 * shelf. So the headline figures are the navigation — tapping "Running low"
 * filters the table to it — and the shopping list sits above the table rather
 * than being something to work out from it.
 */
export function ProductsPanel() {
  return (
    <MirrorGate>
      <ProductsPanelInner />
    </MirrorGate>
  );
}

function ProductsPanelInner() {
  const { projection } = useSync();
  const params = useSearchParams();

  /*
   * Filters are local state, not URL state.
   *
   * The dashboard's date range lives in the URL because that page is a Server
   * Component and the range has to survive a reload. Nothing here is fetched,
   * so a router round-trip would only add latency to a keystroke — and this
   * page has to keep working with no connection at all.
   *
   * The one exception is arriving from elsewhere: ?flag=low is read once, so a
   * link can point straight at what needs attention.
   */
  const [filters, setFilters] = useState<StockFilters>(() => {
    const flag = params.get('flag');
    const status: StockStatusFilter =
      flag === 'low' || flag === 'out' || flag === 'ok' ? flag : 'all';
    return { ...NO_FILTERS, status };
  });

  const [sort, setSort] = useState<StockSort>('recent');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const products = useMemo(() => stockProducts(projection), [projection]);

  const visible = useMemo(
    () => sortStockProducts(filterStockProducts(products, filters), sort),
    [products, filters, sort],
  );

  const categories = useMemo(() => categoriesPresent(products), [products]);
  const counts = useMemo(() => statusCounts(products), [products]);
  const suggestions = useMemo(() => restockSuggestions(products), [products]);

  // Reused rather than re-summed here, so this page and the dashboard can never
  // disagree about what the stock is worth: stockValue() is the figure the
  // logic check holds against the SQL.
  const value = useMemo(() => stockValue(projection.items), [projection.items]);

  const categoryOptions: CategoryOption[] = useMemo(
    () =>
      projection.categories.map((c) => ({
        id: c.id,
        key: c.key,
        name: c.name,
        clientId: c.clientId,
      })),
    [projection.categories],
  );

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
        icon={PackageIcon}
        title="No stock recorded yet"
        body="After a shopping trip, add what you bought so sales and profit can be tracked against it."
        action={{ href: '/products/new', label: 'Add stock' }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Money tied up"
          value={formatCompactUGX(value.atCost)}
          sublabel={`${formatNumber(value.units)} ${pluralise(value.units, 'item')} on the shelf`}
          emphasis
        />
        <StatCard
          label="If it all sells"
          value={formatCompactUGX(value.atRetail)}
          sublabel={`${formatCompactUGX(value.atRetail - value.atCost)} profit`}
          tone="positive"
        />
        <FilterTile
          label="Running low"
          count={counts.low}
          active={filters.status === 'low'}
          onClick={() =>
            setFilters((f) => ({ ...f, status: f.status === 'low' ? 'all' : 'low' }))
          }
        />
        <FilterTile
          label="Sold out"
          count={counts.out}
          active={filters.status === 'out'}
          onClick={() =>
            setFilters((f) => ({ ...f, status: f.status === 'out' ? 'all' : 'out' }))
          }
        />
      </div>

      {suggestions.length > 0 && (
        <section
          className="rounded-[var(--radius-card)] border px-4 py-3.5"
          style={{ background: 'var(--warn-soft)', borderColor: 'var(--warn-border)' }}
        >
          <h2
            className="text-[0.8125rem] font-semibold"
            style={{ color: 'var(--warn)' }}
          >
            Worth a shopping trip
          </h2>
          <p className="mt-0.5 text-[0.8125rem]" style={{ color: 'var(--warn)' }}>
            Running out fastest, by how quickly each one actually sells.
          </p>

          <ul className="mt-2.5 space-y-1.5">
            {suggestions.map(({ product, daysOfCover }) => (
              <li
                key={product.key}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[0.875rem]"
              >
                <button
                  type="button"
                  onClick={() => {
                    setExpanded((current) => new Set(current).add(product.key));
                    // Clear a filter that would hide the row we just opened.
                    setFilters((f) => ({ ...f, status: 'all', search: '' }));
                  }}
                  className="min-w-0 text-left font-medium underline decoration-dotted underline-offset-2"
                  style={{ color: 'var(--warn)' }}
                >
                  {product.specifics}
                </button>
                <span className="tnum text-[0.8125rem]" style={{ color: 'var(--warn)' }}>
                  {product.qtyRemaining === 0
                    ? 'sold out'
                    : `${formatNumber(product.qtyRemaining)} left`}
                  {daysOfCover !== null && product.qtyRemaining > 0 && (
                    <> · about {daysOfCover} {pluralise(daysOfCover, 'day')} left</>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <StockFilterBar
        filters={filters}
        onChange={setFilters}
        sort={sort}
        onSort={setSort}
        categories={categories}
        variant="owner"
        shown={visible.length}
        total={products.length}
      />

      {visible.length === 0 ? (
        <div className="surface px-4 py-8 text-center">
          <p className="font-medium">Nothing matches those filters</p>
          <p className="mx-auto mt-1 max-w-[38ch] text-[0.875rem] text-[var(--text-muted)]">
            Try a different category or clear the filters to see everything again.
          </p>
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
          variant="owner"
          expanded={expanded}
          onToggle={toggle}
          sort={sort}
          onSort={setSort}
          renderDetail={(product) => (
            <ProductDetailPanel product={product} categories={categoryOptions} />
          )}
        />
      )}

      <Link href="/products/new" className="btn btn-secondary w-full">
        Add something new
      </Link>
    </div>
  );
}

/** A headline figure that is also the filter for it. */
function FilterTile({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const muted = count === 0;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={muted}
      className="surface px-4 py-3.5 text-left transition-colors disabled:cursor-default"
      style={
        active
          ? { borderColor: 'var(--warn)', background: 'var(--warn-soft)' }
          : undefined
      }
    >
      <p className="text-[0.8125rem] font-medium text-[var(--text-muted)]">{label}</p>
      <p
        className="tnum mt-1 text-[1.35rem] font-semibold tracking-tight"
        style={{ color: muted ? 'var(--text-faint)' : 'var(--warn)' }}
      >
        {formatNumber(count)}
      </p>
      <p className="mt-0.5 text-[0.75rem] text-[var(--text-faint)]">
        {muted ? 'nothing to do' : active ? 'showing these' : 'tap to see them'}
      </p>
    </button>
  );
}
