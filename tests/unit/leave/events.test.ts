// Task 1.5: A1–A5 as pure functions of (policy, hire, assignment, date, worked, balanceBefore). The numbers are
// the GA cases' arithmetic (brief §8); the GA table proper runs through the simulation in goldens.test.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addDays, calendarDay as d } from '@/accrual/calendar';
import { accrualDates, applyMaxBalanceCap, grossAccrual } from '@/accrual/events';
import { loadPolicyFile, parsePolicy } from '@/accrual/policy';

const pf = loadPolicyFile(readFileSync(new URL('../../../fixtures/policies.json', import.meta.url), 'utf8'));
const SAL = pf.policies.get('PTO_SALARIED')!;
const HOURLY = pf.policies.get('PTO_HOURLY')!;
const SICK = pf.policies.get('SICK_STD')!;
const HAND_HALF_UP = parsePolicy({
  id: 'HAND_HALF_UP', leave_type: 'PTO',
  accrual: { frequency: 'MONTHLY', proration: 'DAILY', rounding: 'HALF_UP', tiers: [{ min_tenure_months: 0, minutes_per_period: 605 }] },
  year: { type: 'CALENDAR' }, carryover_cap_minutes: 2400, max_balance_minutes: 12000, allow_negative: false,
});
const HAND_ANNUAL = parsePolicy({
  id: 'HAND_ANNUAL_GRANT', leave_type: 'PTO',
  accrual: { frequency: 'ANNIVERSARY', proration: 'NONE', rounding: 'HALF_UP', tiers: [{ min_tenure_months: 0, minutes_per_period: 4800 }] },
  year: { type: 'CALENDAR' }, carryover_cap_minutes: 4800, max_balance_minutes: 12000, allow_negative: false,
});
const ANCHOR = pf.payPeriod.anchorStart;
const LEN = pf.payPeriod.lengthDays;
const LO = d('2024-01-01');
const HI = d('2025-12-31');

const gross = (policy: typeof SAL, hire: string, date: string, aStart = hire, aEnd: string | null = null, worked = 0) =>
  grossAccrual({ policy, hire: d(hire), assignStart: d(aStart), assignEnd: aEnd ? d(aEnd) : null, date: d(date), workedMinutes: worked });

describe('A3 MONTHLY with DAILY proration', () => {
  it('GA-01: a full month is the tier rate with no proration code', () => {
    expect(gross(SAL, '2024-01-01', '2024-01-31')).toEqual({ minutes: 600, codes: ['ACCRUAL_MONTHLY'] });
  });
  it('GA-02: mid-month hire 15/31 of 600 = 290.32 -> 290, then a full 600', () => {
    expect(gross(SAL, '2024-03-17', '2024-03-31')).toEqual({ minutes: 290, codes: ['ACCRUAL_MONTHLY', 'PRORATED_DAILY'] });
    expect(gross(SAL, '2024-03-17', '2024-04-30')).toEqual({ minutes: 600, codes: ['ACCRUAL_MONTHLY'] });
  });
  it('GA-03: leap month 15/29 of 600 = 310.34 -> 310', () => {
    expect(gross(SAL, '2024-02-15', '2024-02-29').minutes).toBe(310);
  });
  it('GA-04: HALF_UP on exactly .5: 605*3/30 = 60.5 -> 61', () => {
    expect(gross(HAND_HALF_UP, '2024-04-28', '2024-04-30').minutes).toBe(61);
  });
  it('GA-05 / A2: the tier is chosen by completed months AT the event date', () => {
    expect(gross(SAL, '2022-08-20', '2024-07-31').minutes).toBe(600); // 23 months
    expect(gross(SAL, '2022-08-20', '2024-08-31').minutes).toBe(720); // 24 months
  });
  it('GA-19: termination prorates by active days: 600*10/31 = 193.5 -> 194', () => {
    expect(gross(SAL, '2024-01-01', '2024-05-31', '2024-01-01', '2024-05-10')).toEqual({ minutes: 194, codes: ['ACCRUAL_MONTHLY', 'PRORATED_DAILY'] });
  });
  it('GA-18 / T10: a one-day assignment accrues 1/30 of the tier taken from the REAL hire date', () => {
    expect(gross(SAL, '2024-01-01', '2025-06-30', '2025-06-30').minutes).toBe(20); // 17 months -> 600
    expect(gross(SAL, '2023-04-03', '2025-06-30', '2025-06-30').minutes).toBe(24); // 26 months -> 720
  });
});

