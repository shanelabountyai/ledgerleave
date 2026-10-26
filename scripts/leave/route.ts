// leave:route (task 1.11) — "who would approve this, and does the balance cover it?" before anything is submitted.
// Replays the fixture ledger up to the submit date, then runs the routing engine and the A8 balance check exactly
// as SUBMIT would. Prints working days, minutes, the predicted chain with reason codes and the balance check.
// Nothing is written.
//
//   npm run leave:route -- --employee E011 --start 2024-12-30 --end 2025-01-03 --submit 2024-12-02 [--type PTO|SICK] [--fixtures <dir>]
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { calendarDay, workingDays } from '../../src/accrual/calendar';
import { Simulation, type World } from '../../src/accrual/simulate';
import { type Step, chainString, route, stepRequiresHr } from '../../src/routing/route';
import { loadWorld } from './load-fixtures';

export interface RoutePrediction {
  readonly employeeId: string;
  readonly leaveType: string;
  readonly policyId: string;
  readonly start: string;
  readonly end: string;
  readonly submit: string;
  readonly workingDays: string[];
  readonly minutes: number;
  readonly steps: Step[];
  readonly chain: string;
  /** L1 as of the submit date and L2 after every event on or before it. */
  readonly balance: number;
  readonly available: number;
  readonly allowNegative: boolean;
  readonly check: 'OK' | 'INSUFFICIENT_BALANCE' | 'NEGATIVE_ALLOWED';
}

export function predictRoute(world: World, q: { employeeId: string; leaveType: string; start: string; end: string; submit: string }): RoutePrediction {
  const start = calendarDay(q.start);
  const end = calendarDay(q.end);
  const submit = calendarDay(q.submit);
  if (end < start) throw new Error(`--end ${end} is before --start ${start}`);
  if (!world.org.has(q.employeeId)) throw new Error(`unknown employee ${q.employeeId}`);
  // The ledger as it stood at the end of the submit day (D-9: that day's accruals and events included).
  const asOf = submit < world.asOf ? submit : world.asOf;
  const sim = new Simulation({ ...world, asOf }).run();
  const a = world.assignments.find((x) => x.employeeId === q.employeeId && x.leaveType === q.leaveType && x.start <= start && (x.end === null || start <= x.end));
  if (!a) throw new Error(`${q.employeeId} has no ${q.leaveType} policy assignment on ${start} (D-22: the policy is the one active on the start date)`);
  const pol = world.policyFile.policies.get(a.policyId);
  if (!pol) throw new Error(`unknown policy ${a.policyId}`);
  const wd = workingDays(start, end, world.holidays);
  const minutes = wd.length * world.policyFile.workDayMinutes;
  const steps = route({ org: world.org, policy: pol, delegations: world.delegations, requester: q.employeeId, submit, workingDays: wd.length });
  const balance = sim.ledger.balance(q.employeeId, q.leaveType, submit);
  const available = sim.ledger.available(q.employeeId, q.leaveType);
  const short = available - minutes < 0;
  return {
    employeeId: q.employeeId, leaveType: q.leaveType, policyId: pol.id, start, end, submit, workingDays: wd, minutes, steps, chain: chainString(steps),
    balance, available, allowNegative: pol.allowNegative,
    check: short ? (pol.allowNegative ? 'NEGATIVE_ALLOWED' : 'INSUFFICIENT_BALANCE') : 'OK',
  };
}

export function formatPrediction(p: RoutePrediction): string[] {
  const lines: string[] = [];
  lines.push(`${p.employeeId} ${p.leaveType} (${p.policyId}) ${p.start}..${p.end}, submit ${p.submit}`);
  lines.push(`working days: ${p.workingDays.length}${p.workingDays.length ? ` (${p.workingDays.join(', ')})` : ''}`);
  lines.push(`minutes: ${p.minutes}`);
  lines.push(`chain: ${p.chain}`);
  for (const s of p.steps) {
    lines.push(`  ${s.kept ? ' ' : '~'} ${s.stepId.padEnd(10)} ${s.approver || '(nobody)'}${stepRequiresHr(s.codes) ? ' [must hold HR when acting]' : ''}  ${s.codes.join(' → ')}`);
  }
  lines.push(`balance as of ${p.submit} (L1): ${p.balance}   available (L2): ${p.available}   requested: ${p.minutes}   allow_negative: ${p.allowNegative}`);
  lines.push(`balance check: ${p.check === 'OK' ? 'OK — would route to step 1' : p.check === 'INSUFFICIENT_BALANCE' ? 'DENIED INSUFFICIENT_BALANCE at submit (A8); the chain above is still shown' : 'would go negative; the policy allows it (A8)'}`);
  lines.push('nothing was written.');
  return lines;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? (args[i + 1] ?? '') : undefined;
  };
  const employeeId = flag('--employee');
  const start = flag('--start');
  const end = flag('--end');
  const submit = flag('--submit');
  const leaveType = flag('--type') ?? 'PTO';
  if (!employeeId || !start || !end || !submit) {
    console.log('usage: npm run leave:route -- --employee <id> --start <YYYY-MM-DD> --end <YYYY-MM-DD> --submit <YYYY-MM-DD> [--type PTO|SICK] [--fixtures <dir>]');
    process.exit(2);
  }
  const { world } = loadWorld(resolve(flag('--fixtures') ?? join(process.cwd(), 'fixtures')));
  try {
    for (const line of formatPrediction(predictRoute(world, { employeeId, leaveType, start, end, submit }))) console.log(line);
  } catch (e) {
    console.error(`leave:route: ${(e as Error).message}`);
    process.exit(1);
  }
}
