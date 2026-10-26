/**
 * D-42 (owner decision 2026-10-26, closes O-12): which signed-in User acts as which Employee is the explicit,
 * nullable `Employee.userId`, set or cleared ONLY by `linkEmployee` — an HR action that writes an audit row in the
 * same transaction. A membership email that equals the employee's email is offered as a SUGGESTION on the HR screen
 * (`linkSuggestions`) and never links by itself. Who may run the HR action is `hrAccess`: an org owner/admin
 * (`members.manage`), or a user whose linked employee holds HR on the org's today (D-43).
 */
import { audit } from '@/core/audit';
import { can } from '@/core/authz/permissions';
import { db } from '@/core/db';
import type { Role } from '@/generated/prisma/enums';
import { HR_ROLE } from '@/routing/org';
import { assertWritable } from './archive';
import { ActionRefused } from './errors';
import { REPLAY_TX, lockOrg, loadOrgFromDb } from './replay';

export interface LinkedEmployee {
  readonly employeeId: string;
  readonly name: string;
}

/** The employee this user acts as in this org, or null (then every leave action refuses with NO_EMPLOYEE_MESSAGE). */
export async function employeeForUser(orgId: string, userId: string): Promise<LinkedEmployee | null> {
  const e = await db.employee.findUnique({ where: { orgId_userId: { orgId, userId } }, select: { employeeId: true, name: true } });
  return e ? { employeeId: e.employeeId, name: e.name } : null;
}

export const NO_EMPLOYEE_MESSAGE = 'Your account is not linked to an employee in this org yet. Ask HR to link it (Leave → HR → People).';

/** As employeeForUser, but refuses with the user-facing message (D-42: a stack trace is never the answer). */
export async function requireEmployee(orgId: string, userId: string): Promise<LinkedEmployee> {
  const e = await employeeForUser(orgId, userId);
  if (!e) throw new ActionRefused(NO_EMPLOYEE_MESSAGE);
  return e;
}

export interface HrAccess {
  readonly allowed: boolean;
  /** Why: 'org-admin' (owner/admin), 'hr-role' (linked employee holds HR today), or 'none'. */
  readonly via: 'org-admin' | 'hr-role' | 'none';
}

/** May this member run the HR console and its actions today? (D-42.) */
export async function hrAccess(orgId: string, userId: string, role: Role, today: string): Promise<HrAccess> {
  if (can(role, 'members.manage')) return { allowed: true, via: 'org-admin' };
  const me = await employeeForUser(orgId, userId);
  if (me) {
    const { org } = await loadOrgFromDb(db, orgId);
    if (org.isActive(me.employeeId, today) && org.rolesOf(me.employeeId, today).has(HR_ROLE)) return { allowed: true, via: 'hr-role' };
  }
  return { allowed: false, via: 'none' };
}

export interface LinkInput {
  readonly orgId: string;
  readonly employeeId: string;
  /** The user to link, or null to clear the link. */
  readonly userId: string | null;
  /** The signed-in user doing it (audited). */
  readonly actorUserId: string;
}

/** Set or clear `Employee.userId` (D-42). The user must be a member of the org and not linked to another employee. */
export async function linkEmployee(input: LinkInput): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockOrg(tx, input.orgId);
    await assertWritable(tx, input.orgId);
    const emp = await tx.employee.findUnique({ where: { orgId_employeeId: { orgId: input.orgId, employeeId: input.employeeId } } });
    if (!emp) throw new ActionRefused(`There is no employee ${input.employeeId} in this org.`);
    if (input.userId !== null) {
      const member = await tx.membership.findUnique({ where: { orgId_userId: { orgId: input.orgId, userId: input.userId } } });
      if (!member) throw new ActionRefused('That person is not a member of this org. Invite them first.');
      const other = await tx.employee.findUnique({ where: { orgId_userId: { orgId: input.orgId, userId: input.userId } } });
      if (other && other.employeeId !== emp.employeeId) throw new ActionRefused(`That account already acts as ${other.employeeId}. Unlink it there first.`);
    }
    if (emp.userId === input.userId) return; // nothing changes, nothing is audited
    await tx.employee.update({ where: { id: emp.id }, data: { userId: input.userId } });
    await audit(
      { orgId: input.orgId, userId: input.actorUserId },
      input.userId === null ? 'employee.unlinked' : 'employee.linked',
      { targetType: 'employee', targetId: emp.id, data: { employeeId: emp.employeeId, userId: input.userId, previousUserId: emp.userId } },
      tx,
    );
  }, REPLAY_TX);
}

export interface LinkSuggestion {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly userId: string;
  readonly email: string;
}

/**
 * Unlinked employees whose email equals an unlinked member's email (case-insensitive). A suggestion pre-fills the HR
 * form; it is never applied without the HR action (D-42).
 */
export async function linkSuggestions(orgId: string): Promise<LinkSuggestion[]> {
  const members = await db.membership.findMany({ where: { orgId }, select: { user: { select: { id: true, email: true } } } });
  const linked = new Set((await db.employee.findMany({ where: { orgId, userId: { not: null } }, select: { userId: true } })).map((e) => e.userId));
  const byEmail = new Map(members.filter((m) => !linked.has(m.user.id)).map((m) => [m.user.email.toLowerCase(), m.user]));
  const out: LinkSuggestion[] = [];
  for (const e of await db.employee.findMany({ where: { orgId, userId: null }, orderBy: { employeeId: 'asc' } })) {
    const u = byEmail.get(e.email.toLowerCase());
    if (u) out.push({ employeeId: e.employeeId, employeeName: e.name, userId: u.id, email: u.email });
  }
  return out;
}
