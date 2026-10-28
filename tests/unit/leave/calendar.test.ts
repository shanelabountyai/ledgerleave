// C1–C5 (docs/domain-brief.md §5) and the three places docs/phase-1-plan.md §3 expects a hand-written calendar to
// disagree with Python's datetime. Every value here is either stated in the brief / task 1.3 or re-derivable by hand.
import { describe, expect, it } from 'vitest';
import {
  InvalidCalendarValue,
  addDays,
  addMonthsClamped,
  calendarDay,
  completedMonths,
  daysBetween,
  daysFromCivil,
  civilFromDays,
  daysInMonth,
  isoWeekday,
  lastDayOfMonth,
  payPeriodEndFor,
  payPeriodEnds,
  workingDays,
} from '@/accrual/calendar';
import { assertMinutes, roundDiv, floorDiv, WORK_DAY_MINUTES } from '@/accrual/minutes';

const d = calendarDay;

describe('calendarDay constructor (Bookable LD-2: non-existent dates are refused, never normalized)', () => {
  it('accepts a real date and returns the same string', () => {
    expect(d('2024-02-29')).toBe('2024-02-29');
  });
  it('rejects malformed input', () => {
    expect(() => d('2024-2-9')).toThrow(InvalidCalendarValue);
    expect(() => d('20240209')).toThrow(InvalidCalendarValue);
    expect(() => d('')).toThrow(InvalidCalendarValue);
  });
  it('rejects a day the month does not have', () => {
    expect(() => d('2025-02-29')).toThrow(InvalidCalendarValue);
    expect(() => d('2024-04-31')).toThrow(InvalidCalendarValue);
    expect(() => d('2024-13-01')).toThrow(InvalidCalendarValue);
    expect(() => d('2024-00-10')).toThrow(InvalidCalendarValue);
  });
});

describe('civil-day arithmetic', () => {
  it('round-trips through the day number', () => {
    for (const s of ['1970-01-01', '2000-02-29', '2023-12-31', '2024-01-01', '2024-02-29', '2025-02-28', '2100-03-01']) {
      const { y, m, day } = civilFromDays(daysFromCivil(...splitDate(s)));
      expect([y, m, day]).toEqual(splitDate(s));
    }
  });
  it('1970-01-01 is day 0 and 2024-01-01 is day 19723', () => {
    expect(daysFromCivil(1970, 1, 1)).toBe(0);
    expect(daysFromCivil(2024, 1, 1)).toBe(19723);
  });
  it('addDays crosses month, year and leap boundaries', () => {
    expect(addDays(d('2024-02-28'), 1)).toBe('2024-02-29');
    expect(addDays(d('2024-02-29'), 1)).toBe('2024-03-01');
    expect(addDays(d('2024-12-31'), 1)).toBe('2025-01-01');
    expect(addDays(d('2024-01-01'), -1)).toBe('2023-12-31');
  });
  it('daysBetween is signed and is the inverse of addDays', () => {
    expect(daysBetween(d('2024-01-01'), d('2025-06-30'))).toBe(546);
    expect(daysBetween(d('2025-06-30'), d('2024-01-01'))).toBe(-546);
  });
});

describe('trap 1 — week-day (Python weekday(): Monday = 0; here ISO 1 = Monday .. 7 = Sunday)', () => {
  it('pins known days', () => {
    expect(isoWeekday(d('2024-01-01'))).toBe(1); // Monday — the pay-period anchor
    expect(isoWeekday(d('2024-07-04'))).toBe(4); // Thursday
    expect(isoWeekday(d('2024-07-06'))).toBe(6); // Saturday
    expect(isoWeekday(d('2024-07-07'))).toBe(7); // Sunday
    expect(isoWeekday(d('1970-01-01'))).toBe(4); // Thursday
    expect(isoWeekday(d('2025-05-05'))).toBe(1); // Monday — the GR submit date
  });
});

