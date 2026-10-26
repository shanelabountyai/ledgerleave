/**
 * The request state machine S1–S6 (docs/domain-brief.md §7, D-20, D-21). States and transitions are a table; anything
 * not in it is logged as ignored and changes nothing. SUBMIT freezes the chain (R9) and may deny at once (A8);
 * APPROVE/DENY check eligibility at the moment of the event (S3) and a failing event is VOID — logged, not applied.
 *
 * This module writes no ledger rows itself. It asks the ledger two questions through `RequestContext` (`available`,
 * `usageRowsFor`) and hands back `Effects` — the usage rows an approval owes, the reversals a cancellation owes —
 * for the simulation to post in D-9 order and follow with the A7 recompute. That keeps `src/routing/` free of any
 * import from `src/accrual/`.
 *
 * Lineage (D-32): BoxLoop / Bracketry's "state machine as a transition table, illegal transitions rejected and
 * logged" was not readable from this session; written fresh from §7.
 */
import { type Delegation, HR_ROLE, type Org } from './org';
import { type RoutingThresholds, type Step, chainString, route, stepRequiresHr } from './route';

export const STATES = ['DRAFT', 'SUBMITTED', 'PENDING', 'APPROVED', 'DENIED', 'CANCELLED'] as const;
export type RequestStateName = (typeof STATES)[number];
export const ACTIONS = ['SUBMIT', 'APPROVE', 'DENY', 'CANCEL', 'REASSIGN'] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * D-21: (state, action) → next state. PENDING carries a step index; APPROVE on the last kept step goes to APPROVED.
 * SYSTEM_DENY and ROUTE are the engine's own automatic moves out of SUBMITTED. Anything not here is IGNORED_* (S6).
 */
export const TRANSITIONS: ReadonlyMap<string, RequestStateName | 'PENDING|APPROVED'> = new Map([
  ['DRAFT:SUBMIT', 'SUBMITTED'],
  ['SUBMITTED:ROUTE', 'PENDING'],
  ['SUBMITTED:SYSTEM_DENY', 'DENIED'],
  ['PENDING:APPROVE', 'PENDING|APPROVED'],
  ['PENDING:DENY', 'DENIED'],
  ['PENDING:CANCEL', 'CANCELLED'],
  ['PENDING:REASSIGN', 'PENDING'],
  ['APPROVED:CANCEL', 'CANCELLED'],
]);

export const FINAL_CODES = {
  APPROVED: 'APPROVED',
  DENIED_BY_APPROVER: 'DENIED_BY_APPROVER',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  CANCELLED_PENDING: 'CANCELLED_PENDING',
  CANCELLED_AFTER_APPROVAL: 'CANCELLED_AFTER_APPROVAL',
  UNROUTABLE: 'UNROUTABLE',
} as const;

export const VOID_CODES = {
  APPROVER_NOT_STEP_APPROVER: 'APPROVER_NOT_STEP_APPROVER',
  APPROVER_INACTIVE: 'APPROVER_INACTIVE',
  APPROVER_INELIGIBLE_ROLE_REVOKED: 'APPROVER_INELIGIBLE_ROLE_REVOKED',
  CANCEL_NOT_REQUESTER_OR_HR: 'CANCEL_NOT_REQUESTER_OR_HR',
  REASSIGN_NOT_HR: 'REASSIGN_NOT_HR',
} as const;

export const IGNORED_CODES = {
  IGNORED_NOT_DRAFT: 'IGNORED_NOT_DRAFT',
  IGNORED_TERMINAL: 'IGNORED_TERMINAL',
  IGNORED_NOT_PENDING: 'IGNORED_NOT_PENDING',
} as const;

export interface Request {
  readonly id: string;
  readonly employeeId: string;
  readonly leaveType: string;
  readonly start: string;
  readonly end: string;
  readonly submittedOn: string;
}

export interface RequestEvent {
  readonly requestId: string;
  readonly seq: number;
  readonly on: string;
  readonly actor: string;
  readonly action: Action;
  readonly target: string; // REASSIGN: the new approver
  /**
   * Position within its day for the live write path (D-38): when present on every event of a day it wins the
   * within-day sort; absent (the fixture files), a day sorts by (requestId, seq) as the oracle does.
   */
  readonly ordinal?: number;
}

