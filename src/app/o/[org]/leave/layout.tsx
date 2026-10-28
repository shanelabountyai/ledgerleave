import { Hanken_Grotesk, Newsreader } from 'next/font/google';
import Link from 'next/link';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { isArchived } from '@/leave-db/archive';
import { employeeForUser, hrAccess } from '@/leave-db/people';
import { todayFor } from '@/leave-db/today';
import { ScopeBanner } from './_ui/banner';
import './leave.css';

const body = Hanken_Grotesk({ subsets: ['latin'], variable: '--ll-font-body', display: 'swap' });
const serif = Newsreader({ subsets: ['latin'], variable: '--ll-font-head', display: 'swap' });

// Navigation only (each page guards itself too: a layout does not re-run on client navigation). The archived
// banner and the scope banner sit above every leave page.
export default async function LeaveLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const base = `/o/${ctx.slug}/leave`;
  const [today, me, archived, settings] = await Promise.all([todayFor(ctx.orgId), employeeForUser(ctx.orgId, ctx.userId), isArchived(ctx.orgId), db.leaveSettings.findUnique({ where: { orgId: ctx.orgId } })]);
  const hr = await hrAccess(ctx.orgId, ctx.userId, ctx.role, today);
  return (
    <div className={`${body.variable} ${serif.variable} ll-root`}>
      <header>
      <nav className="ll-nav" aria-label="Leave">
        <Link href={base}>My leave</Link>
        <Link href={`${base}/inbox`}>Approvals inbox</Link>
        {me && <Link href={`${base}/ledger/${me.employeeId}`}>My ledger</Link>}
        {hr.allowed && <Link href={`${base}/hr`}>HR</Link>}
      </nav>
      <p className="ll-muted">
        Today for this org: <strong>{today}</strong> ({settings?.timeZone ?? 'America/Chicago'}) · {me ? <>you act as <strong>{me.name} ({me.employeeId})</strong></> : 'your account is not linked to an employee'}
      </p>
      {archived && <p className="ll-archived" role="note"><strong>Archived.</strong> This org is read-only: its leave history is kept and nothing new can be written (D-47).</p>}
      </header>
      {children}
      <ScopeBanner />
    </div>
  );
}
