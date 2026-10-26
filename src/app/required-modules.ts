// Clone-owned, like cron-jobs.ts and org-hooks.ts: modules this clone's own code depends on
// outside the marked lines (an import `foundation:check-modules` wouldn't otherwise see coming).
// foundation:check-modules leaves these in place and still removes the rest.
// Ledgerleave: the replay enqueues approval notifications through the notifications outbox (D-5, D-23);
// billing stays removable (D-31).
export const REQUIRED_MODULES: string[] = ['notifications'];
