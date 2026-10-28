// Phase 2 task 2.2 acceptance (non-negotiable 2): UPDATE and DELETE on every append-only table are refused by the
// trigger with its message; INSERT succeeds; and the ledger's seq/entryId are assigned by the database in posting
// order — a caller-supplied seq that is not the next one is refused rather than renumbered.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { resetAuthTables } from '../../helpers/auth';

afterAll(() => db.$disconnect());

const countRows = async (t: string) => (await db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${t}"`))[0]!.n;

const APPEND_ONLY = ['LedgerEntry', 'RequestCommand', 'RequestEvent', 'FrozenChain', 'RequestStep'] as const;

let orgId: string;
beforeEach(async () => {
  await resetAuthTables();
  orgId = (await db.org.create({ data: { slug: 'tamper', name: 'tamper' } })).id;
  await db.leaveRequest.create({ data: { orgId, requestId: 'R-0001', employeeId: 'E001', leaveType: 'PTO', start: '2025-05-05', end: '2025-05-06', submittedOn: '2025-05-01' } });
});

const entry = (minutes: number, seq = 0) => ({
  orgId, seq, employeeId: 'E001', leaveType: 'PTO', policyId: 'PTO_SALARIED', kind: 'ADJUSTMENT', effective: '2023-12-31', posted: '2023-12-31',
  minutes, cappedMinutes: 0, codes: 'OPENING_BALANCE', ref: `m${minutes}`,
});

/** One row in each append-only table, so the tamper loop has something to attack. */
async function seedOneRowEach() {
  await db.ledgerEntry.create({ data: entry(50) });
  await db.requestCommand.create({ data: { orgId, requestId: 'R-0001', seq: 1, on: '2025-05-01', actor: 'E001', action: 'SUBMIT', target: '', ordinal: 1 } });
  await db.requestEvent.create({
    data: { orgId, requestId: 'R-0001', seq: 1, on: '2025-05-01', actor: 'E001', action: 'SUBMIT', target: '', outcome: 'APPLIED', logLines: ['SUBMIT:E001:2025-05-01:CHAIN_FROZEN'], stateAfter: 'PENDING', stepAfter: 0, finalCodeAfter: '' },
  });
  await db.frozenChain.create({ data: { orgId, requestId: 'R-0001', policyId: 'PTO_SALARIED', workingDays: 2, minutes: 960, chain: 'MANAGER:E008[MANAGER_OF_REQUESTER]' } });
  await db.requestStep.create({ data: { orgId, requestId: 'R-0001', index: 0, stepId: 'MANAGER', approver: 'E008', codes: ['MANAGER_OF_REQUESTER'], kept: true } });
}

describe('append-only triggers (task 2.2)', () => {
  it('INSERT succeeds on every append-only table', async () => {
    await seedOneRowEach();
    for (const t of APPEND_ONLY) {
      expect(await countRows(t), t).toBe(1);
    }
  });

  it.each(APPEND_ONLY)('%s: UPDATE is refused by the trigger and the row is unchanged', async (t) => {
    await seedOneRowEach();
    const before = await db.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "${t}"`);
    await expect(db.$executeRawUnsafe(`UPDATE "${t}" SET "orgId" = "orgId"`)).rejects.toThrow(new RegExp(`${t} is append-only .*UPDATE refused`));
    expect(await db.$queryRawUnsafe(`SELECT * FROM "${t}"`)).toEqual(before);
  });

  it.each(APPEND_ONLY)('%s: DELETE is refused by the trigger and the row is still there', async (t) => {
    await seedOneRowEach();
    await expect(db.$executeRawUnsafe(`DELETE FROM "${t}"`)).rejects.toThrow(new RegExp(`${t} is append-only .*DELETE refused`));
    expect(await countRows(t)).toBe(1);
  });

  it('deleting the org cannot cascade through an append-only table', async () => {
    await seedOneRowEach();
    await expect(db.org.delete({ where: { id: orgId } })).rejects.toThrow(/append-only/);
    expect(await db.org.count({ where: { id: orgId } })).toBe(1);
  });

  it('the Prisma client cannot update or delete either (no bypass through the ORM)', async () => {
    await seedOneRowEach();
    const row = await db.ledgerEntry.findFirstOrThrow();
    await expect(db.ledgerEntry.update({ where: { id: row.id }, data: { minutes: 51 } })).rejects.toThrow(/append-only/);
    await expect(db.ledgerEntry.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    expect((await db.ledgerEntry.findFirstOrThrow()).minutes).toBe(50);
  });
});

describe('ledger seq and entryId are assigned by the database in posting order (L3)', () => {
  it('seq 0 means "assign me": 1, 2, 3 with entryId L-000001.. per org', async () => {
    const a = await db.ledgerEntry.create({ data: entry(10) });
    const b = await db.ledgerEntry.create({ data: entry(20) });
    const other = (await db.org.create({ data: { slug: 'other', name: 'other' } })).id;
    const c = await db.ledgerEntry.create({ data: { ...entry(30), orgId: other } });
    expect([a.seq, a.entryId, b.seq, b.entryId, c.seq, c.entryId]).toEqual([1, 'L-000001', 2, 'L-000002', 1, 'L-000001']);
  });

  it('the exact next seq is accepted; any other value is refused, never renumbered', async () => {
    await db.ledgerEntry.create({ data: entry(10, 1) });
    await expect(db.ledgerEntry.create({ data: entry(20, 5) })).rejects.toThrow(/seq 5 is not the next seq 2/);
    await expect(db.ledgerEntry.create({ data: entry(20, 1) })).rejects.toThrow(/seq 1 is not the next seq 2/);
    expect(await db.ledgerEntry.count()).toBe(1);
    const b = await db.ledgerEntry.create({ data: entry(20, 2) });
    expect([b.seq, b.entryId]).toEqual([2, 'L-000002']);
  });

  it('the natural key is unique: the same fact cannot be posted twice (D-37 backstop)', async () => {
    await db.ledgerEntry.create({ data: entry(10) });
    await expect(db.ledgerEntry.create({ data: entry(10) })).rejects.toThrow(/LedgerEntry_natural_key|Unique constraint/);
  });

  it('an unknown kind is refused by the CHECK constraint', async () => {
    await expect(db.ledgerEntry.create({ data: { ...entry(10), kind: 'BONUS' } })).rejects.toThrow(/LedgerEntry_kind_check/);
  });
});
