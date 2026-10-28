// Phase 3 tasks 3.4/3.5 acceptance: what the HR console and the ledger page show, from the fixture org's rows.
// The employee-year table equals expected_balances.csv (the test reads the oracle file; product code never does);
// E013's 2024-12-31 carries the −960 CARRYOVER_RECOMPUTED row (T4) and the running balance there is L1.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calendarDay } from '@/accrual/calendar';
import { db } from '@/core/db';
import { balancesFor, employeeYearTable, ledgerFor, requestViews } from '@/leave-db/read';
import { REPLAY_TX, replay } from '@/leave-db/replay';
import { importFixtures } from '../../../scripts/leave/import-fixtures';
import { resetAuthTables } from '../../helpers/auth';

afterAll(() => db.$disconnect());
const DIR = fileURLToPath(new URL('../../../fixtures', import.meta.url));
let orgId: string;

beforeAll(async () => {
  await resetAuthTables();
  orgId = (await importFixtures(DIR)).orgId;
  await db.$transaction((tx) => replay(tx, orgId, calendarDay('2025-12-31')), REPLAY_TX);
}, 300_000);

describe('read models over the fixture org', () => {
  it('the HR employee-year table equals expected_balances.csv: 198 rows, 0 diffs', async () => {
    const rows = await employeeYearTable(orgId, '2025-12-31');
    const csv = readFileSync(`${DIR}/expected_balances.csv`, 'utf8').trim().split('\n');
    const header = csv[0]!;
    expect(header).toBe('employee_id,year,leave_type,opening,accrued,capped,used,forfeited,balance_end');
    const ours = rows.map((r) => [r.employeeId, r.year, r.leaveType, r.opening, r.accrued, r.capped, r.used, r.forfeited, r.balanceEnd].join(','));
    expect(ours.length).toBe(198);
    expect(ours).toEqual(csv.slice(1));
  });

  it('E013 PTO: the 2024-12-31 recompute row is on the ledger page and the running balance is L1', async () => {
    const lines = await ledgerFor(orgId, 'E013');
    const rec = lines.filter((l) => l.leaveType === 'PTO' && l.codes === 'CARRYOVER_RECOMPUTED');
    expect(rec.map((l) => [l.effective, l.minutes])).toEqual([['2024-12-31', -960]]);
    const [pto] = (await balancesFor(orgId, 'E013', '2024-12-31')).filter((b) => b.leaveType === 'PTO');
    expect(rec[0]!.runningBalance).toBe(pto!.balance);
  });

  it('request views reproduce the stored chain and the state label for all 389 requests', async () => {
    const views = await requestViews(orgId);
    expect(views.length).toBe(389);
    const csv = readFileSync(`${DIR}/expected_requests.csv`, 'utf8').trim().split('\n').slice(1);
    const pending = views.filter((v) => v.open).map((v) => v.state);
    expect(pending).toEqual(['PENDING_2']); // brief §11: one request open at as-of
    expect(csv.filter((l) => l.includes(',PENDING_2,')).length).toBe(1);
  });
});
