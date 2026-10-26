// Task 1.7: A6 boundary dates per year type, forfeiture at end of day, A7 recompute in both directions with ONE
// row per trigger, and the D-9 posting order as a named constant.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLASS0_ORDER, POSTING_ORDER, forfeitureAt, recomputeAfter, yearBoundaries } from '@/accrual/boundaries';
import { calendarDay as d } from '@/accrual/calendar';
import { type EntryDraft, Ledger } from '@/accrual/ledger';
import { loadPolicyFile } from '@/accrual/policy';

const pf = loadPolicyFile(readFileSync(new URL('../../../fixtures/policies.json', import.meta.url), 'utf8'));
const SAL = pf.policies.get('PTO_SALARIED')!;
const HOURLY = pf.policies.get('PTO_HOURLY')!;
const SICK = pf.policies.get('SICK_STD')!;
const LO = d('2024-01-01');
const HI = d('2025-12-31');

describe('D-9 posting order is a named constant', () => {
  it('class 0 (open, transfer, accrual) < class 1 (request events) < class 2 (boundaries)', () => {
    expect(POSTING_ORDER.OPEN_TRANSFER_ACCRUAL).toBeLessThan(POSTING_ORDER.REQUEST_EVENTS);
    expect(POSTING_ORDER.REQUEST_EVENTS).toBeLessThan(POSTING_ORDER.YEAR_BOUNDARIES);
    expect(Object.isFrozen(POSTING_ORDER)).toBe(true);
    expect([CLASS0_ORDER.OPEN, CLASS0_ORDER.TRANSFER, CLASS0_ORDER.ACCRUAL]).toEqual([0, 1, 2]);
  });
});

describe('A6 boundary dates', () => {
  const b = (policy: typeof SAL, hire: string, aStart: string, aEnd: string | null, lo = LO, hi = HI) =>
    yearBoundaries({ policy, hire: d(hire), assignStart: d(aStart), assignEnd: aEnd ? d(aEnd) : null, lo, hi });
  it('CALENDAR: Dec 31 of each year inside the assignment; none after a termination (GA-19)', () => {
    expect(b(SAL, '2015-01-05', '2015-01-05', null)).toEqual(['2024-12-31', '2025-12-31']);
    expect(b(SAL, '2024-01-01', '2024-01-01', '2024-05-10')).toEqual([]);
    expect(b(SAL, '2024-01-01', '2024-01-01', '2024-12-31')).toEqual(['2024-12-31']);
  });
  it('POLICY_YEAR starting 07-01: the day before, Jun 30 (GA-14)', () => {
    expect(b(SICK, '2022-01-03', '2022-01-03', null)).toEqual(['2024-06-30', '2025-06-30']);
    expect(b(SICK, '2024-03-20', '2024-03-20', null, LO, d('2024-07-14'))).toEqual(['2024-06-30']);
  });
  it('ANNIVERSARY: the clamped hire anniversary (GA-12 leap-day hire → 2025-02-28; T10 E033)', () => {
    expect(b(HOURLY, '2024-02-29', '2024-02-29', null, LO, d('2025-03-09'))).toEqual(['2025-02-28']);
    expect(b(HOURLY, '2023-04-03', '2023-04-03', '2025-06-29')).toEqual(['2024-04-03', '2025-04-03']);
    expect(b(HOURLY, '2024-01-01', '2024-01-01', '2025-06-29')).toEqual(['2025-01-01']); // GA-18
  });
});

describe('forfeitureAt', () => {
  it('GA-06: 7200 − 2400 = 4800; at or under the cap nothing is forfeited (GA-20)', () => {
    expect(forfeitureAt(7200, 2400)).toBe(4800);
    expect(forfeitureAt(4800, 4800)).toBe(0);
    expect(forfeitureAt(-840, 2400)).toBe(0);
  });
});

const draft = (kind: EntryDraft['kind'], effective: string, posted: string, minutes: number, codes = '', ref = ''): EntryDraft => ({
  employeeId: 'X', leaveType: 'PTO', policyId: 'PTO_SALARIED', kind, effective: d(effective), posted: d(posted), minutes, cappedMinutes: 0, codes, ref,
});

/** GA-10's ledger as of 2025-01-07: twelve 600s, Dec 16–17 used, 3840 forfeited at Dec 31. */
function ga10Ledger(): Ledger {
  const l = new Ledger();
  const ends = ['01-31', '02-29', '03-31', '04-30', '05-31', '06-30', '07-31', '08-31', '09-30', '10-31', '11-30', '12-31'];
  for (const e of ends.slice(0, 11)) l.post(draft('ACCRUAL', `2024-${e}`, `2024-${e}`, 600, 'ACCRUAL_MONTHLY', `2024-${e}`));
  l.post(draft('USAGE', '2024-12-16', '2024-12-03', -480, 'USAGE_APPROVED', 'R1'));
  l.post(draft('USAGE', '2024-12-17', '2024-12-03', -480, 'USAGE_APPROVED', 'R1'));
  l.post(draft('ACCRUAL', '2024-12-31', '2024-12-31', 600, 'ACCRUAL_MONTHLY', '2024-12-31'));
  l.post(draft('FORFEITURE', '2024-12-31', '2024-12-31', -3840, 'CARRYOVER_FORFEITURE', '2024-12-31'));
  return l;
}