describe('trap 2 — month-end and leap years', () => {
  it('days in month, Gregorian rule', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2100, 2)).toBe(28); // divisible by 100, not by 400
    expect(daysInMonth(2000, 2)).toBe(29); // divisible by 400
    expect(daysInMonth(2024, 4)).toBe(30);
    expect(daysInMonth(2024, 12)).toBe(31);
  });
  it('lastDayOfMonth is idempotent at month end', () => {
    expect(lastDayOfMonth(d('2024-02-10'))).toBe('2024-02-29');
    expect(lastDayOfMonth(d('2024-02-29'))).toBe('2024-02-29');
    expect(lastDayOfMonth(d('2025-05-10'))).toBe('2025-05-31');
  });
  it('the MONTHLY event step (last day of the month after this one) never skips a month', () => {
    let m = lastDayOfMonth(d('2024-01-05'));
    const seen: string[] = [m];
    for (let i = 0; i < 13; i++) {
      m = lastDayOfMonth(addDays(m, 1));
      seen.push(m);
    }
    expect(seen).toEqual([
      '2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30', '2024-05-31', '2024-06-30', '2024-07-31',
      '2024-08-31', '2024-09-30', '2024-10-31', '2024-11-30', '2024-12-31', '2025-01-31', '2025-02-28',
    ]);
  });
});

describe('trap 3 — clamped anniversary (C3) and completed months (C4)', () => {
  it('C3: a missing day clamps to the month end, from the ORIGINAL day each time', () => {
    expect(addMonthsClamped(d('2024-02-29'), 12)).toBe('2025-02-28'); // task 1.3 acceptance
    expect(addMonthsClamped(d('2024-02-29'), 24)).toBe('2026-02-28');
    expect(addMonthsClamped(d('2024-02-29'), 48)).toBe('2028-02-29'); // not accumulated from the clamped 28th
    expect(addMonthsClamped(d('2024-01-31'), 1)).toBe('2024-02-29');
    expect(addMonthsClamped(d('2024-01-31'), 3)).toBe('2024-04-30');
    expect(addMonthsClamped(d('2023-05-15'), 12)).toBe('2024-05-15'); // GA-20
    expect(addMonthsClamped(d('2024-11-15'), 2)).toBe('2025-01-15'); // year roll
    expect(addMonthsClamped(d('2024-03-15'), -1)).toBe('2024-02-15');
  });
  it('C4: whole months of tenure as of d, hire day clamped to the length of d month', () => {
    expect(completedMonths(d('2022-08-20'), d('2024-07-31'))).toBe(23); // GA-05 July
    expect(completedMonths(d('2022-08-20'), d('2024-08-31'))).toBe(24); // GA-05 August
    expect(completedMonths(d('2022-08-20'), d('2024-08-19'))).toBe(23);
    expect(completedMonths(d('2022-08-20'), d('2024-08-20'))).toBe(24);
    expect(completedMonths(d('2024-01-31'), d('2024-04-30'))).toBe(3); // hire day 31 clamps to April's 30
    expect(completedMonths(d('2024-01-31'), d('2024-04-29'))).toBe(2);
    expect(completedMonths(d('2024-03-20'), d('2024-03-24'))).toBe(0); // T1
    expect(completedMonths(d('2024-06-01'), d('2024-05-31'))).toBe(0); // floored at 0 like the oracle
    expect(completedMonths(d('2024-01-01'), d('2025-06-30'))).toBe(17); // GA-18 at the transfer
  });
});

describe('C1 working days', () => {
  const HOL = new Set(['2024-01-01', '2024-07-04', '2025-01-01']);
  it('skips the weekend and the Jul 4 holiday (GA-08)', () => {
    expect(workingDays(d('2024-07-03'), d('2024-07-08'), HOL)).toEqual(['2024-07-03', '2024-07-05', '2024-07-08']);
  });
  it('spans Dec 31 and skips Jan 1 (T6 / GA-09)', () => {
    expect(workingDays(d('2024-12-30'), d('2025-01-03'), HOL)).toEqual(['2024-12-30', '2024-12-31', '2025-01-02', '2025-01-03']);
  });
  it('is inclusive and may be empty', () => {
    expect(workingDays(d('2024-07-06'), d('2024-07-07'), HOL)).toEqual([]);
    expect(workingDays(d('2024-07-05'), d('2024-07-05'), HOL)).toEqual(['2024-07-05']);
  });
});

