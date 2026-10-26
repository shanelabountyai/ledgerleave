// Phase 3 task 3.6 acceptance: the nightly close posts yesterday's boundaries once, whichever order it runs in with
// a live action, and skips an archived org. The clock is pinned to an instant; the org zone turns it into the day.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { advanceClock } from '@/core/clock';
import { db } from '@/core/db';
import { cronJobs } from '@/app/cron-jobs';
import { submitRequest } from '@/leave-db/actions';
import { archiveOrg } from '@/leave-db/archive';
import { closeDay, nightlyClose } from '@/leave-db/close';
import { seedHandOrg } from '../../../scripts/leave/seed-hand-org';
import { resetAuthTables } from '../../helpers/auth';

afterAll(() => {
  advanceClock(0);
  return db.$disconnect();
});
/** 00:30 in Chicago on 2025-01-01 is 06:30 UTC. */
const at = (ms: number) => advanceClock(ms - Date.now());
const JAN1_0030_CHICAGO = Date.UTC(2025, 0, 1, 6, 30);
const forfeitures = (orgId: string, day: string) => db.ledgerEntry.count({ where: { orgId, kind: 'FORFEITURE', effective: day } });

let orgId: string;
beforeEach(async () => {
  advanceClock(0);
  await resetAuthTables();
  orgId = await seedHandOrg({ slug: 'close' });
}, 60_000);

describe('nightly close (task 3.6, D-51)', () => {
  it('closes 2024-12-31 at 00:30 on 2025-01-01: the year-end forfeitures post once; a second run inserts 0', async () => {
    at(JAN1_0030_CHICAGO);
    const first = await closeDay(orgId);
    expect([first.today, first.closed]).toEqual(['2025-01-01', '2024-12-31']);
    expect(first.ledgerInserted).toBeGreaterThan(0);
    const n = await forfeitures(orgId, '2024-12-31');
    expect(n).toBeGreaterThan(0); // every hand employee is over the 2400 cap at 2024 year end
    const second = await closeDay(orgId);
    expect([second.ledgerInserted, second.eventsInserted, second.outboxQueued]).toEqual([0, 0, 0]);
    expect(await forfeitures(orgId, '2024-12-31')).toBe(n);
  });

  it('a live action after midnight first, then the close: still prefix-safe, still once', async () => {
    at(JAN1_0030_CHICAGO);
    await submitRequest({ orgId, employeeId: 'H4', leaveType: 'PTO', start: '2025-01-06', end: '2025-01-06', on: '2025-01-01' });
    const n = await forfeitures(orgId, '2024-12-31');
    expect(n).toBeGreaterThan(0); // the live replay already closed yesterday
    expect((await closeDay(orgId)).ledgerInserted).toBe(0);
    expect(await forfeitures(orgId, '2024-12-31')).toBe(n);
  });

  it('the same instant is still 2024-12-31 for an org in Honolulu: nothing of 12-31 is closed there', async () => {
    await db.leaveSettings.update({ where: { orgId }, data: { timeZone: 'Pacific/Honolulu' } });
    at(JAN1_0030_CHICAGO); // 20:30 on 12-31 in Honolulu
    const r = await closeDay(orgId);
    expect([r.today, r.closed]).toEqual(['2024-12-31', '2024-12-30']);
    expect(await forfeitures(orgId, '2024-12-31')).toBe(0); // 12-31 is still open: its boundary waits for the close
  });

  it('cronJobs runs it for every org with a leave setup and skips archived ones', async () => {
    const other = await seedHandOrg({ slug: 'close-archived' });
    const u = await db.user.create({ data: { email: 'o@close.test' } });
    await archiveOrg({ orgId: other, userId: u.id, reason: 'closed' });
    at(JAN1_0030_CHICAGO);
    const out = (await cronJobs()) as { leaveClose: Awaited<ReturnType<typeof nightlyClose>> };
    expect(out.leaveClose.skippedArchived).toBe(1);
    expect(out.leaveClose.closed.map((c) => [c.orgId, c.closed])).toEqual([[orgId, '2024-12-31']]);
    expect(await db.ledgerEntry.count({ where: { orgId: other } })).toBe(0);
  });
});
