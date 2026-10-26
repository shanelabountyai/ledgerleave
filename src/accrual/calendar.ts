/**
 * The calendar axis (D-7). A day is a `YYYY-MM-DD` string; arithmetic runs on civil-day numbers (days since
 * 1970-01-01), never through `Date`, never through a timezone. Rules C1–C5 of docs/domain-brief.md §5 live here.
 *
 * Lineage (D-32): ported in shape from Bookable `packages/core/time/types.ts` and `zone.ts` — the branded string
 * type, the constructor that rejects a date the calendar does not have (`2025-02-29` throws rather than becoming
 * March 1; Bookable's LD-2), and `addDays` / `daysBetween` / weekday as calendar-axis functions so no call site
 * parses a date on its own. Bookable does its arithmetic with `temporal-polyfill`; this repo adds no date
 * library (CLAUDE.md ask-before-add), so the arithmetic below is Howard Hinnant's `days_from_civil` /
 * `civil_from_days`, which are exact for every proleptic-Gregorian date.
 *
 * Nothing here reads the clock. Comparison of two days is plain string comparison, which is correct for this
 * fixed-width format and is why the format is fixed-width.
 */
import { floorDiv } from './minutes';

/** ISO-8601 calendar date, "2024-02-29". A label on a wall calendar; not an instant. */
export type CalendarDay = string & { readonly __calendarDay: unique symbol };

export class InvalidCalendarValue extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCalendarValue';
  }
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export function daysInMonth(y: number, m: number): number {
  if (!Number.isInteger(m) || m < 1 || m > 12) throw new InvalidCalendarValue(`month out of range: ${m}`);
  return m === 2 && isLeapYear(y) ? 29 : DAYS[m - 1]!;
}

/** Days since 1970-01-01 for a proleptic-Gregorian y-m-d (Hinnant). */
export function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = floorDiv(yy, 400);
  const yoe = yy - era * 400; // [0, 399]
  const mp = (m + 9) % 12; // March = 0
  const doy = floorDiv(153 * mp + 2, 5) + d - 1; // [0, 365]
  const doe = yoe * 365 + floorDiv(yoe, 4) - floorDiv(yoe, 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468;
}

