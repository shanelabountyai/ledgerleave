import { refuseOrgDelete } from '@/leave-db/archive';

// Clone-owned, like cron-jobs.ts: what must happen before an org is deleted. Throwing stops the
// deletion. The billing module (and its `// billing` lines here) was removed (D-46).
// D-47: an org with append-only leave history, or an archived one, is never deleted; the refusal is a
// `Refused`, so the template's delete form shows it as a message rather than a stack trace.
export async function beforeOrgDelete(orgId: string): Promise<void> {
  await refuseOrgDelete(orgId);
}
