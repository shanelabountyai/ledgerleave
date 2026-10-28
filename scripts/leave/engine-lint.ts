// engine:lint — the purity gate for the two engines (CLAUDE.md non-negotiable 3, 4, 5).
//
// 1. Greps src/accrual/ and src/routing/ for anything that would make an engine read the clock, the
//    database, the network, a model, or randomness, and for anything that would put a float on a minute
//    or parse a date through the process timezone.
// 2. Greps the whole of src/ and scripts/leave/ for the repo-wide date bans (D-7).
// 3. Loads fixtures/policies.json through the engine's own validator so a bad vocabulary value
//    fails here, not at the first accrual.
//
// Exits 1 naming every offending file:line. Zero dependencies beyond node.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadPolicyFile } from '../../src/accrual/policy';

const ROOT = process.cwd();

type Rule = { pattern: RegExp; why: string };

// Forbidden inside the engines. Each pattern is matched per line; a comment line that merely names a
// banned token is still a hit, which is deliberate: the lint should not need to parse TypeScript to be right.
const ENGINE_RULES: Rule[] = [
  { pattern: /\bDate\.now\b/, why: 'engines take dates as arguments; nothing reads the clock' },
  { pattern: /\bnew Date\b/, why: 'no Date object on the calendar axis (D-7)' },
  { pattern: /\bMath\.random\b/, why: 'engines are deterministic' },
  { pattern: /\bprisma\b/i, why: 'engines import no database' },
  { pattern: /\bfetch\s*\(/, why: 'engines make no network call' },
  { pattern: /\banthropic\b/i, why: 'no model client in an engine (D-2)' },
  { pattern: /@\/core\b/, why: 'engines do not depend on the foundation' },
  { pattern: /\bparseFloat\b|\btoFixed\b|\bMath\.(round|floor|ceil|trunc)\b/, why: 'integer minutes only; use roundDiv (C5, D-6)' },
  { pattern: /\bprocess\.env\b/, why: 'engines read no environment' },
];

// Forbidden everywhere this project writes code (D-7): every one is a silent axis-crossing through the
// process timezone.
const DATE_RULES: Rule[] = [
  { pattern: /\bnew Date\s*\(\s*['"`]/, why: 'new Date(string) parses through the process timezone (D-7)' },
  { pattern: /\bDate\.parse\b/, why: 'Date.parse is new Date(string) by another name (D-7)' },
  { pattern: /\.toISOString\(\)\.slice\(/, why: 'toISOString().slice(0,10) is a day-west shift waiting to happen (D-7)' },
  { pattern: /\bgetTimezoneOffset\b/, why: 'no timezone arithmetic (D-7)' },
  { pattern: /@db\.Date\b/, why: '@db.Date is banned; a calendar day is a CHAR(10) (D-7)' },
];

function walk(dir: string, out: string[] = []): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (n === 'node_modules' || n === 'generated') continue;
      walk(p, out);
    } else if (/\.(ts|tsx|mts|prisma)$/.test(n)) out.push(p);
  }
  return out;
}

function lint(files: string[], rules: Rule[], label: string): string[] {
  const hits: string[] = [];
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/engine-lint:allow\b/.test(line)) return; // an explicit, visible exemption
      for (const r of rules) {
        if (r.pattern.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}: ${label}: ${r.why}\n    ${line.trim()}`);
      }
    });
  }
  return hits;
}

const engineFiles = [...walk(join(ROOT, 'src/accrual')), ...walk(join(ROOT, 'src/routing'))];
// Template-owned or template-shipped paths are not ours to lint (foundation:drift forbids editing them anyway).
const TEMPLATE_PATHS = [
  'src/core/', 'src/modules/', 'src/proxy.ts', 'prisma/schema/core.prisma', 'prisma/schema/billing.prisma', 'prisma/schema/notifications.prisma',
  'src/app/(public)/', 'src/app/onboarding/', 'src/app/account/', 'src/app/s/', 'src/app/o/[org]/settings/', 'src/app/api/',
  'src/app/o/[org]/projects/', // the template's example route; replaced when Phase 3 adds this clone's pages
  'scripts/leave/engine-lint.ts', // this file names every banned token
];
const repoFiles = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts/leave')), ...walk(join(ROOT, 'prisma/schema'))].filter((f) => {
  const rel = relative(ROOT, f);
  return !TEMPLATE_PATHS.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p));
});

const hits = [...lint(engineFiles, ENGINE_RULES, 'engine'), ...lint(repoFiles, DATE_RULES, 'date')];

// Policy vocabularies: validated through the engine's own loader (task 1.4), so a bad value fails here, not at the
// first accrual.
let policyNote: string;
try {
  const pf = loadPolicyFile(readFileSync(join(ROOT, 'fixtures/policies.json'), 'utf8'));
  policyNote = `policies.json: ${pf.policies.size} policies, every vocabulary value valid`;
} catch (e) {
  hits.push(`fixtures/policies.json: ${(e as Error).message}`);
  policyNote = 'policies.json: INVALID';
}

console.log(`engine:lint — ${engineFiles.length} engine file(s), ${repoFiles.length} repo file(s) scanned; ${policyNote}`);
if (hits.length) {
  console.error(hits.join('\n'));
  console.error(`\nengine:lint FAILED: ${hits.length} hit(s)`);
  process.exit(1);
}
console.log('engine:lint OK: 0 hits');
