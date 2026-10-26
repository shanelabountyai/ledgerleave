// Task 1.11: the twenty scripted requests S01–S20 reproduce their chains in expected_requests.csv through leave:route,
// and the balance check agrees with the request's recorded outcome.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../../scripts/leave/csv';
import { loadWorld } from '../../../scripts/leave/load-fixtures';
import { formatPrediction, predictRoute } from '../../../scripts/leave/route';

const DIR = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const { world } = loadWorld(DIR);
const requests = parseCsv(readFileSync(`${DIR}requests.csv`, 'utf8'));
const expected = new Map(parseCsv(readFileSync(`${DIR}expected_requests.csv`, 'utf8')).map((r) => [r.request_id!, r]));
const scripted = requests.filter((r) => /^S\d\d$/.test(r.trap!)).sort((a, b) => a.trap!.localeCompare(b.trap!));

describe('leave:route reproduces the scripted requests', () => {
  it('there are twenty scripted requests S01..S20', () => {
    expect(scripted.map((r) => r.trap)).toEqual(Array.from({ length: 20 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`));
  });
  for (const r of scripted) {
    it(`${r.trap} ${r.request_id}: chain, working days, minutes and the A8 verdict match expected_requests.csv`, () => {
      const e = expected.get(r.request_id!)!;
      const p = predictRoute(world, { employeeId: r.employee_id!, leaveType: r.leave_type!, start: r.start!, end: r.end!, submit: r.submitted_on! });
      expect(p.chain).toBe(e.chain);
      expect(String(p.workingDays.length)).toBe(e.working_days);
      expect(String(p.minutes)).toBe(e.minutes);
      expect(p.policyId).toBe(e.policy_id);
      if (e.final_code === 'INSUFFICIENT_BALANCE') expect(p.check).toBe('INSUFFICIENT_BALANCE');
      else expect(p.check).not.toBe('INSUFFICIENT_BALANCE');
    });
  }
  it('S04 (T8): 10 days asked three weeks after hire is refused at submit, chain still shown', () => {
    const s04 = scripted.find((r) => r.trap === 'S04')!;
    const p = predictRoute(world, { employeeId: s04.employee_id!, leaveType: s04.leave_type!, start: s04.start!, end: s04.end!, submit: s04.submitted_on! });
    expect(p.check).toBe('INSUFFICIENT_BALANCE');
    expect(p.steps.length).toBeGreaterThan(0);
    const text = formatPrediction(p).join('\n');
    expect(text).toContain('DENIED INSUFFICIENT_BALANCE at submit (A8)');
    expect(text).toContain('nothing was written.');
  });
  it('refuses an unknown employee and an end before start', () => {
    expect(() => predictRoute(world, { employeeId: 'E999', leaveType: 'PTO', start: '2025-05-05', end: '2025-05-06', submit: '2025-05-01' })).toThrow(/unknown employee/);
    expect(() => predictRoute(world, { employeeId: 'E011', leaveType: 'PTO', start: '2025-05-06', end: '2025-05-05', submit: '2025-05-01' })).toThrow(/before/);
  });
});
