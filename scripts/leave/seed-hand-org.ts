/**
 * The brief §9 hand org as database rows, for tests, the Phase 3 e2e walk and a local look around: H1 CEO … H10,
 * H7/H8 HR, H9 terminated 2025-03-31; everyone on PTO_SALARIED with a 2400-minute opening balance, the fixture
 * policies and holidays, and (by default) GR-15's two org changes — H4's manager becomes H2 on 2025-05-07 and H7's HR
 * role is revoked on 2025-05-06. Writes inputs only; the replay derives everything else. Synthetic people.
 *
 *   npx tsx scripts/leave/seed-hand-org.ts [slug]     (needs DATABASE_URL; refuses if the slug exists)
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { db } from '../../src/core/db';
import { policyContentHash } from './import-fixtures';

const DIR = new URL('../../fixtures/', import.meta.url);

export const HAND_EMPLOYEES: readonly [id: string, hire: string, managerId: string | null, termDate: string | null, roles: string, name: string][] = [
  ['H1', '2010-01-04', null, null, '', 'Hana (CEO)'], ['H2', '2012-01-09', 'H1', null, '', 'Hugo (VP)'], ['H3', '2015-01-05', 'H2', null, '', 'Hilde (manager)'],
  ['H4', '2018-01-08', 'H3', null, '', 'Hal (IC)'], ['H5', '2019-01-07', 'H3', null, '', 'Hiro (IC)'], ['H6', '2013-01-07', 'H1', null, '', 'Holly (VP People)'],
  ['H7', '2016-01-04', 'H6', null, 'HR', 'Hector (HR manager)'], ['H8', '2020-01-06', 'H7', null, 'HR', 'Heidi (HR generalist)'],
  ['H9', '2014-01-06', 'H2', '2025-03-31', '', 'Hank (left 2025-03-31)'], ['H10', '2021-01-04', 'H9', null, '', 'Hope (IC)'],
];

export interface HandOrgOptions {
  readonly slug?: string;
  readonly name?: string;
  /** GR-15's org changes (default true). */
  readonly gr15Changes?: boolean;
  readonly timeZone?: string;
}

export async function seedHandOrg(opts: HandOrgOptions = {}): Promise<string> {
  const slug = opts.slug ?? 'hand';
  const orgId = (await db.org.create({ data: { slug, name: opts.name ?? slug } })).id;
  const policyText = readFileSync(new URL('policies.json', DIR), 'utf8');
  await db.leaveSettings.create({ data: { orgId, ledgerStart: '2024-01-01', ...(opts.timeZone ? { timeZone: opts.timeZone } : {}) } });
  await db.policySet.create({ data: { orgId, content: JSON.parse(policyText), contentHash: policyContentHash(policyText) } });
  await db.holiday.createMany({ data: readFileSync(new URL('holidays.csv', DIR), 'utf8').trim().split('\n').slice(1).map((date) => ({ orgId, date })) });
  for (const [id, hire, managerId, termDate, roles, name] of HAND_EMPLOYEES) {
    await db.employee.create({ data: { orgId, employeeId: id, name, title: 'T', dept: 'D', managerId, employmentType: 'SALARIED', roles, hireDate: hire, termDate, email: `${id.toLowerCase()}@hand.example` } });
    await db.policyAssignment.create({ data: { orgId, employeeId: id, leaveType: 'PTO', policyId: 'PTO_SALARIED', start: hire, end: termDate } });
    await db.policyAssignment.create({ data: { orgId, employeeId: id, leaveType: 'SICK', policyId: 'SICK_STD', start: hire, end: termDate } });
    await db.openingBalance.create({ data: { orgId, employeeId: id, leaveType: 'PTO', minutes: 2400 } });
  }
  if (opts.gr15Changes ?? true) {
    await db.orgChange.createMany({
      data: [
        { orgId, effective: '2025-05-07', employeeId: 'H4', field: 'MANAGER', oldValue: 'H3', newValue: 'H2' },
        { orgId, effective: '2025-05-06', employeeId: 'H7', field: 'ROLE_REVOKED', oldValue: 'HR', newValue: 'HR' },
      ],
    });
  }
  return orgId;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const slug = process.argv[2] ?? 'hand';
  seedHandOrg({ slug })
    .then((id) => console.log(`seed-hand-org OK: org ${slug} (${id}), ${HAND_EMPLOYEES.length} employees`))
    .catch((e: Error) => {
      console.error(`seed-hand-org FAILED: ${e.message}`);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
