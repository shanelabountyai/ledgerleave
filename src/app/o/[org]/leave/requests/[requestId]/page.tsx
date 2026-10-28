import { notFound } from 'next/navigation';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { loadOrgFromDb } from '@/leave-db/replay';
import { employeeForUser, hrAccess } from '@/leave-db/people';
import { describeEvent, requestViews } from '@/leave-db/read';
import { todayFor } from '@/leave-db/today';
import { approveLeave, cancelLeave, denyLeave } from '../../actions';
import { RequestCard } from '../../_ui/requests';

export const metadata = { title: 'Leave request' };
export const dynamic = 'force-dynamic';

// One request, for the people with a reason to see it: the requester, anyone named in its chain (as routed or by a
// REASSIGN), the requester's manager TODAY, and HR. A manager who took the team over after submit sees the request
// and may press Approve — the engine records that as VOID APPROVER_NOT_STEP_APPROVER, because the chain is frozen.
export default async function RequestPage({ params, searchParams }: { params: Promise<{ org: string; requestId: string }>; searchParams: Promise<{ event?: string }> }) {
  const ctx = await requireOrg((await params).org);
  const p = await params;
  const q = await searchParams;
  const [r] = await requestViews(ctx.orgId, { requestId: p.requestId });
  if (!r) notFound();
  const today = await todayFor(ctx.orgId);
  const me = await employeeForUser(ctx.orgId, ctx.userId);
  const hr = (await hrAccess(ctx.orgId, ctx.userId, ctx.role, today)).allowed;
  const { org } = await loadOrgFromDb(db, ctx.orgId);
  const named = me !== null && (r.employeeId === me.employeeId || r.steps.some((s) => s.approver === me.employeeId || s.routedApprover === me.employeeId) || org.managerOf(r.employeeId, today) === me.employeeId);
  if (!named && !hr) notFound();
  const actions = me && r.open ? [{ label: 'Approve', action: approveLeave.bind(null, ctx.slug) }, { label: 'Deny', action: denyLeave.bind(null, ctx.slug) }] : [];
  if (me && (r.open || r.state === 'APPROVED')) actions.push({ label: 'Cancel', action: cancelLeave.bind(null, ctx.slug) });
  const seq = q.event && /^\d{1,6}$/.test(q.event) ? Number(q.event) : null;
  const ev = seq === null ? null : await db.requestEvent.findUnique({ where: { orgId_requestId_seq: { orgId: ctx.orgId, requestId: r.requestId, seq } } });
  return (
    <main>
      <h1>Request {r.requestId}</h1>
      {ev && <p role="status">{describeEvent(ev)}</p>}
      <RequestCard r={r} actions={actions} level={2} />
    </main>
  );
}
