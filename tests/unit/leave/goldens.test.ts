// Task 1.9 (and the acceptance of 1.5–1.7): GA-01..GA-20 and GR-15 exactly as tools/golden_answers.py states them,
// run through the TypeScript simulation. Every expected value is copied from the brief / golden_answers.py; none
// was edited to pass (CLAUDE.md non-negotiable 8).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calendarDay as d, payPeriodEnds } from '@/accrual/calendar';
import { loadPolicyFile, parsePolicy, type Policy, type PolicyFile } from '@/accrual/policy';
import { type Assignment, type OpeningBalance, Simulation, type World, employeeYearRows, timesheetKey } from '@/accrual/simulate';
import { type Delegation, type Employee, Org, type OrgChange } from '@/routing/org';
import { type Request, type RequestEvent, finalStateLabel } from '@/routing/requests';

const base = loadPolicyFile(readFileSync(new URL('../../../fixtures/policies.json', import.meta.url), 'utf8'));
const HOLIDAYS = new Set(
  readFileSync(new URL('../../../fixtures/holidays.csv', import.meta.url), 'utf8').trim().split('\n').slice(1),
);
const policies = new Map<string, Policy>(base.policies);
policies.set('HAND_HALF_UP', parsePolicy({
  id: 'HAND_HALF_UP', leave_type: 'PTO',
  accrual: { frequency: 'MONTHLY', proration: 'DAILY', rounding: 'HALF_UP', tiers: [{ min_tenure_months: 0, minutes_per_period: 605 }] },
  year: { type: 'CALENDAR' }, carryover_cap_minutes: 2400, max_balance_minutes: 12000, allow_negative: false,
}));
policies.set('HAND_ANNUAL_GRANT', parsePolicy({
  id: 'HAND_ANNUAL_GRANT', leave_type: 'PTO',
  accrual: { frequency: 'ANNIVERSARY', proration: 'NONE', rounding: 'HALF_UP', tiers: [{ min_tenure_months: 0, minutes_per_period: 4800 }] },
  year: { type: 'CALENDAR' }, carryover_cap_minutes: 4800, max_balance_minutes: 12000, allow_negative: false,
}));
const PF: PolicyFile = { ...base, policies };

const emp = (id: string, hire: string, managerId = '', term = '', roles = '', et = 'SALARIED'): Employee => ({
  id, name: id, title: 'T', dept: 'D', managerId, employmentType: et, roles, hireDate: hire, termDate: term,
});
const asg = (employeeId: string, leaveType: string, policyId: string, start: string, end = ''): Assignment => ({
  employeeId, leaveType, policyId, start: d(start), end: end ? d(end) : null,
});
const req = (id: string, employeeId: string, leaveType: string, start: string, end: string, submittedOn: string): Request => ({ id, employeeId, leaveType, start, end, submittedOn });
const ev = (requestId: string, seq: number, on: string, actor: string, action: RequestEvent['action'], target = ''): RequestEvent => ({ requestId, seq, on, actor, action, target });

interface WorldOpts {
  opening?: OpeningBalance[];
  requests?: Request[];
  events?: RequestEvent[];
  delegations?: Delegation[];
  changes?: OrgChange[];
  timesheets?: Map<string, number>;
  asOf?: string;
}

function world(employees: Employee[], assignments: Assignment[], o: WorldOpts = {}): World {
  return {
    policyFile: PF,
    org: new Org(employees, o.changes ?? []),
    assignments,
    holidays: HOLIDAYS,
    timesheets: o.timesheets ?? new Map(),
    delegations: o.delegations ?? [],
    requests: o.requests ?? [],
    events: o.events ?? [],
    opening: o.opening ?? [],
    ledgerStart: d('2024-01-01'),
    asOf: d(o.asOf ?? '2025-12-31'),
  };
}

const run = (w: World) => new Simulation(w).run();

