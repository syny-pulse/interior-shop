'use client';

import Link from 'next/link';
import { PackageIcon } from '@phosphor-icons/react';
import { useSync } from '@/components/offline/SyncProvider';
import { MirrorGate } from '@/components/offline/MirrorGate';
import type { LocalItem } from '@/lib/offline/mirror';
import { formatUGX, formatNumber, pluralise } from '@/lib/format';
import { formatDate } from '@/lib/dates';
import { EmptyState } from '@/components/ui/EmptyState';
import { ArchiveToggle } from './ArchiveToggle';

/** OWNER VIEW — cost price and margin. */
export function ProductsPanel() {
  return (
    <MirrorGate>
      <ProductsPanelInner />
    </MirrorGate>
  );
}

function ProductsPanelInner() {
  const { projection } = useSync();

  const items = [...projection.items].sort(
    (a, b) => b.purchaseDate.localeCompare(a.purchaseDate) || (b.id ?? 0) - (a.id ?? 0),
  );

  const active = items.filter((i) => !i.archived);
  const archived = items.filter((i) => i.archived);

  if (items.length === 0) {
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
    <div className="space-y-6">
      <ProductList items={active} categoryName={projection.categoryName} />

      {archived.length > 0 && (
        <details className="surface px-4 py-3">
          <summary className="cursor-pointer text-[0.875rem] font-medium text-[var(--text-muted)]">
            {archived.length} archived {pluralise(archived.length, 'batch', 'batches')}
          </summary>
          <div className="mt-3">
            <ProductList items={archived} categoryName={projection.categoryName} />
          </div>
        </details>
      )}
    </div>
  );
}

function ProductList({
  items,
  categoryName,
}: {
  items: LocalItem[];
  categoryName: (id: number | null) => string;
}) {
  if (items.length === 0) {
    return (
      <p className="surface px-4 py-6 text-center text-[0.875rem] text-[var(--text-muted)]">
        Nothing in stock. Everything you have bought has sold or been archived.
      </p>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => {
        const soldOut = item.qtyRemaining === 0;
        const cost = item.costPrice ?? 0;
        const marginPerUnit = item.minPrice - cost;

        return (
          <li key={item.key} className="surface flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="chip chip-muted">{categoryName(item.categoryId)}</span>
                <p className="mt-1.5 flex items-center gap-2 font-medium leading-snug">
                  {item.specifics}
                  {item.pending && <span className="chip chip-muted">Not sent yet</span>}
                </p>
                <p className="mt-0.5 text-[0.75rem] text-[var(--text-faint)]">
                  Bought {formatDate(item.purchaseDate)}
                </p>
              </div>
              <span className={soldOut ? 'chip chip-muted' : 'chip chip-accent'}>
                {soldOut
                  ? 'Sold out'
                  : `${formatNumber(item.qtyRemaining)} of ${formatNumber(item.quantity)} left`}
              </span>
            </div>

            <dl className="tnum grid grid-cols-3 gap-2 border-t pt-3 text-[0.8125rem]">
              <div>
                <dt className="text-[var(--text-faint)]">Cost</dt>
                <dd className="mt-0.5 font-medium">{formatUGX(cost)}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-faint)]">Sells at</dt>
                <dd className="mt-0.5 font-medium">{formatUGX(item.minPrice)}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-faint)]">Margin</dt>
                <dd
                  className="mt-0.5 font-medium"
                  style={{
                    color: marginPerUnit < 0 ? 'var(--negative)' : 'var(--positive)',
                  }}
                >
                  {marginPerUnit < 0 ? '−' : '+'}
                  {formatUGX(Math.abs(marginPerUnit))}
                </dd>
              </div>
            </dl>

            <div className="flex gap-2">
              {/*
                A batch that has not reached the server has no id to route to.
                It can still be archived, because that op references it by
                clientId — but there is no page to edit it on until it lands.
              */}
              {item.id !== null ? (
                <Link
                  href={`/products/${item.id}`}
                  className="btn btn-secondary flex-1 py-1.5 text-[0.875rem]"
                >
                  Edit
                </Link>
              ) : (
                <span className="flex-1 self-center text-[0.8125rem] text-[var(--text-faint)]">
                  Editable once sent
                </span>
              )}
              <ArchiveToggle
                id={item.id}
                clientId={item.clientId}
                archived={item.archived}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
