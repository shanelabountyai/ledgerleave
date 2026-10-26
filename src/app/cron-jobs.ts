import { nightlyClose } from '@/leave-db/close';

// Clone-owned (plan §3.2): /api/cron calls this after its own core sweeps. A clone adds its jobs here,
// and removing the notifications module deletes the lines marked `// notifications`.
//
// Ledgerleave (D-40, non-negotiable 10): the template's outbox DRAIN is deliberately not wired. Approval
// notifications are queued by the replay (src/leave-db/replay.ts) and stay QUEUED; nothing leaves in Phases 1–3.
// Wiring `drainOutbox()` back in here is the one edit that would start sending.
//
// Phase 3 task 3.6: the nightly close — per org, replay today with the day open, which closes yesterday (D-51);
// archived orgs are skipped (D-47). The day comes from the org's zone (D-43), never from the process clock.
export async function cronJobs(): Promise<Record<string, unknown>> {
  return { leaveClose: await nightlyClose() };
}
