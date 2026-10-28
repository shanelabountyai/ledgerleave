// Phase 2 task 2.5 acceptance: GR-15 (brief §9) reproduced THROUGH the live actions on the hand org, in date order,
// each action its own transaction; a void approval leaves the ledger untouched; a system denial at submit (A8) and
// a cancel after approval (S4) write what the engine says and nothing else; every action queues its outbox row.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { ActionRefused, approveRequest, cancelRequest, denyRequest, reassignStep, submitRequest } from '@/leave-db/actions';
import { policyContentHash } from '../../../scripts/leave/import-fixtures';
import { resetAuthTables } from '../../helpers/auth';

afterAll(() => db.$disconnect());

const DIR = fileURLToPath(new URL('../../../fixtures', import.meta.url));

/** The brief §9 hand org: H1 CEO … H10, H7/H8 HR, H9 terminated 2025-03-31; everyone on PTO_SALARIED with 2400 opening. */
async function seedHandOrg(): Promise<string> {
  const orgId = (await db.org.create({ data: { slug: 'hand', name: 'hand' } })).id;
  const policyText = readFileSync(`${DIR}/policies.json`, 'utf8');
  await db.leaveSettings.create({ data: { orgId, ledgerStart: '2024-01-01' } });
  await db.policySet.create({ data: { orgId, content: JSON.parse(policyText), contentHash: policyContentHash(policyText) } });
  await db.holiday.createMany({ data: readFileSync(`${DIR}/holidays.csv`, 'utf8').trim().split('\n').slice(1).map((date) => ({ orgId, date })) });
  const H: [string, string, string | null, string | null, string][] = [
    ['H1', '2010-01-04', null, null, ''], ['H2', '2012-01-09', 'H1', null, ''], ['H3', '2015-01-05', 'H2', null, ''], ['H4', '2018-01-08', 'H3', null, ''],
    ['H5', '2019-01-07', 'H3', null, ''], ['H6', '2013-01-07', 'H1', null, ''], ['H7', '2016-01-04', 'H6', null, 'HR'], ['H8', '2020-01-06', 'H7', null, 'HR'],
    ['H9', '2014-01-06', 'H2', '2025-03-31', ''], ['H10', '2021-01-04', 'H9', null, ''],
  ];
  for (const [id, hire, managerId, termDate, roles] of H) {
    await db.employee.create({ data: { orgId, employeeId: id, name: id, title: 'T', dept: 'D', managerId, employmentType: 'SALARIED', roles, hireDate: hire, termDate, email: `${id.toLowerCase()}@hand.example` } });
    await db.policyAssignment.create({ data: { orgId, employeeId: id, leaveType: 'PTO', policyId: 'PTO_SALARIED', start: hire, end: termDate } });
    await db.openingBalance.create({ data: { orgId, employeeId: id, leaveType: 'PTO', minutes: 2400 } });
  }
  await db.orgChange.createMany({
    data: [
      { orgId, effective: '2025-05-07', employeeId: 'H4', field: 'MANAGER', oldValue: 'H3', newValue: 'H2' },
      { orgId, effective: '2025-05-06', employeeId: 'H7', field: 'ROLE_REVOKED', oldValue: 'HR', newValue: 'HR' },
    ],
  });
  return orgId;
}

const ledgerCount = (orgId: string) => db.ledgerEntry.count({ where: { orgId } });
const usageFor = (orgId: string, ref: string) => db.ledgerEntry.findMany({ where: { orgId, ref }, orderBy: { seq: 'asc' } });

