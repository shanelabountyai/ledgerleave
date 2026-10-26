// Task 1.8: GR-01..GR-14 as exact chain strings on the brief §9 hand org, plus the codes the fixtures never reach
// (UNROUTABLE, DELEGATE_LACKS_HR_ROLE, FALLBACK_TO_CEO) and the org-state derivation.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadPolicyFile } from '@/accrual/policy';
import { type Delegation, type Employee, Org, type OrgChange } from '@/routing/org';
import { chainString, route, stepRequiresHr } from '@/routing/route';

const pf = loadPolicyFile(readFileSync(new URL('../../../fixtures/policies.json', import.meta.url), 'utf8'));
const PTO = pf.policies.get('PTO_SALARIED')!;
const SICK = pf.policies.get('SICK_STD')!;

const emp = (id: string, hire: string, managerId = '', term = '', roles = ''): Employee => ({
  id, name: id, title: 'T', dept: 'D', managerId, employmentType: 'SALARIED', roles, hireDate: hire, termDate: term,
});

// Hand org (brief §9): H1 CEO; H2 VP → H1; H3 manager → H2; H4, H5 ICs → H3; H6 VP People → H1; H7 HR Manager (HR) → H6;
// H8 HR Generalist (HR) → H7; H9 manager → H2 terminated 2025-03-31; H10 IC → H9.
const H: Employee[] = [
  emp('H1', '2010-01-04'), emp('H2', '2012-01-09', 'H1'), emp('H3', '2015-01-05', 'H2'), emp('H4', '2018-01-08', 'H3'),
  emp('H5', '2019-01-07', 'H3'), emp('H6', '2013-01-07', 'H1'), emp('H7', '2016-01-04', 'H6', '', 'HR'),
  emp('H8', '2020-01-06', 'H7', '', 'HR'), emp('H9', '2014-01-06', 'H2', '2025-03-31'), emp('H10', '2021-01-04', 'H9'),
];
const org = new Org(H, []);
const D = '2025-05-05';
const dlg = (a: string, b: string, start = '2025-05-01', end = '2025-05-09'): Delegation => ({ approverId: a, delegateId: b, start, end });

const r = (requester: string, workingDays: number, opts: { policy?: typeof PTO; delegations?: Delegation[]; submit?: string; org?: Org } = {}) =>
  chainString(route({ org: opts.org ?? org, policy: opts.policy ?? PTO, delegations: opts.delegations ?? [], requester, submit: opts.submit ?? D, workingDays }));

