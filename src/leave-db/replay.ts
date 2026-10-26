/**
 * Replay-into-database (Phase 2 task 2.4, D-37/D-38): the ONE write path from inputs to derived rows.
 *
 * Builds a `World` from the org's input tables, runs the pure `Simulation` over it up to `asOf`, and stores what
 * the engine returns — LedgerEntry, FrozenChain + RequestStep (at SUBMIT), one RequestEvent per command — inserting
 * only what the tables lack. What they already hold must be a PREFIX of the engine's answer: the stored ledger rows,
 * in seq order, must equal the first N entries the engine posts (natural key by natural key), and every stored
 * chain, step and event must equal the engine's. Anything else is a `ReplayDivergence` and nothing is written —
 * the inputs changed under an append-only ledger, and that is a human's call (an ADJUSTMENT), not a rewrite.
 *
 * The same function serves every caller: the fixture proof (asOf = the fixture's as-of, day closed), the nightly
 * close (asOf = yesterday, closed; task 2.8 seam) and a live command (asOf = its day, `openAsOfDay`; task 2.5).
 * The engines stay pure; this module is the only one that imports both them and the database.
 */
import { createHash } from 'node:crypto';
import { type CalendarDay, calendarDay } from '@/accrual/calendar';
import type { Entry } from '@/accrual/ledger';
import { loadPolicyFile } from '@/accrual/policy';
import { type Assignment, type RunOptions, Simulation, type SimulationResult, type World, timesheetKey } from '@/accrual/simulate';
import type { Prisma } from '@/generated/prisma/client';
import { enqueue } from '@/modules/notifications/outbox';
import { type Employee, ORG_CHANGE_FIELDS, Org, type OrgChange, type OrgChangeField } from '@/routing/org';
import { ACTIONS, type Action, type Effects, type Request, type RequestEvent, type RequestState } from '@/routing/requests';
import type { Step } from '@/routing/route';
import { type Notification, eventOutcome, notificationsFor } from './notify';
import './templates'; // registers APPROVAL_REQUESTED / APPROVED / DENIED into the outbox module

export type Tx = Prisma.TransactionClient;

/** The engine's verdict on a command (RequestEvent.outcome); the CHECK constraint mirrors this list. */
export const EVENT_OUTCOMES = ['APPLIED', 'VOID', 'IGNORED'] as const;
export type EventOutcome = (typeof EVENT_OUTCOMES)[number];

export class ReplayDivergence extends Error {
  constructor(readonly details: readonly string[]) {
    super(`replay refused: the stored rows are not a prefix of the engine's answer (${details.length} difference(s)); nothing written\n  ${details.slice(0, 10).join('\n  ')}`);
    this.name = 'ReplayDivergence';
  }
}

export interface ReplayCounts {
  readonly existing: number;
  readonly inserted: number;
}

export interface ReplayResult {
  readonly orgId: string;
  readonly asOf: string;
  readonly openAsOfDay: boolean;
  readonly ledger: ReplayCounts;
  readonly chains: ReplayCounts;
  readonly steps: ReplayCounts;
  readonly events: ReplayCounts;
  readonly outboxQueued: number;
  readonly engine: { entries: number; requests: number; voided: number; ignored: number; recomputed: number };
  /** sha256 over the engine's ledger rows (natural keys in seq order): the hash a second run must reproduce. */
  readonly ledgerHash: string;
}

// ----------------------------------------------------------------------------------------- world from the tables

export interface LoadedDbWorld {
  readonly world: World;
  readonly emails: ReadonlyMap<string, string>;
}

function oneOf<T extends string>(v: string, allowed: readonly T[], what: string): T {
  if (!(allowed as readonly string[]).includes(v)) throw new Error(`${what}: expected one of ${allowed.join('|')}, got ${JSON.stringify(v)}`);
  return v as T;
}

