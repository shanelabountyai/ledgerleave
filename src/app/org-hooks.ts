// Clone-owned, like cron-jobs.ts: what must happen before an org is deleted. Throwing stops the
// deletion. The billing module (and its `// billing` lines here) was removed (D-46).
export async function beforeOrgDelete(orgId: string): Promise<void> {
  void orgId;
}
