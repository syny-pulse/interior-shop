'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CalendarBlankIcon, CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react/dist/ssr';
import {
  addDays,
  addMonths,
  formatDate,
  formatMonth,
  monthGrid,
  startOfMonth,
  todayInKampala,
} from '@/lib/dates';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/**
 * A themed calendar dropdown standing in for `<input type="date">`, whose
 * native popup can't be styled and looks foreign next to the rest of the app.
 * Weeks start Monday, matching the retail-week convention in lib/dates.ts.
 *
 * Works controlled (pass `value` + `onChange`, as RangePicker does) or
 * uncontrolled (pass `defaultValue` + `name` for a plain <form> to pick up
 * via FormData, as the record forms do) — same shape as a native input.
 */
export function DatePicker({
  id,
  name,
  value,
  defaultValue,
  onChange,
  required,
  min,
  max,
  invalid,
}: {
  id: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  min?: string;
  max?: string;
  invalid?: boolean;
}) {
  const [selected, setSelected] = useState(value ?? defaultValue ?? '');
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(startOfMonth(selected || todayInKampala()));
  const [focusedDay, setFocusedDay] = useState(selected || todayInKampala());

  const wrapperRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingFocusRef = useRef(false);

  // A controlled `value` always wins, including when something outside a
  // click here changes it (RangePicker's URL syncing on browser back/forward).
  useEffect(() => {
    if (value !== undefined) setSelected(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    // selected/deps intentionally narrow: only re-anchor on the transition to open.
    const anchor = selected || todayInKampala();
    setViewMonth(startOfMonth(anchor));
    setFocusedDay(anchor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusedDay}"]`)?.focus();
  }, [focusedDay, viewMonth]);

  function commit(day: string) {
    // Update local state immediately even when controlled, so the trigger
    // never waits a render for the value to round-trip back through props.
    setSelected(day);
    onChange?.(day);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveFocus(day: string) {
    if ((min && day < min) || (max && day > max)) return;
    pendingFocusRef.current = true;
    setFocusedDay(day);
    setViewMonth(startOfMonth(day));
  }

  function onGridKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const deltas: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const delta = deltas[e.key];
    if (delta !== undefined) {
      e.preventDefault();
      moveFocus(addDays(focusedDay, delta));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      commit(focusedDay);
    }
  }

  const days = monthGrid(viewMonth);

  return (
    <div className="relative" ref={wrapperRef}>
      {name && <input type="hidden" name={name} value={selected} required={required} />}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        onClick={() => setOpen((o) => !o)}
        className="control flex items-center justify-between gap-2 text-left"
      >
        <span className={!selected ? 'text-[var(--text-faint)]' : undefined}>
          {selected ? formatDate(selected) : 'Select a date'}
        </span>
        <CalendarBlankIcon size={18} className="shrink-0 text-[var(--text-faint)]" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose a date"
          className="surface absolute left-0 z-30 mt-2 w-[17.5rem] p-3 shadow-lg"
        >
          <div className="flex items-center justify-between pb-2">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setViewMonth((m) => addMonths(m, -1))}
              className="rounded-[var(--radius-chip)] p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            >
              <CaretLeftIcon size={16} weight="bold" />
            </button>
            <p className="text-[0.875rem] font-semibold">{formatMonth(viewMonth)}</p>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
              className="rounded-[var(--radius-chip)] p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            >
              <CaretRightIcon size={16} weight="bold" />
            </button>
          </div>

          <div className="grid grid-cols-7 text-center text-[0.6875rem] font-medium text-[var(--text-faint)]">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>

          <div ref={gridRef} role="grid" className="grid grid-cols-7 gap-0.5" onKeyDown={onGridKeyDown}>
            {days.map((day) => {
              const inMonth = day.slice(0, 7) === viewMonth.slice(0, 7);
              const isToday = day === todayInKampala();
              const isSelected = day === selected;
              const isOutOfRange = (min !== undefined && day < min) || (max !== undefined && day > max);
              return (
                <button
                  key={day}
                  type="button"
                  data-day={day}
                  disabled={isOutOfRange}
                  tabIndex={day === focusedDay ? 0 : -1}
                  aria-current={isToday ? 'date' : undefined}
                  aria-pressed={isSelected}
                  onClick={() => commit(day)}
                  onFocus={() => setFocusedDay(day)}
                  className="tnum flex aspect-square items-center justify-center rounded-[var(--radius-chip)] text-[0.8125rem] font-medium transition-colors enabled:hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-35"
                  style={
                    isSelected
                      ? { background: 'var(--primary)', color: 'var(--primary-fg)' }
                      : {
                          color: inMonth ? 'var(--text)' : 'var(--text-faint)',
                          boxShadow: isToday ? 'inset 0 0 0 1px var(--accent)' : undefined,
                        }
                  }
                >
                  {Number(day.slice(-2))}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => commit(todayInKampala())}
            className="mt-2 w-full rounded-[var(--radius-control)] py-1.5 text-center text-[0.8125rem] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
          >
            Today
          </button>
        </div>
      )}
    </div>
  );
}
