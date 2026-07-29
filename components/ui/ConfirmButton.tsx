'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';

/**
 * Two-step delete. A single tap on a phone is far too easy to hit by accident,
 * and deleting a sale moves stock and money figures.
 */
export function ConfirmButton({
  label,
  confirmLabel = 'Tap again to confirm',
  className = 'btn btn-danger',
}: {
  label: string;
  confirmLabel?: string;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const { pending } = useFormStatus();

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className={className}
        disabled={pending}
      >
        {label}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="submit" className={className} disabled={pending} autoFocus>
        {pending ? 'Removing' : confirmLabel}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="btn btn-ghost"
        disabled={pending}
      >
        Cancel
      </button>
    </span>
  );
}
