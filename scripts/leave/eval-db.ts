// leave:eval --db (Phase 2 tasks 2.7/2.9): the three reference-engine files rebuilt from the DATABASE ROWS ALONE —
// LedgerEntry (entry ids and seqs as the trigger assigned them), the employee-year table recomputed from those rows,
// and expected_requests.csv from LeaveRequest + FrozenChain + RequestEvent — diffed byte for byte against fixtures/.
// No engine runs here: this proves what the tables hold, not what the engine would say.
//
//   npm run leave:eval:db -- [--org <slug>] [--fixtures <dir>]
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { employeeYearRows } from '../../src/accrual/simulate';
import { db } from '../../src/core/db';
import { ledgerEntriesFromDb, requestRowsFromDb } from '../../src/leave-db/verify-db';
import { countDiffLines, firstDiff, writeCsv } from './csv';
import { BAL_COLS, LEDGER_COLS, REQ_COLS, balanceRow, ledgerRow } from './report';

export interface DbOutputs {
  readonly ledgerCsv: string;
  readonly balancesCsv: string;
  readonly requestsCsv: string;
  readonly entries: number;
  readonly balances: number;
  readonly requests: number;
}

export async function buildOutputsFromDb(orgId: string, years: readonly number[]): Promise<DbOutputs> {
  const entries = await ledgerEntriesFromDb(db, orgId);
  const ids = (await db.employee.findMany({ where: { orgId }, select: { employeeId: true } })).map((e) => e.employeeId);
  const balances = employeeYearRows(entries, ids, years);
  const requests = await requestRowsFromDb(db, orgId);
  return {
    ledgerCsv: writeCsv(LEDGER_COLS, entries.map(ledgerRow)),
    balancesCsv: writeCsv(BAL_COLS, balances.map(balanceRow)),
    requestsCsv: writeCsv(REQ_COLS, requests.map((r) => ({ ...r }))),
    entries: entries.length, balances: balances.length, requests: requests.length,
  };
}

export interface FileDiff {
  readonly name: string;
  readonly rows: number;
  readonly differing: number;
  readonly first?: { line: number; expected?: string; actual?: string };
}

export function diffAgainstFixtures(dir: string, out: DbOutputs): FileDiff[] {
  const files: [string, string][] = [['ledger.csv', out.ledgerCsv], ['expected_balances.csv', out.balancesCsv], ['expected_requests.csv', out.requestsCsv]];
  return files.map(([name, actual]) => {
    const want = readFileSync(join(dir, name), 'utf8');
    const d = firstDiff(want, actual);
    const rows = actual.split('\n').length - 2;
    return d ? { name, rows, differing: countDiffLines(want, actual), first: { line: d.line, expected: d.expected ?? '<end of file>', actual: d.actual ?? '<end of file>' } } : { name, rows, differing: 0 };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? (args[i + 1] ?? '') : undefined;
  };
  const dir = resolve(flag('--fixtures') ?? join(process.cwd(), 'fixtures'));
  const slug = flag('--org') ?? 'ledgerleave-fixture';
  const org = await db.org.findUnique({ where: { slug } });
  if (!org) throw new Error(`org ${slug} not found`);
  const settings = await db.leaveSettings.findUniqueOrThrow({ where: { orgId: org.id } });
  const asOf = settings.fixtureAsOf ?? (() => { throw new Error(`org ${slug} has no fixtureAsOf`); })();
  const years: number[] = [];
  for (let y = Number(settings.ledgerStart.slice(0, 4)); y <= Number(asOf.slice(0, 4)); y++) years.push(y);
  const out = await buildOutputsFromDb(org.id, years);
  console.log(`leave:eval --db — org ${slug}: ${out.entries} LedgerEntry rows, ${out.balances} employee-year rows, ${out.requests} requests, from the tables alone`);
  let bad = 0;
  for (const d of diffAgainstFixtures(dir, out)) {
    if (!existsSync(join(dir, d.name))) continue;
    if (d.differing === 0) console.log(`diff ${d.name}: 0 diffs (${d.rows} rows)`);
    else {
      bad++;
      console.log(`diff ${d.name}: ${d.differing} differing line(s); first at line ${d.first!.line}\n  expected: ${d.first!.expected}\n  actual:   ${d.first!.actual}`);
    }
  }
  await db.$disconnect();
  if (bad) {
    console.log(`leave:eval --db FAILED: ${bad} file(s) differ`);
    process.exit(1);
  }
  console.log('leave:eval --db OK: 0 diffs across 3 files, read from the database');
}
