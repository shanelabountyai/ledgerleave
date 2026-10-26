// Phase 3 task 3.1 acceptance: GR-15 walked through the 'use server' actions as signed-in users (the clock pinned to
// noon in the org's zone on each golden day, D-43), plus the refusals the pages rely on: no linked employee (D-42),
// not HR, overlap (D-45), archived org (D-47) — each a { error } message, never a stack trace.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { advanceClock } from '@/core/clock';
import { db } from '@/core/db';
import { approveLeave, archiveThisOrg, cancelLeave, linkEmployeeToUser, reassignLeave, setTimeZone, submitLeave } from '@/app/o/[org]/leave/actions';
import { describeEvent, inboxFor, requestViews } from '@/leave-db/read';
import { NavSignal } from '../../helpers/next';
import { NO_EMPLOYEE_MESSAGE } from '@/leave-db/people';
import { ARCHIVED_MESSAGE } from '@/leave-db/archive';
import { seedHandOrg } from '../../../scripts/leave/seed-hand-org';
import { resetAuthTables, signInAs } from '../../helpers/auth';
import { addMember } from '../../helpers/org';

afterAll(() => db.$disconnect());

const SLUG = 'hand-ui';
/** Noon in America/Chicago (CDT, UTC−5) on a May 2025 day. */
const noonOn = (day: string) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  advanceClock(Date.UTC(y, m - 1, d, 17, 0, 0) - Date.now());
};
let orgId: string;
const users: Record<string, string> = {};
const as = async (who: string) => signInAs(users[who]!, { mfa: true });
const rowId = async (requestId: string) => (await db.leaveRequest.findFirstOrThrow({ where: { orgId, requestId } })).id;
/** An engine command redirects to its request page with ?event=<seq>; read the stored verdict the page would show. */
const act = async (p: Promise<unknown>) => {
  try {
    return await p;
  } catch (e) {
    const m = e instanceof NavSignal && e.kind === 'redirect' ? /\/leave\/requests\/(R-\d+)\?event=(\d+)$/.exec(e.to ?? '') : null;
    if (!m) throw e;
    const ev = await db.requestEvent.findUniqueOrThrow({ where: { orgId_requestId_seq: { orgId, requestId: m[1]!, seq: Number(m[2]) } } });
    return { notice: describeEvent(ev) };
  }
};
const empRow = async (employeeId: string) => (await db.employee.findFirstOrThrow({ where: { orgId, employeeId } })).id;

beforeAll(async () => {
  advanceClock(0);
  await resetAuthTables();
  orgId = await seedHandOrg({ slug: SLUG });
  users.owner = (await addMember(orgId, 'owner', 'owner@hand-ui.test')).id;
  for (const h of ['H2', 'H3', 'H4', 'H7', 'H8']) users[h] = (await addMember(orgId, 'member', `${h.toLowerCase()}@hand-ui.test`)).id;
  users.nobody = (await addMember(orgId, 'member', 'nobody@hand-ui.test')).id;
  await as('owner');
  for (const h of ['H2', 'H3', 'H4', 'H7', 'H8']) {
    expect(await linkEmployeeToUser(SLUG, { employee: await empRow(h), user: users[h] })).toEqual({ notice: `${h} linked.` });
  }
}, 120_000);

afterAll(() => advanceClock(0));

describe('refusals are messages (D-42, D-50)', () => {
  it('a member with no linked employee is refused by every engine command', async () => {
    noonOn('2025-05-05');
    await as('nobody');
    expect(await act(submitLeave(SLUG, { leaveType: 'PTO', start: '2025-05-19', end: '2025-05-20' }))).toEqual({ error: NO_EMPLOYEE_MESSAGE });
  });
  it('a member who is not HR cannot link people or set the zone; an owner without an employee cannot run engine commands', async () => {
    await as('H4');
    expect(await setTimeZone(SLUG, { timeZone: 'UTC' })).toEqual({ error: 'Only HR (or an org owner or admin) can do this.' });
    await as('owner');
    expect(await act(submitLeave(SLUG, { leaveType: 'PTO', start: '2025-05-19', end: '2025-05-20' }))).toEqual({ error: NO_EMPLOYEE_MESSAGE });
    expect(await setTimeZone(SLUG, { timeZone: 'Mars/Base' })).toEqual({ error: '"Mars/Base" is not a time zone this server knows. Use an IANA name such as America/Chicago.' });
  });
});

