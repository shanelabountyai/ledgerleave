/**
 * Org state as of a date (brief §2, PRD P0-1): manager, roles and employment are derived from the employee's base
 * row plus the dated org changes effective on or before the date. Pure data in, pure answers out; no clock.
 *
 * Dates are `YYYY-MM-DD` strings compared as strings (D-7). This module imports nothing from `src/accrual/`:
 * routing needs only to compare days, never to do arithmetic on them.
 */

export const HR_ROLE = 'HR';

export interface Employee {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly dept: string;
  readonly managerId: string; // "" for the CEO
  readonly employmentType: string; // SALARIED | HOURLY
  readonly roles: string; // "+"-joined, e.g. "HR"
  readonly hireDate: string;
  readonly termDate: string; // "" while employed
}

export const ORG_CHANGE_FIELDS = ['MANAGER', 'ROLE_GRANTED', 'ROLE_REVOKED'] as const;
export type OrgChangeField = (typeof ORG_CHANGE_FIELDS)[number];

export interface OrgChange {
  readonly effective: string;
  readonly employeeId: string;
  readonly field: OrgChangeField;
  readonly old: string;
  readonly new: string;
}

export interface Delegation {
  readonly approverId: string;
  readonly delegateId: string;
  readonly start: string;
  readonly end: string;
}

/** Code-point string compare, the same order Python's sorted() gives on these ASCII ids and dates. */
export const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class Org {
  readonly employees: ReadonlyMap<string, Employee>;
  private readonly changes: readonly OrgChange[];

  constructor(employees: readonly Employee[], changes: readonly OrgChange[]) {
    const m = new Map<string, Employee>();
    for (const e of employees) {
      if (m.has(e.id)) throw new Error(`duplicate employee id ${e.id}`);
      m.set(e.id, e);
    }
    this.employees = m;
    // Changes apply in (effective, employee_id, field) order, like the oracle; ties on the same day are resolved by that order.
    this.changes = [...changes].sort((a, b) => cmpStr(a.effective, b.effective) || cmpStr(a.employeeId, b.employeeId) || cmpStr(a.field, b.field));
  }

  has(id: string): boolean {
    return this.employees.has(id);
  }

  get(id: string): Employee {
    const e = this.employees.get(id);
    if (!e) throw new Error(`unknown employee ${id}`);
    return e;
  }

  /** Employed on d: hired on or before d, and not terminated before d (the termination day itself still counts). */
  isActive(id: string, d: string): boolean {
    const e = this.employees.get(id);
    return !!e && e.hireDate <= d && (e.termDate === '' || d <= e.termDate);
  }

  /** The manager as of d: the base row, then every MANAGER change effective ≤ d in order. "" for the CEO. */
  managerOf(id: string, d: string): string {
    let m = this.get(id).managerId;
    for (const c of this.changes) if (c.employeeId === id && c.field === 'MANAGER' && c.effective <= d) m = c.new;
    return m;
  }

  /** Roles as of d: the base row's roles, then grants and revokes effective ≤ d in order. */
  rolesOf(id: string, d: string): Set<string> {
    const r = new Set(this.get(id).roles.split('+').filter((x) => x !== ''));
    for (const c of this.changes) {
      if (c.employeeId !== id || c.effective > d) continue;
      if (c.field === 'ROLE_REVOKED') r.delete(c.new);
      else if (c.field === 'ROLE_GRANTED') r.add(c.new);
    }
    return r;
  }

  holdsHr(id: string, d: string): boolean {
    return this.has(id) && this.rolesOf(id, d).has(HR_ROLE);
  }

  /** R6: HR role holders active on d, by employee id; the first is the HR primary. */
  hrHolders(d: string): string[] {
    const out: string[] = [];
    for (const id of this.employees.keys()) if (this.isActive(id, d) && this.rolesOf(id, d).has(HR_ROLE)) out.push(id);
    return out.sort(cmpStr);
  }

  /** The CEO: the lowest employee id with no manager on the base row. */
  ceo(): string {
    const ids: string[] = [];
    for (const e of this.employees.values()) if (e.managerId === '') ids.push(e.id);
    ids.sort(cmpStr);
    const c = ids[0];
    if (c === undefined) throw new Error('org has no CEO (no employee without a manager)');
    return c;
  }
}

/** R5: the delegate acting for `approverId` on d, or "" — the first delegation row whose range covers d. */
export function delegateOf(delegations: readonly Delegation[], approverId: string, d: string): string {
  for (const g of delegations) if (g.approverId === approverId && g.start <= d && d <= g.end) return g.delegateId;
  return '';
}
