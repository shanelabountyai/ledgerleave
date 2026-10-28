// Phase 2 task 2.1 acceptance: the clone-owned schema as the DATABASE has it, not as the .prisma file says.
// Non-negotiable 1: no column anywhere is a stored balance. D-7: every calendar day is CHAR(10). And the closed
// vocabularies the hand-written CHECK constraints carry must equal the TypeScript lists they mirror, so adding a
// kind, action or state is never one edit (Bookable's status-enum rule, applied to a SQL list the compiler cannot see).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { ENTRY_KINDS } from '@/accrual/ledger';
import { ACTIONS, STATES } from '@/routing/requests';
import { STEP_IDS } from '@/routing/route';
import { ORG_CHANGE_FIELDS } from '@/routing/org';
import { EVENT_OUTCOMES } from '@/leave-db/replay';

afterAll(() => db.$disconnect());

const SCHEMA_DIR = fileURLToPath(new URL('../../../prisma/schema/', import.meta.url));

type Col = { table_name: string; column_name: string; data_type: string; character_maximum_length: number | null };
const columns = () =>
  db.$queryRaw<Col[]>`SELECT table_name, column_name, data_type, character_maximum_length FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY 1, 2`;

/** The IN (...) list of a CHECK constraint, read back from the live database. */
async function checkList(constraint: string): Promise<string[]> {
  const [row] = await db.$queryRaw<{ def: string }[]>`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${constraint}`;
  if (!row) throw new Error(`constraint ${constraint} is not in the database`);
  const m = /ARRAY\[(.*)\]/.exec(row.def);
  if (!m) throw new Error(`${constraint} is not an IN-list check: ${row.def}`);
  return [...m[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!).sort();
}

describe('ledgerleave schema (task 2.1)', () => {
  it('no table has a column named like a stored balance (non-negotiable 1)', async () => {
    const cols = await columns();
    const stored = cols.filter((c) => /balance|available/i.test(c.column_name));
    expect(stored).toEqual([]);
    // the sentinel: the assertion above can see a column, so it must see one if one existed
    expect(cols.some((c) => c.table_name === 'LedgerEntry' && c.column_name === 'minutes')).toBe(true);
  });

  it('no @db.Date anywhere in prisma/schema (D-7)', () => {
    for (const f of readdirSync(SCHEMA_DIR).filter((n) => n.endsWith('.prisma'))) {
      expect(readFileSync(`${SCHEMA_DIR}${f}`, 'utf8'), f).not.toMatch(/@db\.Date\b/);
    }
  });

  it('every calendar-day column is CHAR(10), not date or timestamp', async () => {
    const cols = await columns();
    const days: [string, string][] = [
      ['LeaveSettings', 'ledgerStart'], ['LeaveSettings', 'fixtureAsOf'], ['Employee', 'hireDate'], ['Employee', 'termDate'],
      ['OrgChange', 'effective'], ['PolicyAssignment', 'start'], ['PolicyAssignment', 'end'], ['Holiday', 'date'],
      ['Timesheet', 'periodEnd'], ['Delegation', 'start'], ['Delegation', 'end'], ['LeaveRequest', 'start'], ['LeaveRequest', 'end'],
      ['LeaveRequest', 'submittedOn'], ['RequestCommand', 'on'], ['RequestEvent', 'on'], ['LedgerEntry', 'effective'], ['LedgerEntry', 'posted'],
    ];
    for (const [t, c] of days) {
      const col = cols.find((x) => x.table_name === t && x.column_name === c);
      expect(col, `${t}.${c}`).toBeDefined();
      expect([col!.data_type, col!.character_maximum_length], `${t}.${c}`).toEqual(['character', 10]);
    }
    const dateTyped = cols.filter((c) => c.data_type === 'date');
    expect(dateTyped).toEqual([]);
  });

  it('the CHECK vocabularies equal the TypeScript lists (a new value is never one edit)', async () => {
    expect(await checkList('LedgerEntry_kind_check')).toEqual([...ENTRY_KINDS].sort());
    expect(await checkList('RequestCommand_action_check')).toEqual([...ACTIONS].sort());
    expect(await checkList('RequestEvent_action_check')).toEqual([...ACTIONS].sort());
    expect(await checkList('RequestEvent_stateAfter_check')).toEqual([...STATES].sort());
    expect(await checkList('RequestEvent_outcome_check')).toEqual([...EVENT_OUTCOMES].sort());
    expect(await checkList('RequestStep_stepId_check')).toEqual([...STEP_IDS].sort());
    expect(await checkList('OrgChange_field_check')).toEqual([...ORG_CHANGE_FIELDS].sort());
  });
});