describe('live actions reproduce GR-15 (task 2.5)', () => {
  let orgId: string;
  beforeAll(async () => {
    await resetAuthTables();
    orgId = await seedHandOrg();
  }, 60_000);

  it('Q1 and Q2 submit on 2025-05-05: chains frozen exactly as the golden says', async () => {
    const q1 = await submitRequest({ orgId, employeeId: 'H4', leaveType: 'PTO', start: '2025-05-19', end: '2025-05-20', on: '2025-05-05' });
    const q2 = await submitRequest({ orgId, employeeId: 'H4', leaveType: 'PTO', start: '2025-06-02', end: '2025-06-16', on: '2025-05-05' });
    expect([q1.requestId, q1.outcome, q1.state, q1.logLines]).toEqual(['R-0001', 'APPLIED', 'PENDING_1', ['SUBMIT:H4:2025-05-05:CHAIN_FROZEN']]);
    expect([q2.requestId, q2.state]).toEqual(['R-0002', 'PENDING_1']);
    const chains = await db.frozenChain.findMany({ where: { orgId }, orderBy: { requestId: 'asc' } });
    expect(chains.map((c) => [c.requestId, c.chain, c.workingDays, c.minutes])).toEqual([
      ['R-0001', 'MANAGER:H3[MANAGER_OF_REQUESTER]', 2, 960],
      ['R-0002', 'MANAGER:H3[MANAGER_OF_REQUESTER]|SKIP_LEVEL:H2[MANAGER_OF_MANAGER]|HR:H7[HR_ROLE_HOLDER]', 11, 5280],
    ]);
    // the first replay also posted the opening balances and every accrual due by 2025-05-05 (class 0 of the open day included)
    expect(await ledgerCount(orgId)).toBeGreaterThan(10);
    expect(await db.outbox.count({ where: { orgId, template: 'APPROVAL_REQUESTED', to: 'h3@hand.example' } })).toBe(2);
  });

  it('Q2: H3 (05-06) and H2 (05-07) approve in turn; each advances the step and asks the next approver', async () => {
    const a = await approveRequest({ orgId, requestId: 'R-0002', actor: 'H3', on: '2025-05-06' });
    expect([a.outcome, a.state, a.logLines]).toEqual(['APPLIED', 'PENDING_2', ['APPROVE:H3:2025-05-06:MANAGER']]);
    const b = await approveRequest({ orgId, requestId: 'R-0002', actor: 'H2', on: '2025-05-07' });
    expect([b.outcome, b.state, b.logLines]).toEqual(['APPLIED', 'PENDING_3', ['APPROVE:H2:2025-05-07:SKIP_LEVEL']]);
    expect(await db.outbox.count({ where: { orgId, template: 'APPROVAL_REQUESTED', to: 'h7@hand.example' } })).toBe(1);
  });

  it('05-08: the new manager\'s approval of Q1 is void; H7\'s approval of Q2 is void (HR revoked 05-06); the ledger is untouched', async () => {
    const before = await ledgerCount(orgId);
    const outbox = await db.outbox.count({ where: { orgId } });
    const v1 = await approveRequest({ orgId, requestId: 'R-0001', actor: 'H2', on: '2025-05-08' });
    expect([v1.outcome, v1.state, v1.logLines]).toEqual(['VOID', 'PENDING_1', ['VOID_APPROVE:H2:2025-05-08:APPROVER_NOT_STEP_APPROVER']]);
    const v2 = await approveRequest({ orgId, requestId: 'R-0002', actor: 'H7', on: '2025-05-08' });
    expect([v2.outcome, v2.state, v2.logLines]).toEqual(['VOID', 'PENDING_3', ['VOID_APPROVE:H7:2025-05-08:APPROVER_INELIGIBLE_ROLE_REVOKED']]);
    expect(await ledgerCount(orgId)).toBe(before);
    expect(await db.outbox.count({ where: { orgId } })).toBe(outbox); // a void event asks nobody
    expect(await db.requestEvent.count({ where: { orgId, outcome: 'VOID' } })).toBe(2);
  });

  it('05-09: H3 approves Q1 → APPROVED with one USAGE row per working day; H8 reassigns Q2 to H8', async () => {
    const a = await approveRequest({ orgId, requestId: 'R-0001', actor: 'H3', on: '2025-05-09' });
    expect([a.outcome, a.state, a.finalCode, a.logLines]).toEqual(['APPLIED', 'APPROVED', 'APPROVED', ['APPROVE:H3:2025-05-09:MANAGER']]);
    const usage = await usageFor(orgId, 'R-0001');
    expect(usage.map((u) => [u.kind, u.effective, u.posted, u.minutes])).toEqual([['USAGE', '2025-05-19', '2025-05-09', -480], ['USAGE', '2025-05-20', '2025-05-09', -480]]);
    expect(await db.outbox.count({ where: { orgId, template: 'APPROVED', to: 'h4@hand.example' } })).toBe(1);
    const r = await reassignStep({ orgId, requestId: 'R-0002', actor: 'H8', on: '2025-05-09', target: 'H8' });
    expect([r.outcome, r.state, r.logLines]).toEqual(['APPLIED', 'PENDING_3', ['REASSIGN:H8:2025-05-09:STEP_REASSIGNED->H8']]);
    expect(await db.outbox.count({ where: { orgId, template: 'APPROVAL_REQUESTED', to: 'h8@hand.example' } })).toBe(1);
    // the frozen step row still names H7 as routed (D-20): the reassignment lives in the event log
    expect((await db.requestStep.findUniqueOrThrow({ where: { orgId_requestId_index: { orgId, requestId: 'R-0002', index: 2 } } })).approver).toBe('H7');
  });

  it('05-12: H8 approves Q2 → APPROVED; the stored log equals the golden\'s tail', async () => {
    const a = await approveRequest({ orgId, requestId: 'R-0002', actor: 'H8', on: '2025-05-12' });
    expect([a.outcome, a.state, a.logLines]).toEqual(['APPLIED', 'APPROVED', ['APPROVE:H8:2025-05-12:HR']]);
    const evs = await db.requestEvent.findMany({ where: { orgId, requestId: 'R-0002' }, orderBy: { seq: 'asc' } });
    expect(evs.flatMap((e) => e.logLines).slice(3)).toEqual(['VOID_APPROVE:H7:2025-05-08:APPROVER_INELIGIBLE_ROLE_REVOKED', 'REASSIGN:H8:2025-05-09:STEP_REASSIGNED->H8', 'APPROVE:H8:2025-05-12:HR']);
    expect(await usageFor(orgId, 'R-0002')).toHaveLength(11);
  });

  it('a terminal request ignores a late approve (S6) and the event says so', async () => {
    const a = await approveRequest({ orgId, requestId: 'R-0001', actor: 'H3', on: '2025-05-13' });
    expect([a.outcome, a.state, a.logLines]).toEqual(['IGNORED', 'APPROVED', ['APPROVE:H3:2025-05-13:IGNORED_TERMINAL']]);
  });

  it('cancel after approval (S4): one reversal per usage row, posted on the cancel day, in the same transaction; a peer cannot', async () => {
    const peer = await cancelRequest({ orgId, requestId: 'R-0001', actor: 'H5', on: '2025-05-14' });
    expect([peer.outcome, peer.logLines]).toEqual(['VOID', ['VOID_CANCEL:H5:2025-05-14:CANCEL_NOT_REQUESTER_OR_HR']]);
    const c = await cancelRequest({ orgId, requestId: 'R-0001', actor: 'H4', on: '2025-05-14' });
    expect([c.outcome, c.state, c.finalCode]).toEqual(['APPLIED', 'CANCELLED', 'CANCELLED_AFTER_APPROVAL']);
    const rows = await usageFor(orgId, 'R-0001');
    expect(rows.map((u) => [u.kind, u.effective, u.posted, u.minutes])).toEqual([
      ['USAGE', '2025-05-19', '2025-05-09', -480], ['USAGE', '2025-05-20', '2025-05-09', -480],
      ['USAGE_REVERSAL', '2025-05-19', '2025-05-14', 480], ['USAGE_REVERSAL', '2025-05-20', '2025-05-14', 480],
    ]);
  });

  it('deny by the eligible approver → DENIED_BY_APPROVER and a DENIED notice; A8 denies an oversized request at submit', async () => {
    const q3 = await submitRequest({ orgId, employeeId: 'H5', leaveType: 'PTO', start: '2025-07-07', end: '2025-07-08', on: '2025-06-02' });
    const d = await denyRequest({ orgId, requestId: q3.requestId, actor: 'H3', on: '2025-06-03' });
    expect([d.outcome, d.state, d.finalCode, d.logLines]).toEqual(['APPLIED', 'DENIED', 'DENIED_BY_APPROVER', ['DENY:H3:2025-06-03:MANAGER']]);
    expect(await db.outbox.count({ where: { orgId, template: 'DENIED', to: 'h5@hand.example' } })).toBe(1);
    // H10: 2400 opening + accruals to June 2025 is well under 25 days
    const big = await submitRequest({ orgId, employeeId: 'H10', leaveType: 'PTO', start: '2025-07-01', end: '2025-08-05', on: '2025-06-04' });
    expect([big.outcome, big.state, big.finalCode, big.logLines]).toEqual(['APPLIED', 'DENIED', 'INSUFFICIENT_BALANCE', ['SUBMIT:H10:2025-06-04:CHAIN_FROZEN', 'SYSTEM_DENY:SYSTEM:2025-06-04:INSUFFICIENT_BALANCE']]);
    expect(await usageFor(orgId, big.requestId)).toHaveLength(0);
    expect((await db.frozenChain.findUniqueOrThrow({ where: { orgId_requestId: { orgId, requestId: big.requestId } } })).chain).toBe('MANAGER:H2[MANAGER_OF_REQUESTER,APPROVER_INACTIVE_TO_MANAGER]|SKIP_LEVEL:H1[MANAGER_OF_MANAGER,APPROVER_INACTIVE_TO_MANAGER]|HR:H8[HR_ROLE_HOLDER]'); // the chain is frozen even on a denial; string confirmed against tools/leavelib.py route() (D-25: the hand derivation was wrong)
  });

  it('refuses nonsense before touching the database', async () => {
    const n = await db.requestCommand.count({ where: { orgId } });
    await expect(submitRequest({ orgId, employeeId: 'H4', leaveType: 'VACATION', start: '2025-09-01', end: '2025-09-02', on: '2025-08-01' })).rejects.toThrow(ActionRefused);
    await expect(submitRequest({ orgId, employeeId: 'H4', leaveType: 'PTO', start: '2025-09-02', end: '2025-09-01', on: '2025-08-01' })).rejects.toThrow(/end is before start/);
    await expect(submitRequest({ orgId, employeeId: 'NOBODY', leaveType: 'PTO', start: '2025-09-01', end: '2025-09-02', on: '2025-08-01' })).rejects.toThrow(/unknown employee/);
    await expect(approveRequest({ orgId, requestId: 'R-9999', actor: 'H3', on: '2025-08-01' })).rejects.toThrow(/unknown request/);
    await expect(submitRequest({ orgId, employeeId: 'H4', leaveType: 'PTO', start: '2025-02-30', end: '2025-03-01', on: '2025-08-01' })).rejects.toThrow();
    expect(await db.requestCommand.count({ where: { orgId } })).toBe(n);
  });
});
