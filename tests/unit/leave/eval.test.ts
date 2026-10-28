// Task 1.9 acceptance under vitest: the full fixture replay reproduces the three reference-engine files byte for
// byte and the brief §11 numbers. Reads fixtures/ read-only; writes nothing.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Simulation } from '@/accrual/simulate';
import { parseCsv, writeCsv } from '../../../scripts/leave/csv';
import { loadWorld } from '../../../scripts/leave/load-fixtures';
import { buildOutputs, pyDict, requestLines, summaryLines } from '../../../scripts/leave/report';

const DIR = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const { world, manifest } = loadWorld(DIR);
const sim = new Simulation(world).run();
const out = buildOutputs(world, sim);
const read = (n: string) => readFileSync(`${DIR}${n}`, 'utf8');

describe('leave:eval on the frozen fixtures (seed 20261025)', () => {
  it('ledger.csv: 5057 rows, byte for byte', () => {
    expect(sim.ledger.entries).toHaveLength(5057);
    expect(out.ledgerCsv).toBe(read('ledger.csv'));
  });
  it('expected_balances.csv: 198 rows, byte for byte', () => {
    expect(out.balances).toHaveLength(198);
    expect(out.balancesCsv).toBe(read('expected_balances.csv'));
  });
  it('expected_requests.csv: 389 rows, byte for byte', () => {
    expect(out.requests).toHaveLength(389);
    expect(out.requestsCsv).toBe(read('expected_requests.csv'));
  });
  it('brief §11: 15 void, 0 ignored, 2 recomputed; kept steps 355/33/1', () => {
    expect([sim.voided, sim.ignored, sim.recomputed]).toEqual([15, 0, 2]);
    const lines = summaryLines(world, sim, out, 'fixtures');
    expect(lines).toContain('kept_steps_per_request: {1: 355, 2: 33, 3: 1}');
    expect(lines).toContain('final_states: {\'APPROVED\': 294, \'CANCELLED\': 39, \'DENIED\': 55, \'PENDING_2\': 1}');
    expect(lines).toContain('usage_rows_posted_after_effective: 134');
    expect(lines).toContain('2024 PTO: rows 49 accrued 344027 capped 13066 used 95040 forfeited 199095 balance_end 127112');
    expect(lines.filter((l) => /^E\d{3} /.test(l))).toHaveLength(198);
  });
  it('--requests prints 389 lines and the scripted traps carry their chains (S05, S08, S09, S11, S12)', () => {
    const lines = requestLines(out);
    expect(lines).toHaveLength(389);
    const trap = new Map(parseCsv(read('requests.csv')).filter((r) => r.trap).map((r) => [r.trap!, r.request_id!]));
    const byId = new Map(out.requests.map((r) => [r.req.id, r]));
    expect(byId.get(trap.get('S05')!)!.chain).toBe('MANAGER:E003[MANAGER_OF_REQUESTER,APPROVER_INACTIVE_TO_MANAGER]');
    expect(byId.get(trap.get('S08')!)!.chain).toBe('MANAGER:E006[MANAGER_OF_REQUESTER,DELEGATION_DEPTH_EXCEEDED,FALLBACK_TO_HR]|SKIP_LEVEL:E001[MANAGER_OF_MANAGER]');
    expect(byId.get(trap.get('S09')!)!.chain).toBe('~MANAGER:E037[MANAGER_OF_REQUESTER,DELEGATED,DELEGATE_IS_REQUESTER_STEP_DROPPED]|FALLBACK:E006[EMPTY_CHAIN_TO_HR,FALLBACK_TO_HR]');
    expect(byId.get(trap.get('S11')!)!.chain).toBe('MANAGER:E006[MANAGER_OF_REQUESTER,CEO_MANAGER_IS_HR]');
    expect(byId.get(trap.get('S12')!)!.chain).toMatch(/\|~HR:E005\[HR_ROLE_HOLDER,SELF_APPROVAL_TO_MANAGER,DUPLICATE_APPROVER_COLLAPSED\]$/);
  });
  it('the manifest hashes name the inputs this run read', () => {
    expect(manifest.seed).toBe(20261025);
    expect(Object.keys(manifest.sha256).sort()).toEqual([
      'assignments.csv', 'delegations.csv', 'employees.csv', 'holidays.csv', 'opening_balances.csv', 'org_changes.csv', 'policies.json', 'request_events.csv', 'requests.csv', 'timesheets.csv',
    ]);
  });
});

describe('csv helpers mirror Python csv', () => {
  it('QUOTE_MINIMAL quoting and a parse round-trip', () => {
    const rows = [{ a: 'x', b: 'has,comma', c: 'has "quote"' }, { a: '', b: 'line\nbreak', c: 'plain' }];
    const text = writeCsv(['a', 'b', 'c'], rows);
    expect(text).toBe('a,b,c\nx,"has,comma","has ""quote"""\n,"line\nbreak",plain\n');
    expect(parseCsv(text)).toEqual(rows);
  });
  it('pyDict prints like dict(sorted(...))', () => {
    expect(pyDict(new Map<string | number, number>([['b', 2], ['a', 1]]))).toBe("{'a': 1, 'b': 2}");
    expect(pyDict(new Map<string | number, number>([[2, 33], [1, 355]]))).toBe('{1: 355, 2: 33}');
  });
});
