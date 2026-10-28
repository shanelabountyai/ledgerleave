'use server';
// Phase 3 task 3.1: every leave action through the foundation's orgAction (guard, zod, Refused → { error }).
// Engine commands act as the signed-in user's linked employee (D-42, D-50) on the org's today (D-43); ids are row
// uuids looked up INSIDE the org, so another org's id and a missing id both end in notFound() (INV-02/03/04).
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { orgAction, ref } from '@/core/authz/action';
import type { OrgCtx } from '@/core/authz/guards';
import { db } from '@/core/db';
import { LEAVE_TYPES } from '@/accrual/policy';
import { type ActionOutcome, approveRequest, cancelRequest, denyRequest, reassignStep, submitRequest } from '@/leave-db/actions';
import { archiveOrg } from '@/leave-db/archive';
import { ActionRefused } from '@/leave-db/errors';
import { hrAccess, linkEmployee, requireEmployee } from '@/leave-db/people';
import { setOrgTimeZone } from '@/leave-db/settings';
import { todayFor } from '@/leave-db/today';

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates are YYYY-MM-DD.');
const base = (ctx: OrgCtx) => `/o/${ctx.slug}/leave`;

/**
 * After an engine command, show the request with the stored verdict of THIS command (`?event=<seq>`): the card the
 * button lived on may leave the list it was in (an approved request leaves the inbox), so the outcome gets a page.
 */
function shown(ctx: OrgCtx, o: ActionOutcome): never {
  redirect(`${base(ctx)}/requests/${o.requestId}?event=${o.seq}`);
}

async function requestRow(ctx: OrgCtx, id: string) {
  const r = await db.leaveRequest.findFirst({ where: { id, orgId: ctx.orgId }, select: { requestId: true, employeeId: true } });
  if (!r) notFound();
  return r;
}

async function employeeRow(ctx: OrgCtx, id: string) {
  const e = await db.employee.findFirst({ where: { id, orgId: ctx.orgId }, select: { employeeId: true } });
  if (!e) notFound();
  return e;
}

async function requireHr(ctx: OrgCtx, today: string) {
  if (!(await hrAccess(ctx.orgId, ctx.userId, ctx.role, today)).allowed) throw new ActionRefused('Only HR (or an org owner or admin) can do this.');
}

export const submitLeave = orgAction(
  null,
  z.object({ leaveType: z.enum(LEAVE_TYPES), start: DAY, end: DAY }),
  async (ctx, i) => {
    const me = await requireEmployee(ctx.orgId, ctx.userId);
    const on = await todayFor(ctx.orgId);
    const o = await submitRequest({ orgId: ctx.orgId, employeeId: me.employeeId, leaveType: i.leaveType, start: i.start, end: i.end, on });
    shown(ctx, o);
  },
);

const decide = (fn: typeof approveRequest) =>
  orgAction(null, z.object({ request: ref('leaveRequest') }), async (ctx, i) => {
    const r = await requestRow(ctx, i.request);
    const me = await requireEmployee(ctx.orgId, ctx.userId);
    const o = await fn({ orgId: ctx.orgId, requestId: r.requestId, actor: me.employeeId, on: await todayFor(ctx.orgId) });
    shown(ctx, o);
  });

export const approveLeave = decide(approveRequest);
export const denyLeave = decide(denyRequest);
/** The requester, or an HR holder on their behalf; the engine decides which (S4, CANCEL_NOT_REQUESTER_OR_HR). */
export const cancelLeave = decide(cancelRequest);

export const reassignLeave = orgAction(null, z.object({ request: ref('leaveRequest'), approver: ref('employee') }), async (ctx, i) => {
  const r = await requestRow(ctx, i.request);
  const target = await employeeRow(ctx, i.approver);
  const me = await requireEmployee(ctx.orgId, ctx.userId);
  const o = await reassignStep({ orgId: ctx.orgId, requestId: r.requestId, actor: me.employeeId, on: await todayFor(ctx.orgId), target: target.employeeId });
  shown(ctx, o);
});

async function memberUser(ctx: OrgCtx, userId: string) {
  const m = await db.membership.findFirst({ where: { orgId: ctx.orgId, userId }, select: { userId: true } });
  if (!m) notFound();
  return m.userId;
}

export const linkEmployeeToUser = orgAction(null, z.object({ employee: ref('employee'), user: ref('member') }), async (ctx, i) => {
  const e = await employeeRow(ctx, i.employee);
  const userId = await memberUser(ctx, i.user);
  await requireHr(ctx, await todayFor(ctx.orgId));
  await linkEmployee({ orgId: ctx.orgId, employeeId: e.employeeId, userId, actorUserId: ctx.userId });
  revalidatePath(`${base(ctx)}/hr`);
  return { notice: `${e.employeeId} linked.` };
});

export const unlinkEmployee = orgAction(null, z.object({ employee: ref('employee') }), async (ctx, i) => {
  const e = await employeeRow(ctx, i.employee);
  await requireHr(ctx, await todayFor(ctx.orgId));
  await linkEmployee({ orgId: ctx.orgId, employeeId: e.employeeId, userId: null, actorUserId: ctx.userId });
  revalidatePath(`${base(ctx)}/hr`);
  return { notice: `${e.employeeId} unlinked.` };
});

export const setTimeZone = orgAction(null, z.object({ timeZone: z.string().trim().min(1, 'Give a time zone.').max(64) }), async (ctx, i) => {
  await requireHr(ctx, await todayFor(ctx.orgId));
  await setOrgTimeZone({ orgId: ctx.orgId, timeZone: i.timeZone, actorUserId: ctx.userId });
  revalidatePath(`${base(ctx)}/hr`);
  return { notice: `Time zone set to ${i.timeZone}. Today is ${await todayFor(ctx.orgId)} for this org.` };
});

export const archiveThisOrg = orgAction('org.delete', z.object({ reason: z.string().trim().min(1, 'Say why the org is being archived.').max(500) }), async (ctx, i) => {
  await archiveOrg({ orgId: ctx.orgId, userId: ctx.userId, reason: i.reason });
  revalidatePath(base(ctx));
  return { notice: 'Archived. The org is read-only from now on; its history is kept.' };
});
