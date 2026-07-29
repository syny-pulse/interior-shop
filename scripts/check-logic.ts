/**
 * Regression checks for the date and money helpers. No database needed.
 *
 *   npm run test:logic
 *
 * These cover the three places this app is most likely to go quietly wrong:
 *   1. Kampala is UTC+3, so a naive UTC "today" files early-morning sales
 *      under the previous day.
 *   2. Date ranges must include both endpoints, or the last day of a period
 *      vanishes from the dashboard.
 *   3. Postgres returns SUM() over integers as a STRING, so unguarded
 *      arithmetic concatenates instead of adding.
 */
import {
  addDays,
  addMonths,
  eachDay,
  formatMonth,
  isValidIsoDate,
  monthGrid,
  rangeFor,
  startOfMonth,
  todayInKampala,
  formatDate,
  rangeFromParams,
} from '../lib/dates';
import {
  formatUGX,
  formatSignedUGX,
  toNumber,
  formatCompactUGX,
  marginPercent,
} from '../lib/format';
import { runOfflineChecks } from './check-offline';

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

console.log('\n--- The Kampala timezone trap (plan verification pass 8) ---');
// 22:30 UTC on 28 Jul is already 01:30 on 29 Jul in Kampala (UTC+3).
const lateUtc = new Date('2026-07-28T22:30:00Z');
const naive = lateUtc.toISOString().slice(0, 10);
const kampala = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala' }).format(lateUtc);
check('naive UTC slice returns the WRONG (previous) day', naive, '2026-07-28');
check('Africa/Kampala returns the correct day', kampala, '2026-07-29');
console.log(`        -> a sale at 01:30 Kampala would have been filed under ${naive} without the helper`);

console.log('\n--- addDays across awkward boundaries ---');
check('month boundary', addDays('2026-01-31', 1), '2026-02-01');
check('year boundary', addDays('2026-12-31', 1), '2027-01-01');
check('backwards over year boundary', addDays('2027-01-01', -1), '2026-12-31');
check('leap day exists in 2028', addDays('2028-02-28', 1), '2028-02-29');
check('no leap day in 2026', addDays('2026-02-28', 1), '2026-03-01');

console.log('\n--- eachDay is inclusive of both endpoints (plan verification pass 9) ---');
check('single day', eachDay('2026-07-28', '2026-07-28'), ['2026-07-28']);
check('three days inclusive', eachDay('2026-07-28', '2026-07-30'), [
  '2026-07-28',
  '2026-07-29',
  '2026-07-30',
]);
check('full January is 31 days', eachDay('2026-01-01', '2026-01-31').length, 31);

console.log('\n--- isValidIsoDate rejects impossible dates ---');
check('valid date', isValidIsoDate('2026-07-29'), true);
check('30 February rejected', isValidIsoDate('2026-02-30'), false);
check('month 13 rejected', isValidIsoDate('2026-13-01'), false);
check('29 Feb in a non-leap year rejected', isValidIsoDate('2026-02-29'), false);
check('29 Feb in a leap year accepted', isValidIsoDate('2028-02-29'), true);
check('junk rejected', isValidIsoDate('not-a-date'), false);

console.log('\n--- rangeFor invariants ---');
const today = todayInKampala();
const todayRange = rangeFor('today');
check('today range is a single day', [todayRange.from, todayRange.to], [today, today]);

const week = rangeFor('week');
check('week ends today', week.to, today);
check('week start is on or before today', week.from <= week.to, true);
const weekStartDow = new Date(`${week.from}T00:00:00Z`).getUTCDay();
check('week starts on a Monday', weekStartDow, 1);
check('week is at most 7 days', eachDay(week.from, week.to).length <= 7, true);

const month = rangeFor('month');
check('month starts on the 1st', month.from.slice(-2), '01');
check('month ends today', month.to, today);

const backwards = rangeFor('custom', '2026-07-30', '2026-07-01');
check('a backwards custom range is corrected, not dropped', [backwards.from, backwards.to], [
  '2026-07-01',
  '2026-07-30',
]);

console.log('\n--- rangeFromParams tolerates bad URL input ---');
check('unknown preset falls back to today', rangeFromParams({ range: 'nonsense' }).from, today);
check('invalid custom date falls back safely', rangeFromParams({ range: 'custom', from: '2026-02-30', to: '2026-03-05' }).to, '2026-03-05');

console.log('\n--- Money formatting (UGX, whole shillings) ---');
check('formats with USh prefix', formatUGX(45000).startsWith('USh'), true);
check('no decimal places', formatUGX(45000).includes('.'), false);
check('zero', formatUGX(0).startsWith('USh'), true);
check('positive profit carries a plus', formatSignedUGX(12000).startsWith('+'), true);
check('negative profit carries a real minus sign', formatSignedUGX(-3400).startsWith('−'), true);
check('compact millions', formatCompactUGX(1_250_000), 'USh 1.3M');
check('compact keeps exact below a million', formatCompactUGX(999_000).includes('999'), true);

console.log('\n--- toNumber: the Postgres bigint-as-string trap ---');
check('SUM() returned as a string becomes a number', toNumber('1234'), 1234);
check('adding two aggregates does not concatenate', toNumber('12') + toNumber('34'), 46);
check('null aggregate becomes 0', toNumber(null), 0);
check('undefined becomes 0', toNumber(undefined), 0);
check('junk becomes 0 rather than NaN', toNumber('abc'), 0);

console.log('\n--- Margin guards divide-by-zero ---');
check('zero revenue returns null instead of Infinity', marginPercent(0, 500), null);
check('normal margin', marginPercent(1000, 250), '25.0%');

console.log('\n--- Calendar dropdown grid (custom-styled date picker) ---');
check('startOfMonth clamps to the 1st', startOfMonth('2026-07-29'), '2026-07-01');
check('addMonths across a year boundary', addMonths('2026-12-15', 1), '2027-01-01');
check('addMonths backwards across a year boundary', addMonths('2027-01-15', -1), '2026-12-01');
const grid = monthGrid('2026-07-15');
check('grid is 6 Monday-first weeks', grid.length, 42);
check('grid starts on a Monday', new Date(`${grid[0]}T00:00:00Z`).getUTCDay(), 1);
check('grid contains every day of the month', eachDay('2026-07-01', '2026-07-31').every((d) => grid.includes(d)), true);
check('grid pads with the previous month to fill the first week', grid[0] < '2026-07-01', true);
check('formatMonth reads naturally', formatMonth('2026-07-15'), 'July 2026');

console.log('\n--- Date display is unambiguous ---');
check('formatDate avoids DD/MM ambiguity', formatDate('2026-03-05'), '5 Mar 2026');

runOfflineChecks(check);

console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