/** Mirrors scripts/leave/load-fixtures.ts, reading the tables instead of the files. */
export async function loadWorldFromDb(tx: Tx, orgId: string, asOf: CalendarDay): Promise<LoadedDbWorld> {
  const settings = await tx.leaveSettings.findUnique({ where: { orgId } });
  if (!settings) throw new Error(`org ${orgId} has no LeaveSettings row (run leave:import or create one)`);
  const policySet = await tx.policySet.findFirst({ where: { orgId }, orderBy: { createdAt: 'desc' } });
  if (!policySet) throw new Error(`org ${orgId} has no PolicySet row`);
  const policyFile = loadPolicyFile(JSON.stringify(policySet.content));

  const employeeRows = await tx.employee.findMany({ where: { orgId }, orderBy: { employeeId: 'asc' } });
  const employees: Employee[] = employeeRows.map((e) => ({
    id: e.employeeId, name: e.name, title: e.title, dept: e.dept, managerId: e.managerId ?? '', employmentType: e.employmentType, roles: e.roles,
    hireDate: calendarDay(e.hireDate), termDate: e.termDate === null ? '' : calendarDay(e.termDate),
  }));
  const emails = new Map(employeeRows.map((e) => [e.employeeId, e.email]));
  const changes: OrgChange[] = (await tx.orgChange.findMany({ where: { orgId } })).map((c) => ({
    effective: calendarDay(c.effective), employeeId: c.employeeId, field: oneOf<OrgChangeField>(c.field, ORG_CHANGE_FIELDS, 'OrgChange.field'), old: c.oldValue, new: c.newValue,
  }));
  const assignments: Assignment[] = (await tx.policyAssignment.findMany({ where: { orgId }, orderBy: [{ employeeId: 'asc' }, { leaveType: 'asc' }, { start: 'asc' }] })).map((a) => ({
    employeeId: a.employeeId, leaveType: a.leaveType, policyId: a.policyId, start: calendarDay(a.start), end: a.end === null ? null : calendarDay(a.end),
  }));
  const holidays = new Set((await tx.holiday.findMany({ where: { orgId } })).map((h) => calendarDay(h.date) as string));
  const timesheets = new Map<string, number>();
  for (const t of await tx.timesheet.findMany({ where: { orgId } })) timesheets.set(timesheetKey(t.employeeId, calendarDay(t.periodEnd)), t.minutesWorked);
  const delegations = (await tx.delegation.findMany({ where: { orgId } })).map((d) => ({ approverId: d.approverId, delegateId: d.delegateId, start: calendarDay(d.start) as string, end: calendarDay(d.end) as string }));
  const requests: Request[] = (await tx.leaveRequest.findMany({ where: { orgId }, orderBy: { requestId: 'asc' } })).map((r) => ({
    id: r.requestId, employeeId: r.employeeId, leaveType: r.leaveType, start: calendarDay(r.start), end: calendarDay(r.end), submittedOn: calendarDay(r.submittedOn),
  }));
  const events: RequestEvent[] = (await tx.requestCommand.findMany({ where: { orgId }, orderBy: [{ on: 'asc' }, { ordinal: 'asc' }] })).map((c) => ({
    requestId: c.requestId, seq: c.seq, on: calendarDay(c.on), actor: c.actor, action: oneOf<Action>(c.action, ACTIONS, 'RequestCommand.action'), target: c.target, ordinal: c.ordinal,
  }));
  const opening = (await tx.openingBalance.findMany({ where: { orgId } })).map((o) => ({ employeeId: o.employeeId, leaveType: o.leaveType, minutes: o.minutes }));

  const world: World = {
    policyFile, org: new Org(employees, changes), assignments, holidays, timesheets, delegations, requests, events, opening,
    ledgerStart: calendarDay(settings.ledgerStart), asOf,
  };
  return { world, emails };
}

// ---------------------------------------------------------------------------------------------------- the replay

export const ledgerNaturalKey = (e: { employeeId: string; leaveType: string; policyId: string; kind: string; effective: string; posted: string; minutes: number; codes: string; ref: string }): string =>
  [e.employeeId, e.leaveType, e.policyId, e.kind, e.effective, e.posted, e.minutes, e.codes, e.ref].join('|');

