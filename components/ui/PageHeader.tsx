import Link from 'next/link';

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-[1.5rem] font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 max-w-[60ch] text-[0.9375rem] text-[var(--text-muted)]">
            {description}
          </p>
        )}
      </div>
      {action && (
        <Link href={action.href} className="btn btn-primary">
          {action.label}
        </Link>
      )}
    </div>
  );
}
