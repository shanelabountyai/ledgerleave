/**
 * Phase 3 read models: what the pages show, computed from the Phase 2 rows on every read (non-negotiable 1 — no
 * balance, state or chain is cached anywhere). Balances are sums over LedgerEntry (L1 as of a day, L2 over every
 * posted row); a request's state is its last RequestEvent's after-state; its current approver is the step AS ROUTED,
 * overridden by the last applied REASSIGN at that step (a REASSIGN never edits RequestStep, D-36). The submit
 * preview runs the same engines SUBMIT will run, writes nothing, and says what SUBMIT would say.
 */
import { type CalendarDay, calendarDay, workingDays, yearOf } from '@/accrual/calendar';
import { LEAVE_TYPES } from '@/accrual/policy';
import { type EmployeeYearRow, Simulation, employeeYearRows } from '@/accrual/simulate';
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';
import { overlappingOpen } from '@/routing/requests';
import { type Step, chainString, route, stepRequiresHr } from '@/routing/route';
import { loadWorldFromDb } from './replay';
import { ledgerEntriesFromDb } from './verify-db';

// ------------------------------------------------------------------------------------------------------ balances

export interface BalanceView {
  readonly leaveType: string;
  /** L1: Σ minutes of entries effective on or before `asOf`. */
  readonly balance: number;
  /** L2: Σ minutes of every posted entry (future-dated usage included). */
  readonly available: number;
}

export async function balancesFor(orgId: string, employeeId: string, asOf: string): Promise<BalanceView[]> {
  const rows = await db.ledgerEntry.findMany({ where: { orgId, employeeId }, select: { leaveType: true, effective: true, minutes: true } });
  return LEAVE_TYPES.filter((lt) => rows.some((r) => r.leaveType === lt)).map((lt) => {
    let balance = 0;
    let available = 0;
    for (const r of rows) {
      if (r.leaveType !== lt) continue;
      available += r.minutes;
      if (r.effective <= asOf) balance += r.minutes;
    }
    return { leaveType: lt, balance, available };
  });
}

/** Minutes as days and minutes of the org's 480-minute work day, for display next to the integer (never instead of it). */
export function asWorkDays(minutes: number, workDay = 480): string {
  const sign = minutes < 0 ? '−' : '';
  const m = Math.abs(minutes);
  const d = (m - (m % workDay)) / workDay;
  const rest = m % workDay;
  return `${sign}${d} d${rest ? ` ${rest} min` : ''}`;
}

// ------------------------------------------------------------------------------------------------------ requests

export interface StepView {
  readonly index: number;
  readonly stepId: string;
  readonly routedApprover: string;
  /** The approver now: as routed, or the target of the last applied REASSIGN at this step. */
  readonly approver: string;
  readonly codes: readonly string[];
  readonly kept: boolean;
  readonly requiresHr: boolean;
  readonly current: boolean;
}

export interface RequestView {
  readonly id: string; // LeaveRequest row uuid (what actions take)
  readonly requestId: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly leaveType: string;
  readonly start: string;
  readonly end: string;
  readonly submittedOn: string;
  readonly workingDays: number;
  readonly minutes: number;
  readonly chain: string;
  /** PENDING_k for an open request, else the state name. */
  readonly state: string;
  readonly open: boolean;
  readonly finalCode: string;
  readonly steps: readonly StepView[];
  readonly currentApprover: string | null;
  readonly log: readonly string[];
  readonly lastEvent: { readonly outcome: string; readonly lines: readonly string[]; readonly on: string } | null;
}

type Where = Prisma.LeaveRequestWhereInput;

