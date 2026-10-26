import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { loadOrgFromDb } from '@/leave-db/replay';
import { todayFor } from '@/leave-db/today';
import { inboxFor, requestViews } from '@/leave-db/read';
import { NO_EMPLOYEE_MESSAGE, employeeForUser } from '@/leave-db/people';
import { approveLeave, denyLeave } from '../actions';
import { RequestCard } from '../_ui/requests';

export const metadata = { title: 'Approvals inbox' };
export const dynamic = 'force-dynamic';

// Requests whose CURRENT step names you: the chain frozen at submit, overridden only by a REASSIGN (D-20). An
// approval you are not eligible for is still recorded — as VOID with its code, shown on the request, never applied.
export default async function Inbox({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const me = await employeeForUser(ctx.orgId, ctx.userId);
  if (!me) return <main><h1>Approvals inbox</h1><p role="status">{NO_EMPLOYEE_MESSAGE}</p></main>;
  const items = await inboxFor(ctx.orgId, me.employeeId);
  const today = await todayFor(ctx.orgId);
  const { org } = await loadOrgFromDb(db, ctx.orgId);
  const reports = [...org.employees.keys()].filter((id) => org.managerOf(id, today) === me.employeeId);
  const inbox = new Set(items.map((r) => r.requestId));
  const team = reports.length ? (await requestViews(ctx.orgId, { employeeId: { in: reports } })).filter((r) => r.open && !inbox.has(r.requestId)) : [];
  const href = (id: string) => `/o/${ctx.slug}/leave/requests/${id}`;
  return (
    <main>
      <h1>Approvals inbox</h1>
      <h2>Waiting on you</h2>
      <p>Requests waiting on {me.name} ({me.employeeId}): <strong>{items.length}</strong>.</p>
      {items.map((r) => (
        <RequestCard key={r.id} r={r} href={href(r.requestId)} actions={[{ label: 'Approve', action: approveLeave.bind(null, ctx.slug) }, { label: 'Deny', action: denyLeave.bind(null, ctx.slug) }]} />
      ))}
      <h2>Open requests of your reports as of {today} that are not waiting on you ({team.length})</h2>
      <p className="ll-muted">The chain was frozen when each was submitted (D-20); approving one of these is recorded as void.</p>
      {team.map((r) => <RequestCard key={r.id} r={r} href={href(r.requestId)} />)}
    </main>
  );
}
