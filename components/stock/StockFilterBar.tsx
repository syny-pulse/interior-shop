'use client';

import { useId } from 'react';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { AmountInput } from '@/components/ui/AmountInput';
import {
  NO_FILTERS,
  OWNER_ONLY_SORTS,
  SORT_LABEL,
  hasActiveFilters,
  type StockFilters,
  type StockSort,
  type StockStatusFilter,
} from '@/lib/offline/stock';

/**
 * Every way of asking the stock table a question.
 *
 * The search box is deliberately NOT debounced. The whole list is already on
 * the device and a shop has tens of products, not tens of thousands, so
 * filtering costs less than a frame — and a debounce would trade nothing for a
 * keyboard that feels broken.
 */

const STATUSES: Array<{ key: StockStatusFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'ok', label: 'In stock' },
  { key: 'low', label: 'Running low' },
  { key: 'out', label: 'Sold out' },
];

export function StockFilterBar({
  filters,
  onChange,
  sort,
  onSort,
  categories,
  variant,
  shown,
  total,
}: {
  filters: StockFilters;
  onChange: (next: StockFilters) => void;
  sort: StockSort;
  onSort: (sort: StockSort) => void;
  categories: Array<{ id: number; name: string }>;
  variant: 'owner' | 'attendant';
  shown: number;
  total: number;
}) {
  const id = useId();
  const owner = variant === 'owner';
  const active = hasActiveFilters(filters);

  const set = (patch: Partial<StockFilters>) => onChange({ ...filters, ...patch });

  const sorts = (Object.keys(SORT_LABEL) as StockSort[]).filter(
    (key) => owner || !OWNER_ONLY_SORTS.includes(key),
  );

  const statuses = owner ? STATUSES : STATUSES.filter((s) => s.key !== 'out');

  return (
    <div className="surface space-y-3 p-3">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[11rem] flex-1">
          <label htmlFor={`${id}-search`} className="sr-only">
            Search stock
          </label>
          <MagnifyingGlassIcon
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
          />
          <input
            id={`${id}-search`}
            type="search"
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder="Search by name or category"
            className="control pl-9"
          />
        </div>

        <div className="min-w-[9rem] flex-1">
          <label htmlFor={`${id}-category`} className="sr-only">
            Filter by category
          </label>
          <select
            id={`${id}-category`}
            value={filters.categoryId ?? ''}
            onChange={(e) =>
              set({ categoryId: e.target.value === '' ? null : Number(e.target.value) })
            }
            className="control"
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        role="group"
        aria-label="Filter by stock level"
        className="flex w-full gap-1 overflow-x-auto rounded-[var(--radius-control)] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ background: 'var(--surface-2)' }}
      >
        {statuses.map(({ key, label }) => {
          const on = filters.status === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => set({ status: key })}
              aria-pressed={on}
              className="flex-1 whitespace-nowrap rounded-[var(--radius-chip)] px-3 py-2 text-[0.875rem] font-medium transition-colors"
              style={
                on
                  ? { background: 'var(--primary)', color: 'var(--primary-fg)' }
                  : { color: 'var(--text-muted)' }
              }
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[7rem] flex-1">
          <label htmlFor={`${id}-from`} className="label">
            Price from
          </label>
          <AmountInput
            id={`${id}-from`}
            name={`${id}-from-value`}
            value={filters.priceFrom === null ? '' : String(filters.priceFrom)}
            onValueChange={(digits) =>
              set({ priceFrom: digits === '' ? null : Number(digits) })
            }
            className="control tnum"
          />
        </div>

        <div className="min-w-[7rem] flex-1">
          <label htmlFor={`${id}-to`} className="label">
            Price to
          </label>
          <AmountInput
            id={`${id}-to`}
            name={`${id}-to-value`}
            value={filters.priceTo === null ? '' : String(filters.priceTo)}
            onValueChange={(digits) => set({ priceTo: digits === '' ? null : Number(digits) })}
            className="control tnum"
          />
        </div>

        <div className="min-w-[10rem] flex-1">
          <label htmlFor={`${id}-sort`} className="label">
            Sort by
          </label>
          <select
            id={`${id}-sort`}
            value={sort}
            onChange={(e) => onSort(e.target.value as StockSort)}
            className="control"
          >
            {sorts.map((key) => (
              <option key={key} value={key}>
                {SORT_LABEL[key]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t pt-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {owner && (
            <label className="flex items-center gap-2 text-[0.875rem] text-[var(--text-muted)]">
              <input
                type="checkbox"
                checked={filters.includeArchived}
                onChange={(e) => set({ includeArchived: e.target.checked })}
                className="size-4 accent-[var(--primary)]"
              />
              Show archived
            </label>
          )}

          <p aria-live="polite" className="text-[0.8125rem] text-[var(--text-muted)]">
            {shown === total
              ? `${total} ${total === 1 ? 'product' : 'products'}`
              : `Showing ${shown} of ${total}`}
          </p>
        </div>

        {active && (
          <button
            type="button"
            onClick={() => onChange(NO_FILTERS)}
            className="btn btn-ghost py-1.5 text-[0.875rem]"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
