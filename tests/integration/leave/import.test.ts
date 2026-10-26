// Phase 2 task 2.3 acceptance: the ten input files land in the input tables; two runs leave identical row counts
// AND identical content (hashed per table, ids and timestamps excluded — a count cannot see a column, A-045);
// the second run inserts 0 commands; a stored command that differs from the file is refused, not rewritten.
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { FIXTURE_ORG_SLUG, type ImportCounts, importFixtures } from '../../../scripts/leave/import-fixtures';
import { resetAuthTables } from '../../helpers/auth';

afterAll(() => db.$disconnect());

const DIR = fileURLToPath(new URL('../../../fixtures', import.meta.url));
const INPUT_TABLES = ['Employee', 'OrgChange', 'PolicyAssignment', 'Holiday', 'Timesheet', 'Delegation', 'OpeningBalance', 'LeaveRequest', 'RequestCommand', 'PolicySet', 'LeaveSettings'];

/** sha256 of every row of a table in a stable order, minus the columns a re-run is allowed to differ in. */
async function tableHash(table: string): Promise<string> {
  const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "${table}"`);
  const stripped = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'id' && k !== 'createdAt')));
  stripped.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  return createHash('sha256').update(JSON.stringify(stripped)).digest('hex');
}

describe('leave:import (task 2.3)', () => {
  let first: ImportCounts;
  let second: ImportCounts;
  const hashes: Record<string, string>[] = [];
  beforeAll(async () => {
    await resetAuthTables();
    first = await importFixtures(DIR);
    hashes.push(Object.fromEntries(await Promise.all(INPUT_TABLES.map(async (t) => [t, await tableHash(t)]))));
    second = await importFixtures(DIR);
    hashes.push(Object.fromEntries(await Promise.all(INPUT_TABLES.map(async (t) => [t, await tableHash(t)]))));
  }, 120_000);

  it('row counts equal the MANIFEST counts (brief §12)', () => {
    expect(first.tables).toEqual({
      Employee: 50, OrgChange: 11, PolicyAssignment: 101, Holiday: 16, Timesheet: 726, Delegation: 14, OpeningBalance: 86, LeaveRequest: 389, RequestCommand: 813, PolicySet: 1,
    });
    expect(first.commandsInserted).toBe(813);
  });

  it('a second run changes nothing: same counts, same content hash per table, 0 commands inserted', () => {
    expect(second.tables).toEqual(first.tables);
    expect(second.orgId).toBe(first.orgId);
    expect(second.commandsInserted).toBe(0);
    expect(hashes[1]).toEqual(hashes[0]);
    expect(Object.keys(hashes[0]!)).toHaveLength(INPUT_TABLES.length);
  });

  it('stores the policy document validated and hashed, and the settings from MANIFEST', async () => {
    const ps = await db.policySet.findFirstOrThrow({ where: { orgId: first.orgId } });
    expect(ps.contentHash).toBe(first.policySetHash);
    expect((ps.content as { policies: unknown[] }).policies).toHaveLength(3);
    expect(await db.leaveSettings.findUniqueOrThrow({ where: { orgId: first.orgId } })).toMatchObject({ ledgerStart: '2024-01-01', fixtureSeed: 20261025, fixtureAsOf: '2025-12-31' });
    expect(await db.org.findUniqueOrThrow({ where: { id: first.orgId } })).toMatchObject({ slug: FIXTURE_ORG_SLUG });
  });

  it('maps "" to NULL for the CEO\'s manager and an open term date; nothing derived is written', async () => {
    const ceo = await db.employee.findUniqueOrThrow({ where: { orgId_employeeId: { orgId: first.orgId, employeeId: 'E001' } } });
    expect([ceo.managerId, ceo.termDate, ceo.email]).toEqual([null, null, 'e001@ledgerleave.example']);
    const gone = await db.employee.findUniqueOrThrow({ where: { orgId_employeeId: { orgId: first.orgId, employeeId: 'E022' } } });
    expect(gone.termDate).toBe('2024-10-18'); // T9
    expect([await db.ledgerEntry.count(), await db.requestEvent.count(), await db.frozenChain.count(), await db.requestStep.count()]).toEqual([0, 0, 0, 0]);
  });

  it('ranks a day\'s commands by (request id, seq) — the oracle\'s within-day order (D-38)', async () => {
    const day = await db.requestCommand.findMany({ where: { orgId: first.orgId, on: '2024-12-02' }, orderBy: { ordinal: 'asc' } });
    expect(day.length).toBeGreaterThan(1); // R-0001 and R-0002 both submit on 2024-12-02 (T4, T6)
    const sorted = [...day].sort((a, b) => (a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : a.seq - b.seq));
    expect(day.map((c) => `${c.requestId}|${c.seq}`)).toEqual(sorted.map((c) => `${c.requestId}|${c.seq}`));
    expect(day.map((c) => c.ordinal)).toEqual(day.map((_, i) => i + 1));
  });

  it('a stored command that differs from the file is refused, never rewritten (append-only)', async () => {
    const { mkdtempSync, cpSync, readFileSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(`${tmpdir()}/ll-import-`);
    cpSync(DIR, dir, { recursive: true });
    const text = readFileSync(`${dir}/request_events.csv`, 'utf8');
    const mutated = text.replace('R-0001,2,2024-12-03,E008,APPROVE,', 'R-0001,2,2024-12-03,E008,DENY,');
    expect(mutated).not.toBe(text);
    writeFileSync(`${dir}/request_events.csv`, mutated);
    await expect(importFixtures(dir)).rejects.toThrow(/R-0001 seq 2: stored action="APPROVE", file has "DENY"; commands are append-only/);
    expect((await db.requestCommand.findFirstOrThrow({ where: { orgId: first.orgId, requestId: 'R-0001', seq: 2 } })).action).toBe('APPROVE');
  });
});
