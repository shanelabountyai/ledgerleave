// ledger:verify (Phase 1 form, task 1.10) — recomputes every employee-year row (opening, accrued, capped, used,
// forfeited, balance_end) from fixtures/ledger.csv ALONE and diffs it against expected_balances.csv, naming the
// employee, year, leave type and column of every mismatch. Proves non-negotiable 1 from the outside: the balance is
// a sum over entries and nothing else. Phase 2 points the same function at the database.
//
//   npm run ledger:verify                        # fixtures/
//   npm run ledger:verify -- --ledger <csv> --expected <csv> [--years 2024,2025]
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { calendarDay } from '../../src/accrual/calendar';
import { ENTRY_KINDS, type Entry, type EntryKind } from '../../src/accrual/ledger';
import { type EmployeeYearRow, employeeYearRows } from '../../src/accrual/simulate';
import { parseCsv } from './csv';
import { BAL_COLS } from './report';

export interface VerifyMismatch {
  readonly employeeId: string;
  readonly year: number;
  readonly leaveType: string;
  readonly column: string;
  readonly expected: string;
  readonly actual: string;
}

export interface VerifyResult {
  readonly rows: number;
  readonly entries: number;
  readonly mismatches: VerifyMismatch[];
}

export function entriesFromLedgerCsv(text: string): Entry[] {
  return parseCsv(text).map((r, i) => {
    const kind = r.kind!;
    if (!(ENTRY_KINDS as readonly string[]).includes(kind)) throw new Error(`ledger.csv row ${i + 2}: unknown kind ${JSON.stringify(kind)}`);
    const n = (col: string) => {
      const v = r[col]!;
      if (!/^-?\d+$/.test(v)) throw new Error(`ledger.csv row ${i + 2}: ${col} is not an integer: ${JSON.stringify(v)}`);
      return Number(v);
    };
    return {
      entryId: r.entry_id!, employeeId: r.employee_id!, leaveType: r.leave_type!, policyId: r.policy_id!, kind: kind as EntryKind,
      effective: calendarDay(r.effective!), posted: calendarDay(r.posted!), minutes: n('minutes'), cappedMinutes: n('capped_minutes'),
      codes: r.codes!, ref: r.ref!, seq: n('seq'),
    };
  });
}

const rowKey = (employeeId: string, year: number | string, leaveType: string) => `${employeeId}|${year}|${leaveType}`;

/** Recompute from the ledger text alone and compare with the expected table. */
export function verifyLedger(ledgerCsv: string, expectedCsv: string, years: readonly number[]): VerifyResult {
  const entries = entriesFromLedgerCsv(ledgerCsv);
  const ids = [...new Set(entries.map((e) => e.employeeId))];
  const actual = employeeYearRows(entries, ids, years);
  const expected = parseCsv(expectedCsv);
  const mismatches: VerifyMismatch[] = [];

  const actualBy = new Map(actual.map((r) => [rowKey(r.employeeId, r.year, r.leaveType), r]));
  const expectedBy = new Map(expected.map((r) => [rowKey(r.employee_id!, r.year!, r.leave_type!), r]));
  const asRecord = (r: EmployeeYearRow): Record<string, string> => ({
    employee_id: r.employeeId, year: String(r.year), leave_type: r.leaveType, opening: String(r.opening), accrued: String(r.accrued), capped: String(r.capped),
    used: String(r.used), forfeited: String(r.forfeited), balance_end: String(r.balanceEnd),
  });

  for (const [k, e] of expectedBy) {
    const a = actualBy.get(k);
    if (!a) {
      mismatches.push({ employeeId: e.employee_id!, year: Number(e.year), leaveType: e.leave_type!, column: '(row)', expected: 'present', actual: 'absent' });
      continue;
    }
    const ar = asRecord(a);
    for (const col of BAL_COLS) if (ar[col] !== e[col]) mismatches.push({ employeeId: a.employeeId, year: a.year, leaveType: a.leaveType, column: col, expected: e[col]!, actual: ar[col]! });
  }
  for (const [k, a] of actualBy) {
    if (!expectedBy.has(k)) mismatches.push({ employeeId: a.employeeId, year: a.year, leaveType: a.leaveType, column: '(row)', expected: 'absent', actual: 'present' });
  }
  return { rows: expected.length, entries: entries.length, mismatches };
}

export function formatMismatch(m: VerifyMismatch): string {
  return `${m.employeeId} ${m.year} ${m.leaveType} ${m.column}: expected ${m.expected}, recomputed ${m.actual}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? (args[i + 1] ?? '') : undefined;
  };
  const fixtures = join(process.cwd(), 'fixtures');
  const ledgerPath = resolve(flag('--ledger') ?? join(fixtures, 'ledger.csv'));
  const expectedPath = resolve(flag('--expected') ?? join(fixtures, 'expected_balances.csv'));
  let years: number[];
  const yearsFlag = flag('--years');
  if (yearsFlag) years = yearsFlag.split(',').map(Number);
  else {
    const m = JSON.parse(readFileSync(join(fixtures, 'MANIFEST.json'), 'utf8')) as { ledger_start: string; asof: string };
    years = [];
    for (let y = Number(m.ledger_start.slice(0, 4)); y <= Number(m.asof.slice(0, 4)); y++) years.push(y);
  }
  const res = verifyLedger(readFileSync(ledgerPath, 'utf8'), readFileSync(expectedPath, 'utf8'), years);
  console.log(`ledger:verify — ${res.entries} entries → ${res.rows} employee-year rows recomputed from ${ledgerPath}`);
  for (const m of res.mismatches) console.log(`  ${formatMismatch(m)}`);
  if (res.mismatches.length) {
    console.log(`ledger:verify FAILED: ${res.mismatches.length} mismatch(es)`);
    process.exit(1);
  }
  console.log(`ledger:verify OK: ${res.rows} rows, 0 diffs`);
}