describe('GR-15 through the server actions (brief §9)', () => {
  it('05-05: H4 submits Q1 (2 days) and Q2 (11 days); chains frozen as the golden says', async () => {
    noonOn('2025-05-05');
    await as('H4');
    expect(await act(submitLeave(SLUG, { leaveType: 'PTO', start: '2025-05-19', end: '2025-05-20' }))).toEqual({ notice: 'R-0001: PENDING_1 — SUBMIT:H4:2025-05-05:CHAIN_FROZEN' });
    expect(await act(submitLeave(SLUG, { leaveType: 'PTO', start: '2025-06-02', end: '2025-06-16' }))).toEqual({ notice: 'R-0002: PENDING_1 — SUBMIT:H4:2025-05-05:CHAIN_FROZEN' });
    const [q2, q1] = await requestViews(orgId);
    expect([q1!.chain, q2!.chain]).toEqual(['MANAGER:H3[MANAGER_OF_REQUESTER]', 'MANAGER:H3[MANAGER_OF_REQUESTER]|SKIP_LEVEL:H2[MANAGER_OF_MANAGER]|HR:H7[HR_ROLE_HOLDER]']);
  });
  it('05-06/05-07: H3 then H2 approve Q2', async () => {
    noonOn('2025-05-06');
    await as('H3');
    expect(await act(approveLeave(SLUG, { request: await rowId('R-0002') }))).toEqual({ notice: 'R-0002: PENDING_2 — APPROVE:H3:2025-05-06:MANAGER' });
    noonOn('2025-05-07');
    await as('H2');
    expect(await act(approveLeave(SLUG, { request: await rowId('R-0002') }))).toEqual({ notice: 'R-0002: PENDING_3 — APPROVE:H2:2025-05-07:SKIP_LEVEL' });
  });
  it('05-08: H2 (the new manager) is not Q1\'s approver: void, shown; H2\'s inbox never had Q1 (the chain is frozen), H3\'s does', async () => {
    noonOn('2025-05-08');
    expect((await inboxFor(orgId, 'H2')).map((r) => r.requestId)).toEqual([]);
    expect((await inboxFor(orgId, 'H3')).map((r) => r.requestId)).toEqual(['R-0001']);
    await as('H2');
    expect(await act(approveLeave(SLUG, { request: await rowId('R-0001') }))).toEqual({ notice: 'R-0001: VOID — VOID_APPROVE:H2:2025-05-08:APPROVER_NOT_STEP_APPROVER' });
    await as('H7');
    expect(await act(approveLeave(SLUG, { request: await rowId('R-0002') }))).toEqual({ notice: 'R-0002: VOID — VOID_APPROVE:H7:2025-05-08:APPROVER_INELIGIBLE_ROLE_REVOKED' });
  });
  it('05-09: H8 reassigns Q2\'s HR step to H8; H3 approves Q1; 05-12: H8 approves Q2', async () => {
    noonOn('2025-05-09');
    await as('H8');
    expect(await act(reassignLeave(SLUG, { request: await rowId('R-0002'), approver: await empRow('H8') }))).toEqual({ notice: 'R-0002: PENDING_3 — REASSIGN:H8:2025-05-09:STEP_REASSIGNED->H8' });
    expect((await inboxFor(orgId, 'H8')).map((r) => r.requestId)).toEqual(['R-0002']);
    await as('H3');
    expect(await act(approveLeave(SLUG, { request: await rowId('R-0001') }))).toEqual({ notice: 'R-0001: APPROVED — APPROVE:H3:2025-05-09:MANAGER' });
    noonOn('2025-05-12');
    await as('H8');
    expect(await act(approveLeave(SLUG, { request: await rowId('R-0002') }))).toEqual({ notice: 'R-0002: APPROVED — APPROVE:H8:2025-05-12:HR' });
    const [q2, q1] = await requestViews(orgId);
    expect([q1!.state, q2!.state, q2!.steps.find((s) => s.stepId === 'HR')!.approver, q2!.steps.find((s) => s.stepId === 'HR')!.routedApprover]).toEqual(['APPROVED', 'APPROVED', 'H8', 'H7']);
  });
});

describe('overlap and archive through the actions', () => {
  it('D-45: a submit over approved days is denied OVERLAPPING_REQUEST and says so', async () => {
    noonOn('2025-05-13');
    await as('H4');
    expect(await act(submitLeave(SLUG, { leaveType: 'SICK', start: '2025-05-20', end: '2025-05-21' }))).toEqual({
      notice: 'R-0003: DENIED (OVERLAPPING_REQUEST) — SUBMIT:H4:2025-05-13:CHAIN_FROZEN; SYSTEM_DENY:SYSTEM:2025-05-13:OVERLAPPING_REQUEST',
    });
    expect(await act(cancelLeave(SLUG, { request: await rowId('R-0001') }))).toEqual({ notice: 'R-0001: CANCELLED (CANCELLED_AFTER_APPROVAL) — CANCEL:H4:2025-05-13:CANCELLED_AFTER_APPROVAL' });
  });
  it('D-47: archive is owner-only; afterwards every write is refused with the archived message', async () => {
    await as('owner');
    expect(await archiveThisOrg(SLUG, { reason: 'end of the walk' })).toEqual({ notice: 'Archived. The org is read-only from now on; its history is kept.' });
    await as('H4');
    expect(await act(submitLeave(SLUG, { leaveType: 'PTO', start: '2025-07-01', end: '2025-07-01' }))).toEqual({ error: ARCHIVED_MESSAGE });
    await as('owner');
    expect(await setTimeZone(SLUG, { timeZone: 'UTC' })).toEqual({ error: ARCHIVED_MESSAGE });
  });
});