describe('A7 recompute after a retroactive batch', () => {
  it('GA-10 take-back: the reversal batch re-derives Dec 31 once: target 4800, existing 3840 → ONE row of −960', () => {
    const l = ga10Ledger();
    const posted = l.usageRowsFor('X', 'PTO', 'R1').map((u) => l.post(draft('USAGE_REVERSAL', u.effective, '2025-01-08', -u.minutes, 'USAGE_REVERSED_CANCELLED', 'R1')));
    const rows = recomputeAfter(l, posted, [d('2024-12-31')], () => SAL);
    expect(rows.map((r) => [r.effective, r.posted, r.minutes, r.codes, r.ref])).toEqual([['2024-12-31', '2025-01-08', -960, 'CARRYOVER_RECOMPUTED', 'R1']]);
    expect(l.forfeitedAt('X', 'PTO', d('2024-12-31'))).toBe(4800);
    expect(l.balance('X', 'PTO', d('2025-01-08'))).toBe(2400);
  });
  it('S13 give-back: a late approval landing in the closed year lowers the forfeiture (+480)', () => {
    const l = new Ledger();
    l.post(draft('ADJUSTMENT', '2023-12-31', '2023-12-31', 2700, 'OPENING_BALANCE'));
    l.post(draft('FORFEITURE', '2024-06-30', '2024-06-30', -300, 'CARRYOVER_FORFEITURE', '2024-06-30'));
    const posted = [l.post(draft('USAGE', '2024-06-27', '2024-07-03', -480, 'USAGE_APPROVED', 'R9'))];
    const rows = recomputeAfter(l, posted, [d('2024-06-30')], () => SICK);
    // S(B) = 2700 − 480 = 2220 → target 0; existing 300 → delta −300 → row +300
    expect(rows.map((r) => [r.effective, r.minutes, r.codes, r.ref])).toEqual([['2024-06-30', 300, 'CARRYOVER_RECOMPUTED', 'R9']]);
  });
  it('an entry effective after the last processed boundary triggers nothing', () => {
    const l = ga10Ledger();
    const posted = [l.post(draft('USAGE', '2025-01-10', '2025-01-02', -480, 'USAGE_APPROVED', 'R2'))];
    expect(recomputeAfter(l, posted, [d('2024-12-31')], () => SAL)).toEqual([]);
  });
  it('a forfeiture row never triggers a recompute of itself; an empty batch does nothing', () => {
    const l = ga10Ledger();
    const f = l.entries.find((e) => e.kind === 'FORFEITURE')!;
    expect(recomputeAfter(l, [f], [d('2024-12-31')], () => SAL)).toEqual([]);
    expect(recomputeAfter(l, [], [d('2024-12-31')], () => SAL)).toEqual([]);
  });
  it('a batch already consistent with the boundary posts no zero-delta row', () => {
    const l = ga10Ledger();
    const posted = l.usageRowsFor('X', 'PTO', 'R1').map((u) => l.post(draft('USAGE_REVERSAL', u.effective, '2025-01-08', -u.minutes, 'USAGE_REVERSED_CANCELLED', 'R1')));
    recomputeAfter(l, posted, [d('2024-12-31')], () => SAL);
    const again = [l.post(draft('ADJUSTMENT', '2024-06-01', '2025-02-01', 0, 'OPENING_BALANCE', ''))];
    expect(recomputeAfter(l, again, [d('2024-12-31')], () => SAL)).toEqual([]);
  });
  it('two closed boundaries: a batch in the first year re-derives both in order', () => {
    const l = new Ledger();
    for (const y of ['2024', '2025']) l.post(draft('ACCRUAL', `${y}-06-30`, `${y}-06-30`, 3000, 'ACCRUAL_MONTHLY'));
    l.post(draft('FORFEITURE', '2024-12-31', '2024-12-31', -600, 'CARRYOVER_FORFEITURE', '2024-12-31')); // 3000 − 2400
    l.post(draft('FORFEITURE', '2025-12-31', '2025-12-31', -3000, 'CARRYOVER_FORFEITURE', '2025-12-31')); // 2400 + 3000 − 2400
    const posted = [l.post(draft('USAGE_REVERSAL', '2024-03-01', '2026-01-05', 480, 'USAGE_REVERSED_CANCELLED', 'R3'))];
    const rows = recomputeAfter(l, posted, [d('2024-12-31'), d('2025-12-31')], () => SAL);
    // 2024: S = 3480 → target 1080, existing 600 → −480. 2025: S = 3480 − 1080 + 3000 = 5400 → 3000, existing 3000 → 0 (no row)
    expect(rows.map((r) => [r.effective, r.minutes])).toEqual([['2024-12-31', -480]]);
    expect(l.balance('X', 'PTO', d('2025-12-31'))).toBe(2400);
  });
});
