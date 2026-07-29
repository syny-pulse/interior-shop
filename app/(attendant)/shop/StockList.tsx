'use client';

import Link from 'next/link';
import { StorefrontIcon } from '@phosphor-icons/react';
import { useSync } from '@/components/offline/SyncProvider';
import { MirrorGate } from '@/components/offline/MirrorGate';
import { sellableItems, stockUnits } from '@/lib/offline/mirror';
import { formatUGX, formatNumber, pluralise } from '@/lib/format';

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

  const items = sellableItems(projection);
  const stock = stockUnits(projection);

  const byCategory = new Map<string, typeof items>();
  for (const item of items) {
    const list = byCategory.get(item.categoryName) ?? [];
    list.push(item);
    byCategory.set(item.categoryName, list);
  }

  return (
    <div className="space-y-6">
      <div className="surface flex items-baseline justify-between gap-4 px-4 py-3.5">
        <span className="text-[0.8125rem] font-medium text-[var(--text-muted)]">
          Items on hand
        </span>
        <span className="tnum text-[1.35rem] font-semibold tracking-tight">
          {formatNumber(stock.units)}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="surface flex flex-col items-center gap-3 px-6 py-12 text-center">
          <div
            className="flex size-11 items-center justify-center rounded-full"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}
          >
            <StorefrontIcon size={20} weight="duotone" />
          </div>
          <p className="font-medium">Nothing in stock right now</p>
          <p className="max-w-[38ch] text-[0.875rem] text-[var(--text-muted)]">
            The owner has not added any stock, or everything has sold.
          </p>
        </div>
      ) : (
        <>
          {[...byCategory.entries()].map(([category, list]) => (
            <section key={category}>
              <h2 className="mb-2 text-[0.9375rem] font-semibold">{category}</h2>
              <ul className="surface divide-y overflow-hidden">
                {list.map((item) => (
                  <li
                    key={item.key}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium leading-snug">{item.specifics}</p>
                      <p className="text-[0.8125rem] text-[var(--text-muted)]">
                        {formatNumber(item.qtyRemaining)}{' '}
                        {pluralise(item.qtyRemaining, 'left', 'left')}
                      </p>
                    </div>
                    <span className="chip chip-accent">
                      From {formatUGX(item.minPrice)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <Link href="/shop/sale" className="btn btn-primary w-full">
            Record a sale
          </Link>
        </>
      )}
    </div>
  );
}
