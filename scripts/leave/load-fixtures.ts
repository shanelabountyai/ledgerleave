// Reads a fixtures directory (the inputs build_fixtures.py writes) into a World for the simulation. Product code
// never reads ledger.csv or expected_*.csv (CLAUDE.md non-negotiable 7); this loader reads only the inputs and
// MANIFEST.json (for ledger_start / as-of). Mirrors tools/build_fixtures.py `load_world`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calendarDay } from '../../src/accrual/calendar';
import { loadPolicyFile } from '../../src/accrual/policy';
import { type Assignment, type World, timesheetKey } from '../../src/accrual/simulate';
import { type Employee, ORG_CHANGE_FIELDS, Org, type OrgChange, type OrgChangeField } from '../../src/routing/org';
import { ACTIONS, type Action, type Request, type RequestEvent } from '../../src/routing/requests';
import { parseCsv } from './csv';

export const INPUT_FILES = [
  'policies.json', 'employees.csv', 'assignments.csv', 'holidays.csv', 'timesheets.csv', 'delegations.csv',
  'org_changes.csv', 'opening_balances.csv', 'requests.csv', 'request_events.csv', 'MANIFEST.json',
] as const;

export interface LoadedWorld {
  readonly world: World;
  readonly manifest: { seed: number; ledger_start: string; asof: string; sha256: Record<string, string> };
}

function int(v: string, what: string): number {
  if (!/^-?\d+$/.test(v)) throw new Error(`${what}: expected an integer, got ${JSON.stringify(v)}`);
  return Number(v);
}

function oneOf<T extends string>(v: string, allowed: readonly T[], what: string): T {
  if (!(allowed as readonly string[]).includes(v)) throw new Error(`${what}: expected one of ${allowed.join('|')}, got ${JSON.stringify(v)}`);
  return v as T;
}

export function loadWorld(dir: string): LoadedWorld {
  const read = (name: string) => readFileSync(join(dir, name), 'utf8');
  const rows = (name: string) => parseCsv(read(name));

  const manifest = JSON.parse(read('MANIFEST.json')) as LoadedWorld['manifest'];
  const policyFile = loadPolicyFile(read('policies.json'));

  const employees: Employee[] = rows('employees.csv').map((r) => ({
    id: r.employee_id!, name: r.name!, title: r.title!, dept: r.dept!, managerId: r.manager_id!, employmentType: r.employment_type!,
    roles: r.roles!, hireDate: calendarDay(r.hire_date!), termDate: r.term_date === '' ? '' : calendarDay(r.term_date!),
  }));
  const changes: OrgChange[] = rows('org_changes.csv').map((r) => ({
    effective: calendarDay(r.effective!), employeeId: r.employee_id!, field: oneOf<OrgChangeField>(r.field!, ORG_CHANGE_FIELDS, 'org_changes.field'), old: r.old!, new: r.new!,
  }));
  const assignments: Assignment[] = rows('assignments.csv').map((r) => ({
    employeeId: r.employee_id!, leaveType: r.leave_type!, policyId: r.policy_id!, start: calendarDay(r.start!), end: r.end === '' ? null : calendarDay(r.end!),
  }));
  const holidays = new Set(rows('holidays.csv').map((r) => calendarDay(r.date!) as string));
  const timesheets = new Map<string, number>();
  for (const r of rows('timesheets.csv')) timesheets.set(timesheetKey(r.employee_id!, calendarDay(r.period_end!)), int(r.minutes_worked!, 'timesheets.minutes_worked'));
  const delegations = rows('delegations.csv').map((r) => ({ approverId: r.approver_id!, delegateId: r.delegate_id!, start: calendarDay(r.start!) as string, end: calendarDay(r.end!) as string }));
  const requests: Request[] = rows('requests.csv').map((r) => ({
    id: r.request_id!, employeeId: r.employee_id!, leaveType: r.leave_type!, start: calendarDay(r.start!), end: calendarDay(r.end!), submittedOn: calendarDay(r.submitted_on!),
  }));
  const events: RequestEvent[] = rows('request_events.csv').map((r) => ({
    requestId: r.request_id!, seq: int(r.seq!, 'request_events.seq'), on: calendarDay(r.on!), actor: r.actor!, action: oneOf<Action>(r.action!, ACTIONS, 'request_events.action'), target: r.target!,
  }));
  const opening = rows('opening_balances.csv').map((r) => ({ employeeId: r.employee_id!, leaveType: r.leave_type!, minutes: int(r.minutes!, 'opening_balances.minutes') }));

  const world: World = {
    policyFile,
    org: new Org(employees, changes),
    assignments,
    holidays,
    timesheets,
    delegations,
    requests,
    events,
    opening,
    ledgerStart: calendarDay(manifest.ledger_start),
    asOf: calendarDay(manifest.asof),
  };
  return { world, manifest };
}
