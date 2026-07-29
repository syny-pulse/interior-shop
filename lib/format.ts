/**
 * Money is stored as integer UGX (whole shillings) everywhere in the app.
 * This is the only place it becomes a string for display.
 */

const UGX = new Intl.NumberFormat('en-UG', {
  style: 'currency',
  currency: 'UGX',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const PLAIN = new Intl.NumberFormat('en-UG', { maximumFractionDigits: 0 });

/** 45000 -> "USh 45,000" */
export function formatUGX(amount: number): string {
  // Intl renders UGX as "UGX 45,000" in some ICU builds and "USh" in others;
  // normalise so the app reads the same on every runtime.
  return UGX.format(amount).replace(/^UGX\s?/, 'USh ').replace(/^USh(?=\d)/, 'USh ');
}

/** 45000 -> "45,000" — for table cells where the column header already says USh. */
export function formatNumber(amount: number): string {
  return PLAIN.format(amount);
}

/**
 * Signed money for profit figures: "+USh 12,000" / "−USh 3,400".
 * Uses a real minus sign (U+2212) so a negative never reads as a hyphen or a dash.
 */
export function formatSignedUGX(amount: number): string {
  if (amount === 0) return formatUGX(0);
  const sign = amount > 0 ? '+' : '−';
  return `${sign}${formatUGX(Math.abs(amount))}`;
}

/** 1_250_000 -> "USh 1.3M" — for stat cards where the full figure would wrap. */
export function formatCompactUGX(amount: number): string {
  const abs = Math.abs(amount);
  if (abs < 1_000_000) return formatUGX(amount);
  const millions = amount / 1_000_000;
  return `USh ${millions.toFixed(millions % 1 === 0 ? 0 : 1)}M`;
}

/**
 * Postgres SUM() over integer columns returns bigint, which the driver hands
 * back as a STRING. Every aggregate must pass through here — this is the
 * easiest place in the app to silently get "12" + "34" = "1234".
 */
export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Percentage margin for display; guards the divide-by-zero on a free item. */
export function marginPercent(revenue: number, profit: number): string | null {
  if (revenue <= 0) return null;
  return `${((profit / revenue) * 100).toFixed(1)}%`;
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}