/** One employee on one policy from hire. */
function one(eid: string, hire: string, policy: string, opts: { lt?: string; end?: string; opening?: number; term?: string } = {}) {
  const lt = opts.lt ?? 'PTO';
  const e = [emp(eid, hire, '', opts.term ?? '')];
  const a = [asg(eid, lt, policy, hire, opts.end ?? opts.term ?? '')];
  const o: OpeningBalance[] = opts.opening ? [{ employeeId: eid, leaveType: lt, minutes: opts.opening }] : [];
  return { e, a, o };
}

function flatTimesheets(eid: string, lo: string, hi: string, minutes: number): Map<string, number> {
  const m = new Map<string, number>();
  for (const pe of payPeriodEnds(d('2024-01-01'), 14, d(lo), d(hi))) m.set(timesheetKey(eid, pe), minutes);
  return m;
}

const bal = (s: ReturnType<typeof run>, eid: string, lt: string, asOf: string) => s.ledger.balance(eid, lt, d(asOf));
const withManager = (e: Employee[]) => {
  e.push(emp('M', '2010-01-04'));
  e[0] = { ...e[0]!, managerId: 'M' };
  return e;
};

describe('accrual goldens GA-01..GA-20 (brief §8)', () => {
  it('GA-01 full month, tier 0', () => {
    const { e, a, o } = one('X', '2024-01-01', 'PTO_SALARIED');
    const s = run(world(e, a, { opening: o }));
    expect([bal(s, 'X', 'PTO', '2024-01-30'), bal(s, 'X', 'PTO', '2024-01-31')]).toEqual([0, 600]);
  });
  it('GA-02 mid-month hire 290 then 890', () => {
    const { e, a, o } = one('X', '2024-03-17', 'PTO_SALARIED');
    const s = run(world(e, a, { opening: o }));
    expect([bal(s, 'X', 'PTO', '2024-03-31'), bal(s, 'X', 'PTO', '2024-04-30')]).toEqual([290, 890]);
  });
  it('GA-03 leap-month hire 310', () => {
    const { e, a, o } = one('X', '2024-02-15', 'PTO_SALARIED');
    expect(bal(run(world(e, a, { opening: o })), 'X', 'PTO', '2024-02-29')).toBe(310);
  });
  it('GA-04 HALF_UP on exactly .5 → 61', () => {
    const { e, a, o } = one('X', '2024-04-28', 'HAND_HALF_UP');
    expect(bal(run(world(e, a, { opening: o })), 'X', 'PTO', '2024-04-30')).toBe(61);
  });
  it('GA-05 tier crossing at 24 months: Jul 600, Aug 720; balance 4920', () => {
    const { e, a, o } = one('X', '2022-08-20', 'PTO_SALARIED');
    const s = run(world(e, a, { opening: o }));
    const rows = s.ledger.rows('X', 'PTO');
    const jul = rows.find((x) => x.effective === '2024-07-31')!.minutes;
    const aug = rows.find((x) => x.effective === '2024-08-31')!.minutes;
    expect([jul, aug, bal(s, 'X', 'PTO', '2024-08-31')]).toEqual([600, 720, 4920]);
  });
  it('GA-06 carryover after the Dec accrual: 6600, 2400, forfeited 4800', () => {
    const { e, a, o } = one('X', '2024-01-01', 'PTO_SALARIED');
    const s = run(world(e, a, { opening: o }));
    expect([bal(s, 'X', 'PTO', '2024-12-30'), bal(s, 'X', 'PTO', '2024-12-31'), s.ledger.forfeitedAt('X', 'PTO', d('2024-12-31'))]).toEqual([6600, 2400, 4800]);
  });
  it('GA-07 max-balance cap 12000 reopened by usage', () => {
    const { e, a, o } = one('X', '2015-01-05', 'PTO_SALARIED', { opening: 11600 });
    withManager(e);
    const s = run(world(e, a, {
      opening: o,
      requests: [req('R1', 'X', 'PTO', '2024-03-04', '2024-03-05', '2024-02-19')],
      events: [ev('R1', 1, '2024-02-19', 'X', 'SUBMIT'), ev('R1', 2, '2024-02-20', 'M', 'APPROVE')],
    }));
    const acc = new Map(s.ledger.rows('X', 'PTO').filter((x) => x.kind === 'ACCRUAL').map((x) => [x.effective as string, [x.minutes, x.cappedMinutes]]));
    expect([acc.get('2024-01-31'), acc.get('2024-02-29'), acc.get('2024-03-31'), acc.get('2024-04-30'), bal(s, 'X', 'PTO', '2024-04-30')]).toEqual([
      [400, 440], [0, 840], [840, 0], [120, 720], 12000,
    ]);
  });
  it('GA-08 usage per working day; Jul 4 and the weekend skipped', () => {
    const { e, a, o } = one('X', '2024-01-01', 'PTO_SALARIED');
    withManager(e);
    const s = run(world(e, a, {
      opening: o,
      requests: [req('R1', 'X', 'PTO', '2024-07-03', '2024-07-08', '2024-06-17')],
      events: [ev('R1', 1, '2024-06-17', 'X', 'SUBMIT'), ev('R1', 2, '2024-06-18', 'M', 'APPROVE')],
    }));
    expect(s.ledger.rows('X', 'PTO').filter((x) => x.kind === 'USAGE').map((x) => [x.effective, x.minutes])).toEqual([
      ['2024-07-03', -480], ['2024-07-05', -480], ['2024-07-08', -480],
    ]);
  });
  it('GA-09 request spanning Dec 31', () => {
    const { e, a, o } = one('X', '2024-01-01', 'PTO_SALARIED');
    withManager(e);
    const s = run(world(e, a, {
      opening: o,
      requests: [req('R1', 'X', 'PTO', '2024-12-30', '2025-01-03', '2024-12-02')],
      events: [ev('R1', 1, '2024-12-02', 'X', 'SUBMIT'), ev('R1', 2, '2024-12-03', 'M', 'APPROVE')],
    }));
    const rows = new Map(employeeYearRows(s.ledger.entries, ['X'], [2024, 2025]).map((r) => [r.year, r]));
    expect([rows.get(2024)!.used, rows.get(2024)!.forfeited, rows.get(2025)!.used, bal(s, 'X', 'PTO', '2025-01-31')]).toEqual([960, 3840, 960, 2040]);
  });
  it('GA-10 cancelled after year end: reversal lands in 2024, forfeiture recomputed 3840 → 4800', () => {
    const { e, a, o } = one('X', '2024-01-01', 'PTO_SALARIED');
    withManager(e);
    const s = run(world(e, a, {
      opening: o,
      requests: [req('R1', 'X', 'PTO', '2024-12-16', '2024-12-17', '2024-12-02')],
      events: [ev('R1', 1, '2024-12-02', 'X', 'SUBMIT'), ev('R1', 2, '2024-12-03', 'M', 'APPROVE'), ev('R1', 3, '2025-01-08', 'X', 'CANCEL')],
    }));
    const rows = new Map(employeeYearRows(s.ledger.entries, ['X'], [2024, 2025]).map((r) => [r.year, r]));
    const forf = s.ledger.rows('X', 'PTO').filter((x) => x.kind === 'FORFEITURE' && x.effective < '2025').map((x) => [x.effective, x.minutes, x.codes]);
    expect([rows.get(2024)!.used, rows.get(2024)!.forfeited, bal(s, 'X', 'PTO', '2025-01-08'), forf]).toEqual([
      0, 4800, 2400, [['2024-12-31', -3840, 'CARRYOVER_FORFEITURE'], ['2024-12-31', -960, 'CARRYOVER_RECOMPUTED']],
    ]);
    expect(s.recomputed).toBe(1);
  });
  it('GA-11 hourly FLOOR 159, 160', () => {
    const { e, a, o } = one('X', '2024-01-01', 'PTO_HOURLY');
    const ts = new Map([[timesheetKey('X', '2024-01-14'), 4790], [timesheetKey('X', '2024-01-28'), 4800]]);
    const s = run(world(e, a, { opening: o, timesheets: ts, asOf: '2024-01-31' }));
    expect(s.ledger.rows('X', 'PTO').map((x) => x.minutes)).toEqual([159, 160]);
  });
  it('GA-12 leap-day hire: 4160, forfeit 1760 at the clamped 2025-02-28, then 2560', () => {
    const { e, a, o } = one('X', '2024-02-29', 'PTO_HOURLY');
    const s = run(world(e, a, { opening: o, timesheets: flatTimesheets('X', '2024-02-29', '2025-03-09', 4800), asOf: '2025-03-09' }));
    expect([bal(s, 'X', 'PTO', '2025-02-27'), s.ledger.forfeitedAt('X', 'PTO', d('2025-02-28')), bal(s, 'X', 'PTO', '2025-03-09')]).toEqual([4160, 1760, 2560]);
  });
  it('GA-13 sick, NONE proration: full 120 four days after hire', () => {
    const { e, a, o } = one('X', '2024-03-20', 'SICK_STD', { lt: 'SICK' });
    expect(bal(run(world(e, a, { opening: o, asOf: '2024-03-31' })), 'X', 'SICK', '2024-03-24')).toBe(120);
  });
  it('GA-14 sick max 2880 then Jun 30 cap 2400: accrued 180, 2400, forfeit 480, 2520', () => {
    const { e, a, o } = one('X', '2022-01-03', 'SICK_STD', { lt: 'SICK', opening: 2700 });
    const s = run(world(e, a, { opening: o, asOf: '2024-07-14' }));
    const acc = s.ledger.rows('X', 'SICK').filter((x) => x.kind === 'ACCRUAL' && x.effective <= '2024-06-30').reduce((t, x) => t + x.minutes, 0);
    expect([acc, bal(s, 'X', 'SICK', '2024-06-30'), s.ledger.forfeitedAt('X', 'SICK', d('2024-06-30')), bal(s, 'X', 'SICK', '2024-07-14')]).toEqual([180, 2400, 480, 2520]);
  });
  it('GA-15 allow_negative=false: DENIED INSUFFICIENT_BALANCE, no usage, 600', () => {
    const { e, a, o } = one('X', '2024-03-01', 'PTO_SALARIED');
    withManager(e);
    const s = run(world(e, a, {
      opening: o,
      requests: [req('R1', 'X', 'PTO', '2024-03-18', '2024-03-22', '2024-03-04')],
      events: [ev('R1', 1, '2024-03-04', 'X', 'SUBMIT'), ev('R1', 2, '2024-03-05', 'M', 'APPROVE')],
      asOf: '2024-03-31',
    }));
    const r1 = s.requests.get('R1')!;
    expect([r1.state, r1.finalCode, bal(s, 'X', 'PTO', '2024-03-31')]).toEqual(['DENIED', 'INSUFFICIENT_BALANCE', 600]);
    expect(s.ignored).toBe(1); // the approval of a denied request is IGNORED_TERMINAL
    expect(r1.log).toEqual(['SUBMIT:X:2024-03-04:CHAIN_FROZEN', 'SYSTEM_DENY:SYSTEM:2024-03-04:INSUFFICIENT_BALANCE', 'APPROVE:M:2024-03-05:IGNORED_TERMINAL']);
  });
  it('GA-16 allow_negative=true: −960 then −840', () => {
    const { e, a, o } = one('X', '2024-03-01', 'SICK_STD', { lt: 'SICK' });
    withManager(e);
    const s = run(world(e, a, {
      opening: o,
      requests: [req('R1', 'X', 'SICK', '2024-03-05', '2024-03-06', '2024-03-05')],
      events: [ev('R1', 1, '2024-03-05', 'X', 'SUBMIT'), ev('R1', 2, '2024-03-06', 'M', 'APPROVE')],
      asOf: '2024-03-31',
    }));
    expect([s.requests.get('R1')!.state, bal(s, 'X', 'SICK', '2024-03-06'), bal(s, 'X', 'SICK', '2024-03-10')]).toEqual(['APPROVED', -960, -840]);
  });
  it('GA-17 balance 2400 vs available 1440; 1920 asked → DENIED', () => {
    const { e, a, o } = one('X', '2024-01-01', 'PTO_SALARIED');
    withManager(e);
    const s = run(world(e, a, {
      opening: o,
      requests: [req('R1', 'X', 'PTO', '2024-06-10', '2024-06-11', '2024-05-06'), req('R2', 'X', 'PTO', '2024-06-17', '2024-06-20', '2024-05-15')],
      events: [ev('R1', 1, '2024-05-06', 'X', 'SUBMIT'), ev('R1', 2, '2024-05-10', 'M', 'APPROVE'), ev('R2', 1, '2024-05-15', 'X', 'SUBMIT')],
      asOf: '2024-05-15',
    }));
    expect([bal(s, 'X', 'PTO', '2024-05-15'), s.ledger.available('X', 'PTO'), s.requests.get('R2')!.finalCode]).toEqual([2400, 1440, 'INSUFFICIENT_BALANCE']);
  });
  it('GA-18 hourly → salaried on 2025-06-30', () => {
    const e = [emp('X', '2024-01-01', '', '', '', 'HOURLY')];
    const a = [asg('X', 'PTO', 'PTO_HOURLY', '2024-01-01', '2025-06-29'), asg('X', 'PTO', 'PTO_SALARIED', '2025-06-30')];
    const s = run(world(e, a, { timesheets: flatTimesheets('X', '2024-01-01', '2025-06-29', 4800), asOf: '2025-07-31' }));
    const tr = s.ledger.rows('X', 'PTO').filter((x) => x.kind.startsWith('TRANSFER')).map((x) => [x.kind, x.policyId, x.minutes]);
    const jun = s.ledger.rows('X', 'PTO').find((x) => x.effective === '2025-06-30' && x.kind === 'ACCRUAL')!;
    expect([bal(s, 'X', 'PTO', '2025-06-29'), tr, [jun.minutes, jun.codes], bal(s, 'X', 'PTO', '2025-07-31')]).toEqual([
      4480, [['TRANSFER_OUT', 'PTO_HOURLY', -4480], ['TRANSFER_IN', 'PTO_SALARIED', 4480]], [20, 'ACCRUAL_MONTHLY+PRORATED_DAILY'], 5100,
    ]);
  });
  it('GA-19 termination 05-10: 194 in May, nothing after, 5 rows', () => {
    const { e, a, o } = one('X', '2024-01-01', 'PTO_SALARIED', { term: '2024-05-10' });
    const s = run(world(e, a, { opening: o }));
    expect([bal(s, 'X', 'PTO', '2024-05-31'), bal(s, 'X', 'PTO', '2025-12-31'), s.ledger.rows('X', 'PTO').length]).toEqual([2594, 2594, 5]);
  });
  it('GA-20 ANNIVERSARY grant with a CALENDAR cap', () => {
    const { e, a, o } = one('X', '2023-05-15', 'HAND_ANNUAL_GRANT');
    const s = run(world(e, a, { opening: o }));
    expect([bal(s, 'X', 'PTO', '2024-05-14'), bal(s, 'X', 'PTO', '2024-12-31'), bal(s, 'X', 'PTO', '2025-05-15'), bal(s, 'X', 'PTO', '2025-12-31')]).toEqual([0, 4800, 9600, 4800]);
  });
});