export async function requestViews(orgId: string, where: Where = {}): Promise<RequestView[]> {
  const requests = await db.leaveRequest.findMany({ where: { ...where, orgId }, orderBy: { requestId: 'desc' } });
  if (requests.length === 0) return [];
  const ids = requests.map((r) => r.requestId);
  const [chains, steps, events, emps] = await Promise.all([
    db.frozenChain.findMany({ where: { orgId, requestId: { in: ids } } }),
    db.requestStep.findMany({ where: { orgId, requestId: { in: ids } }, orderBy: [{ requestId: 'asc' }, { index: 'asc' }] }),
    db.requestEvent.findMany({ where: { orgId, requestId: { in: ids } }, orderBy: [{ requestId: 'asc' }, { seq: 'asc' }] }),
    db.employee.findMany({ where: { orgId }, select: { employeeId: true, name: true } }),
  ]);
  const chainOf = new Map(chains.map((c) => [c.requestId, c]));
  const names = new Map(emps.map((e) => [e.employeeId, e.name]));
  const group = <T extends { requestId: string }>(xs: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of xs) m.set(x.requestId, [...(m.get(x.requestId) ?? []), x]);
    return m;
  };
  const stepsOf = group(steps);
  const eventsOf = group(events);
  return requests.map((r) => {
    const evs = eventsOf.get(r.requestId) ?? [];
    const last = evs[evs.length - 1];
    const open = last?.stateAfter === 'PENDING';
    const kept = (stepsOf.get(r.requestId) ?? []).filter((s) => s.kept);
    const reassigned = new Map<number, string>();
    for (const e of evs) if (e.action === 'REASSIGN' && e.outcome === 'APPLIED') reassigned.set(e.stepAfter, e.target);
    const currentIndex = open && last ? kept[last.stepAfter]?.index ?? -1 : -1;
    const stepViews: StepView[] = (stepsOf.get(r.requestId) ?? []).map((s) => {
      const k = kept.indexOf(s);
      return {
        index: s.index, stepId: s.stepId, routedApprover: s.approver, approver: k >= 0 ? (reassigned.get(k) ?? s.approver) : s.approver,
        codes: s.codes, kept: s.kept, requiresHr: stepRequiresHr(s.codes as Step['codes']), current: s.index === currentIndex,
      };
    });
    const c = chainOf.get(r.requestId);
    return {
      id: r.id, requestId: r.requestId, employeeId: r.employeeId, employeeName: names.get(r.employeeId) ?? r.employeeId, leaveType: r.leaveType,
      start: r.start, end: r.end, submittedOn: r.submittedOn, workingDays: c?.workingDays ?? 0, minutes: c?.minutes ?? 0, chain: c?.chain ?? '',
      state: last ? (last.stateAfter === 'PENDING' ? `PENDING_${last.stepAfter + 1}` : last.stateAfter) : 'DRAFT',
      open, finalCode: last?.finalCodeAfter ?? '', steps: stepViews,
      currentApprover: stepViews.find((s) => s.current)?.approver ?? null,
      log: evs.flatMap((e) => e.logLines),
      lastEvent: last ? { outcome: last.outcome, lines: last.logLines, on: last.on } : null,
    };
  });
}

/** Open requests whose current step names this employee (D-20: the frozen chain, plus REASSIGN). */
export async function inboxFor(orgId: string, employeeId: string): Promise<RequestView[]> {
  const candidates = await db.requestStep.findMany({ where: { orgId, kept: true, approver: employeeId }, select: { requestId: true } });
  const reassignedTo = await db.requestEvent.findMany({ where: { orgId, action: 'REASSIGN', outcome: 'APPLIED', target: employeeId }, select: { requestId: true } });
  const ids = [...new Set([...candidates, ...reassignedTo].map((x) => x.requestId))];
  if (ids.length === 0) return [];
  return (await requestViews(orgId, { requestId: { in: ids } })).filter((v) => v.open && v.currentApprover === employeeId);
}

/** One sentence for an engine verdict, from the stored RequestEvent — a void or ignored event is said, never swallowed. */
export function describeEvent(ev: { requestId: string; outcome: string; stateAfter: string; stepAfter: number; finalCodeAfter: string; logLines: readonly string[] }): string {
  const state = ev.stateAfter === 'PENDING' ? `PENDING_${ev.stepAfter + 1}` : ev.stateAfter;
  const what = ev.outcome === 'APPLIED' ? `${ev.requestId}: ${state}${ev.finalCodeAfter && ev.finalCodeAfter !== state ? ` (${ev.finalCodeAfter})` : ''}` : `${ev.requestId}: ${ev.outcome}`;
  return `${what} — ${ev.logLines.join('; ')}`;
}

// ------------------------------------------------------------------------------------------------------- ledger

export interface LedgerLine {
  readonly entryId: string;
  readonly leaveType: string;
  readonly kind: string;
  readonly effective: string;
  readonly posted: string;
  readonly minutes: number;
  readonly cappedMinutes: number;
  readonly codes: string;
  readonly ref: string;
  /** L1 balance as of this row's effective day, counting every row effective on or before it. */
  readonly runningBalance: number;
}

