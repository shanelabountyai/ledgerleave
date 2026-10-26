// Task 1.6: L1 balance(asOf), L2 available, forfeitedAt, usage/reversal mirroring, and the property that
// balance(asOf) does not depend on posting order for the same entry set.
import { describe, expect, it } from 'vitest';
import { type CalendarDay, calendarDay as d } from '@/accrual/calendar';
import { type EntryDraft, Ledger } from '@/accrual/ledger';

const draft = (kind: EntryDraft['kind'], effective: string, posted: string, minutes: number, extra: Partial<EntryDraft> = {}): EntryDraft => ({
  employeeId: 'X',
  leaveType: 'PTO',
  policyId: 'PTO_SALARIED',
  kind,
  effective: d(effective),
  posted: d(posted),
  minutes,
  cappedMinutes: 0,
  codes: '',
  ref: '',
  ...extra,
});

describe('posting', () => {
  it('assigns seq and L-000001 style ids in posting order and never reuses them', () => {
    const l = new Ledger();
    const a = l.post(draft('ADJUSTMENT', '2023-12-31', '2023-12-31', 50));
    const b = l.post(draft('ACCRUAL', '2024-01-31', '2024-01-31', 600));
    expect([a.entryId, a.seq, b.entryId, b.seq]).toEqual(['L-000001', 1, 'L-000002', 2]);
    expect(l.entries).toHaveLength(2);
  });
  it('refuses a float minute', () => {
    expect(() => new Ledger().post(draft('ACCRUAL', '2024-01-31', '2024-01-31', 0.5))).toThrow();
  });
});

describe('GA-17: balance (L1) vs available (L2)', () => {
  const l = new Ledger();
  for (let m = 1; m <= 4; m++) l.post(draft('ACCRUAL', `2024-0${m}-${m === 2 ? 29 : m === 4 ? 30 : 31}`, `2024-0${m}-${m === 2 ? 29 : m === 4 ? 30 : 31}`, 600));
  // Jun 10–11 approved on 05-10: future-dated usage, posted now
  l.post(draft('USAGE', '2024-06-10', '2024-05-10', -480, { ref: 'R1', codes: 'USAGE_APPROVED' }));
  l.post(draft('USAGE', '2024-06-11', '2024-05-10', -480, { ref: 'R1', codes: 'USAGE_APPROVED' }));
  it('balance as of 05-15 ignores the June usage; available does not', () => {
    expect(l.balance('X', 'PTO', d('2024-05-15'))).toBe(2400);
    expect(l.available('X', 'PTO')).toBe(1440);
    expect(l.balance('X', 'PTO', d('2024-06-11'))).toBe(1440);
  });
  it('usageRowsFor returns exactly the rows an approval wrote', () => {
    expect(l.usageRowsFor('X', 'PTO', 'R1').map((e) => e.effective)).toEqual(['2024-06-10', '2024-06-11']);
    expect(l.usageRowsFor('X', 'PTO', 'R2')).toEqual([]);
  });
});

describe('GA-08 / S4: a reversal mirrors each usage row', () => {
  it('nets to zero on every day and in total', () => {
    const l = new Ledger();
    const days = ['2024-07-03', '2024-07-05', '2024-07-08'];
    for (const day of days) l.post(draft('USAGE', day, '2024-06-18', -480, { ref: 'R1' }));
    for (const u of l.usageRowsFor('X', 'PTO', 'R1')) l.post(draft('USAGE_REVERSAL', u.effective, '2024-07-01', -u.minutes, { ref: 'R1' }));
    for (const day of days) expect(l.balance('X', 'PTO', d(day))).toBe(0);
    expect(l.available('X', 'PTO')).toBe(0);
    expect(l.entries).toHaveLength(6);
  });
});

describe('forfeitedAt', () => {
  it('sums CARRYOVER_FORFEITURE and CARRYOVER_RECOMPUTED on the boundary day as a positive number (GA-10)', () => {
    const l = new Ledger();
    l.post(draft('FORFEITURE', '2024-12-31', '2024-12-31', -3840, { codes: 'CARRYOVER_FORFEITURE', ref: '2024-12-31' }));
    l.post(draft('FORFEITURE', '2024-12-31', '2025-01-08', -960, { codes: 'CARRYOVER_RECOMPUTED', ref: 'R1' }));
    expect(l.forfeitedAt('X', 'PTO', d('2024-12-31'))).toBe(4800);
    expect(l.forfeitedAt('X', 'PTO', d('2025-12-31'))).toBe(0);
  });
});

describe('property: balance(asOf) is independent of posting order', () => {
  // A small deterministic LCG so the test is reproducible with no clock or Math.random.
  let seed = 20261025;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const days: CalendarDay[] = ['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30', '2024-05-31', '2024-06-30'].map(d);
  it('holds for 50 shuffles of 30 entries', () => {
    const base: EntryDraft[] = [];
    for (let i = 0; i < 30; i++) {
      const kind = (['ACCRUAL', 'USAGE', 'ADJUSTMENT', 'FORFEITURE'] as const)[i % 4]!;
      const eff = days[Math.min(days.length - 1, (i * 7) % days.length)]!;
      base.push(draft(kind, eff, eff, (kind === 'ACCRUAL' ? 1 : -1) * ((i * 37) % 600)));
    }
    const reference = new Ledger();
    for (const e of base) reference.post(e);
    const asOfs = [...days, d('2023-12-31'), d('2025-12-31')];
    const want = asOfs.map((a) => reference.balance('X', 'PTO', a));
    for (let s = 0; s < 50; s++) {
      const shuffled = [...base];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.min(i, (rnd() * (i + 1)) | 0);
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      const l = new Ledger();
      for (const e of shuffled) l.post(e);
      expect(asOfs.map((a) => l.balance('X', 'PTO', a))).toEqual(want);
      expect(l.available('X', 'PTO')).toBe(reference.available('X', 'PTO'));
    }
  });
});