export interface RequestState {
  readonly req: Request;
  policyId: string;
  workingDays: number;
  minutes: number;
  state: RequestStateName;
  /** Index into the KEPT steps. */
  step: number;
  steps: Step[];
  /** chainString at submit; frozen (R9). */
  chain: string;
  finalCode: string;
  /** "ACTION:actor:date:code" lines, in order. */
  log: string[];
}

export function newRequestState(req: Request): RequestState {
  return { req, policyId: '', workingDays: 0, minutes: 0, state: 'DRAFT', step: 0, steps: [], chain: '', finalCode: '', log: [] };
}

export const keptSteps = (rs: RequestState): Step[] => rs.steps.filter((s) => s.kept);

/** What the state machine needs from a policy (structurally satisfied by `Policy`). */
export interface RequestPolicy extends RoutingThresholds {
  readonly id: string;
  readonly allowNegative: boolean;
}

/** A USAGE row as the cancellation needs to see it. */
export interface UsageRow {
  readonly policyId: string;
  readonly effective: string;
  readonly minutes: number;
}

export interface RequestContext {
  readonly org: Org;
  readonly delegations: readonly Delegation[];
  readonly workDayMinutes: number;
  policyFor(policyId: string): RequestPolicy;
  /** The assignment active on a date for this employee and leave type, or null (D-22: the policy of the start date). */
  assignmentPolicyOn(employeeId: string, leaveType: string, day: string): string | null;
  /** C1 working days of an inclusive range, as `YYYY-MM-DD` strings. */
  workingDays(start: string, end: string): string[];
  /** L2. */
  available(employeeId: string, leaveType: string): number;
  /** The USAGE rows an earlier approval of this request wrote (S4). */
  usageRowsFor(employeeId: string, leaveType: string, requestId: string): readonly UsageRow[];
}

export type Effects =
  | { readonly kind: 'none'; readonly voided?: true; readonly ignored?: true }
  | { readonly kind: 'usage'; readonly policyId: string; readonly days: readonly string[]; readonly postedOn: string; readonly minutesPerDay: number }
  | { readonly kind: 'reversal'; readonly rows: readonly UsageRow[]; readonly postedOn: string };

const NONE: Effects = { kind: 'none' };
const VOIDED: Effects = { kind: 'none', voided: true };
const IGNORED: Effects = { kind: 'none', ignored: true };

function ignore(rs: RequestState, ev: RequestEvent, code: string): Effects {
  rs.log.push(`${ev.action}:${ev.actor}:${ev.on}:${code}`);
  return IGNORED;
}

function voidEvent(rs: RequestState, ev: RequestEvent, code: string): Effects {
  rs.log.push(`VOID_${ev.action}:${ev.actor}:${ev.on}:${code}`);
  return VOIDED;
}

/**
 * Apply one event to one request (S1–S6). Mutates `rs` (state, step, log, steps[i].approver on REASSIGN) and returns
 * the ledger effects the caller must post. Mirrors tools/leavelib.py `Simulation._do_event`.
 */
