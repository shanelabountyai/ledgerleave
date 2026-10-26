// Phase 2 tasks 2.4 (replay-into-database, idempotent), 2.6 (outbox), 2.7 (ledger:verify and leave:eval against the
// database). The exit bar, as numbers: 5057 ledger rows, 389 chains, 813 events written once; a second replay writes
// 0 and queues 0; the three reference files rebuilt from the tables alone diff 0 against fixtures/; the outbox holds
// exactly the rows the oracle's request log implies, all QUEUED; a backdated command is refused with nothing written.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calendarDay as d } from '@/accrual/calendar';
import { db } from '@/core/db';
import { REPLAY_TX, ReplayDivergence, type ReplayResult, lockOrg, replay } from '@/leave-db/replay';
import { ledgerEntriesFromDb } from '@/leave-db/verify-db';
import { parseCsv } from '../../../scripts/leave/csv';
import { buildOutputsFromDb, diffAgainstFixtures } from '../../../scripts/leave/eval-db';
import { importFixtures } from '../../../scripts/leave/import-fixtures';
import { verifyEntries } from '../../../scripts/leave/verify';
import { resetAuthTables } from '../../helpers/auth';

afterAll(() => db.$disconnect());

const DIR = fileURLToPath(new URL('../../../fixtures', import.meta.url));
const YEARS = [2024, 2025];
const expectedBalances = readFileSync(`${DIR}/expected_balances.csv`, 'utf8');

/** Derived from the oracle's own request log, not from the code under test (brief §12 columns). */
function oracleCounts() {
  const rows = parseCsv(readFileSync(`${DIR}/expected_requests.csv`, 'utf8'));
  let notifications = 0;
  let steps = 0;
  for (const r of rows) {
    for (const l of r.log!.split(';')) if (['SUBMIT', 'APPROVE', 'DENY', 'REASSIGN'].includes(l.split(':')[0]!)) notifications++;
    steps += r.chain!.split('|').length;
  }
  return { requests: rows.length, notifications, steps };
}

const run = (orgId: string, asOf: string, openAsOfDay = false) =>
  db.$transaction(async (tx) => {
    await lockOrg(tx, orgId);
    return replay(tx, orgId, d(asOf), { openAsOfDay });
  }, REPLAY_TX);

