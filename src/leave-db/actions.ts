/**
 * Live writes through the engines (Phase 2 task 2.5, D-39). A live action is a COMMAND — what somebody did on a
 * day — appended to RequestCommand, followed by the same replay the fixtures go through, with the command's day
 * left open (D-38). The engine decides what the command means (applied, void or ignored), freezes the chain on a
 * SUBMIT, posts usage, reversals and A7 recomputes, and the replay stores it all plus the outbox rows, in ONE
 * transaction under the org lock. There is no second code path: history and live are the same replay.
 *
 * These are library functions, not Next server actions: Phase 3 wraps them in `orgAction` with the foundation's
 * guards and maps the signed-in user to an employee id. Nothing here reads the clock — `on` is an argument.
 */
import { type CalendarDay, calendarDay } from '@/accrual/calendar';
import { LEAVE_TYPES } from '@/accrual/policy';
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';
import { type Action } from '@/routing/requests';
import { assertWritable } from './archive';
import { ActionRefused } from './errors';
import { type EventOutcome, REPLAY_TX, type ReplayResult, type Tx, lockOrg, replay } from './replay';

export interface ActionOutcome {
  readonly requestId: string;
  readonly seq: number;
  readonly outcome: EventOutcome;
  readonly logLines: readonly string[];
  readonly state: string; // PENDING_k for an open request, else the state name
  readonly finalCode: string;
  readonly replay: ReplayResult;
}

export { ActionRefused }; // moved to ./errors (it is the foundation's Refused now, D-42)

async function nextOrdinal(tx: Tx, orgId: string, on: string): Promise<number> {
  const last = await tx.requestCommand.findFirst({ where: { orgId, on }, orderBy: { ordinal: 'desc' }, select: { ordinal: true } });
  return (last?.ordinal ?? 0) + 1;
}

async function nextSeq(tx: Tx, orgId: string, requestId: string): Promise<number> {
  const last = await tx.requestCommand.findFirst({ where: { orgId, requestId }, orderBy: { seq: 'desc' }, select: { seq: true } });
  return (last?.seq ?? 0) + 1;
}

/** `R-` + the next 4-digit number for the org (the fixtures use R-0001..R-0389). */
async function nextRequestId(tx: Tx, orgId: string): Promise<string> {
  const rows = await tx.leaveRequest.findMany({ where: { orgId }, select: { requestId: true } });
  let max = 0;
  for (const r of rows) {
    const m = /^R-(\d+)$/.exec(r.requestId);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `R-${String(max + 1).padStart(4, '0')}`;
}

async function record(tx: Tx, orgId: string, requestId: string, on: CalendarDay, actor: string, action: Action, target: string): Promise<ActionOutcome> {
  const seq = await nextSeq(tx, orgId, requestId);
  const data: Prisma.RequestCommandCreateManyInput = { orgId, requestId, seq, on, actor, action, target, ordinal: await nextOrdinal(tx, orgId, on) };
  await tx.requestCommand.create({ data });
  const result = await replay(tx, orgId, on, { openAsOfDay: true });
  const ev = await tx.requestEvent.findUnique({ where: { orgId_requestId_seq: { orgId, requestId, seq } } });
  if (!ev) throw new Error(`replay to ${on} did not produce an event for ${requestId} seq ${seq} (is the command dated after as-of?)`);
  return {
    requestId, seq, outcome: ev.outcome as EventOutcome, logLines: ev.logLines,
    state: ev.stateAfter === 'PENDING' ? `PENDING_${ev.stepAfter + 1}` : ev.stateAfter, finalCode: ev.finalCodeAfter, replay: result,
  };
}

export interface SubmitInput {
  readonly orgId: string;
  readonly employeeId: string;
  readonly leaveType: string;
  readonly start: string;
  readonly end: string;
  /** The day the request is submitted — the command's date and the request's submittedOn. */
  readonly on: string;
}

/** S1: create the request and its SUBMIT command, then replay — the chain is frozen and A8 decides (D-12, D-20). */
export async function submitRequest(input: SubmitInput): Promise<ActionOutcome> {
  const start = calendarDay(input.start);
  const end = calendarDay(input.end);
  const on = calendarDay(input.on);
  if (!(LEAVE_TYPES as readonly string[]).includes(input.leaveType)) throw new ActionRefused(`leave type must be one of ${LEAVE_TYPES.join('|')}`);
  if (end < start) throw new ActionRefused('end is before start');
  return db.$transaction(async (tx) => {
    await lockOrg(tx, input.orgId);
    await assertWritable(tx, input.orgId);
    const emp = await tx.employee.findUnique({ where: { orgId_employeeId: { orgId: input.orgId, employeeId: input.employeeId } } });
    if (!emp) throw new ActionRefused(`unknown employee ${input.employeeId}`);
    const requestId = await nextRequestId(tx, input.orgId);
    await tx.leaveRequest.create({ data: { orgId: input.orgId, requestId, employeeId: input.employeeId, leaveType: input.leaveType, start, end, submittedOn: on } });
    return record(tx, input.orgId, requestId, on, input.employeeId, 'SUBMIT', '');
  }, REPLAY_TX);
}

export interface DecisionInput {
  readonly orgId: string;
  readonly requestId: string;
  readonly actor: string;
  readonly on: string;
}

/** S3: approve the current step — void if the actor is not its approver, inactive, or lost HR (D-20). */
export const approveRequest = (i: DecisionInput): Promise<ActionOutcome> => command(i, 'APPROVE', '');
/** S3: deny at the current step by an eligible approver. */
export const denyRequest = (i: DecisionInput): Promise<ActionOutcome> => command(i, 'DENY', '');
/** S4: cancel by the requester or an HR holder; after approval the reversals and the A7 recompute post in this transaction. */
export const cancelRequest = (i: DecisionInput): Promise<ActionOutcome> => command(i, 'CANCEL', '');
/** S-REASSIGN: an HR holder replaces the current step's approver. */
export const reassignStep = (i: DecisionInput & { readonly target: string }): Promise<ActionOutcome> => command(i, 'REASSIGN', i.target);

async function command(i: DecisionInput, action: Exclude<Action, 'SUBMIT'>, target: string): Promise<ActionOutcome> {
  const on = calendarDay(i.on);
  if (action === 'REASSIGN' && target === '') throw new ActionRefused('REASSIGN needs a target approver');
  return db.$transaction(async (tx) => {
    await lockOrg(tx, i.orgId);
    await assertWritable(tx, i.orgId);
    const req = await tx.leaveRequest.findUnique({ where: { orgId_requestId: { orgId: i.orgId, requestId: i.requestId } } });
    if (!req) throw new ActionRefused(`unknown request ${i.requestId}`);
    if (!(await tx.employee.findUnique({ where: { orgId_employeeId: { orgId: i.orgId, employeeId: i.actor } } }))) throw new ActionRefused(`unknown actor ${i.actor}`);
    return record(tx, i.orgId, i.requestId, on, i.actor, action, target);
  }, REPLAY_TX);
}