export function applyEvent(rs: RequestState, ev: RequestEvent, ctx: RequestContext): Effects {
  const r = rs.req;
  if (ev.action === 'SUBMIT') {
    if (rs.state !== 'DRAFT') return ignore(rs, ev, IGNORED_CODES.IGNORED_NOT_DRAFT);
    const wd = ctx.workingDays(r.start, r.end);
    rs.workingDays = wd.length;
    rs.minutes = wd.length * ctx.workDayMinutes;
    rs.policyId = ctx.assignmentPolicyOn(r.employeeId, r.leaveType, r.start) ?? '';
    const pol = ctx.policyFor(rs.policyId);
    rs.steps = route({ org: ctx.org, policy: pol, delegations: ctx.delegations, requester: r.employeeId, submit: ev.on, workingDays: rs.workingDays });
    rs.chain = chainString(rs.steps);
    rs.state = 'SUBMITTED';
    rs.log.push(`SUBMIT:${ev.actor}:${ev.on}:CHAIN_FROZEN`);
    // A8: the balance check, after the chain so the denial still shows who would have approved
    if (!pol.allowNegative && ctx.available(r.employeeId, r.leaveType) - rs.minutes < 0) {
      rs.state = 'DENIED';
      rs.finalCode = FINAL_CODES.INSUFFICIENT_BALANCE;
      rs.log.push(`SYSTEM_DENY:SYSTEM:${ev.on}:${FINAL_CODES.INSUFFICIENT_BALANCE}`);
      return NONE;
    }
    if (keptSteps(rs).length === 0) {
      rs.state = 'SUBMITTED';
      rs.finalCode = FINAL_CODES.UNROUTABLE;
      return NONE;
    }
    rs.state = 'PENDING';
    return NONE;
  }

  // S6: a terminal request ignores everything except CANCEL after APPROVED
  const terminal = rs.state === 'APPROVED' || rs.state === 'DENIED' || rs.state === 'CANCELLED';
  if (terminal && !(rs.state === 'APPROVED' && ev.action === 'CANCEL')) return ignore(rs, ev, IGNORED_CODES.IGNORED_TERMINAL);

  if (ev.action === 'CANCEL') {
    if (ev.actor !== r.employeeId && !ctx.org.rolesOf(ev.actor, ev.on).has(HR_ROLE)) return voidEvent(rs, ev, VOID_CODES.CANCEL_NOT_REQUESTER_OR_HR);
    const wasApproved = rs.state === 'APPROVED';
    rs.state = 'CANCELLED';
    rs.finalCode = wasApproved ? FINAL_CODES.CANCELLED_AFTER_APPROVAL : FINAL_CODES.CANCELLED_PENDING;
    rs.log.push(`CANCEL:${ev.actor}:${ev.on}:${rs.finalCode}`);
    if (!wasApproved) return NONE;
    return { kind: 'reversal', rows: ctx.usageRowsFor(r.employeeId, r.leaveType, r.id), postedOn: ev.on };
  }

  if (rs.state !== 'PENDING') return ignore(rs, ev, IGNORED_CODES.IGNORED_NOT_PENDING);
  const step = keptSteps(rs)[rs.step];
  if (!step) throw new Error(`request ${r.id} is PENDING with no step ${rs.step}`);

  if (ev.action === 'REASSIGN') {
    if (!ctx.org.rolesOf(ev.actor, ev.on).has(HR_ROLE)) return voidEvent(rs, ev, VOID_CODES.REASSIGN_NOT_HR);
    step.approver = ev.target;
    rs.log.push(`REASSIGN:${ev.actor}:${ev.on}:STEP_REASSIGNED->${ev.target}`);
    return NONE;
  }

  // S3: eligibility for APPROVE / DENY
  if (ev.actor !== step.approver) return voidEvent(rs, ev, VOID_CODES.APPROVER_NOT_STEP_APPROVER);
  if (!ctx.org.isActive(ev.actor, ev.on)) return voidEvent(rs, ev, VOID_CODES.APPROVER_INACTIVE);
  if (stepRequiresHr(step.codes) && !ctx.org.rolesOf(ev.actor, ev.on).has(HR_ROLE)) return voidEvent(rs, ev, VOID_CODES.APPROVER_INELIGIBLE_ROLE_REVOKED);

  if (ev.action === 'DENY') {
    rs.state = 'DENIED';
    rs.finalCode = FINAL_CODES.DENIED_BY_APPROVER;
    rs.log.push(`DENY:${ev.actor}:${ev.on}:${step.stepId}`);
    return NONE;
  }

  // APPROVE
  rs.log.push(`APPROVE:${ev.actor}:${ev.on}:${step.stepId}`);
  rs.step += 1;
  if (rs.step < keptSteps(rs).length) return NONE;
  rs.state = 'APPROVED';
  rs.finalCode = FINAL_CODES.APPROVED;
  return { kind: 'usage', policyId: rs.policyId, days: ctx.workingDays(r.start, r.end), postedOn: ev.on, minutesPerDay: ctx.workDayMinutes };
}

/** `PENDING_k` for an open request, else the state name — the `final_state` column of expected_requests.csv. */
export function finalStateLabel(rs: RequestState): string {
  return rs.state === 'PENDING' ? `PENDING_${rs.step + 1}` : rs.state;
}