describe('GR-15 frozen chain and eligibility at approval (brief §9)', () => {
  const H: Employee[] = [
    emp('H1', '2010-01-04'), emp('H2', '2012-01-09', 'H1'), emp('H3', '2015-01-05', 'H2'), emp('H4', '2018-01-08', 'H3'),
    emp('H5', '2019-01-07', 'H3'), emp('H6', '2013-01-07', 'H1'), emp('H7', '2016-01-04', 'H6', '', 'HR'),
    emp('H8', '2020-01-06', 'H7', '', 'HR'), emp('H9', '2014-01-06', 'H2', '2025-03-31'), emp('H10', '2021-01-04', 'H9'),
  ];
  const D = '2025-05-05';
  const assigns = H.map((h) => asg(h.id, 'PTO', 'PTO_SALARIED', h.hireDate, h.termDate));
  const s = run(world(H, assigns, {
    opening: H.map((h) => ({ employeeId: h.id, leaveType: 'PTO', minutes: 2400 })),
    requests: [req('Q1', 'H4', 'PTO', '2025-05-19', '2025-05-20', D), req('Q2', 'H4', 'PTO', '2025-06-02', '2025-06-16', D)],
    events: [
      ev('Q1', 1, D, 'H4', 'SUBMIT'), ev('Q1', 2, '2025-05-08', 'H2', 'APPROVE'), ev('Q1', 3, '2025-05-09', 'H3', 'APPROVE'),
      ev('Q2', 1, D, 'H4', 'SUBMIT'), ev('Q2', 2, '2025-05-06', 'H3', 'APPROVE'), ev('Q2', 3, '2025-05-07', 'H2', 'APPROVE'),
      ev('Q2', 4, '2025-05-08', 'H7', 'APPROVE'), ev('Q2', 5, '2025-05-09', 'H8', 'REASSIGN', 'H8'), ev('Q2', 6, '2025-05-12', 'H8', 'APPROVE'),
    ],
    changes: [
      { effective: '2025-05-07', employeeId: 'H4', field: 'MANAGER', old: 'H3', new: 'H2' },
      { effective: '2025-05-06', employeeId: 'H7', field: 'ROLE_REVOKED', old: 'HR', new: 'HR' },
    ],
  }));
  const q1 = s.requests.get('Q1')!;
  const q2 = s.requests.get('Q2')!;
  it('Q1: the new manager’s approval is void; the frozen approver approves', () => {
    expect(q1.chain).toBe('MANAGER:H3[MANAGER_OF_REQUESTER]');
    expect(q1.log).toEqual(['SUBMIT:H4:2025-05-05:CHAIN_FROZEN', 'VOID_APPROVE:H2:2025-05-08:APPROVER_NOT_STEP_APPROVER', 'APPROVE:H3:2025-05-09:MANAGER']);
    expect(q1.state).toBe('APPROVED');
  });
  it('Q2: revoked HR role → void; HR reassigns; approved', () => {
    expect(q2.chain).toBe('MANAGER:H3[MANAGER_OF_REQUESTER]|SKIP_LEVEL:H2[MANAGER_OF_MANAGER]|HR:H7[HR_ROLE_HOLDER]');
    expect(q2.log.slice(3)).toEqual(['VOID_APPROVE:H7:2025-05-08:APPROVER_INELIGIBLE_ROLE_REVOKED', 'REASSIGN:H8:2025-05-09:STEP_REASSIGNED->H8', 'APPROVE:H8:2025-05-12:HR']);
    expect(q2.state).toBe('APPROVED');
    expect(s.voided).toBe(2);
  });
});

