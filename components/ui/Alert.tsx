import {
  CheckCircleIcon,
  WarningCircleIcon,
  WarningIcon,
  InfoIcon,
} from '@phosphor-icons/react/dist/ssr';
import type { ActionState } from '@/lib/action-state';

const TONES = {
  success: {
    Icon: CheckCircleIcon,
    bg: 'var(--accent-soft)',
    fg: 'var(--accent-text)',
    border: 'var(--accent-border)',
  },
  error: {
    Icon: WarningCircleIcon,
    bg: 'var(--negative-soft)',
    fg: 'var(--negative)',
    border: 'var(--negative)',
  },
  warn: {
    Icon: WarningIcon,
    bg: 'var(--warn-soft)',
    fg: 'var(--warn)',
    border: 'var(--warn-border)',
  },
  info: {
    Icon: InfoIcon,
    bg: 'var(--surface-2)',
    fg: 'var(--text-muted)',
    border: 'var(--border)',
  },
} as const;

export function Alert({
  tone = 'info',
  children,
}: {
  tone?: keyof typeof TONES;
  children: React.ReactNode;
}) {
  const { Icon, bg, fg, border } = TONES[tone];

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className="flex items-start gap-2.5 rounded-[var(--radius-control)] border px-3.5 py-3 text-[0.875rem] leading-snug"
      style={{ background: bg, color: fg, borderColor: border }}
    >
      <Icon size={18} weight="fill" className="mt-px shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** Renders the result of a Server Action, if there is one to show. */
export function FormMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return <Alert tone={state.ok ? 'success' : 'error'}>{state.message}</Alert>;
}
