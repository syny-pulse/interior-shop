import { STATUS_LABEL, type StockStatus } from '@/lib/offline/stock';

/**
 * How a stock status looks, in one place.
 *
 * "In stock" gets no chip at all. A badge on every healthy row would be noise
 * competing with the two rows that actually need attention, and the whole point
 * of the flag is that it is rare enough to notice.
 */
export function StockStatusChip({ status }: { status: StockStatus }) {
  if (status === 'ok') return null;

  return (
    <span className={status === 'low' ? 'chip chip-warn' : 'chip chip-muted'}>
      {STATUS_LABEL[status]}
    </span>
  );
}

const BAR_COLOUR: Record<StockStatus, string> = {
  out: 'var(--border-strong)',
  low: 'var(--warn)',
  ok: 'var(--accent)',
};

/**
 * How much of the current stocking is left, as a bar.
 *
 * Purely decorative and hidden from assistive tech: the figure beside it says
 * "9 of 20" and the chip says "Running low", so the bar adds scannability
 * without being the only way to learn anything. Colour is never the sole
 * signal — the same rule the stat cards follow.
 */
export function SellThroughBar({
  remaining,
  baseline,
  status,
}: {
  remaining: number;
  baseline: number;
  status: StockStatus;
}) {
  const percent =
    baseline > 0 ? Math.max(0, Math.min(100, Math.round((remaining / baseline) * 100))) : 0;

  return (
    <span
      aria-hidden="true"
      className="mt-1 block h-[3px] w-full overflow-hidden rounded-full"
      style={{ background: 'var(--surface-3)' }}
    >
      <span
        className="block h-full rounded-full"
        style={{ width: `${percent}%`, background: BAR_COLOUR[status] }}
      />
    </span>
  );
}
