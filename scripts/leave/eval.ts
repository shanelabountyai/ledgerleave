// leave:eval — replays fixtures/ through both engines and diffs the three reference-engine files byte for byte
// (D-24, task 1.9). Prints the brief §10 summary and the employee-year table; with --requests one line per request;
// exits non-zero on any diff. Nothing is written anywhere.
//
//   npm run leave:eval                          # fixtures/
//   npm run leave:eval -- --requests
//   npm run leave:eval -- --fixtures <dir>      # a copy (the pre-Phase-2 check in docs/phase-1-tasks.md)
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { Simulation } from '../../src/accrual/simulate';
import { countDiffLines, firstDiff } from './csv';
import { loadWorld } from './load-fixtures';
import { buildOutputs, requestLines, summaryLines } from './report';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? '') : undefined;
};
const dir = resolve(flag('--fixtures') ?? join(process.cwd(), 'fixtures'));
const wantRequests = args.includes('--requests');

const { world, manifest } = loadWorld(dir);
const sim = new Simulation(world).run();
const out = buildOutputs(world, sim);

for (const line of summaryLines(world, sim, out, basename(dir))) console.log(line);
if (wantRequests) {
  console.log('');
  for (const line of requestLines(out)) console.log(line);
}

const expected: [string, string][] = [
  ['ledger.csv', out.ledgerCsv],
  ['expected_balances.csv', out.balancesCsv],
  ['expected_requests.csv', out.requestsCsv],
];
console.log('');
let bad = 0;
let missing = 0;
for (const [name, actual] of expected) {
  const path = join(dir, name);
  if (!existsSync(path)) {
    missing++;
    console.log(`diff ${name}: file absent (run tools/reference_leave.py --write-expected)`);
    continue;
  }
  const want = readFileSync(path, 'utf8');
  const d = firstDiff(want, actual);
  const rows = actual.split('\n').length - 2; // header and trailing newline
  if (!d) {
    console.log(`diff ${name}: 0 diffs (${rows} rows)`);
    continue;
  }
  bad++;
  const n = countDiffLines(want, actual);
  console.log(`diff ${name}: ${n} differing line(s); first at line ${d.line}`);
  console.log(`  expected: ${d.expected ?? '<end of file>'}`);
  console.log(`  actual:   ${d.actual ?? '<end of file>'}`);
}
console.log(`seed ${manifest.seed}; D-24: these numbers measure TypeScript–Python agreement on fixtures written by the same author, not policy fitness`);
if (bad || missing) {
  console.log(`leave:eval FAILED: ${bad} file(s) differ, ${missing} missing`);
  process.exit(1);
}
console.log('leave:eval OK: 0 diffs across 3 files');
