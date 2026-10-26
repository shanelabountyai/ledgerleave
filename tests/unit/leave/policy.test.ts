// Task 1.4: the three fixture policies load; invalid policies are rejected naming the field (D-15); the routing
// table and work-day constant are read and closed (plan C-1, C-2).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PolicyError, loadPolicyFile, parsePolicy } from '@/accrual/policy';

const FILE = readFileSync(new URL('../../../fixtures/policies.json', import.meta.url), 'utf8');

describe('fixtures/policies.json loads', () => {
  const pf = loadPolicyFile(FILE);
  it('has the three policies with the brief §3 values', () => {
    expect([...pf.policies.keys()]).toEqual(['PTO_SALARIED', 'PTO_HOURLY', 'SICK_STD']);
    const sal = pf.policies.get('PTO_SALARIED')!;
    expect(sal.frequency).toBe('MONTHLY');
    expect(sal.proration).toBe('DAILY');
    expect(sal.rounding).toBe('HALF_UP');
    expect(sal.yearType).toBe('CALENDAR');
    expect(sal.carryoverCapMinutes).toBe(2400);
    expect(sal.maxBalanceMinutes).toBe(12000);
    expect(sal.allowNegative).toBe(false);
    expect(sal.skipLevelOverDays).toBe(5);
    expect(sal.hrOverDays).toBe(10);
    const hourly = pf.policies.get('PTO_HOURLY')!;
    expect(hourly.frequency).toBe('PER_HOURS_WORKED');
    expect(hourly.minutesPer60Worked).toBe(2);
    expect(hourly.rounding).toBe('FLOOR');
    expect(hourly.yearType).toBe('ANNIVERSARY');
    const sick = pf.policies.get('SICK_STD')!;
    expect(sick.frequency).toBe('PER_PAY_PERIOD');
    expect(sick.yearType).toBe('POLICY_YEAR');
    expect(sick.yearStarts).toBe('07-01');
    expect(sick.allowNegative).toBe(true);
    expect(sick.skipLevelOverDays).toBeNull();
    expect(sick.hrOverDays).toBe(3);
  });
  it('reads the pay period, work day and routing table as data', () => {
    expect(pf.payPeriod).toEqual({ anchorStart: '2024-01-01', lengthDays: 14 });
    expect(pf.workDayMinutes).toBe(480);
    expect(pf.routingTable).toEqual({ steps: ['MANAGER', 'SKIP_LEVEL', 'HR'], delegationMaxDepth: 1, fallbackOrder: ['HR_PRIMARY', 'OTHER_HR', 'CEO'] });
  });
  it('A2: rate(tenureMonths) is the highest tier whose min_tenure_months ≤ tenure', () => {
    const sal = pf.policies.get('PTO_SALARIED')!;
    expect(sal.rate(0)).toBe(600);
    expect(sal.rate(23)).toBe(600);
    expect(sal.rate(24)).toBe(720);
    expect(sal.rate(59)).toBe(720);
    expect(sal.rate(60)).toBe(840);
    expect(sal.rate(200)).toBe(840);
    expect(pf.policies.get('PTO_HOURLY')!.rate(100)).toBe(0); // hourly has no tiers
  });
});

const base = () => ({
  id: 'X',
  leave_type: 'PTO',
  accrual: { frequency: 'MONTHLY', proration: 'DAILY', rounding: 'HALF_UP', tiers: [{ min_tenure_months: 0, minutes_per_period: 600 }] },
  year: { type: 'CALENDAR' },
  carryover_cap_minutes: 2400,
  max_balance_minutes: 12000,
  allow_negative: false,
  routing: { skip_level_over_days: 5, hr_over_days: 10 },
});

describe('six invalid policies are rejected with the field named (D-15)', () => {
  const reject = (mutate: (p: ReturnType<typeof base>) => void, field: string) => {
    const p = base();
    mutate(p);
    let err: unknown;
    try {
      parsePolicy(p);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PolicyError);
    expect((err as PolicyError).message).toContain(field);
  };
  it('1. unknown frequency', () => reject((p) => void (p.accrual.frequency = 'WEEKLY'), 'accrual.frequency'));
  it('2. DAILY proration with a non-MONTHLY frequency', () => reject((p) => void (p.accrual.frequency = 'PER_PAY_PERIOD'), 'accrual.proration'));
  it('3. tier list without a 0 tier first', () => reject((p) => void (p.accrual.tiers = [{ min_tenure_months: 12, minutes_per_period: 600 }]), 'accrual.tiers[0].min_tenure_months'));
  it('4. unknown rounding', () => reject((p) => void (p.accrual.rounding = 'BANKERS'), 'accrual.rounding'));
  it('5. unknown year type', () => reject((p) => void (p.year.type = 'FISCAL'), 'year.type'));
  it('6. negative cap', () => reject((p) => void (p.carryover_cap_minutes = -1), 'carryover_cap_minutes'));
  it('also: a float minute', () => reject((p) => void (p.max_balance_minutes = 12000.5), 'max_balance_minutes'));
  it('also: PER_HOURS_WORKED needs minutes_per_60_worked and no tiers', () => {
    reject((p) => {
      p.accrual.frequency = 'PER_HOURS_WORKED';
      p.accrual.proration = 'NONE';
    }, 'accrual.minutes_per_60_worked');
  });
  it('also: POLICY_YEAR needs a MM-DD starts', () => reject((p) => void (p.year = { type: 'POLICY_YEAR' }), 'year.starts'));
  it('also: a string where a boolean belongs', () => reject((p) => void ((p as { allow_negative: unknown }).allow_negative = 'no'), 'allow_negative'));
});

describe('file-level closed values (plan C-1, C-2)', () => {
  const file = () => JSON.parse(FILE) as Record<string, unknown>;
  const rejectFile = (mutate: (f: Record<string, unknown>) => void, field: string) => {
    const f = file();
    mutate(f);
    expect(() => loadPolicyFile(JSON.stringify(f))).toThrow(PolicyError);
    try {
      loadPolicyFile(JSON.stringify(f));
    } catch (e) {
      expect((e as Error).message).toContain(field);
    }
  };
  it('a work day other than 480 is refused (D-6)', () => rejectFile((f) => void (f.work_day_minutes = 420), 'work_day_minutes'));
  it('a routing step order other than MANAGER,SKIP_LEVEL,HR is refused (D-18 as the oracle runs it)', () =>
    rejectFile((f) => void ((f.routing_table as Record<string, unknown>).steps = ['HR', 'MANAGER']), 'routing_table.steps'));
  it('a delegation depth other than 1 is refused (R5)', () => rejectFile((f) => void ((f.routing_table as Record<string, unknown>).delegation_max_depth = 2), 'routing_table.delegation_max_depth'));
  it('a fallback order other than HR_PRIMARY,OTHER_HR,CEO is refused (R7)', () =>
    rejectFile((f) => void ((f.routing_table as Record<string, unknown>).fallback_order = ['CEO']), 'routing_table.fallback_order'));
  it('duplicate policy ids are refused', () =>
    rejectFile((f) => void ((f.policies as unknown[]).push((f.policies as unknown[])[0])), 'policies[3].id'));
  it('a bad pay-period anchor is refused', () => rejectFile((f) => void ((f.pay_period as Record<string, unknown>).anchor_start = '2024-02-30'), 'pay_period.anchor_start'));
});
