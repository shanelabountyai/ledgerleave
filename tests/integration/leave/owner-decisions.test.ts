// The 2026-10-26 owner decisions, against the database: D-42 (Employee.userId, set only by the audited HR action;
// email only suggests), D-43 (the org's zone decides "today"), D-45 through the live write path, D-47 (archive, keep
// Restrict: an archived org takes no write; delete-org refuses an org with history and changes no row; nothing in
// the repo disables a trigger).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { advanceClock } from '@/core/clock';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { beforeOrgDelete } from '@/app/org-hooks';
import { cancelRequest, submitRequest } from '@/leave-db/actions';
import { ARCHIVED_MESSAGE, archiveOrg, hasHistory, isArchived } from '@/leave-db/archive';
import { NO_EMPLOYEE_MESSAGE, employeeForUser, hrAccess, linkEmployee, linkSuggestions, requireEmployee } from '@/leave-db/people';
import { replay } from '@/leave-db/replay';
import { todayFor } from '@/leave-db/today';
import { calendarDay } from '@/accrual/calendar';
import { seedHandOrg } from '../../../scripts/leave/seed-hand-org';
import { resetAuthTables } from '../../helpers/auth';

afterAll(() => db.$disconnect());

let orgId: string;
const member = async (email: string, role: 'owner' | 'admin' | 'member' = 'member') => {
  const u = await db.user.create({ data: { email } });
  await db.membership.create({ data: { orgId, userId: u.id, role } });
  return u.id;
};
/** Every row of every table the org's writes could touch, as one string. */
const snapshot = async () => {
  const tables = ['Employee', 'LedgerEntry', 'RequestCommand', 'RequestEvent', 'FrozenChain', 'RequestStep', 'LeaveRequest', 'OrgArchive', 'Org', 'Outbox', 'LeaveSettings'];
  const parts = await Promise.all(tables.map((t) => db.$queryRawUnsafe<{ j: string }[]>(`SELECT coalesce(json_agg(x ORDER BY x::text)::text, '[]') AS j FROM "${t}" x`)));
  return parts.map((p, i) => `${tables[i]}:${p[0]!.j}`).join('\n');
};

beforeEach(async () => {
  advanceClock(0);
  await resetAuthTables();
  orgId = await seedHandOrg({ slug: 'decisions' });
}, 60_000);

describe('D-42 Employee.userId', () => {
  it('links only through the HR action, audits it, and an email match is only a suggestion', async () => {
    const hal = await member('h4@hand.example'); // same email as H4
    expect(await employeeForUser(orgId, hal)).toBeNull(); // nothing linked by itself
    expect(await linkSuggestions(orgId)).toEqual([{ employeeId: 'H4', employeeName: 'Hal (IC)', userId: hal, email: 'h4@hand.example' }]);
    await expect(requireEmployee(orgId, hal)).rejects.toThrow(NO_EMPLOYEE_MESSAGE);

    const admin = await member('boss@example.test', 'admin');
    await linkEmployee({ orgId, employeeId: 'H4', userId: hal, actorUserId: admin });
    expect(await employeeForUser(orgId, hal)).toEqual({ employeeId: 'H4', name: 'Hal (IC)' });
    expect(await linkSuggestions(orgId)).toEqual([]);
    const ev = await db.auditEvent.findMany({ where: { orgId, action: { startsWith: 'employee.' } } });
    expect(ev.map((e) => [e.action, e.actorUserId, (e.data as { employeeId: string }).employeeId])).toEqual([['employee.linked', admin, 'H4']]);

    await linkEmployee({ orgId, employeeId: 'H4', userId: null, actorUserId: admin });
    expect(await employeeForUser(orgId, hal)).toBeNull();
    expect(await db.auditEvent.count({ where: { orgId, action: 'employee.unlinked' } })).toBe(1);
  });

  it('refuses a non-member, a second employee for the same account, and an unknown employee — with messages', async () => {
    const admin = await member('boss@example.test', 'admin');
    const hal = await member('hal@example.test');
    const outsider = (await db.user.create({ data: { email: 'out@example.test' } })).id;
    await expect(linkEmployee({ orgId, employeeId: 'H4', userId: outsider, actorUserId: admin })).rejects.toThrow(/not a member/);
    await linkEmployee({ orgId, employeeId: 'H4', userId: hal, actorUserId: admin });
    await expect(linkEmployee({ orgId, employeeId: 'H5', userId: hal, actorUserId: admin })).rejects.toThrow(/already acts as H4/);
    await expect(linkEmployee({ orgId, employeeId: 'H99', userId: hal, actorUserId: admin })).rejects.toBeInstanceOf(Refused);
  });

  it('hrAccess: owner/admin by role; a member only while their linked employee holds HR on that day', async () => {
    const admin = await member('boss@example.test', 'admin');
    const hector = await member('hector@example.test');
    expect(await hrAccess(orgId, admin, 'admin', '2025-05-05')).toEqual({ allowed: true, via: 'org-admin' });
    expect(await hrAccess(orgId, hector, 'member', '2025-05-05')).toEqual({ allowed: false, via: 'none' });
    await linkEmployee({ orgId, employeeId: 'H7', userId: hector, actorUserId: admin });
    expect(await hrAccess(orgId, hector, 'member', '2025-05-05')).toEqual({ allowed: true, via: 'hr-role' });
    expect(await hrAccess(orgId, hector, 'member', '2025-05-06')).toEqual({ allowed: false, via: 'none' }); // H7's HR revoked 05-06
  });
});