/** The inverse of daysFromCivil. */
export function civilFromDays(n: number): { y: number; m: number; day: number } {
  const z = n + 719468;
  const era = floorDiv(z, 146097);
  const doe = z - era * 146097; // [0, 146096]
  const yoe = floorDiv(doe - floorDiv(doe, 1460) + floorDiv(doe, 36524) - floorDiv(doe, 146096), 365); // [0, 399]
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + floorDiv(yoe, 4) - floorDiv(yoe, 100)); // [0, 365]
  const mp = floorDiv(5 * doy + 2, 153); // [0, 11]
  const day = doy - floorDiv(153 * mp + 2, 5) + 1; // [1, 31]
  const m = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
  return { y: m <= 2 ? y + 1 : y, m, day };
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/** Build a day from parts, validating that the day exists. */
export function fromParts(y: number, m: number, d: number): CalendarDay {
  if (!Number.isInteger(y) || y < 1 || y > 9999) throw new InvalidCalendarValue(`year out of range: ${y}`);
  const dim = daysInMonth(y, m);
  if (!Number.isInteger(d) || d < 1 || d > dim) throw new InvalidCalendarValue(`${y}-${pad2(m)} has ${dim} days, got day ${d}`);
  return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}` as CalendarDay;
}

/** "2024-02-29". Rejects malformed strings AND dates the calendar does not have. */
export function calendarDay(s: string): CalendarDay {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new InvalidCalendarValue(`CalendarDay must be YYYY-MM-DD, got: ${JSON.stringify(s)}`);
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  return fromParts(y, m, d);
}

export function partsOf(day: CalendarDay): { y: number; m: number; day: number } {
  return { y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)), day: Number(day.slice(8, 10)) };
}

export const yearOf = (day: CalendarDay): number => Number(day.slice(0, 4));
export const monthOf = (day: CalendarDay): number => Number(day.slice(5, 7));
export const dayOf = (day: CalendarDay): number => Number(day.slice(8, 10));

export function toDayNumber(day: CalendarDay): number {
  const p = partsOf(day);
  return daysFromCivil(p.y, p.m, p.day);
}

export function fromDayNumber(n: number): CalendarDay {
  const p = civilFromDays(n);
  return fromParts(p.y, p.m, p.day);
}

/** Day arithmetic on the calendar axis. Adding 86_400_000 ms would be the other axis. */
export function addDays(day: CalendarDay, n: number): CalendarDay {
  if (!Number.isInteger(n)) throw new InvalidCalendarValue(`addDays needs an integer, got ${n}`);
  return fromDayNumber(toDayNumber(day) + n);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. Inverse of addDays. */
export function daysBetween(from: CalendarDay, to: CalendarDay): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** ISO weekday: 1 = Monday .. 7 = Sunday. (Python's weekday() is this minus one; JS getDay() is something else again.) */
export function isoWeekday(day: CalendarDay): number {
  // 1970-01-01 was a Thursday (ISO 4).
  const r = ((toDayNumber(day) + 3) % 7 + 7) % 7; // 0 = Monday
  return r + 1;
}

export const isWeekend = (day: CalendarDay): boolean => isoWeekday(day) >= 6;

export function firstDayOfMonth(day: CalendarDay): CalendarDay {
  const p = partsOf(day);
  return fromParts(p.y, p.m, 1);
}

export function lastDayOfMonth(day: CalendarDay): CalendarDay {
  const p = partsOf(day);
  return fromParts(p.y, p.m, daysInMonth(p.y, p.m));
}

/** C3: the same day n months on; a day the target month lacks clamps to its last day (2024-02-29 + 12 → 2025-02-28). */
export function addMonthsClamped(day: CalendarDay, n: number): CalendarDay {
  if (!Number.isInteger(n)) throw new InvalidCalendarValue(`addMonthsClamped needs an integer, got ${n}`);
  const p = partsOf(day);
  const idx = p.m - 1 + n;
  const y = p.y + floorDiv(idx, 12);
  const m = idx - floorDiv(idx, 12) * 12 + 1;
  return fromParts(y, m, Math.min(p.day, daysInMonth(y, m)));
}

/** C4: whole months of tenure as of d (inclusive); the hire day clamps to the length of d's month; floored at 0. */
export function completedMonths(hire: CalendarDay, d: CalendarDay): number {
  const h = partsOf(hire);
  const t = partsOf(d);
  let months = (t.y - h.y) * 12 + (t.m - h.m);
  if (t.day < Math.min(h.day, daysInMonth(t.y, t.m))) months -= 1;
  return months < 0 ? 0 : months;
}

/** C1: Monday–Friday in the inclusive range, company holidays removed. */
export function workingDays(start: CalendarDay, end: CalendarDay, holidays: ReadonlySet<string>): CalendarDay[] {
  const out: CalendarDay[] = [];
  let n = toDayNumber(start);
  const last = toDayNumber(end);
  for (; n <= last; n++) {
    const day = fromDayNumber(n);
    if (!isWeekend(day) && !holidays.has(day)) out.push(day);
  }
  return out;
}

/** C2: the inclusive end date of the pay period containing d: anchor + (⌊(d − anchor)/len⌋ + 1)·len − 1. */
export function payPeriodEndFor(d: CalendarDay, anchor: CalendarDay, length: number): CalendarDay {
  const k = floorDiv(daysBetween(anchor, d), length);
  return addDays(anchor, (k + 1) * length - 1);
}

/** Every period end e with lo ≤ e ≤ hi. */
export function payPeriodEnds(anchor: CalendarDay, length: number, lo: CalendarDay, hi: CalendarDay): CalendarDay[] {
  const out: CalendarDay[] = [];
  let e = payPeriodEndFor(lo, anchor, length);
  while (e <= hi) {
    if (e >= lo) out.push(e);
    e = addDays(e, length);
  }
  return out;
}

export const minDay = (a: CalendarDay, b: CalendarDay): CalendarDay => (a <= b ? a : b);
export const maxDay = (a: CalendarDay, b: CalendarDay): CalendarDay => (a >= b ? a : b);
