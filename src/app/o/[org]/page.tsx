import Link from 'next/link';
import { requireOrg } from '@/core/authz/guards';

// Ledgerleave's org home points at the leave section (Phase 3). A link, not a redirect: the org nav stays the page's
// only navigation landmark here (the template's demo e2e reads it).
export default async function OrgHome({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  return (
    <main>
      <h1>Ledgerleave</h1>
      <p><Link href={`/o/${ctx.slug}/leave`}>Open leave: balances, requests and approvals</Link>.</p>
    </main>
  );
}
