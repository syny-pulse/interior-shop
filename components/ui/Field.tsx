import type { ReactNode } from 'react';

/**
 * Label ABOVE the input, error BELOW it. Never placeholder-as-label: the
 * placeholder disappears the moment someone types, which is exactly when a
 * shop attendant entering figures on a phone needs it most.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className = '',
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;

  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="label">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-[0.8125rem] text-[var(--text-muted)]">
          {hint}
        </p>
      )}
      {error && (
        <p
          id={errorId}
          role="alert"
          className="mt-1.5 text-[0.8125rem] font-medium text-[var(--negative)]"
        >
          {error}
        </p>
      )}
    </div>
  );
}