describe('GR-17 OVERLAPPING_REQUEST (D-45, brief §9)', () => {
  const H: Employee[] = [
    emp('H1', '2010-01-04'), emp('H2', '2012-01-09', 'H1'), emp('H3', '2015-01-05', 'H2'), emp('H4', '2018-01-08', 'H3'),
    emp('H5', '2019-01-07', 'H3'), emp('H6', '2013-01-07', 'H1'), emp('H7', '2016-01-04', 'H6', '', 'HR'),
    emp('H8', '2020-01-06', 'H7', '', 'HR'), emp('H9', '2014-01-06', 'H2', '2025-03-31'), emp('H10', '2021-01-04', 'H9'),
  ];
  const D = '2025-05-05';
  const assigns = [...H.map((h) => asg(h.id, 'PTO', 'PTO_SALARIED', h.hireDate, h.termDate)), asg('H4', 'SICK', 'SICK_STD', '2018-01-08')];
  const s = run(world(H, assigns, {
    opening: H.map((h) => ({ employeeId: h.id, leaveType: 'PTO', minutes: 2400 })),
    requests: [
      req('P1', 'H4', 'PTO', '2025-05-19', '2025-05-20', D), req('P2', 'H4', 'SICK', '2025-05-20', '2025-05-21', '2025-05-07'),
      req('P3', 'H4', 'PTO', '2025-05-21', '2025-05-22', '2025-05-07'), req('P4', 'H4', 'PTO', '2025-05-19', '2025-05-19', '2025-05-09'),
      req('P5', 'H4', 'PTO', '2025-05-22', '2025-05-22', '2025-05-09'),
    ],
    events: [
      ev('P1', 1, D, 'H4', 'SUBMIT'), ev('P1', 2, '2025-05-06', 'H3', 'APPROVE'), ev('P2', 1, '2025-05-07', 'H4', 'SUBMIT'),
      ev('P3', 1, '2025-05-07', 'H4', 'SUBMIT'), ev('P1', 3, '2025-05-08', 'H4', 'CANCEL'),
      ev('P4', 1, '2025-05-09', 'H4', 'SUBMIT'), ev('P5', 1, '2025-05-09', 'H4', 'SUBMIT'),
    ],
    asOf: '2025-05-09',
  }));
  const p = (id: string) => s.requests.get(id)!;
  it('overlapping an APPROVED request of another leave type → system denial, chain still shown', () => {
    expect([finalStateLabel(p('P2')), p('P2').finalCode, p('P2').chain]).toEqual(['DENIED', 'OVERLAPPING_REQUEST', 'MANAGER:H3[MANAGER_OF_REQUESTER]']);
    expect(p('P2').log).toEqual(['SUBMIT:H4:2025-05-07:CHAIN_FROZEN', 'SYSTEM_DENY:SYSTEM:2025-05-07:OVERLAPPING_REQUEST']);
  });
  it('adjacent days do not overlap, and denied or cancelled requests do not block', () => {
    expect([finalStateLabel(p('P3')), finalStateLabel(p('P4'))]).toEqual(['PENDING_1', 'PENDING_1']);
  });
  it('overlapping a PENDING request → system denial', () => {
    expect([finalStateLabel(p('P5')), p('P5').finalCode]).toEqual(['DENIED', 'OVERLAPPING_REQUEST']);
  });
});

