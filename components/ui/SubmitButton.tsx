'use client';

import { useFormStatus } from 'react-dom';
import { CircleNotchIcon } from '@phosphor-icons/react/dist/ssr';

/**
 * Disables itself while the action is in flight. Without this, a slow
 * connection in the shop invites a second tap, and a double-submitted sale
 * silently decrements stock twice.
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = 'primary',
  className = '',
  disabled = false,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className={`btn btn-${variant} ${className}`}
    >
      {pending && <CircleNotchIcon size={16} weight="bold" className="animate-spin" />}
      {pending ? (pendingLabel ?? 'Saving') : children}
    </button>
  );
}
