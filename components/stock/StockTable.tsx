'use client';

import { type ReactNode } from 'react';
import { CaretRightIcon } from '@phosphor-icons/react';
import { formatNumber } from '@/lib/format';
import { describeLastSold, type StockProduct, type StockSort } from '@/lib/offline/stock';
import { SellThroughBar, StockStatusChip } from './StockStatusChip';

/**
 * ONE table, both roles.
 *
 * The owner's columns and the attendant's are the same component because the
 * two screens must never disagree about what is on the shelf. What differs is
 * which columns exist at all: the attendant variant has no cost, no margin and
 * no stock value, and those cells are absent from its column list rather than
 * blanked out — a cell that renders `null` is one refactor away from rendering
 * a figure.
 *
 * PHONE FIRST. A shop phone is 360px wide and the page body cannot scroll
 * sideways (globals.css). So instead of a seven-column table dragged left and
 * right, the narrow layout drops columns and the EXPANDED ROW becomes the
 * detail view — every figure hidden at that width appears there. Nothing is
 * only reachable by scrolling.
 */

interface Column {
  key: string;
  label: string;
  /** Applied to the header and every cell, so they cannot drift apart. */
  className: string;
  /** Set to make the header sortable. Each column has one useful order. */
  sort?: StockSort;
  direction?: 'ascending' | 'descending';
  render: (product: StockProduct) => ReactNode;
}

function signedNumber(amount: number): string {
  return `${amount < 0 ? '−' : '+'}${formatNumber(Math.abs(amount))}`;
}

/** The figure column that is always visible: what is left of this stocking. */
const leftColumn: Column = {
  key: 'left',
  label: 'Left',
  className: 'w-[6.5rem] text-right',
  sort: 'leastLeft',
  direction: 'ascending',
  render: (product) => (
    <>
      <span className="tnum whitespace-nowrap font-medium">
        {formatNumber(product.qtyRemaining)}
        <span className="text-[var(--text-faint)]"> / {formatNumber(product.liveBaseline)}</span>
      </span>
      <SellThroughBar
        remaining={product.qtyRemaining}
        baseline={product.liveBaseline}
        status={product.status}
      />
    </>
  ),
};

const priceColumn: Column = {
  key: 'price',
  label: 'Sells at (USh)',
  className: 'hidden text-right sm:table-cell',
  sort: 'price',
  direction: 'descending',
  render: (product) => (
    <span className="tnum whitespace-nowrap">{formatNumber(product.minPrice)}</span>
  ),
};

const OWNER_COLUMNS: Column[] = [
  leftColumn,
  priceColumn,
  {
    key: 'cost',
    label: 'Cost (USh)',
    className: 'hidden text-right md:table-cell',
    render: (product) => (
      <span className="tnum whitespace-nowrap text-[var(--text-muted)]">
        {product.costPrice === null ? '—' : formatNumber(product.costPrice)}
        {/* The batches on the shelf were not all bought at this price. The
            expanded row is where the real answer is, so this only has to be
            enough to stop the single figure being read as the whole truth. */}
        {product.costVaries && <span aria-hidden="true"> *</span>}
      </span>
    ),
  },
  {
    key: 'margin',
    label: 'Margin (USh)',
    className: 'hidden text-right md:table-cell',
    sort: 'margin',
    direction: 'descending',
    render: (product) =>
      product.marginPerUnit === null ? (
        <span className="text-[var(--text-faint)]">—</span>
      ) : (
        <span
          className="tnum whitespace-nowrap font-medium"
          style={{
            color: product.marginPerUnit < 0 ? 'var(--negative)' : 'var(--positive)',
          }}
        >
          {signedNumber(product.marginPerUnit)}
        </span>
      ),
  },
  {
    key: 'tiedUp',
    label: 'Tied up (USh)',
    className: 'hidden text-right lg:table-cell',
    sort: 'tiedUp',
    direction: 'descending',
    render: (product) => (
      <span className="tnum whitespace-nowrap">
        {product.atCost === null ? '—' : formatNumber(product.atCost)}
      </span>
    ),
  },
  {
    key: 'lastSold',
    label: 'Last sold',
    className: 'hidden whitespace-nowrap text-right lg:table-cell',
    sort: 'longestUnsold',
    direction: 'ascending',
    render: (product) => (
      <span
        className="text-[0.8125rem]"
        style={{
          color: product.lastSoldDate ? 'var(--text-muted)' : 'var(--text-faint)',
        }}
      >
        {describeLastSold(product.lastSoldDate)}
      </span>
    ),
  },
];

const ATTENDANT_COLUMNS: Column[] = [leftColumn, priceColumn];

