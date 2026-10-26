// Turns a simulation into the three expected files and the brief §10 summary, in exactly the shapes
// tools/reference_leave.py prints and writes. Shared by leave:eval, ledger:verify and leave:route.
import { type Entry } from '../../src/accrual/ledger';
import { type EmployeeYearRow, type SimulationResult, type World, employeeYearRows } from '../../src/accrual/simulate';
import { type RequestState, finalStateLabel, keptSteps } from '../../src/routing/requests';
import { writeCsv } from './csv';

export const LEDGER_COLS = ['entry_id', 'employee_id', 'leave_type', 'policy_id', 'kind', 'effective', 'posted', 'minutes', 'capped_minutes', 'codes', 'ref', 'seq'] as const;
export const BAL_COLS = ['employee_id', 'year', 'leave_type', 'opening', 'accrued', 'capped', 'used', 'forfeited', 'balance_end'] as const;
export const REQ_COLS = ['request_id', 'employee_id', 'leave_type', 'policy_id', 'start', 'end', 'submitted_on', 'working_days', 'minutes', 'chain', 'final_state', 'final_code', 'log'] as const;

export const ledgerRow = (e: Entry): Record<string, string | number> => ({
  entry_id: e.entryId, employee_id: e.employeeId, leave_type: e.leaveType, policy_id: e.policyId, kind: e.kind, effective: e.effective, posted: e.posted,
  minutes: e.minutes, capped_minutes: e.cappedMinutes, codes: e.codes, ref: e.ref, seq: e.seq,
});

export const balanceRow = (r: EmployeeYearRow): Record<string, string | number> => ({
  employee_id: r.employeeId, year: r.year, leave_type: r.leaveType, opening: r.opening, accrued: r.accrued, capped: r.capped, used: r.used, forfeited: r.forfeited, balance_end: r.balanceEnd,
});

export const requestRow = (rs: RequestState): Record<string, string | number> => ({
  request_id: rs.req.id, employee_id: rs.req.employeeId, leave_type: rs.req.leaveType, policy_id: rs.policyId, start: rs.req.start, end: rs.req.end,
  submitted_on: rs.req.submittedOn, working_days: rs.workingDays, minutes: rs.minutes, chain: rs.chain, final_state: finalStateLabel(rs), final_code: rs.finalCode,
  log: rs.log.join(';'),
});

/** The years the employee-year table covers: every calendar year from the ledger start to the as-of date. */
export function reportYears(world: World): number[] {
  const out: number[] = [];
  for (let y = Number(world.ledgerStart.slice(0, 4)); y <= Number(world.asOf.slice(0, 4)); y++) out.push(y);
  return out;
}

export interface Outputs {
  readonly ledgerCsv: string;
  readonly balancesCsv: string;
  readonly requestsCsv: string;
  readonly balances: EmployeeYearRow[];
  readonly requests: RequestState[]; // sorted by request id
}

export function buildOutputs(world: World, sim: SimulationResult): Outputs {
  const years = reportYears(world);
  const balances = employeeYearRows(sim.ledger.entries, [...world.org.employees.keys()], years);
  const requests = [...sim.requests.values()].sort((a, b) => (a.req.id < b.req.id ? -1 : a.req.id > b.req.id ? 1 : 0));
  return {
    ledgerCsv: writeCsv(LEDGER_COLS, sim.ledger.entries.map(ledgerRow)),
    balancesCsv: writeCsv(BAL_COLS, balances.map(balanceRow)),
    requestsCsv: writeCsv(REQ_COLS, requests.map(requestRow)),
    balances,
    requests,
  };
}

/** Python's `dict(sorted(counter.items()))` repr: `{'A': 1, 'B': 2}` with string keys, `{1: 355, 2: 33}` with ints. */
export function pyDict(counts: Map<string | number, number>): string {
  const keys = [...counts.keys()].sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
  return `{${keys.map((k) => `${typeof k === 'number' ? k : `'${k}'`}: ${counts.get(k)}`).join(', ')}}`;
}