describe('A4 PER_HOURS_WORKED, PER_PAY_PERIOD, ANNIVERSARY', () => {
  it('GA-11: FLOOR: 4790*2/60 = 159.67 -> 159; 4800 -> 160', () => {
    expect(gross(HOURLY, '2024-01-01', '2024-01-14', '2024-01-01', null, 4790)).toEqual({ minutes: 159, codes: ['ACCRUAL_HOURS_WORKED'] });
    expect(gross(HOURLY, '2024-01-01', '2024-01-28', '2024-01-01', null, 4800).minutes).toBe(160);
  });
  it('GA-13 / T1: NONE proration gives the full 120 four days after hire', () => {
    expect(gross(SICK, '2024-03-20', '2024-03-24')).toEqual({ minutes: 120, codes: ['ACCRUAL_PAY_PERIOD'] });
  });
  it('GA-20: an anniversary grant is the tier rate', () => {
    expect(gross(HAND_ANNUAL, '2023-05-15', '2024-05-15')).toEqual({ minutes: 4800, codes: ['ACCRUAL_ANNIVERSARY'] });
  });
});

describe('A5 max-balance cap measured at posting (GA-07, T7)', () => {
  it('posts min(gross, room) and records the shortfall', () => {
    expect(applyMaxBalanceCap(840, 12000, 11600)).toEqual({ posted: 400, capped: 440, codes: ['MAX_BALANCE_CAP'] });
    expect(applyMaxBalanceCap(840, 12000, 12000)).toEqual({ posted: 0, capped: 840, codes: ['MAX_BALANCE_CAP'] });
    expect(applyMaxBalanceCap(840, 12000, 11040)).toEqual({ posted: 840, capped: 0, codes: [] });
    expect(applyMaxBalanceCap(840, 12000, 11880)).toEqual({ posted: 120, capped: 720, codes: ['MAX_BALANCE_CAP'] });
  });
  it('a balance above the max (O-10 transfer-in) has zero room, never negative', () => {
    expect(applyMaxBalanceCap(600, 4800, 5000)).toEqual({ posted: 0, capped: 600, codes: ['MAX_BALANCE_CAP'] });
  });
  it('a zero gross is still a (zero) row with no cap code', () => {
    expect(applyMaxBalanceCap(0, 2880, 2880)).toEqual({ posted: 0, capped: 0, codes: [] });
  });
});

describe('A1 event dates', () => {
  const dates = (policy: typeof SAL, hire: string, aStart: string, aEnd: string | null, ts: string[] = [], lo = LO, hi = HI) =>
    accrualDates({ policy, hire: d(hire), assignStart: d(aStart), assignEnd: aEnd ? d(aEnd) : null, lo, hi, anchor: ANCHOR, lengthDays: LEN, timesheetEnds: new Set(ts) });

  it('MONTHLY: the last day of every month the assignment touches, the end month included (GA-19: 5 rows)', () => {
    expect(dates(SAL, '2024-01-01', '2024-01-01', '2024-05-10')).toEqual(['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30', '2024-05-31']);
  });
  it('MONTHLY: starts at the month end of max(lo, start) and stops at hi', () => {
    expect(dates(SAL, '2015-01-05', '2015-01-05', null, [], LO, d('2024-03-31'))).toEqual(['2024-01-31', '2024-02-29', '2024-03-31']);
    expect(dates(SAL, '2025-06-30', '2025-06-30', null, [], LO, d('2025-07-31'))).toEqual(['2025-06-30', '2025-07-31']);
  });
  it('an assignment entirely outside [lo, hi] has no events', () => {
    expect(dates(SAL, '2026-01-05', '2026-01-05', null)).toEqual([]);
    expect(dates(SAL, '2015-01-05', '2015-01-05', '2023-06-30')).toEqual([]);
  });
  it('PER_PAY_PERIOD: every period end the assignment is active on (GA-13: first is 03-24)', () => {
    expect(dates(SICK, '2024-03-20', '2024-03-20', null, [], LO, d('2024-04-30'))).toEqual(['2024-03-24', '2024-04-07', '2024-04-21']);
  });
  it('PER_HOURS_WORKED: only period ends with a timesheet row (GA-11)', () => {
    expect(dates(HOURLY, '2024-01-01', '2024-01-01', null, ['2024-01-14', '2024-01-28'], LO, d('2024-02-15'))).toEqual(['2024-01-14', '2024-01-28']);
    expect(dates(HOURLY, '2024-01-01', '2024-01-01', null, ['2024-01-14'], LO, d('2024-02-15'))).toEqual(['2024-01-14']);
  });
  it('PER_HOURS_WORKED: the transfer day is not a period end, so the old policy stops at 06-29 (GA-18: 13 periods in 2025)', () => {
    const ts = new Set<string>();
    for (let e = d('2024-01-14'); e <= d('2025-06-29'); e = addDays(e, 14)) ts.add(e);
    const got = dates(HOURLY, '2024-01-01', '2024-01-01', '2025-06-29', [...ts]);
    expect(got.filter((x) => x >= '2025-01-01')).toHaveLength(13);
    expect(got[got.length - 1]).toBe('2025-06-29');
  });
  it('ANNIVERSARY: each clamped anniversary of hire while active (GA-20)', () => {
    expect(dates(HAND_ANNUAL, '2023-05-15', '2023-05-15', null)).toEqual(['2024-05-15', '2025-05-15']);
  });
});