describe('codes the fixtures never reach (brief §11): void and ignored paths', () => {
  const H = [emp('H1', '2010-01-04'), emp('H3', '2015-01-05', 'H1'), emp('H4', '2018-01-08', 'H3'), emp('H5', '2019-01-07', 'H3'), emp('H7', '2016-01-04', 'H1', '', 'HR')];
  const assigns = H.map((h) => asg(h.id, 'PTO', 'PTO_SALARIED', h.hireDate));
  const opening = H.map((h) => ({ employeeId: h.id, leaveType: 'PTO', minutes: 4800 }));
  const D = '2025-05-05';
  it('CANCEL_NOT_REQUESTER_OR_HR and REASSIGN_NOT_HR are void; a second SUBMIT and an event on a denied request are ignored', () => {
    const s = run(world(H, assigns, {
      opening,
      requests: [req('Q1', 'H4', 'PTO', '2025-05-19', '2025-05-20', D), req('Q2', 'H4', 'PTO', '2025-06-02', '2025-06-03', D)],
      events: [
        ev('Q1', 1, D, 'H4', 'SUBMIT'), ev('Q1', 2, D, 'H4', 'SUBMIT'), ev('Q1', 3, '2025-05-06', 'H5', 'CANCEL'), ev('Q1', 4, '2025-05-06', 'H5', 'REASSIGN', 'H5'),
        ev('Q1', 5, '2025-05-07', 'H3', 'DENY'), ev('Q1', 6, '2025-05-08', 'H3', 'APPROVE'),
        ev('Q2', 1, D, 'H4', 'SUBMIT'), ev('Q2', 2, '2025-05-06', 'H7', 'REASSIGN', 'H1'), ev('Q2', 3, '2025-05-07', 'H3', 'APPROVE'), ev('Q2', 4, '2025-05-08', 'H1', 'APPROVE'), ev('Q2', 5, '2025-05-09', 'H7', 'CANCEL'),
      ],
    }));
    const q1 = s.requests.get('Q1')!;
    expect(q1.log).toEqual([
      'SUBMIT:H4:2025-05-05:CHAIN_FROZEN', 'SUBMIT:H4:2025-05-05:IGNORED_NOT_DRAFT', 'VOID_CANCEL:H5:2025-05-06:CANCEL_NOT_REQUESTER_OR_HR',
      'VOID_REASSIGN:H5:2025-05-06:REASSIGN_NOT_HR', 'DENY:H3:2025-05-07:MANAGER', 'APPROVE:H3:2025-05-08:IGNORED_TERMINAL',
    ]);
    expect([q1.state, q1.finalCode]).toEqual(['DENIED', 'DENIED_BY_APPROVER']);
    const q2 = s.requests.get('Q2')!;
    expect(q2.log).toEqual([
      'SUBMIT:H4:2025-05-05:CHAIN_FROZEN', 'REASSIGN:H7:2025-05-06:STEP_REASSIGNED->H1', 'VOID_APPROVE:H3:2025-05-07:APPROVER_NOT_STEP_APPROVER',
      'APPROVE:H1:2025-05-08:MANAGER', 'CANCEL:H7:2025-05-09:CANCELLED_AFTER_APPROVAL',
    ]);
    expect([q2.state, q2.finalCode]).toEqual(['CANCELLED', 'CANCELLED_AFTER_APPROVAL']);
    expect(s.ledger.rows('H4', 'PTO').filter((x) => x.kind === 'USAGE_REVERSAL')).toHaveLength(2);
    expect([s.voided, s.ignored]).toEqual([3, 2]);
  });
  it('APPROVER_INACTIVE: the frozen approver leaves before acting', () => {
    const H2 = H.map((h) => (h.id === 'H3' ? { ...h, termDate: '2025-05-06' } : h));
    const s = run(world(H2, assigns, {
      opening,
      requests: [req('Q1', 'H4', 'PTO', '2025-05-19', '2025-05-20', D)],
      events: [ev('Q1', 1, D, 'H4', 'SUBMIT'), ev('Q1', 2, '2025-05-07', 'H3', 'APPROVE')],
    }));
    expect(s.requests.get('Q1')!.log[1]).toBe('VOID_APPROVE:H3:2025-05-07:APPROVER_INACTIVE');
  });
  it('UNROUTABLE at submit leaves the request SUBMITTED with final code UNROUTABLE', () => {
    const solo = [emp('H1', '2010-01-04')];
    const s = run(world(solo, [asg('H1', 'PTO', 'PTO_SALARIED', '2010-01-04')], {
      opening: [{ employeeId: 'H1', leaveType: 'PTO', minutes: 4800 }],
      requests: [req('Q1', 'H1', 'PTO', '2025-05-19', '2025-05-20', D)],
      events: [ev('Q1', 1, D, 'H1', 'SUBMIT')],
    }));
    const q = s.requests.get('Q1')!;
    expect([q.state, q.finalCode, q.chain]).toEqual(['SUBMITTED', 'UNROUTABLE', '~MANAGER:[MANAGER_OF_REQUESTER,CEO_MANAGER_IS_HR,UNROUTABLE]|~FALLBACK:[EMPTY_CHAIN_TO_HR,UNROUTABLE]']);
  });
});