describe('D-43 the org zone decides today', () => {
  it('the same instant is 2025-05-04 in Chicago and 2025-05-05 in Kiritimati', async () => {
    const t = Date.UTC(2025, 4, 5, 3, 0, 0);
    advanceClock(t - Date.now());
    expect(await todayFor(orgId)).toBe('2025-05-04');
    await db.leaveSettings.update({ where: { orgId }, data: { timeZone: 'Pacific/Kiritimati' } });
    expect(await todayFor(orgId)).toBe('2025-05-05');
  });
});

describe('D-45 through the live write path', () => {
  it('a second submit over the same days is denied OVERLAPPING_REQUEST; after a cancel the days are free again', async () => {
    const a = await submitRequest({ orgId, employeeId: 'H5', leaveType: 'PTO', start: '2025-05-19', end: '2025-05-20', on: '2025-05-05' });
    const b = await submitRequest({ orgId, employeeId: 'H5', leaveType: 'SICK', start: '2025-05-20', end: '2025-05-20', on: '2025-05-05' });
    expect([a.state, b.state, b.finalCode, b.logLines]).toEqual(['PENDING_1', 'DENIED', 'OVERLAPPING_REQUEST', ['SUBMIT:H5:2025-05-05:CHAIN_FROZEN', 'SYSTEM_DENY:SYSTEM:2025-05-05:OVERLAPPING_REQUEST']]);
    await cancelRequest({ orgId, requestId: a.requestId, actor: 'H5', on: '2025-05-06' });
    const c = await submitRequest({ orgId, employeeId: 'H5', leaveType: 'PTO', start: '2025-05-20', end: '2025-05-20', on: '2025-05-06' });
    expect(c.state).toBe('PENDING_1');
  });
});

describe('D-47 archive, keep Restrict', () => {
  it('an archived org refuses every write path with the same message, and nothing changes', async () => {
    const admin = await member('boss@example.test', 'owner');
    const hal = await member('hal@example.test');
    await submitRequest({ orgId, employeeId: 'H4', leaveType: 'PTO', start: '2025-05-19', end: '2025-05-20', on: '2025-05-05' });
    await archiveOrg({ orgId, userId: admin, reason: 'closed the company' });
    expect(await isArchived(orgId)).toBe(true);
    const before = await snapshot();
    await expect(submitRequest({ orgId, employeeId: 'H4', leaveType: 'PTO', start: '2025-06-02', end: '2025-06-03', on: '2025-05-06' })).rejects.toThrow(ARCHIVED_MESSAGE);
    await expect(cancelRequest({ orgId, requestId: 'R-0001', actor: 'H4', on: '2025-05-06' })).rejects.toThrow(ARCHIVED_MESSAGE);
    await expect(linkEmployee({ orgId, employeeId: 'H4', userId: hal, actorUserId: admin })).rejects.toThrow(ARCHIVED_MESSAGE);
    await expect(db.$transaction((tx) => replay(tx, orgId, calendarDay('2025-05-07')))).rejects.toThrow(ARCHIVED_MESSAGE);
    await expect(archiveOrg({ orgId, userId: admin, reason: 'again' })).rejects.toThrow(/already archived/);
    expect(await snapshot()).toBe(before);
    expect(await db.auditEvent.count({ where: { orgId, action: 'org.archived' } })).toBe(1);
  });

  it('OrgArchive is append-only: UPDATE and DELETE are refused by the trigger (archiving is one-way)', async () => {
    const admin = await member('boss@example.test', 'owner');
    await archiveOrg({ orgId, userId: admin, reason: 'closed' });
    await expect(db.$executeRawUnsafe(`UPDATE "OrgArchive" SET "reason" = 'x'`)).rejects.toThrow(/OrgArchive is append-only .*UPDATE refused/);
    await expect(db.$executeRawUnsafe(`DELETE FROM "OrgArchive"`)).rejects.toThrow(/OrgArchive is append-only .*DELETE refused/);
    await expect(db.org.delete({ where: { id: orgId } })).rejects.toThrow(/append-only/);
  });

  it('delete-org on an org with history is refused by the clone hook with a user-facing message, and no row changes', async () => {
    await submitRequest({ orgId, employeeId: 'H4', leaveType: 'PTO', start: '2025-05-19', end: '2025-05-20', on: '2025-05-05' });
    expect(await hasHistory(orgId)).toBe(true);
    const before = await snapshot();
    const err = await beforeOrgDelete(orgId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Refused); // orgAction turns it into { error } on the template's danger page
    expect((err as Error).message).toMatch(/append-only and is never deleted\. Archive the org instead/);
    expect(await snapshot()).toBe(before);
  });

  it('an org with no history and no archive may still be deleted (the hook lets it through)', async () => {
    await expect(beforeOrgDelete(orgId)).resolves.toBeUndefined();
    await db.org.delete({ where: { id: orgId } });
    expect(await db.employee.count({ where: { orgId } })).toBe(0);
  });

  it('no application code disables a trigger (src, scripts, prisma migrations)', () => {
    const root = join(import.meta.dirname, '../../..');
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) {
          if (n !== 'generated' && n !== 'node_modules') walk(p);
        } else if (/\.(ts|tsx|sql)$/.test(n) && /DISABLE\s+TRIGGER|session_replication_role/i.test(readFileSync(p, 'utf8'))) hits.push(relative(root, p));
      }
    };
    for (const d of ['src', 'scripts', 'prisma']) walk(join(root, d));
    expect(hits).toEqual([]);
  });
});
