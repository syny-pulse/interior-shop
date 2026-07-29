import type { Icon } from '@phosphor-icons/react';
import Link from 'next/link';

export function EmptyState({
  icon: IconGlyph,
  title,
  body,
  action,
}: {
  icon: Icon;
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="surface flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div
        className="flex size-11 items-center justify-center rounded-full"
        style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}
      >
        <IconGlyph size={20} weight="duotone" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="mx-auto max-w-[38ch] text-[0.875rem] text-[var(--text-muted)]">
          {body}
        </p>
      </div>
      {action && (
        <Link href={action.href} className="btn btn-primary mt-1">
          {action.label}
        </Link>
      )}
    </div>
  );
}
