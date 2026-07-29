import { formatSignedUGX, formatUGX } from '@/lib/format';

/**
 * Figures use tabular numerals so a column of amounts lines up.
 *
 * Profit is pink-forward when positive and red when negative, but colour is
 * never the only signal: negatives also carry an explicit minus sign, and
 * every card states in words what it is.
 */
export function StatCard({
  label,
  value,
  sublabel,
  tone = 'neutral',
  emphasis = false,
}: {
  label: string;
  value: string;
  sublabel?: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'accent';
  emphasis?: boolean;
}) {
  const colour =
    tone === 'negative'
      ? 'var(--negative)'
      : tone === 'positive' || tone === 'accent'
        ? 'var(--positive)'
        : 'var(--text)';

  return (
    <div
      className="surface px-4 py-3.5"
      style={emphasis ? { borderColor: 'var(--accent-border)' } : undefined}
    >
      <p className="text-[0.8125rem] font-medium text-[var(--text-muted)]">{label}</p>
      <p
        className={`tnum mt-1 font-semibold tracking-tight ${
          emphasis ? 'text-[1.6rem]' : 'text-[1.35rem]'
        }`}
        style={{ color: colour }}
      >
        {value}
      </p>
      {sublabel && (
        <p className="mt-0.5 text-[0.75rem] text-[var(--text-faint)]">{sublabel}</p>
      )}
    </div>
  );
}

/** Money stat with the sign baked in, for profit and loss. */
export function ProfitCard({
  label,
  amount,
  sublabel,
  emphasis = false,
}: {
  label: string;
  amount: number;
  sublabel?: string;
  emphasis?: boolean;
}) {
  return (
    <StatCard
      label={label}
      value={amount === 0 ? formatUGX(0) : formatSignedUGX(amount)}
      sublabel={sublabel}
      tone={amount < 0 ? 'negative' : 'positive'}
      emphasis={emphasis}
    />
  );
}
