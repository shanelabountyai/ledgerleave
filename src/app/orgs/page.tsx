import Link from 'next/link';
import { requireUser } from '@/core/auth/session';
import { db } from '@/core/db';

export const metadata = { title: 'Your orgs' };
export const dynamic = 'force-dynamic';

// D-47: the clone's org list hides archived orgs (an archived org is read-only history, reachable by its address).
// The template's /onboarding list is template-owned and still shows every membership; stated in decisions, not fixed.
export default async function Orgs() {
  const s = await requireUser();
  const memberships = await db.membership.findMany({
    where: { userId: s.userId },
    select: { role: true, org: { select: { slug: true, name: true, archive: { select: { archivedAt: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  const live = memberships.filter((m) => !m.org.archive);
  const hidden = memberships.length - live.length;
  return (
    <main>
      <h1>Your orgs</h1>
      {live.length ? (
        <ul>{live.map((m) => <li key={m.org.slug}><Link href={`/o/${m.org.slug}/leave`}>{m.org.name}</Link> ({m.role})</li>)}</ul>
      ) : (
        <p>No active orgs.</p>
      )}
      {hidden > 0 && <p>{hidden} archived org{hidden === 1 ? ' is' : 's are'} hidden from this list.</p>}
      <p><Link href="/onboarding">Create an org or see invitations</Link></p>
    </main>
  );
}
