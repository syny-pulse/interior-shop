'use client';

import { useEffect, useState } from 'react';
import { CheckIcon, CopyIcon } from '@phosphor-icons/react/dist/ssr';

export function CopyButton({
  value,
  label = 'Copy link',
  className = 'btn btn-secondary',
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      // navigator.clipboard needs a secure context; on plain http it throws.
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  if (failed) {
    return (
      <input
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className="control font-mono text-[0.75rem]"
        aria-label="Attendant link, select and copy manually"
      />
    );
  }

  return (
    <button type="button" onClick={copy} className={className}>
      {copied ? <CheckIcon size={15} weight="bold" /> : <CopyIcon size={15} />}
      {copied ? 'Copied' : label}
    </button>
  );
}
