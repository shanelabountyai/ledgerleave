import { notFound } from 'next/navigation';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { employeeForUser, hrAccess } from '@/leave-db/people';
import { ledgerFor } from '@/leave-db/read';
import { todayFor } from '@/leave-db/today';

export const metadata = { title: 'Ledger' };
export const dynamic = 'force-dynamic';

// Every entry for one employee (task 3.5): kind, effective, posted, minutes, codes, ref, and the running L1 balance
// as of each row's effective day. Visible to the employee and to HR.
export default async function Ledger({ params }: { params: Promise<{ org: string; employee: string }> }) {
  const ctx = await requireOrg((await params).org);
  const p = await params;
  const emp = await db.employee.findFirst({ where: { orgId: ctx.orgId, employeeId: p.employee } });
  if (!emp) notFound();
  const me = await employeeForUser(ctx.orgId, ctx.userId);
  if (me?.employeeId !== emp.employeeId && !(await hrAccess(ctx.orgId, ctx.userId, ctx.role, await todayFor(ctx.orgId))).allowed) notFound();
  const rows = await ledgerFor(ctx.orgId, emp.employeeId);
  return (
    <main>
      <h1>Ledger: {emp.name} ({emp.employeeId})</h1>
      <p>{rows.length} entries, append-only. The running balance on each row is L1: every entry effective on or before that row&rsquo;s day.</p>
      {[...new Set(rows.map((r) => r.leaveType))].map((lt) => (
        <section key={lt} aria-label={`${lt} ledger`}>
          <h2>{lt}</h2>
          <div className="ll-scroll">
            <table>
              <thead><tr><th scope="col">Entry</th><th scope="col">Kind</th><th scope="col">Effective</th><th scope="col">Posted</th><th scope="col" className="ll-n">Minutes</th><th scope="col" className="ll-n">Capped</th><th scope="col">Codes</th><th scope="col">Ref</th><th scope="col" className="ll-n">Running balance</th></tr></thead>
              <tbody>
                {rows.filter((r) => r.leaveType === lt).map((r) => (
                  <tr key={r.entryId}><td>{r.entryId}</td><td>{r.kind}</td><td>{r.effective}</td><td>{r.posted}</td><td className="ll-n">{r.minutes}</td><td className="ll-n">{r.cappedMinutes}</td><td><code>{r.codes}</code></td><td>{r.ref}</td><td className="ll-n">{r.runningBalance}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </main>
  );
}