/** Every entry of one employee, per leave type in (effective, seq) order, each with its running L1 balance. */
export async function ledgerFor(orgId: string, employeeId: string): Promise<LedgerLine[]> {
  const rows = await db.ledgerEntry.findMany({ where: { orgId, employeeId }, orderBy: [{ leaveType: 'asc' }, { effective: 'asc' }, { seq: 'asc' }] });
  const out: LedgerLine[] = [];
  for (const lt of new Set(rows.map((r) => r.leaveType))) {
    const mine = rows.filter((r) => r.leaveType === lt);
    for (const r of mine) {
      const running = mine.reduce((s, x) => (x.effective <= r.effective ? s + x.minutes : s), 0);
      out.push({ entryId: r.entryId, leaveType: lt, kind: r.kind, effective: r.effective, posted: r.posted, minutes: r.minutes, cappedMinutes: r.cappedMinutes, codes: r.codes, ref: r.ref, runningBalance: running });
    }
  }
  return out;
}

/** The per employee-year table (brief §10) from LedgerEntry alone — the function ledger:verify --db diffs. */
export async function employeeYearTable(orgId: string, through: string): Promise<EmployeeYearRow[]> {
  const [entries, settings, emps] = await Promise.all([
    ledgerEntriesFromDb(db, orgId),
    db.leaveSettings.findUnique({ where: { orgId } }),
    db.employee.findMany({ where: { orgId }, select: { employeeId: true } }),
  ]);
  if (!settings || entries.length === 0) return [];
  const first = yearOf(calendarDay(settings.ledgerStart));
  const lastEffective = entries.reduce((m, e) => (e.effective > m ? e.effective : m), settings.ledgerStart);
  const last = Math.min(yearOf(calendarDay(through)), yearOf(calendarDay(lastEffective)));
  const years: number[] = [];
  for (let y = first; y <= last; y++) years.push(y);
  return employeeYearRows(entries, emps.map((e) => e.employeeId), years);
}

// ------------------------------------------------------------------------------------------------------ preview

export interface SubmitPreview {
  readonly leaveType: string;
  readonly policyId: string;
  readonly start: string;
  readonly end: string;
  readonly on: string;
  readonly workingDays: readonly string[];
  readonly minutes: number;
  readonly chain: string;
  readonly steps: readonly Step[];
  readonly available: number;
  readonly allowNegative: boolean;
  /** What SUBMIT would decide: D-45 first, then A8. */
  readonly verdict: 'PENDING' | 'OVERLAPPING_REQUEST' | 'INSUFFICIENT_BALANCE' | 'UNROUTABLE';
  readonly overlapsWith: string | null;
}

/** What SUBMIT would do today, without writing: the same engines on the same rows, the as-of day open (D-38). */
export async function previewSubmit(orgId: string, q: { employeeId: string; leaveType: string; start: string; end: string; on: CalendarDay }): Promise<SubmitPreview> {
  const start = calendarDay(q.start);
  const end = calendarDay(q.end);
  return db.$transaction(async (tx) => {
    const { world } = await loadWorldFromDb(tx, orgId, q.on);
    const result = new Simulation(world).run({ openAsOfDay: true });
    const a = world.assignments.find((x) => x.employeeId === q.employeeId && x.leaveType === q.leaveType && x.start <= start && (x.end === null || start <= x.end));
    if (!a) throw new Error(`no ${q.leaveType} policy on ${start}`);
    const pol = world.policyFile.policies.get(a.policyId)!;
    const wd = workingDays(start, end, world.holidays);
    const minutes = wd.length * world.policyFile.workDayMinutes;
    const steps = route({ org: world.org, policy: pol, delegations: world.delegations, requester: q.employeeId, submit: q.on, workingDays: wd.length });
    const available = result.ledger.available(q.employeeId, q.leaveType);
    const overlapsWith = overlappingOpen(result.requests, '', q.employeeId, start, end);
    const verdict = overlapsWith !== null ? 'OVERLAPPING_REQUEST'
      : !pol.allowNegative && available - minutes < 0 ? 'INSUFFICIENT_BALANCE'
      : steps.some((s) => s.kept) ? 'PENDING' : 'UNROUTABLE';
    return { leaveType: q.leaveType, policyId: pol.id, start, end, on: q.on, workingDays: wd, minutes, chain: chainString(steps), steps, available, allowNegative: pol.allowNegative, verdict, overlapsWith };
  }, { timeout: 60_000, maxWait: 15_000 });
}

/** Whether the employee has a policy assignment for this leave type on the day (the submit form offers only those). */
export async function leaveTypesOn(orgId: string, employeeId: string, day: string): Promise<string[]> {
  const a = await db.policyAssignment.findMany({ where: { orgId, employeeId, start: { lte: day }, OR: [{ end: null }, { end: { gte: day } }] }, select: { leaveType: true } });
  return [...new Set(a.map((x) => x.leaveType))].sort();
}
