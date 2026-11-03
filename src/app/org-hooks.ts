import { archivedOrgIds, refuseOrgDelete } from '@/leave-db/archive';
import type { ListedOrg } from '@/core/tenancy/listed';

// Clone-owned, like cron-jobs.ts: what must happen before an org is deleted. Throwing stops the
// deletion. The billing module (and its `// billing` lines here) was removed (D-46).
// D-47: an org with append-only leave history, or an archived one, is never deleted; the refusal is a
// `Refused`, so the template's delete form shows it as a message rather than a stack trace.
export async function beforeOrgDelete(orgId: string): Promise<void> {
  await refuseOrgDelete(orgId);
}

// Clone-owned (v1.4.0): which of a user's orgs the template's org lists show — `/onboarding`, where every
// sign-in lands, and each account on `/demo`. Return the ones to show; the default shows them all. A clone
// that archives orgs returns `orgs` minus the archived ones. The template keeps only ids that were in
// `orgs` (core/tenancy/listed.ts), so this can hide an org but never add or rename one. Display only:
// it does not stop a member opening `/o/<slug>`, which the clone's own pages decide.
// D-47 (closed by D-61): archived orgs are hidden here, one query for the whole list.
export async function filterListedOrgs(_userId: string, orgs: readonly ListedOrg[]): Promise<readonly ListedOrg[]> {
  const archived = await archivedOrgIds(orgs.map((o) => o.id));
  return orgs.filter((o) => !archived.has(o.id));
}
