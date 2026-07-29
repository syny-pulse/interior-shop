'use client';

import { useSync } from '@/components/offline/SyncProvider';
import { MirrorGate } from '@/components/offline/MirrorGate';
import { salesInRange, sellableItems } from '@/lib/offline/mirror';
import { useRange } from '@/lib/offline/use-range';
import { formatUGX, formatNumber, pluralise } from '@/lib/format';
import { formatDateShort } from '@/lib/dates';
import { RangePicker } from '@/components/RangePicker';
import { SaleForm } from '@/components/forms/SaleForm';
import { DeleteSale } from './DeleteSale';

/**
 * OWNER VIEW — unit cost and per-line profit.
 *
 * The unitCost on each sale is the SNAPSHOT taken when it was recorded, never
 * the item's cost today. Correcting a typo in a batch's cost price must not
 * rewrite last month's profit, which is why the sale carries its own copy.
 */
export function SalesPanel() {
  return (
    <MirrorGate>
      <SalesPanelInner />
    </MirrorGate>
  );
}

function SalesPanelInner() {
  const { projection } = useSync();
  const range = useRange();

  const sales = salesInRange(projection, range.from, range.to);
  const revenue = sales.reduce((sum, s) => sum + s.unitPrice * s.quantity, 0);
  const profit = sales.reduce(
    (sum, s) => sum + (s.unitPrice - (s.unitCost ?? 0)) * s.quantity,
    0,
  );

  return (
    <div className="space-y-6">
      <div className="surface p-5">
        <h2 className="mb-4 text-[0.9375rem] font-semibold">Record a sale</h2>
        <SaleForm items={sellableItems(projection)} />
      </div>

      <div className="space-y-3">
        <h2 className="text-[0.9375rem] font-semibold">Sales history</h2>
        <RangePicker />
      </div>

      {sales.length === 0 ? (
        <p className="surface px-4 py-8 text-center text-[0.875rem] text-[var(--text-muted)]">
          No sales recorded for {range.label.toLowerCase()}.
        </p>
      ) : (
        <>
          <div className="surface flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-4 py-3.5">
            <div>
              <p className="text-[0.8125rem] text-[var(--text-muted)]">
                {formatNumber(sales.length)} {pluralise(sales.length, 'sale')}
              </p>
              <p className="tnum text-[1.25rem] font-semibold tracking-tight">
                {formatUGX(revenue)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[0.8125rem] text-[var(--text-muted)]">Profit on goods</p>
              <p
                className="tnum text-[1.25rem] font-semibold tracking-tight"
                style={{ color: profit < 0 ? 'var(--negative)' : 'var(--positive)' }}
              >
                {profit < 0 ? '−' : '+'}
                {formatUGX(Math.abs(profit))}
              </p>
            </div>
          </div>

          <ul className="surface divide-y overflow-hidden">
            {sales.map((sale) => {
              const item = projection.items.find((i) => i.id === sale.itemId);
              const lineProfit = (sale.unitPrice - (sale.unitCost ?? 0)) * sale.quantity;

              return (
                <li key={sale.key} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium leading-snug">
                        <span>
                          {sale.quantity > 1 && `${sale.quantity} × `}
                          {item?.specifics ?? 'Unknown item'}
                        </span>
                        {sale.pending && <span className="chip chip-muted">Not sent yet</span>}
                      </p>
                      <p className="text-[0.8125rem] text-[var(--text-muted)]">
                        {formatDateShort(sale.saleDate)} ·{' '}
                        {projection.categoryName(item?.categoryId ?? null)} ·{' '}
                        {projection.attendantName(sale.attendantId) ?? 'you'}
                      </p>
                      {sale.belowMin && (
                        <span className="chip chip-warn mt-1.5">
                          Below minimum of {formatUGX(item?.minPrice ?? 0)}
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="tnum font-medium">
                        {formatUGX(sale.unitPrice * sale.quantity)}
                      </p>
                      {/*
                        A sale still in the outbox has no unit cost yet: the
                        server snapshots it when it applies the decrement.
                        Showing a profit of the full price would be a lie the
                        owner might act on, so it waits.
                      */}
                      {sale.pending ? (
                        <p className="text-[0.8125rem] text-[var(--text-faint)]">
                          Profit once sent
                        </p>
                      ) : (
                        <p
                          className="tnum text-[0.8125rem]"
                          style={{
                            color: lineProfit < 0 ? 'var(--negative)' : 'var(--positive)',
                          }}
                        >
                          {lineProfit < 0 ? '−' : '+'}
                          {formatUGX(Math.abs(lineProfit))}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-2">
                    <DeleteSale id={sale.id} clientId={sale.clientId} />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
