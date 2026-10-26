/**
 * Phase 3 task 3.6: the nightly close (the task 2.8 seam, built). For every org with a leave setup that is not archived
 * (D-47), replay the org's TODAY with the day left open (D-38, D-43): that posts every boundary up to and including
 * yesterday — yesterday is now closed — plus today's class-0 accruals, exactly as a live action at 00:01 would, and
 * nothing else. Replaying "yesterday, closed" (the 2.8 comment) diverges as soon as a live action has already
 * replayed today, because the stored ledger then extends past yesterday; replaying today open is the same close
 * and is prefix-safe in both orders (D-51). Running it twice inserts nothing the second time.
 * Nothing here reads the clock on the date axis except through `todayFor` (the one converter).
 */
import { db } from '@/core/db';
import { isArchived } from './archive';
import { REPLAY_TX, lockOrg, replay } from './replay';
import { dayBefore, todayFor } from './today';

export interface CloseRow {
  readonly orgId: string;
  readonly today: string;
  readonly closed: string;
  readonly ledgerInserted: number;
  readonly eventsInserted: number;
  readonly outboxQueued: number;
}

export async function closeDay(orgId: string): Promise<CloseRow> {
  const today = await todayFor(orgId);
  const r = await db.$transaction(async (tx) => {
    await lockOrg(tx, orgId);
    return replay(tx, orgId, today, { openAsOfDay: true });
  }, REPLAY_TX);
  return { orgId, today, closed: dayBefore(today), ledgerInserted: r.ledger.inserted, eventsInserted: r.events.inserted, outboxQueued: r.outboxQueued };
}

/** Every org with LeaveSettings, archived ones skipped (D-47). Returns one row of numbers per org closed. */
export async function nightlyClose(): Promise<{ closed: CloseRow[]; skippedArchived: number }> {
  const orgs = await db.leaveSettings.findMany({ select: { orgId: true }, orderBy: { orgId: 'asc' } });
  const closed: CloseRow[] = [];
  let skippedArchived = 0;
  for (const { orgId } of orgs) {
    if (await isArchived(orgId)) {
      skippedArchived += 1;
      continue;
    }
    closed.push(await closeDay(orgId));
  }
  return { closed, skippedArchived };
}
