import { createHash } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrg } from '@/core/authz/guards';
import { can } from '@/core/authz/permissions';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { isArchived } from '@/leave-db/archive';
import { employeeForUser, hrAccess, linkSuggestions } from '@/leave-db/people';
import { employeeYearTable, requestViews } from '@/leave-db/read';
import { todayFor } from '@/leave-db/today';
import { archiveThisOrg, cancelLeave, linkEmployeeToUser, reassignLeave, setTimeZone, unlinkEmployee } from '../actions';
import { SICK_POLICY_LABEL } from '../_ui/banner';
import { RequestCard } from '../_ui/requests';

export const metadata = { title: 'HR console' };
export const dynamic = 'force-dynamic';

// HR console (task 3.4). Open to an org owner/admin or a linked employee holding HR today (D-42). Every number is a
// read over the Phase 2 rows: the employee-year table is employeeYearRows over LedgerEntry (what ledger:verify --db
// diffs), the outbox is QUEUED rows with no send button (non-negotiable 10).
export default async function Hr({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const today = await todayFor(ctx.orgId);
  if (!(await hrAccess(ctx.orgId, ctx.userId, ctx.role, today)).allowed) notFound();
  const [me, settings, employees, members, suggestions, pending, table, outbox, outboxQueued, policySet, delegations, changes, archived] = await Promise.all([
    employeeForUser(ctx.orgId, ctx.userId),
    db.leaveSettings.findUnique({ where: { orgId: ctx.orgId } }),
    db.employee.findMany({ where: { orgId: ctx.orgId }, orderBy: { employeeId: 'asc' }, include: { user: { select: { email: true } } } }),
    db.membership.findMany({ where: { orgId: ctx.orgId }, include: { user: { select: { id: true, email: true } } }, orderBy: { createdAt: 'asc' } }),
    linkSuggestions(ctx.orgId),
    requestViews(ctx.orgId),
    employeeYearTable(ctx.orgId, today),
    db.outbox.findMany({ where: { orgId: ctx.orgId }, orderBy: [{ sendAfter: 'desc' }, { id: 'asc' }], take: 25 }),
    Promise.all([db.outbox.count({ where: { orgId: ctx.orgId, sentAt: null } }), db.outbox.count({ where: { orgId: ctx.orgId, sentAt: { not: null } } })]),
    db.policySet.findFirst({ where: { orgId: ctx.orgId }, orderBy: { createdAt: 'desc' } }),
    db.delegation.findMany({ where: { orgId: ctx.orgId }, orderBy: [{ start: 'asc' }, { approverId: 'asc' }] }),
    db.orgChange.findMany({ where: { orgId: ctx.orgId }, orderBy: [{ effective: 'asc' }, { employeeId: 'asc' }] }),
    isArchived(ctx.orgId),
  ]);
  const open = pending.filter((r) => r.open);
  const linkedUsers = new Set(employees.map((e) => e.userId).filter(Boolean));
  const free = members.filter((m) => !linkedUsers.has(m.user.id));
  const policies = (policySet?.content as { policies?: { id: string; leave_type: string; accrual: { frequency: string }; carryover_cap_minutes: number; max_balance_minutes: number; allow_negative: boolean }[] } | null)?.policies ?? [];
  const policyHash = policySet ? createHash('sha256').update(JSON.stringify(policySet.content)).digest('hex') : '';
  const slug = ctx.slug;
  return (
    <main>
      <h1>HR console</h1>
      <p className="ll-muted">Acting as {me ? `${me.name} (${me.employeeId})` : 'an org owner/admin with no linked employee — engine actions (reassign, cancel) need a linked employee (D-50)'}.</p>

      <h2 id="people">People: who acts as whom (D-42)</h2>
      <p>An account acts as an employee only after an HR action here; a matching email is a suggestion, never a link.</p>
      {suggestions.length > 0 && (
        <>
          <h3>Suggested by matching email ({suggestions.length})</h3>
          {suggestions.map((s) => (
            <ActionForm key={s.employeeId} action={linkEmployeeToUser.bind(null, slug)}>
              <input type="hidden" name="employee" value={employees.find((e) => e.employeeId === s.employeeId)!.id} />
              <input type="hidden" name="user" value={s.userId} />
              <button type="submit">Link {s.employeeId} ({s.employeeName}) to {s.email}</button>
            </ActionForm>
          ))}
        </>
      )}
      <ActionForm action={linkEmployeeToUser.bind(null, slug)}>
        <label>Employee <select name="employee" required>{employees.filter((e) => !e.userId).map((e) => <option key={e.id} value={e.id}>{e.employeeId} {e.name}</option>)}</select></label>
        <label>Account <select name="user" required>{free.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.email}</option>)}</select></label>
        <button type="submit">Link</button>
      </ActionForm>
      <div className="ll-scroll">
        <table>
          <thead><tr><th scope="col">Employee</th><th scope="col">Roles</th><th scope="col">Employed</th><th scope="col">Account</th><th scope="col">Ledger</th></tr></thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id}>
                <th scope="row">{e.employeeId} {e.name}</th><td>{e.roles || '—'}</td><td>{e.hireDate}{e.termDate ? ` to ${e.termDate}` : ''}</td>
                <td>{e.user ? <ActionForm action={unlinkEmployee.bind(null, slug)}><input type="hidden" name="employee" value={e.id} />{e.user.email} <button type="submit">Unlink {e.employeeId}</button></ActionForm> : '—'}</td>
                <td><Link href={`/o/${slug}/leave/ledger/${e.employeeId}`}>{e.employeeId} ledger</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="zone">The org&rsquo;s calendar (D-43)</h2>
      <p>Today is <strong>{today}</strong> in <code>{settings?.timeZone ?? 'America/Chicago'}</code>. Every action is dated on this day; the nightly close replays the day before it.</p>
      <ActionForm action={setTimeZone.bind(null, slug)}>
        <label>IANA time zone <input name="timeZone" defaultValue={settings?.timeZone ?? 'America/Chicago'} required /></label>
        <button type="submit">Set time zone</button>
      </ActionForm>

      <h2 id="pending">Open requests ({open.length})</h2>
      {open.map((r) => (
        <div key={r.id}>
          <RequestCard r={r} href={`/o/${slug}/leave/requests/${r.requestId}`} actions={me ? [{ label: 'Cancel on behalf', action: cancelLeave.bind(null, slug) }] : []} />
          {me && (
            <ActionForm action={reassignLeave.bind(null, slug)}>
              <input type="hidden" name="request" value={r.id} />
              <label>Reassign the current step of {r.requestId} to <select name="approver">{employees.filter((e) => !e.termDate || e.termDate >= today).map((e) => <option key={e.id} value={e.id}>{e.employeeId} {e.name}</option>)}</select></label>
              <button type="submit">Reassign {r.requestId}</button>
            </ActionForm>
          )}
        </div>
      ))}

      <h2 id="balances">Employee-year table (from {table.length} rows of LedgerEntry sums)</h2>
      <p className="ll-muted">Minutes. Opening = everything effective before the year; used is net of reversals; balance is L1 at 12-31. The same function <code>ledger:verify --db</code> diffs against the oracle.</p>
      <div className="ll-scroll">
        <table>
          <thead><tr><th scope="col">Employee</th><th scope="col">Year</th><th scope="col">Type</th><th scope="col" className="ll-n">Opening</th><th scope="col" className="ll-n">Accrued</th><th scope="col" className="ll-n">Capped</th><th scope="col" className="ll-n">Used</th><th scope="col" className="ll-n">Forfeited</th><th scope="col" className="ll-n">Balance end</th></tr></thead>
          <tbody>
            {table.map((r) => (
              <tr key={`${r.employeeId}-${r.year}-${r.leaveType}`}>
                <th scope="row">{r.employeeId}</th><td>{r.year}</td><td>{r.leaveType}</td><td className="ll-n">{r.opening}</td><td className="ll-n">{r.accrued}</td><td className="ll-n">{r.capped}</td><td className="ll-n">{r.used}</td><td className="ll-n">{r.forfeited}</td><td className="ll-n">{r.balanceEnd}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="outbox">Outbox (nothing is sent)</h2>
      <p><strong>{outboxQueued[0]}</strong> queued (unsent) · <strong>{outboxQueued[1]}</strong> sent. Notifications queue here and are never sent: the drain is unwired (D-40). There is no send button.</p>
      <div className="ll-scroll">
        <table>
          <thead><tr><th scope="col">Template</th><th scope="col">To</th><th scope="col">Sent</th></tr></thead>
          <tbody>{outbox.map((o) => <tr key={o.id}><td>{o.template}</td><td>{o.to}</td><td>{o.sentAt ? 'sent' : 'queued, never sent'}</td></tr>)}</tbody>
        </table>
      </div>

      <h2 id="policy">Policies</h2>
      <p>Policy file sha256 <code>{policyHash}</code> (content as stored).</p>
      <ul>
        {policies.map((p) => (
          <li key={p.id}>
            <strong>{p.id}</strong> ({p.leave_type}, {p.accrual.frequency}, carryover cap {p.carryover_cap_minutes} min, max {p.max_balance_minutes} min, negative {p.allow_negative ? 'allowed' : 'not allowed'})
            {p.leave_type === 'SICK' && <> — sample policy: {SICK_POLICY_LABEL}</>}
          </li>
        ))}
      </ul>

      <h2 id="delegations">Delegations ({delegations.length}) and org changes ({changes.length})</h2>
      <ul>{delegations.map((d) => <li key={d.id}>{d.approverId} → {d.delegateId}, {d.start}..{d.end}</li>)}</ul>
      <ul>{changes.map((c) => <li key={c.id}>{c.effective}: {c.employeeId} {c.field} {c.oldValue} → {c.newValue}</li>)}</ul>

      {can(ctx.role, 'org.delete') && (
        <>
          <h2 id="archive">Archive the org (D-47)</h2>
          {archived ? <p>This org is archived.</p> : (
            <>
              <p>Leave history is append-only and is never deleted. Archiving makes the org read-only and hides it from your org list. It cannot be undone.</p>
              <ActionForm action={archiveThisOrg.bind(null, slug)}>
                <label>Reason <input name="reason" required maxLength={500} /></label>
                <button type="submit">Archive org</button>
              </ActionForm>
            </>
          )}
        </>
      )}
    </main>
  );
}
