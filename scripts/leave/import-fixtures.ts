// Phase 2 task 2.3 — loads the ten INPUT fixture files into the clone-owned input tables for one org. Never reads
// ledger.csv or expected_*.csv (non-negotiable 7): everything derived is written by the replay (task 2.4), not here.
// Idempotent on the inputs: every row is upserted by its natural key, and RequestCommand (append-only) gets only the
// rows it does not have — a stored command that differs from the file is reported, never rewritten.
//
//   npm run leave:import                         # fixtures/ into org "ledgerleave-fixture"
//   npm run leave:import -- --org <slug> [--fixtures <dir>]
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { calendarDay } from '../../src/accrual/calendar';
import { loadPolicyFile } from '../../src/accrual/policy';
import { db } from '../../src/core/db';
import { ORG_CHANGE_FIELDS } from '../../src/routing/org';
import { ACTIONS } from '../../src/routing/requests';
import { cmpStr } from '../../src/routing/org';
import { parseCsv } from './csv';
import { assertWritable } from '../../src/leave-db/archive';

export const FIXTURE_ORG_SLUG = 'ledgerleave-fixture';

/** Synthetic outbox address for an employee id (D-36): nothing is ever sent to it. */
export const employeeEmail = (employeeId: string): string => `${employeeId.toLowerCase()}@ledgerleave.example`;

export interface ImportCounts {
  readonly orgId: string;
  readonly policySetHash: string;
  readonly tables: Record<string, number>; // rows now in each input table for the org
  readonly commandsInserted: number;
}

type Row = Record<string, string | undefined>;
const int = (v: string | undefined, what: string): number => {
  if (v === undefined || !/^-?\d+$/.test(v)) throw new Error(`${what}: expected an integer, got ${JSON.stringify(v)}`);
  return Number(v);
};
const day = (v: string | undefined, what: string): string => {
  if (v === undefined) throw new Error(`${what}: missing`);
  return calendarDay(v) as string;
};
const dayOrNull = (v: string | undefined, what: string): string | null => (v === undefined || v === '' ? null : day(v, what));
const oneOf = (v: string | undefined, allowed: readonly string[], what: string): string => {
  if (v === undefined || !allowed.includes(v)) throw new Error(`${what}: expected one of ${allowed.join('|')}, got ${JSON.stringify(v)}`);
  return v;
};

/** The hash PolicySet.contentHash stores: sha256 of the parsed document re-serialised (key order as in the file). */
export const policyContentHash = (text: string): string => createHash('sha256').update(JSON.stringify(JSON.parse(text))).digest('hex');

