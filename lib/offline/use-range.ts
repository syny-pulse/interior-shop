'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { rangeFromParams, type DateRange } from '../dates';

/**
 * The selected period, computed on the device.
 *
 * The range used to be derived on the server from searchParams, which was
 * correct while every page load reached the server. It no longer does: offline,
 * the service worker replays a cached document, and a "today" baked into HTML
 * from yesterday would silently show the wrong day's takings — the exact class
 * of bug lib/dates.ts exists to prevent.
 *
 * rangeFromParams() is the same function the server used, and todayInKampala()
 * inside it reads Africa/Kampala rather than any clock's idea of local time.
 */
export function useRange(): DateRange {
  const params = useSearchParams();

  const range = params.get('range') ?? undefined;
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;

  return useMemo(() => rangeFromParams({ range, from, to }), [range, from, to]);
}