export function StockTable({
  products,
  variant,
  expanded,
  onToggle,
  sort,
  onSort,
  renderDetail,
}: {
  products: StockProduct[];
  variant: 'owner' | 'attendant';
  expanded: Set<string>;
  onToggle: (key: string) => void;
  sort: StockSort;
  onSort: (sort: StockSort) => void;
  renderDetail: (product: StockProduct) => ReactNode;
}) {
  const columns = variant === 'owner' ? OWNER_COLUMNS : ATTENDANT_COLUMNS;
  const columnCount = columns.length + 1;

  return (
    <div className="surface overflow-hidden">
      {/* A safety net for a very long description at a middle width; at 360px
          the columns have already been dropped so nothing overflows. */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[0.875rem]">
          <caption className="sr-only">
            Stock by product. Each row expands to show the purchase batches behind it.
          </caption>

          <thead>
            <tr className="text-[0.6875rem] uppercase tracking-wide text-[var(--text-faint)]">
              <SortableHeader
                label="Item"
                sort="name"
                direction="ascending"
                current={sort}
                onSort={onSort}
                className="pl-4"
              />
              {columns.map((column) =>
                column.sort ? (
                  <SortableHeader
                    key={column.key}
                    label={column.label}
                    sort={column.sort}
                    direction={column.direction ?? 'ascending'}
                    current={sort}
                    onSort={onSort}
                    className={column.className}
                  />
                ) : (
                  <th
                    key={column.key}
                    scope="col"
                    className={`px-3 py-2 font-medium ${column.className}`}
                  >
                    {column.label}
                  </th>
                ),
              )}
            </tr>
          </thead>

          {products.map((product) => {
            const open = expanded.has(product.key);

            /*
             * One tbody per product. It is what associates a summary row with
             * its detail row in the document structure rather than only
             * visually, and it is valid HTML — a table may have many.
             */
            return (
              <tbody key={product.key}>
                <tr
                  className="border-t align-top"
                  style={open ? { background: 'var(--surface-2)' } : undefined}
                >
                  <th scope="row" className="py-2.5 pl-4 pr-3 font-normal">
                    {/*
                      The toggle is a button spanning the description, not a
                      click handler on the whole row: a clickable row that also
                      contains buttons is ambiguous to a mouse and impossible
                      to a keyboard.
                    */}
                    <button
                      type="button"
                      onClick={() => onToggle(product.key)}
                      aria-expanded={open}
                      aria-controls={`stock-detail-${product.key}`}
                      className="flex w-full items-start gap-1.5 text-left"
                    >
                      <CaretRightIcon
                        size={14}
                        weight="bold"
                        aria-hidden="true"
                        className={`mt-1 shrink-0 text-[var(--text-faint)] transition-transform ${
                          open ? 'rotate-90' : ''
                        }`}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium leading-snug">
                          {product.specifics}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1">
                          <span className="chip chip-muted">{product.categoryName}</span>
                          <StockStatusChip status={product.status} />
                          {product.pending && <span className="chip chip-muted">Not sent yet</span>}
                          {product.archived && <span className="chip chip-muted">Archived</span>}
                          {variant === 'owner' && product.belowMinCount > 0 && (
                            <span className="chip chip-warn">
                              Sold under price ×{product.belowMinCount}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </th>

                  {/*
                    Every cell keeps the same 12px gutter. A `last:pr-4` would
                    land on the last cell in the DOM, which at 360px is one of
                    the hidden ones — leaving the visible right edge unpadded.
                  */}
                  {columns.map((column) => (
                    <td key={column.key} className={`px-3 py-2.5 ${column.className}`}>
                      {column.render(product)}
                    </td>
                  ))}
                </tr>

                {open && (
                  <tr id={`stock-detail-${product.key}`}>
                    <td colSpan={columnCount} className="p-0">
                      <div
                        className="border-t px-4 py-4"
                        style={{ background: 'var(--surface-2)' }}
                      >
                        {renderDetail(product)}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}

/**
 * Each sortable column has exactly one order worth having — nobody asks for
 * "most left first" — so a header applies its sort, and tapping the active one
 * returns to the default. That is one tap for every question the table can
 * answer, instead of two and a guess about which way it went.
 */
function SortableHeader({
  label,
  sort,
  direction,
  current,
  onSort,
  className,
}: {
  label: string;
  sort: StockSort;
  direction: 'ascending' | 'descending';
  current: StockSort;
  onSort: (sort: StockSort) => void;
  className: string;
}) {
  const active = current === sort;

  return (
    <th
      scope="col"
      aria-sort={active ? direction : 'none'}
      className={`px-3 py-2 font-medium ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(active ? 'recent' : sort)}
        className="transition-colors hover:text-[var(--text)]"
        style={active ? { color: 'var(--accent-text)' } : undefined}
      >
        {label}
      </button>
    </th>
  );
}