function count<K extends string | number>(items: Iterable<K>): Map<K, number> {
  const m = new Map<K, number>();
  for (const k of items) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

const padL = (s: string | number, n: number) => String(s).padEnd(n);
const padR = (s: string | number, n: number) => String(s).padStart(n);

/** The brief §10 summary and the employee-year table, line for line as reference_leave.py prints them. */
export function summaryLines(world: World, sim: SimulationResult, out: Outputs, fixturesLabel: string): string[] {
  const lines: string[] = [];
  const entries = sim.ledger.entries;
  const kinds = count(entries.map((e) => e.kind));
  const states = count(out.requests.map((r) => finalStateLabel(r)));
  const codes = count(out.requests.filter((r) => r.finalCode !== '').map((r) => r.finalCode));
  const stepCounts = count(out.requests.map((r) => keptSteps(r).length));
  const routeCodes = count(out.requests.flatMap((r) => r.steps.flatMap((s) => s.codes as string[])));
  const accrCodes = count(entries.filter((e) => e.kind === 'ACCRUAL').flatMap((e) => e.codes.split('+')));

  lines.push(`fixtures: ${fixturesLabel}  ledger ${world.ledgerStart}..${world.asOf}  employees ${world.org.employees.size}`);
  lines.push(`ledger_entries: ${entries.length}`);
  for (const k of ['ADJUSTMENT', 'ACCRUAL', 'USAGE', 'USAGE_REVERSAL', 'FORFEITURE', 'TRANSFER_OUT', 'TRANSFER_IN']) lines.push(`  ${k}: ${kinds.get(k as Entry['kind']) ?? 0}`);
  lines.push(`accrual_codes: ${pyDict(accrCodes)}`);
  lines.push(`forfeiture_recomputed_entries: ${sim.recomputed}`);
  lines.push(`requests: ${out.requests.length}`);
  lines.push(`final_states: ${pyDict(states)}`);
  lines.push(`final_codes: ${pyDict(codes)}`);
  lines.push(`kept_steps_per_request: ${pyDict(stepCounts)}`);
  lines.push(`routing_codes: ${pyDict(routeCodes)}`);
  lines.push(`void_events: ${sim.voided}  ignored_events: ${sim.ignored}`);
  for (const y of reportYears(world)) {
    for (const lt of ['PTO', 'SICK']) {
      const rs = out.balances.filter((r) => r.year === y && r.leaveType === lt);
      const sum = (f: (r: EmployeeYearRow) => number) => rs.reduce((t, r) => t + f(r), 0);
      lines.push(`${y} ${lt}: rows ${rs.length} accrued ${sum((r) => r.accrued)} capped ${sum((r) => r.capped)} used ${sum((r) => r.used)} forfeited ${sum((r) => r.forfeited)} balance_end ${sum((r) => r.balanceEnd)}`);
    }
  }
  // Brief §11 reports this and reference_leave.py does not print it (plan C-6); the summary is not diffed.
  lines.push(`usage_rows_posted_after_effective: ${entries.filter((e) => e.kind === 'USAGE' && e.posted > e.effective).length}`);
  lines.push('');
  lines.push('employee_id year type   opening accrued capped   used forfeited balance_end');
  for (const r of out.balances) {
    lines.push(`${padL(r.employeeId, 11)} ${r.year} ${padL(r.leaveType, 5)} ${padR(r.opening, 8)} ${padR(r.accrued, 7)} ${padR(r.capped, 6)} ${padR(r.used, 6)} ${padR(r.forfeited, 9)} ${padR(r.balanceEnd, 11)}`);
  }
  return lines;
}

/** `--requests`: one line per request, as reference_leave.py --requests prints it. */
export function requestLines(out: Outputs): string[] {
  return out.requests.map((r) => `${r.req.id} ${r.req.employeeId} ${r.req.leaveType} ${r.req.start}..${r.req.end} wd=${r.workingDays} ${finalStateLabel(r)} ${r.finalCode} ${r.chain}`);
}