describe('GR-01..GR-14 (brief §9)', () => {
  it('GR-01 IC, 2 days', () => expect(r('H4', 2)).toBe('MANAGER:H3[MANAGER_OF_REQUESTER]'));
  it('GR-02 IC, 6 days → skip-level', () => expect(r('H4', 6)).toBe('MANAGER:H3[MANAGER_OF_REQUESTER]|SKIP_LEVEL:H2[MANAGER_OF_MANAGER]'));
  it('GR-03 IC, 11 days → + HR primary', () =>
    expect(r('H4', 11)).toBe('MANAGER:H3[MANAGER_OF_REQUESTER]|SKIP_LEVEL:H2[MANAGER_OF_MANAGER]|HR:H7[HR_ROLE_HOLDER]'));
  it('GR-04 manager delegating to a peer of the requester', () =>
    expect(r('H4', 2, { delegations: [dlg('H3', 'H5')] })).toBe('MANAGER:H5[MANAGER_OF_REQUESTER,DELEGATED]'));
  it('GR-05 delegate also delegating → depth exceeded → HR fallback', () =>
    expect(r('H4', 2, { delegations: [dlg('H3', 'H5'), dlg('H5', 'H2', '2025-05-05', '2025-05-06')] })).toBe(
      'MANAGER:H7[MANAGER_OF_REQUESTER,DELEGATION_DEPTH_EXCEEDED,FALLBACK_TO_HR]',
    ));
  it('GR-06 HR primary asks 11 days: HR step is self → manager → duplicate of step 1', () =>
    expect(r('H7', 11)).toBe(
      'MANAGER:H6[MANAGER_OF_REQUESTER]|SKIP_LEVEL:H1[MANAGER_OF_MANAGER]|~HR:H6[HR_ROLE_HOLDER,SELF_APPROVAL_TO_MANAGER,DUPLICATE_APPROVER_COLLAPSED]',
    ));
  it('GR-07 CEO, 2 days: the CEO manager is HR', () => expect(r('H1', 2)).toBe('MANAGER:H7[MANAGER_OF_REQUESTER,CEO_MANAGER_IS_HR]'));
  it('GR-08 CEO, 11 days: skip-level and HR both collapse into HR (O-9)', () =>
    expect(r('H1', 11)).toBe(
      'MANAGER:H7[MANAGER_OF_REQUESTER,CEO_MANAGER_IS_HR]|~SKIP_LEVEL:H7[MANAGER_OF_MANAGER,CEO_MANAGER_IS_HR,DUPLICATE_APPROVER_COLLAPSED]|~HR:H7[HR_ROLE_HOLDER,DUPLICATE_APPROVER_COLLAPSED]',
    ));
  it('GR-09 VP, 6 days: skip-level above the CEO is HR', () =>
    expect(r('H2', 6)).toBe('MANAGER:H1[MANAGER_OF_REQUESTER]|SKIP_LEVEL:H7[MANAGER_OF_MANAGER,CEO_MANAGER_IS_HR]'));
  it('GR-10 manager delegates to the requester: step dropped, empty chain → HR fallback', () =>
    expect(r('H4', 2, { delegations: [dlg('H3', 'H4')] })).toBe(
      '~MANAGER:H4[MANAGER_OF_REQUESTER,DELEGATED,DELEGATE_IS_REQUESTER_STEP_DROPPED]|FALLBACK:H7[EMPTY_CHAIN_TO_HR,FALLBACK_TO_HR]',
    ));
  it('GR-11 manager delegates to the skip-level: one approval, not two', () =>
    expect(r('H4', 6, { delegations: [dlg('H3', 'H2')] })).toBe('MANAGER:H2[MANAGER_OF_REQUESTER,DELEGATED]|~SKIP_LEVEL:H2[MANAGER_OF_MANAGER,DUPLICATE_APPROVER_COLLAPSED]'));
  it('GR-12 manager terminated, reports not yet moved: climb to the manager’s manager', () =>
    expect(r('H10', 2, { submit: '2025-04-07' })).toBe('MANAGER:H2[MANAGER_OF_REQUESTER,APPROVER_INACTIVE_TO_MANAGER]'));
  it('GR-13 sick 4 days: no skip-level step for sick, HR over 3', () =>
    expect(r('H4', 4, { policy: SICK })).toBe('MANAGER:H3[MANAGER_OF_REQUESTER]|HR:H7[HR_ROLE_HOLDER]'));
  it('GR-14 HR primary delegating to the HR backup', () =>
    expect(r('H4', 11, { delegations: [dlg('H7', 'H8')] })).toBe('MANAGER:H3[MANAGER_OF_REQUESTER]|SKIP_LEVEL:H2[MANAGER_OF_MANAGER]|HR:H8[HR_ROLE_HOLDER,DELEGATED]'));
});

describe('codes the fixtures never reach (brief §11)', () => {
  it('UNROUTABLE: no HR holders and the CEO is the requester (task 1.8 acceptance)', () => {
    const noHr = new Org(H.map((e) => ({ ...e, roles: '' })), []);
    expect(r('H1', 2, { org: noHr })).toBe('~MANAGER:[MANAGER_OF_REQUESTER,CEO_MANAGER_IS_HR,UNROUTABLE]|~FALLBACK:[EMPTY_CHAIN_TO_HR,UNROUTABLE]');
  });
  it('FALLBACK_TO_CEO: no HR holders, an IC whose manager delegates to a delegating delegate', () => {
    const noHr = new Org(H.map((e) => ({ ...e, roles: '' })), []);
    expect(r('H4', 2, { org: noHr, delegations: [dlg('H3', 'H5'), dlg('H5', 'H2')] })).toBe('MANAGER:H1[MANAGER_OF_REQUESTER,DELEGATION_DEPTH_EXCEEDED,FALLBACK_TO_CEO]');
  });
  it('FALLBACK_TO_CEO on the HR step: no HR holders at all, 11 days', () => {
    const noHr = new Org(H.map((e) => ({ ...e, roles: '' })), []);
    expect(r('H4', 11, { org: noHr })).toBe('MANAGER:H3[MANAGER_OF_REQUESTER]|SKIP_LEVEL:H2[MANAGER_OF_MANAGER]|HR:H1[HR_ROLE_HOLDER,FALLBACK_TO_CEO]');
  });
  it('DELEGATE_LACKS_HR_ROLE: the HR primary delegates the HR step to someone without HR → R7 fallback', () => {
    // The oracle's fallback is the HR primary — H7, the very person who delegated. Hand derivation first said H8;
    // leavelib says H7 and the oracle wins (D-25). Noted for the owner in NEXT.md as a candidate decision.
    expect(r('H4', 11, { delegations: [dlg('H7', 'H6')] })).toBe(
      'MANAGER:H3[MANAGER_OF_REQUESTER]|SKIP_LEVEL:H2[MANAGER_OF_MANAGER]|HR:H7[HR_ROLE_HOLDER,DELEGATE_LACKS_HR_ROLE,FALLBACK_TO_HR]',
    );
  });
  it('an INACTIVE delegate counts as depth exceeded (R5, plan C-12)', () => {
    expect(r('H10', 2, { delegations: [dlg('H2', 'H9', '2025-04-01', '2025-04-10')], submit: '2025-04-07' })).toBe(
      'MANAGER:H7[MANAGER_OF_REQUESTER,APPROVER_INACTIVE_TO_MANAGER,DELEGATION_DEPTH_EXCEEDED,FALLBACK_TO_HR]',
    );
  });
  it('a delegation outside its date range does nothing', () => {
    expect(r('H4', 2, { delegations: [dlg('H3', 'H5', '2025-05-06', '2025-05-09')] })).toBe('MANAGER:H3[MANAGER_OF_REQUESTER]');
  });
  it('a fallback approver is never delegated (R7)', () => {
    expect(r('H4', 2, { delegations: [dlg('H3', 'H5'), dlg('H5', 'H2'), dlg('H7', 'H8')] })).toBe('MANAGER:H7[MANAGER_OF_REQUESTER,DELEGATION_DEPTH_EXCEEDED,FALLBACK_TO_HR]');
  });
});

