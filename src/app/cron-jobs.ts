// Clone-owned (plan §3.2): /api/cron calls this after its own core sweeps. A clone adds its jobs here,
// and removing the notifications module deletes the lines marked `// notifications`.
//
// Ledgerleave, Phase 2 (D-40, non-negotiable 10): the template's outbox DRAIN is deliberately not wired. Approval
// notifications are queued by the replay (src/leave-db/replay.ts) and stay QUEUED; nothing leaves in Phases 1–3.
// Wiring `drainOutbox()` back in here is the one edit that would start sending.
//
// Nightly close seam (task 2.8, not built — P1): a scheduled call would run, per org,
//   db.$transaction(tx => { await lockOrg(tx, orgId); return replay(tx, orgId, yesterday, { openAsOfDay: false }) }, REPLAY_TX)
// to post yesterday's class-2 boundaries and any class-0 accruals not yet posted, and nothing else — the replay
// inserts exactly the rows the engine posts beyond the stored prefix (tests/integration/leave/replay.test.ts
// "replay grows the ledger as a prefix"). `yesterday` must come from the org's calendar day, never from the
// process clock on the date axis (D-7); that conversion is the Phase 3 question, not this file's.
export async function cronJobs(): Promise<Record<string, unknown>> {
  return {};
}
