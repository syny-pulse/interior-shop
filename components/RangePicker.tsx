'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { todayInKampala } from '@/lib/dates';
import { DatePicker } from '@/components/ui/DatePicker';

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Custom' },
] as const;

/**
 * Range lives in the URL, so the dashboard stays a Server Component and a
 * chosen period survives a refresh or a shared link.
 */
export function RangePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const current = params.get('range') ?? 'today';
  const today = todayInKampala();

  const [from, setFrom] = useState(params.get('from') ?? today);
  const [to, setTo] = useState(params.get('to') ?? today);

  /*
   * These fields only ever get written by `apply` below, so nothing resyncs
   * them when the URL changes some other way — e.g. the browser's Back
   * button landing on a different custom range. Re-read from the URL
   * whenever we land on "custom", so the visible dates never drift from
   * what's actually being queried.
   */
  useEffect(() => {
    if (current === 'custom') {
      setFrom(params.get('from') ?? today);
      setTo(params.get('to') ?? today);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  function apply(range: string, nextFrom = from, nextTo = to) {
    const next = new URLSearchParams();
    next.set('range', range);
    if (range === 'custom') {
      next.set('from', nextFrom);
      next.set('to', nextTo);
    }
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }

  return (
    <div className="space-y-3" data-pending={isPending ? '' : undefined}>
      <div
        role="group"
        aria-label="Date range"
        className="surface flex w-full gap-1 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {PRESETS.map(({ key, label }) => {
          const active = current === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => apply(key)}
              aria-pressed={active}
              className="flex-1 whitespace-nowrap rounded-[var(--radius-chip)] px-3 py-2 text-[0.875rem] font-medium transition-colors"
              style={
                active
                  ? { background: 'var(--primary)', color: 'var(--primary-fg)' }
                  : { color: 'var(--text-muted)' }
              }
            >
              {label}
            </button>
          );
        })}
      </div>

      {current === 'custom' && (
        <div className="surface flex flex-wrap items-end gap-3 p-3">
          <div className="min-w-[9rem] flex-1">
            <label htmlFor="range-from" className="label">
              From
            </label>
            <DatePicker id="range-from" value={from} max={to} onChange={setFrom} />
          </div>
          <div className="min-w-[9rem] flex-1">
            <label htmlFor="range-to" className="label">
              To
            </label>
            <DatePicker id="range-to" value={to} min={from} onChange={setTo} />
          </div>
          <button
            type="button"
            onClick={() => apply('custom', from, to)}
            className="btn btn-primary"
            disabled={isPending}
          >
            {isPending ? 'Loading' : 'Apply'}
          </button>
        </div>
      )}
    </div>
  );
}