interface ObservedEvent {
  readonly ev: RequestEvent;
  readonly outcome: EventOutcome;
  readonly lines: readonly string[];
  readonly stateAfter: RequestState['state'];
  readonly stepAfter: number;
  readonly finalCodeAfter: string;
  readonly notifications: readonly Notification[];
  /** Set on the applied SUBMIT only: the chain as routed, before any REASSIGN touches `rs.steps`. */
  readonly frozen?: { policyId: string; workingDays: number; minutes: number; chain: string; steps: Step[] };
}

/** Run the engine over the org's tables and store the missing derived rows. Call inside a transaction that holds the org lock. */
export async function replay(tx: Tx, orgId: string, asOf: CalendarDay, opts: RunOptions = {}): Promise<ReplayResult> {
  const { world, emails } = await loadWorldFromDb(tx, orgId, asOf);
  const observed: ObservedEvent[] = [];
  const sim = new Simulation(world, {
    afterEvent(ev: RequestEvent, rs: RequestState, fx: Effects, lines: readonly string[]) {
      const outcome = eventOutcome(fx);
      const frozen = ev.action === 'SUBMIT' && outcome === 'APPLIED'
        ? { policyId: rs.policyId, workingDays: rs.workingDays, minutes: rs.minutes, chain: rs.chain, steps: rs.steps.map((s) => ({ ...s, codes: [...s.codes] })) }
        : undefined;
      observed.push({ ev, outcome, lines: [...lines], stateAfter: rs.state, stepAfter: rs.step, finalCodeAfter: rs.finalCode, notifications: notificationsFor(ev, rs, fx), frozen });
    },
  });
  const result: SimulationResult = sim.run(opts);
  const details: string[] = [];

  // ---- ledger: stored rows must be a prefix of the engine's rows, in seq order
  const stored = await tx.ledgerEntry.findMany({ where: { orgId }, orderBy: { seq: 'asc' } });
  const engineEntries = result.ledger.entries;
  stored.forEach((row, i) => {
    const want = engineEntries[i];
    if (row.seq !== i + 1) details.push(`LedgerEntry seq gap: stored row ${i} has seq ${row.seq}`);
    if (!want) details.push(`LedgerEntry ${row.entryId}: stored, but the engine posts only ${engineEntries.length} rows`);
    else if (ledgerNaturalKey(row) !== ledgerNaturalKey(want)) details.push(`LedgerEntry ${row.entryId}: stored ${ledgerNaturalKey(row)}, engine ${ledgerNaturalKey(want)}`);
  });
  const newEntries: Entry[] = details.length ? [] : engineEntries.slice(stored.length);

  // ---- chains and steps: keyed by request; stored must equal engine
  const storedChains = new Map((await tx.frozenChain.findMany({ where: { orgId } })).map((c) => [c.requestId, c]));
  const storedSteps = new Map((await tx.requestStep.findMany({ where: { orgId } })).map((s) => [`${s.requestId}|${s.index}`, s]));
  const newChains: Prisma.FrozenChainCreateManyInput[] = [];
  const newSteps: Prisma.RequestStepCreateManyInput[] = [];
  for (const o of observed) {
    if (!o.frozen) continue;
    const rid = o.ev.requestId;
    const have = storedChains.get(rid);
    const want = { orgId, requestId: rid, policyId: o.frozen.policyId, workingDays: o.frozen.workingDays, minutes: o.frozen.minutes, chain: o.frozen.chain };
    if (have) {
      for (const k of ['policyId', 'workingDays', 'minutes', 'chain'] as const) if (have[k] !== want[k]) details.push(`FrozenChain ${rid}.${k}: stored ${JSON.stringify(have[k])}, engine ${JSON.stringify(want[k])}`);
    } else newChains.push(want);
    o.frozen.steps.forEach((s, index) => {
      const key = `${rid}|${index}`;
      const row = { orgId, requestId: rid, index, stepId: s.stepId, approver: s.approver, codes: [...s.codes], kept: s.kept };
      const got = storedSteps.get(key);
      if (got) {
        if (got.stepId !== row.stepId || got.approver !== row.approver || got.kept !== row.kept || got.codes.join(',') !== row.codes.join(',')) details.push(`RequestStep ${key}: stored ${got.stepId}:${got.approver}[${got.codes.join(',')}]${got.kept ? '' : '~'}, engine ${row.stepId}:${row.approver}[${row.codes.join(',')}]${row.kept ? '' : '~'}`);
      } else newSteps.push(row);
    });
  }

  // ---- events: keyed by (request, seq); stored must equal engine
  const storedEvents = new Map((await tx.requestEvent.findMany({ where: { orgId } })).map((e) => [`${e.requestId}|${e.seq}`, e]));
  const newEvents: { row: Prisma.RequestEventCreateManyInput; notifications: readonly Notification[] }[] = [];
  for (const o of observed) {
    const key = `${o.ev.requestId}|${o.ev.seq}`;
    const row: Prisma.RequestEventCreateManyInput = {
      orgId, requestId: o.ev.requestId, seq: o.ev.seq, on: o.ev.on, actor: o.ev.actor, action: o.ev.action, target: o.ev.target,
      outcome: o.outcome, logLines: [...o.lines], stateAfter: o.stateAfter, stepAfter: o.stepAfter, finalCodeAfter: o.finalCodeAfter,
    };
    const got = storedEvents.get(key);
    if (got) {
      const diff = (['on', 'actor', 'action', 'target', 'outcome', 'stateAfter', 'stepAfter', 'finalCodeAfter'] as const).filter((k) => got[k] !== row[k]);
      if (got.logLines.join('\n') !== o.lines.join('\n')) diff.push('logLines' as never);
      if (diff.length) details.push(`RequestEvent ${key}: stored and engine differ in ${diff.join(', ')}`);
    } else newEvents.push({ row, notifications: o.notifications });
  }

  if (details.length) throw new ReplayDivergence(details);

  // ---- write, in posting order; the trigger assigns seq = stored.length + 1 .. and refuses anything else
  for (let i = 0; i < newEntries.length; i += 1000) {
    await tx.ledgerEntry.createMany({
      data: newEntries.slice(i, i + 1000).map((e) => ({
        orgId, seq: e.seq, employeeId: e.employeeId, leaveType: e.leaveType, policyId: e.policyId, kind: e.kind, effective: e.effective, posted: e.posted,
        minutes: e.minutes, cappedMinutes: e.cappedMinutes, codes: e.codes, ref: e.ref,
      })),
    });
  }
  if (newChains.length) await tx.frozenChain.createMany({ data: newChains });
  if (newSteps.length) await tx.requestStep.createMany({ data: newSteps });
  if (newEvents.length) await tx.requestEvent.createMany({ data: newEvents.map((e) => e.row) });
  let outboxQueued = 0;
  for (const e of newEvents) {
    for (const n of e.notifications) {
      const to = emails.get(n.to);
      if (!to) throw new Error(`no Employee row (address) for ${n.to}`);
      await enqueue({ channel: 'email', to, template: n.template, data: n.data, orgId }, tx);
      outboxQueued++;
    }
  }

  const ledgerHash = createHash('sha256').update(engineEntries.map(ledgerNaturalKey).join('\n')).digest('hex');
  return {
    orgId, asOf, openAsOfDay: opts.openAsOfDay === true,
    ledger: { existing: stored.length, inserted: newEntries.length },
    chains: { existing: storedChains.size, inserted: newChains.length },
    steps: { existing: storedSteps.size, inserted: newSteps.length },
    events: { existing: storedEvents.size, inserted: newEvents.length },
    outboxQueued,
    engine: { entries: engineEntries.length, requests: result.requests.size, voided: result.voided, ignored: result.ignored, recomputed: result.recomputed },
    ledgerHash,
  };
}

/** Serialises writers on the org (SELECT … FOR UPDATE on the Org row) so two replays cannot interleave ledger seqs. */
export async function lockOrg(tx: Tx, orgId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Org" WHERE id = ${orgId}::uuid FOR UPDATE`;
  if (rows.length !== 1) throw new Error(`org ${orgId} not found`);
}

export const REPLAY_TX = { timeout: 120_000, maxWait: 15_000 } as const;
