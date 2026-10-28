// Task 1.10: ledger:verify recomputes 198 rows from ledger.csv alone with 0 diffs, and a single mutated minute in a
// COPY is reported with the employee, year, leave type and column. fixtures/ is never written.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatMismatch, verifyLedger } from '../../../scripts/leave/verify';

const DIR = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const ledger = readFileSync(`${DIR}ledger.csv`, 'utf8');
const expected = readFileSync(`${DIR}expected_balances.csv`, 'utf8');
const YEARS = [2024, 2025];

describe('ledger:verify (Phase 1 form)', () => {
  it('198 rows from 5057 entries, 0 mismatches', () => {
    const r = verifyLedger(ledger, expected, YEARS);
    expect([r.entries, r.rows, r.mismatches]).toEqual([5057, 198, []]);
  });
  it('one minute changed in a copy is reported with employee, year, type and column', () => {
    // L-000001 is E001 PTO OPENING_BALANCE 50 effective 2023-12-31: bump it to 51 in memory
    const mutated = ledger.replace('L-000001,E001,PTO,PTO_SALARIED,ADJUSTMENT,2023-12-31,2023-12-31,50,', 'L-000001,E001,PTO,PTO_SALARIED,ADJUSTMENT,2023-12-31,2023-12-31,51,');
    expect(mutated).not.toBe(ledger);
    const r = verifyLedger(mutated, expected, YEARS);
    const lines = r.mismatches.map(formatMismatch);
    // 2024 opening moves by one; the Dec 31 forfeiture in the file does not, so balance_end moves too; 2025 opening likewise
    expect(lines).toContain('E001 2024 PTO opening: expected 50, recomputed 51');
    expect(lines).toContain('E001 2024 PTO balance_end: expected 2400, recomputed 2401');
    expect(lines).toContain('E001 2025 PTO opening: expected 2400, recomputed 2401');
    expect(r.mismatches.every((m) => m.employeeId === 'E001' && m.leaveType === 'PTO')).toBe(true);
  });
  it('a deleted row is reported as absent; an unknown kind is refused', () => {
    const lines = ledger.split('\n');
    const dropped = lines.filter((l) => !l.startsWith('L-000002,')).join('\n'); // E001 SICK opening 1660
    const r = verifyLedger(dropped, expected, YEARS);
    expect(r.mismatches.map(formatMismatch)).toContain('E001 2024 SICK opening: expected 1660, recomputed 0');
    expect(() => verifyLedger(ledger.replace('ADJUSTMENT,2023-12-31,2023-12-31,50,', 'BONUS,2023-12-31,2023-12-31,50,'), expected, YEARS)).toThrow(/unknown kind/);
  });
});
