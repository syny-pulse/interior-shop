'use client';

import { useSync } from '@/components/offline/SyncProvider';
import { MirrorGate } from '@/components/offline/MirrorGate';
import { salesInRange } from '@/lib/offline/mirror';
import { attendantSummary } from '@/lib/offline/aggregates';
import { useRange } from '@/lib/offline/use-range';
import { formatUGX, formatNumber, pluralise } from '@/lib/format';
import { formatDateShort } from '@/lib/dates';
import { RangePicker } from '@/components/RangePicker';
import { StatCard } from '@/components/ui/StatCard';

/**
 * ATTENDANT VIEW.
 *
 * attendantSummary() computes revenue and volume only — no unit cost reaches
 * this device to compute a margin from, so there is no profit figure here to
 * hide. Stock is a unit count with no valuation attached, exactly as the
 * ATTENDANT-SAFE queries in lib/queries.ts always returned it.
 */
export function SummaryPanel({ attendantName }: { attendantName: string }) {
  return (
    <MirrorGate>
      <SummaryPanelInner attendantName={attendantName} />
    </MirrorGate>
  );
}

function SummaryPanelInner({ attendantName }: { attendantName: string }) {
  const { projection } = useSync();
  const range = useRange();

  const sales = salesInRange(projection, range.from, range.to);
  const summary = attendantSummary(sales, projection.items);

  return (
    <div className="space-y-6">
      <p className="text-[0.9375rem] text-[var(--text-muted)]">{range.label}</p>

      <RangePicker />

      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Sales"
          value={formatUGX(summary.revenue)}
          sublabel={`${formatNumber(summary.transactions)} ${pluralise(summary.transactions, 'sale')}`}
        />
        <StatCard
          label="Items sold"
          value={formatNumber(summary.unitsSold)}
          sublabel="In this period"
        />
        <StatCard
          label="Items on hand"
          value={formatNumber(summary.stockUnits)}
          sublabel="As of today"
        />
      </section>

      <section>
        <h2 className="mb-3 text-[0.9375rem] font-semibold">Sales recorded</h2>
        {sales.length === 0 ? (
          <p className="surface px-4 py-8 text-center text-[0.875rem] text-[var(--text-muted)]">
            No sales recorded for {range.label.toLowerCase()}.
          </p>
        ) : (
          <ul className="surface divide-y overflow-hidden">
            {sales.map((sale) => {
              const item = projection.items.find((i) => i.id === sale.itemId);
              /*
               * A sale still in the outbox has not been stamped with an
               * attendant id yet — the server does that from the session. The
               * person looking at it is the one who recorded it, so "you" is
               * both true and what they would call themselves.
               */
              const recordedBy = sale.pending
                ? attendantName
                : (projection.attendantName(sale.attendantId) ?? 'owner');

              return (
                <li
                  key={sale.key}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
                >
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
                      {projection.categoryName(item?.categoryId ?? null)} · {recordedBy}
                      {recordedBy === attendantName && ' (you)'}
                    </p>
                  </div>
                  <p className="tnum font-medium">
                    {formatUGX(sale.unitPrice * sale.quantity)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
