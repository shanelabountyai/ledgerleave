// Phase 2 (D-38): the simulation serves two callers. The fixture replay orders a day's events by (request id, seq),
// as the oracle does; the live write path appends events in arrival order and must not re-order the ones already
// posted. Both are the same engine: an optional `ordinal` on an event wins the within-day sort when present, and
// `openAsOfDay` leaves the as-of day's class-2 boundaries unposted so a later event that day still lands before
// them. The per-event observer is what the replay stores as RequestEvent rows.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calendarDay as d } from '@/accrual/calendar';
import { loadPolicyFile } from '@/accrual/policy';
import { type Assignment, Simulation, type World } from '@/accrual/simulate';
import { type Employee, Org } from '@/routing/org';
import { type Request, type RequestEvent } from '@/routing/requests';

const PF = loadPolicyFile(readFileSync(new URL('../../../fixtures/policies.json', import.meta.url), 'utf8'));
const HOLIDAYS = new Set(readFileSync(new URL('../../../fixtures/holidays.csv', import.meta.url), 'utf8').trim().split('\n').slice(1));

const emp = (id: string, managerId = ''): Employee => ({ id, name: id, title: 'T', dept: 'D', managerId, employmentType: 'SALARIED', roles: '', hireDate: '2015-01-05', termDate: '' });
const asg = (employeeId: string): Assignment => ({ employeeId, leaveType: 'PTO', policyId: 'PTO_SALARIED', start: d('2015-01-05'), end: null });
const req = (id: string, start: string, end: string): Request => ({ id, employeeId: 'X', leaveType: 'PTO', start, end, submittedOn: '2024-12-02' });

function world(events: RequestEvent[], asOf = '2024-12-31'): World {
  return {
    policyFile: PF, org: new Org([emp('X', 'M'), emp('M')], []), assignments: [asg('X'), asg('M')], holidays: HOLIDAYS, timesheets: new Map(), delegations: [],
    requests: [req('R-0001', '2024-12-16', '2024-12-16'), req('R-0002', '2024-12-17', '2024-12-17')], events,
    opening: [{ employeeId: 'X', leaveType: 'PTO', minutes: 7000 }], ledgerStart: d('2024-01-01'), asOf: d(asOf),
  };
}
const submits: RequestEvent[] = [
  { requestId: 'R-0001', seq: 1, on: '2024-12-02', actor: 'X', action: 'SUBMIT', target: '' },
  { requestId: 'R-0002', seq: 1, on: '2024-12-02', actor: 'X', action: 'SUBMIT', target: '' },
];
const usageRefs = (s: ReturnType<Simulation['run']>) => s.ledger.entries.filter((e) => e.kind === 'USAGE').map((e) => e.ref);

describe('within-day event order (D-38)', () => {
  it('without ordinals a day sorts by (request id, seq), as the oracle does', () => {
    const s = new Simulation(world([...submits,
      { requestId: 'R-0002', seq: 2, on: '2024-12-03', actor: 'M', action: 'APPROVE', target: '' },
      { requestId: 'R-0001', seq: 2, on: '2024-12-03', actor: 'M', action: 'APPROVE', target: '' },
    ])).run();
    expect(usageRefs(s)).toEqual(['R-0001', 'R-0002']);
  });
  it('with ordinals the arrival order wins, whatever the request ids say', () => {
    const s = new Simulation(world([...submits.map((e, i) => ({ ...e, ordinal: i + 1 })),
      { requestId: 'R-0002', seq: 2, on: '2024-12-03', actor: 'M', action: 'APPROVE', target: '', ordinal: 1 },
      { requestId: 'R-0001', seq: 2, on: '2024-12-03', actor: 'M', action: 'APPROVE', target: '', ordinal: 2 },
    ])).run();
    expect(usageRefs(s)).toEqual(['R-0002', 'R-0001']);
  });
});

describe('openAsOfDay (D-38)', () => {
  const approveBoth: RequestEvent[] = [...submits,
    { requestId: 'R-0001', seq: 2, on: '2024-12-31', actor: 'M', action: 'APPROVE', target: '' },
    { requestId: 'R-0002', seq: 2, on: '2024-12-31', actor: 'M', action: 'APPROVE', target: '' },
  ];
  it('closed: the Dec 31 boundary forfeits after the day\'s approvals', () => {
    const s = new Simulation(world(approveBoth)).run();
    expect(s.ledger.forfeitedAt('X', 'PTO', d('2024-12-31'))).toBeGreaterThan(0);
    expect(s.ledger.balance('X', 'PTO', d('2024-12-31'))).toBe(2400); // at the carryover cap once the day closes
  });
  it('open: class 0 and class 1 of the as-of day post, class 2 waits for the day to close', () => {
    const s = new Simulation(world(approveBoth)).run({ openAsOfDay: true });
    expect(s.ledger.forfeitedAt('X', 'PTO', d('2024-12-31'))).toBe(0);
    expect(s.ledger.entries.some((e) => e.kind === 'ACCRUAL' && e.effective === '2024-12-31')).toBe(true); // class 0 of the day
    expect(usageRefs(s)).toEqual(['R-0001', 'R-0002']); // class 1 of the day
    // the prefix property the replay relies on: the closed run is the open run plus the day's boundaries
    const closed = new Simulation(world(approveBoth)).run();
    expect(closed.ledger.entries.slice(0, s.ledger.entries.length)).toEqual(s.ledger.entries);
    const tail = closed.ledger.entries.slice(s.ledger.entries.length);
    expect(tail.map((e) => [e.kind, e.effective as string])).toEqual([['FORFEITURE', '2024-12-31'], ['FORFEITURE', '2024-12-31']]); // X and M
  });
});

describe('observer', () => {
  it('sees every event with the lines it appended and the state after it', () => {
    const seen: { id: string; seq: number; lines: string[]; state: string; voided: boolean }[] = [];
    new Simulation(world([...submits, { requestId: 'R-0001', seq: 2, on: '2024-12-03', actor: 'X', action: 'APPROVE', target: '' }]), {
      afterEvent: (ev, rs, fx, lines) => seen.push({ id: ev.requestId, seq: ev.seq, lines: [...lines], state: rs.state, voided: fx.kind === 'none' && fx.voided === true }),
    }).run();
    expect(seen).toEqual([
      { id: 'R-0001', seq: 1, lines: ['SUBMIT:X:2024-12-02:CHAIN_FROZEN'], state: 'PENDING', voided: false },
      { id: 'R-0002', seq: 1, lines: ['SUBMIT:X:2024-12-02:CHAIN_FROZEN'], state: 'PENDING', voided: false },
      { id: 'R-0001', seq: 2, lines: ['VOID_APPROVE:X:2024-12-03:APPROVER_NOT_STEP_APPROVER'], state: 'PENDING', voided: true },
    ]);
  });
});
