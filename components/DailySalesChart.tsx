import { eachDay, formatDateShort } from '@/lib/dates';
import { formatUGX, formatCompactUGX } from '@/lib/format';

interface Point {
  day: string;
  revenue: number;
  profit: number;
}

/**
 * One series (daily revenue), so there is no legend: the heading names it.
 * Profit is not plotted as a second series because it would either need a
 * second axis or a second pink, and it is already carried by the stat tiles.
 * It rides along in each bar's tooltip instead.
 *
 * Bars are anchored to the baseline with rounded tops only, separated by a
 * surface-coloured gap. Built from plain elements so this stays a Server
 * Component with no chart library in the phone's bundle.
 */
export function DailySalesChart({
  points,
  from,
  to,
}: {
  points: Point[];
  from: string;
  to: string;
}) {
  const byDay = new Map(points.map((p) => [p.day, p]));
  // Pad the gaps so a quiet day reads as a real zero, not a missing bar.
  const days = eachDay(from, to).map((day) => ({
    day,
    revenue: byDay.get(day)?.revenue ?? 0,
    profit: byDay.get(day)?.profit ?? 0,
  }));

  const peak = Math.max(...days.map((d) => d.revenue), 0);

  if (peak === 0) {
    return (
      <section className="surface p-5">
        <h2 className="text-[0.9375rem] font-semibold">Daily sales</h2>
        <p className="mt-3 text-[0.875rem] text-[var(--text-muted)]">
          No sales recorded in this period yet.
        </p>
      </section>
    );
  }

  return (
    <section className="surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[0.9375rem] font-semibold">Daily sales</h2>
        <p className="tnum text-[0.75rem] text-[var(--text-faint)]">
          Peak {formatCompactUGX(peak)}
        </p>
      </div>

      {/* Wide ranges scroll inside the card rather than stretching the page. */}
      <div className="mt-4 overflow-x-auto [scrollbar-width:thin]">
        <div
          className="flex h-40 items-end gap-[2px]"
          style={{ minWidth: `${days.length * 14}px` }}
          role="img"
          aria-label={`Daily sales from ${formatDateShort(from)} to ${formatDateShort(to)}. Peak ${formatUGX(peak)}.`}
        >
          {days.map(({ day, revenue, profit }) => {
            // Floor at 2px so a day with a small sale is still visibly non-zero.
            const height = revenue === 0 ? 0 : Math.max(2, (revenue / peak) * 100);
            return (
              <div
                key={day}
                className="group relative flex min-w-[12px] flex-1 flex-col justify-end"
                style={{ height: '100%' }}
                title={`${formatDateShort(day)}\nSales ${formatUGX(revenue)}\nProfit ${formatUGX(profit)}`}
              >
                <div
                  className="w-full rounded-t-[4px] transition-opacity group-hover:opacity-80"
                  style={{
                    height: `${height}%`,
                    background: revenue === 0 ? 'var(--border)' : 'var(--accent)',
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex justify-between text-[0.6875rem] text-[var(--text-faint)]">
        <span>{formatDateShort(from)}</span>
        <span>{formatDateShort(to)}</span>
      </div>
    </section>
  );
}