export async function importFixtures(dir: string, orgSlug = FIXTURE_ORG_SLUG): Promise<ImportCounts> {
  const read = (name: string) => readFileSync(join(dir, name), 'utf8');
  const rows = (name: string): Row[] => parseCsv(read(name));
  const manifest = JSON.parse(read('MANIFEST.json')) as { seed: number; ledger_start: string; asof: string };
  const policyText = read('policies.json');
  loadPolicyFile(policyText); // validated on write (task 2.1); a bad vocabulary value fails here, before any row lands
  const policyHash = policyContentHash(policyText);

  const org = await db.org.upsert({ where: { slug: orgSlug }, create: { slug: orgSlug, name: orgSlug }, update: {} });
  const orgId = org.id;

  return db.$transaction(async (tx) => {
    await assertWritable(tx, orgId); // D-47: an archived org takes no import either
    await tx.leaveSettings.upsert({
      where: { orgId },
      create: { orgId, ledgerStart: day(manifest.ledger_start, 'MANIFEST.ledger_start'), fixtureSeed: manifest.seed, fixtureAsOf: day(manifest.asof, 'MANIFEST.asof') },
      update: { ledgerStart: day(manifest.ledger_start, 'MANIFEST.ledger_start'), fixtureSeed: manifest.seed, fixtureAsOf: day(manifest.asof, 'MANIFEST.asof') },
    });
    await tx.policySet.upsert({
      where: { orgId_contentHash: { orgId, contentHash: policyHash } },
      create: { orgId, contentHash: policyHash, content: JSON.parse(policyText) },
      update: {},
    });

    for (const r of rows('employees.csv')) {
      const data = {
        name: r.name!, title: r.title!, dept: r.dept!, managerId: r.manager_id === '' ? null : r.manager_id!, employmentType: r.employment_type!, roles: r.roles!,
        hireDate: day(r.hire_date, 'employees.hire_date'), termDate: dayOrNull(r.term_date, 'employees.term_date'), email: employeeEmail(r.employee_id!),
      };
      await tx.employee.upsert({ where: { orgId_employeeId: { orgId, employeeId: r.employee_id! } }, create: { orgId, employeeId: r.employee_id!, ...data }, update: data });
    }
    for (const r of rows('org_changes.csv')) {
      const key = { orgId, effective: day(r.effective, 'org_changes.effective'), employeeId: r.employee_id!, field: oneOf(r.field, ORG_CHANGE_FIELDS, 'org_changes.field') };
      const data = { oldValue: r.old!, newValue: r.new! };
      await tx.orgChange.upsert({ where: { orgId_effective_employeeId_field: key }, create: { ...key, ...data }, update: data });
    }
    for (const r of rows('assignments.csv')) {
      const key = { orgId, employeeId: r.employee_id!, leaveType: r.leave_type!, start: day(r.start, 'assignments.start') };
      const data = { policyId: r.policy_id!, end: dayOrNull(r.end, 'assignments.end') };
      await tx.policyAssignment.upsert({ where: { orgId_employeeId_leaveType_start: key }, create: { ...key, ...data }, update: data });
    }
    for (const r of rows('holidays.csv')) {
      const key = { orgId, date: day(r.date, 'holidays.date') };
      await tx.holiday.upsert({ where: { orgId_date: key }, create: key, update: {} });
    }
    for (const r of rows('timesheets.csv')) {
      const key = { orgId, employeeId: r.employee_id!, periodEnd: day(r.period_end, 'timesheets.period_end') };
      const data = { minutesWorked: int(r.minutes_worked, 'timesheets.minutes_worked') };
      await tx.timesheet.upsert({ where: { orgId_employeeId_periodEnd: key }, create: { ...key, ...data }, update: data });
    }
    for (const r of rows('delegations.csv')) {
      const key = { orgId, approverId: r.approver_id!, delegateId: r.delegate_id!, start: day(r.start, 'delegations.start') };
      const data = { end: day(r.end, 'delegations.end') };
      await tx.delegation.upsert({ where: { orgId_approverId_delegateId_start: key }, create: { ...key, ...data }, update: data });
    }
    for (const r of rows('opening_balances.csv')) {
      const key = { orgId, employeeId: r.employee_id!, leaveType: r.leave_type! };
      const data = { minutes: int(r.minutes, 'opening_balances.minutes') };
      await tx.openingBalance.upsert({ where: { orgId_employeeId_leaveType: key }, create: { ...key, ...data }, update: data });
    }
    for (const r of rows('requests.csv')) {
      const data = {
        employeeId: r.employee_id!, leaveType: r.leave_type!, start: day(r.start, 'requests.start'), end: day(r.end, 'requests.end'),
        submittedOn: day(r.submitted_on, 'requests.submitted_on'), trap: r.trap === '' ? null : r.trap!,
      };
      await tx.leaveRequest.upsert({ where: { orgId_requestId: { orgId, requestId: r.request_id! } }, create: { orgId, requestId: r.request_id!, ...data }, update: data });
    }

    // Commands: append-only. Rank each day's commands by (request id, seq) — the oracle's within-day order (D-38) —
    // then insert only the ones the table lacks; a stored command whose content differs is a conflict, not an update.
    const commands = rows('request_events.csv').map((r) => ({
      requestId: r.request_id!, seq: int(r.seq, 'request_events.seq'), on: day(r.on, 'request_events.on'), actor: r.actor!,
      action: oneOf(r.action, ACTIONS, 'request_events.action'), target: r.target!,
    }));
    commands.sort((a, b) => cmpStr(a.on, b.on) || cmpStr(a.requestId, b.requestId) || a.seq - b.seq);
    const perDay = new Map<string, number>();
    const ranked = commands.map((c) => {
      const n = (perDay.get(c.on) ?? 0) + 1;
      perDay.set(c.on, n);
      return { ...c, ordinal: n };
    });
    const existing = new Map((await tx.requestCommand.findMany({ where: { orgId } })).map((c) => [`${c.requestId}|${c.seq}`, c]));
    const fresh: typeof ranked = [];
    for (const c of ranked) {
      const have = existing.get(`${c.requestId}|${c.seq}`);
      if (!have) {
        fresh.push(c);
        continue;
      }
      for (const k of ['on', 'actor', 'action', 'target', 'ordinal'] as const) {
        if (have[k] !== c[k]) throw new Error(`request_events.csv ${c.requestId} seq ${c.seq}: stored ${k}=${JSON.stringify(have[k])}, file has ${JSON.stringify(c[k])}; commands are append-only — add a new seq instead`);
      }
    }
    if (fresh.length) await tx.requestCommand.createMany({ data: fresh.map((c) => ({ orgId, ...c })) });

    const where = { where: { orgId } };
    const tables: Record<string, number> = {
      Employee: await tx.employee.count(where), OrgChange: await tx.orgChange.count(where), PolicyAssignment: await tx.policyAssignment.count(where),
      Holiday: await tx.holiday.count(where), Timesheet: await tx.timesheet.count(where), Delegation: await tx.delegation.count(where),
      OpeningBalance: await tx.openingBalance.count(where), LeaveRequest: await tx.leaveRequest.count(where), RequestCommand: await tx.requestCommand.count(where),
      PolicySet: await tx.policySet.count(where),
    };
    return { orgId, policySetHash: policyHash, tables, commandsInserted: fresh.length };
  }, { timeout: 60_000 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? (args[i + 1] ?? '') : undefined;
  };
  const dir = resolve(flag('--fixtures') ?? join(process.cwd(), 'fixtures'));
  const res = await importFixtures(dir, flag('--org') ?? FIXTURE_ORG_SLUG);
  console.log(`leave:import — org ${res.orgId} from ${dir}; policies ${res.policySetHash.slice(0, 12)}…`);
  for (const [t, n] of Object.entries(res.tables)) console.log(`  ${t}: ${n}`);
  console.log(`leave:import OK: ${res.commandsInserted} command(s) inserted`);
  await db.$disconnect();
}