describe('stepRequiresHr walks the codes in order; the last selection wins', () => {
  it('sets and clears', () => {
    expect(stepRequiresHr(['HR_ROLE_HOLDER'])).toBe(true);
    expect(stepRequiresHr(['MANAGER_OF_REQUESTER', 'CEO_MANAGER_IS_HR'])).toBe(true);
    expect(stepRequiresHr(['HR_ROLE_HOLDER', 'SELF_APPROVAL_TO_MANAGER'])).toBe(false);
    expect(stepRequiresHr(['EMPTY_CHAIN_TO_HR', 'FALLBACK_TO_HR'])).toBe(true);
    expect(stepRequiresHr(['HR_ROLE_HOLDER', 'FALLBACK_TO_CEO'])).toBe(false);
    expect(stepRequiresHr(['MANAGER_OF_REQUESTER', 'DELEGATED'])).toBe(false);
    expect(stepRequiresHr(['HR_ROLE_HOLDER', 'DELEGATED'])).toBe(true); // GR-14: the delegate must hold HR too
  });
});

describe('Org: state as of a date from the base row plus dated changes', () => {
  const changes: OrgChange[] = [
    { effective: '2025-05-07', employeeId: 'H4', field: 'MANAGER', old: 'H3', new: 'H2' },
    { effective: '2025-05-06', employeeId: 'H7', field: 'ROLE_REVOKED', old: 'HR', new: 'HR' },
    { effective: '2025-06-01', employeeId: 'H5', field: 'ROLE_GRANTED', old: '', new: 'HR' },
  ];
  const o = new Org(H, changes);
  it('manager changes apply from their effective date inclusive', () => {
    expect(o.managerOf('H4', '2025-05-06')).toBe('H3');
    expect(o.managerOf('H4', '2025-05-07')).toBe('H2');
  });
  it('roles are revoked and granted on their dates; the HR primary moves (GR-15 Q2)', () => {
    expect(o.hrHolders('2025-05-05')).toEqual(['H7', 'H8']);
    expect(o.hrHolders('2025-05-06')).toEqual(['H8']);
    expect(o.hrHolders('2025-06-01')).toEqual(['H5', 'H8']);
    expect(o.holdsHr('H7', '2025-05-05')).toBe(true);
    expect(o.holdsHr('H7', '2025-05-06')).toBe(false);
  });
  it('active is hire ≤ d ≤ term, the termination day included', () => {
    expect(o.isActive('H9', '2025-03-31')).toBe(true);
    expect(o.isActive('H9', '2025-04-01')).toBe(false);
    expect(o.isActive('H10', '2021-01-03')).toBe(false);
    expect(o.isActive('ZZ', '2025-01-01')).toBe(false);
  });
  it('the CEO is the lowest id without a manager', () => {
    expect(o.ceo()).toBe('H1');
  });
});
