// CLONE-OWNED. The INV-01..04 harness seeds these rows in both fixture orgs, so it can drive
// actions whose inputs use ref('<model>') for the clone's own tables. Return { model: id } for
// one row of each model, owned by `org.orgId`.
//
// Ledgerleave (Phase 3 task 3.1): one leave setup per org — settings, the fixture policy file, one employee (E001,
// the harness's own owner is NOT linked to it, so engine commands are refused with a message as D-42 says) and one
// request — so ref('employee') and ref('leaveRequest') resolve inside the right org.
import { readFileSync } from 'node:fs';
import { db } from '@/core/db';
import { policyContentHash } from '../../scripts/leave/import-fixtures';

// Fixed ids: the harness re-seeds before every call and builds inputs from the first seed's ids.
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const IDS = { a: { employee: ID(150), leaveRequest: ID(151) }, b: { employee: ID(250), leaveRequest: ID(251) } } as const;

const policyText = readFileSync(new URL('../../fixtures/policies.json', import.meta.url), 'utf8');

export async function seedApp(org: { orgId: string; userId: string }, key: 'a' | 'b'): Promise<Record<string, string>> {
  const { orgId } = org;
  await db.leaveSettings.create({ data: { orgId, ledgerStart: '2024-01-01' } });
  await db.policySet.create({ data: { orgId, content: JSON.parse(policyText), contentHash: policyContentHash(policyText) } });
  const employee = await db.employee.create({
    data: { id: IDS[key].employee, orgId, employeeId: 'E001', name: `Employee ${key}`, title: 'T', dept: 'D', managerId: null, employmentType: 'SALARIED', roles: 'HR', hireDate: '2020-01-06', termDate: null, email: `e001-${key}@harness.example` },
  });
  await db.policyAssignment.create({ data: { orgId, employeeId: 'E001', leaveType: 'PTO', policyId: 'PTO_SALARIED', start: '2020-01-06', end: null } });
  const request = await db.leaveRequest.create({ data: { id: IDS[key].leaveRequest, orgId, requestId: 'R-0001', employeeId: 'E001', leaveType: 'PTO', start: '2025-05-19', end: '2025-05-20', submittedOn: '2025-05-05' } });
  return { employee: employee.id, leaveRequest: request.id };
}