describe('replay into the database (tasks 2.4, 2.6, 2.7)', () => {
  let orgId: string;
  let first: ReplayResult;
  let second: ReplayResult;
  beforeAll(async () => {
    await resetAuthTables();
    orgId = (await importFixtures(DIR)).orgId;
    first = await run(orgId, '2025-12-31');
    second = await run(orgId, '2025-12-31');
  }, 180_000);

  it('the first replay writes the engine\'s whole answer: 5057 entries, 389 chains, 813 events, 2 recomputes', () => {
    const { requests, steps } = oracleCounts();
    expect(first.engine).toEqual({ entries: 5057, requests: 389, voided: 15, ignored: 0, recomputed: 2 });
    expect([first.ledger, first.chains, first.steps, first.events]).toEqual([
      { existing: 0, inserted: 5057 }, { existing: 0, inserted: requests }, { existing: 0, inserted: steps }, { existing: 0, inserted: 813 },
    ]);
    expect(steps).toBe(429);
  });

  it('the second replay writes nothing: 0 inserted everywhere, 0 queued, same ledger hash', async () => {
    expect([second.ledger, second.chains, second.steps, second.events, second.outboxQueued]).toEqual([
      { existing: 5057, inserted: 0 }, { existing: 389, inserted: 0 }, { existing: 429, inserted: 0 }, { existing: 813, inserted: 0 }, 0,
    ]);
    expect(second.ledgerHash).toBe(first.ledgerHash);
    expect(await db.ledgerEntry.count({ where: { orgId } })).toBe(5057);
  });

  it('ledger:verify --db: 198 rows recomputed from LedgerEntry alone, 0 diffs against the oracle', async () => {
    const r = verifyEntries(await ledgerEntriesFromDb(db, orgId), expectedBalances, YEARS);
    expect([r.entries, r.rows, r.mismatches]).toEqual([5057, 198, []]);
  });

  it('leave:eval --db: the three reference files rebuilt from the tables alone diff 0 — entry ids and seqs included', async () => {
    const out = await buildOutputsFromDb(orgId, YEARS);
    expect(diffAgainstFixtures(DIR, out)).toEqual([
      { name: 'ledger.csv', rows: 5057, differing: 0 }, { name: 'expected_balances.csv', rows: 198, differing: 0 }, { name: 'expected_requests.csv', rows: 389, differing: 0 },
    ]);
  });

  it('outbox (D-23): one row per SUBMIT→PENDING, SYSTEM_DENY, APPROVE, DENY and REASSIGN in the oracle\'s log; all QUEUED, none sent', async () => {
    const { notifications } = oracleCounts();
    expect(first.outboxQueued).toBe(notifications);
    expect(notifications).toBe(759);
    const rows = await db.outbox.findMany({ where: { orgId } });
    expect(rows).toHaveLength(759);
    expect(rows.every((r) => r.sentAt === null && r.attempts === 0 && r.channel === 'email')).toBe(true);
    const byTemplate = new Map<string, number>();
    for (const r of rows) byTemplate.set(r.template, (byTemplate.get(r.template) ?? 0) + 1);
    // APPROVED = 294 final + 28 cancelled after approval; DENIED = 22 by approver + 33 by the system (brief §11)
    expect(Object.fromEntries(byTemplate)).toEqual({ APPROVAL_REQUESTED: 382, APPROVED: 322, DENIED: 55 });
    expect(await db.capturedMessage.count()).toBe(0); // nothing drained, nothing captured, nothing sent
    const s04 = rows.find((r) => (r.data as { requestId: string }).requestId === 'R-0004'); // T8: the system denial at submit
    expect(s04).toMatchObject({ template: 'DENIED', to: 'e049@ledgerleave.example' });
    expect((s04!.data as { code: string }).code).toBe('INSUFFICIENT_BALANCE');
  });

  it('a command backdated into a closed day is refused as a divergence and nothing is written', async () => {
    // R-0001 was approved 2024-12-03; a CANCEL dated 2025-12-30 would have to post its reversals BEFORE the stored
    // 2025-12-31 boundaries, so the stored ledger is no longer a prefix of the engine's answer.
    await db.requestCommand.create({ data: { orgId, requestId: 'R-0001', seq: 3, on: '2025-12-30', actor: 'E011', action: 'CANCEL', target: '', ordinal: 999 } });
    const before = [await db.ledgerEntry.count({ where: { orgId } }), await db.requestEvent.count({ where: { orgId } }), await db.outbox.count({ where: { orgId } })];
    await expect(run(orgId, '2025-12-31')).rejects.toThrow(ReplayDivergence);
    await expect(run(orgId, '2025-12-31')).rejects.toThrow(/LedgerEntry L-004991: stored E001\|PTO\|.*ACCRUAL_MONTHLY.*, engine E011\|PTO\|PTO_SALARIED\|USAGE_REVERSAL\|2024-12-30\|2025-12-30\|480\|USAGE_REVERSED_CANCELLED\|R-0001/);
    expect([await db.ledgerEntry.count({ where: { orgId } }), await db.requestEvent.count({ where: { orgId } }), await db.outbox.count({ where: { orgId } })]).toEqual(before);
  });
});

describe('replay grows the ledger as a prefix (D-38)', () => {
  let orgId: string;
  beforeAll(async () => {
    await resetAuthTables();
    orgId = (await importFixtures(DIR)).orgId;
  }, 120_000);

  it('mid-year, then the as-of day open, then closed: each step appends; the result equals the one-shot replay', async () => {
    const june = await run(orgId, '2025-06-30');
    expect(june.ledger.existing).toBe(0);
    expect(june.ledger.inserted).toBeGreaterThan(0);
    expect(june.ledger.inserted).toBeLessThan(5057);

    const open = await run(orgId, '2025-12-31', true);
    expect(open.ledger.existing).toBe(june.ledger.inserted);
    const closed = await run(orgId, '2025-12-31');
    expect(closed.ledger.existing).toBe(june.ledger.inserted + open.ledger.inserted);
    // the day's close adds exactly the Dec 31 boundaries: every row it inserts is a FORFEITURE effective 2025-12-31
    const tail = await db.ledgerEntry.findMany({ where: { orgId }, orderBy: { seq: 'asc' }, skip: closed.ledger.existing });
    expect(tail).toHaveLength(closed.ledger.inserted);
    expect(tail.every((e) => e.kind === 'FORFEITURE' && e.effective === '2025-12-31')).toBe(true);
    expect(closed.ledger.existing + closed.ledger.inserted).toBe(5057);

    const out = await buildOutputsFromDb(orgId, YEARS);
    expect(diffAgainstFixtures(DIR, out).map((f) => f.differing)).toEqual([0, 0, 0]);
    expect(await db.outbox.count({ where: { orgId } })).toBe(759);
  }, 180_000);
});
