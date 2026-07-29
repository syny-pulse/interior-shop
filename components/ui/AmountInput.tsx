'use client';

import { useRef, type HTMLAttributes } from 'react';
import { formatNumber } from '@/lib/format';

type Props = {
  id: string;
  name: string;
  value: string;
  onValueChange: (digits: string) => void;
  required?: boolean;
  className?: string;
} & Pick<HTMLAttributes<HTMLInputElement>, 'aria-describedby' | 'aria-invalid'>;

/**
 * A whole-shilling amount field. `value`/`onValueChange` deal in a plain
 * digit string — what the zod schemas and profit maths expect — while the
 * visible input shows that string grouped with thousands separators as the
 * shopkeeper types. The digits are submitted through a paired hidden input
 * so the formatted, comma-bearing text never reaches the server action.
 */
export function AmountInput({ id, name, value, onValueChange, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        {...rest}
        ref={ref}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={value ? formatNumber(Number(value)) : ''}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
          onValueChange(digits);
          // Reformatting on every keystroke moves the comma positions, which
          // would otherwise fling the caret wherever the browser last left
          // it. Amounts are typed left-to-right, so pinning it to the end
          // matches what the shopkeeper expects.
          requestAnimationFrame(() => {
            const el = ref.current;
            if (el) el.setSelectionRange(el.value.length, el.value.length);
          });
        }}
      />
      <input type="hidden" name={name} value={value} />
    </>
  );
}