describe('C2 pay periods (anchor 2024-01-01, 14 days)', () => {
  const A = d('2024-01-01');
  it('the period containing a date ends on anchor + (k+1)·14 − 1', () => {
    expect(payPeriodEndFor(d('2025-06-30'), A, 14)).toBe('2025-07-13'); // task 1.3 acceptance
    expect(payPeriodEndFor(d('2024-01-01'), A, 14)).toBe('2024-01-14');
    expect(payPeriodEndFor(d('2024-01-14'), A, 14)).toBe('2024-01-14');
    expect(payPeriodEndFor(d('2024-01-15'), A, 14)).toBe('2024-01-28');
    expect(payPeriodEndFor(d('2024-03-20'), A, 14)).toBe('2024-03-24'); // T1 / GA-13
  });
  it('a date before the anchor floors like Python //', () => {
    expect(payPeriodEndFor(d('2023-12-31'), A, 14)).toBe('2023-12-31');
    expect(payPeriodEndFor(d('2023-12-20'), A, 14)).toBe('2023-12-31');
  });
  it('period ends inside [lo, hi], first one at or after lo', () => {
    expect(payPeriodEnds(A, 14, d('2024-02-29'), d('2024-04-10'))).toEqual(['2024-03-10', '2024-03-24', '2024-04-07']);
    expect(payPeriodEnds(A, 14, d('2024-02-29'), d('2025-02-23'))).toHaveLength(26); // GA-12
    expect(payPeriodEnds(A, 14, d('2024-01-14'), d('2024-01-14'))).toEqual(['2024-01-14']);
    expect(payPeriodEnds(A, 14, d('2024-01-15'), d('2024-01-27'))).toEqual([]);
  });
});

describe('C5 roundDiv and minutes', () => {
  it('HALF_UP rounds an exact .5 up; FLOOR truncates', () => {
    expect(roundDiv(605 * 3, 30, 'HALF_UP')).toBe(61); // GA-04: 60.5 -> 61
    expect(roundDiv(4790 * 2, 60, 'FLOOR')).toBe(159); // GA-11: 159.67 -> 159
    expect(roundDiv(4800 * 2, 60, 'FLOOR')).toBe(160);
    expect(roundDiv(600 * 15, 31, 'HALF_UP')).toBe(290); // GA-02: 290.32
    expect(roundDiv(600 * 15, 29, 'HALF_UP')).toBe(310); // GA-03: 310.34
    expect(roundDiv(600 * 10, 31, 'HALF_UP')).toBe(194); // GA-19: 193.5 -> 194
    expect(roundDiv(600 * 1, 30, 'HALF_UP')).toBe(20); // GA-18
    expect(roundDiv(0, 7, 'HALF_UP')).toBe(0);
  });
  it('refuses a negative numerator, a non-positive denominator and a non-integer', () => {
    expect(() => roundDiv(-1, 2, 'FLOOR')).toThrow();
    expect(() => roundDiv(1, 0, 'FLOOR')).toThrow();
    expect(() => roundDiv(1.5, 2, 'FLOOR')).toThrow();
  });
  it('floorDiv matches Python // on negatives', () => {
    expect(floorDiv(-1, 14)).toBe(-1);
    expect(floorDiv(-14, 14)).toBe(-1);
    expect(floorDiv(-15, 14)).toBe(-2);
    expect(floorDiv(13, 14)).toBe(0);
  });
  it('a work day is 480 minutes and minutes are integers', () => {
    expect(WORK_DAY_MINUTES).toBe(480);
    expect(assertMinutes(-960)).toBe(-960);
    expect(() => assertMinutes(1.5)).toThrow();
    expect(() => assertMinutes(Number.NaN)).toThrow();
  });
});

function splitDate(s: string): [number, number, number] {
  const [y, m, dd] = s.split('-').map(Number);
  return [y!, m!, dd!];
}
