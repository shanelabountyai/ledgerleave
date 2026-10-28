/**
 * The approval-routing engine, R1–R9 (docs/domain-brief.md §6, D-18, D-19). A pure function of the org state at the
 * submit date, the policy's thresholds, the active delegations, the requester and the working-day count. Output:
 * an ordered list of steps, each with its resolved approver and ORDERED reason codes; a dropped step stays in the
 * output marked dropped so the inbox can say why (`~STEP:…`). The chain is then frozen (R9): nothing after submit
 * re-routes it.
 *
 * Mirrors tools/leavelib.py `route()` clause for clause — including the parts that look odd: the SKIP_LEVEL step
 * re-resolves the requester's manager (so an APPROVER_INACTIVE_TO_MANAGER code lands on it too), and the CEO's
 * skip-level never climbs above HR (O-9).
 *
 * Lineage (D-32): Adjuster's "a decision carries the rules that fired, in order" was not readable from this
 * session; the `codes[]` shape is written from §6.
 */
import { type Delegation, HR_ROLE, type Org, delegateOf } from './org';

export const STEP_IDS = ['MANAGER', 'SKIP_LEVEL', 'HR', 'FALLBACK'] as const;
export type StepId = (typeof STEP_IDS)[number];

/** The closed code set (R1–R9, R7′). A new code needs a decision and a golden. */
export const ROUTING_CODES = [
  'MANAGER_OF_REQUESTER',
  'MANAGER_OF_MANAGER',
  'HR_ROLE_HOLDER',
  'CEO_MANAGER_IS_HR',
  'APPROVER_INACTIVE_TO_MANAGER',
  'SELF_APPROVAL_TO_MANAGER',
  'DELEGATED',
  'DELEGATION_DEPTH_EXCEEDED',
  'DELEGATE_IS_REQUESTER_STEP_DROPPED',
  'DELEGATE_LACKS_HR_ROLE',
  'FALLBACK_TO_HR',
  'FALLBACK_TO_CEO',
  'FALLBACK_TO_DELEGATOR', // D-44
  'UNROUTABLE',
  'DUPLICATE_APPROVER_COLLAPSED',
  'EMPTY_CHAIN_TO_HR',
] as const;
export type RoutingCode = (typeof ROUTING_CODES)[number];

export interface Step {
  readonly stepId: StepId;
  /** The resolved approver; "" when UNROUTABLE. Mutable only by REASSIGN (S-rules), which replaces it. */
  approver: string;
  readonly codes: RoutingCode[];
  readonly kept: boolean;
}

/** What `route()` needs from a policy: the two thresholds (D-18). null = that step never applies. */
export interface RoutingThresholds {
  readonly skipLevelOverDays: number | null;
  readonly hrOverDays: number | null;
}

/** `STEP:approver[code,code]` joined by `|`; a dropped step is prefixed `~`. Exactly the oracle's chain_str. */
export function chainString(steps: readonly Step[]): string {
  return steps.map((s) => `${s.kept ? '' : '~'}${s.stepId}:${s.approver}[${s.codes.join(',')}]`).join('|');
}

/**
 * S3 / R5: does this step's approver have to hold HR on the day they act? Walk the codes in order; the last
 * selection decides. HR_ROLE_HOLDER, CEO_MANAGER_IS_HR, FALLBACK_TO_HR, EMPTY_CHAIN_TO_HR set it;
 * SELF_APPROVAL_TO_MANAGER, FALLBACK_TO_CEO, APPROVER_INACTIVE_TO_MANAGER clear it.
 */
export function stepRequiresHr(codes: readonly RoutingCode[]): boolean {
  let req = false;
  for (const c of codes) {
    if (c === 'HR_ROLE_HOLDER' || c === 'CEO_MANAGER_IS_HR' || c === 'FALLBACK_TO_HR' || c === 'EMPTY_CHAIN_TO_HR') req = true;
    else if (c === 'SELF_APPROVAL_TO_MANAGER' || c === 'FALLBACK_TO_CEO' || c === 'APPROVER_INACTIVE_TO_MANAGER') req = false;
  }
  return req;
}

/**
 * R7: HR primary, other HR holders by id, then the CEO; never the requester, never someone inactive; never delegated.
 * R7′ (D-44, D-56): after a failed delegation, also skip the approver who delegated the step away; if that leaves no HR
 * holder and the delegator holds HR, the delegator (FALLBACK_TO_DELEGATOR, neutral for stepRequiresHr). A non-HR
 * delegator changes nothing.
 */
function fallback(org: Org, requester: string, d: string, codes: RoutingCode[], delegator = ''): string {
  const holders = org.hrHolders(d);
  for (const h of holders) {
    if (h !== requester && h !== delegator) {
      codes.push('FALLBACK_TO_HR');
      return h;
    }
  }
  if (delegator !== '' && holders.includes(delegator)) {
    codes.push('FALLBACK_TO_DELEGATOR');
    return delegator;
  }
  const ceo = org.ceo();
  if (ceo !== requester && org.isActive(ceo, d)) {
    codes.push('FALLBACK_TO_CEO');
    return ceo;
  }
  codes.push('UNROUTABLE');
  return '';
}

/**
 * The manager of `id` as of d. An inactive manager is skipped upward, repeatedly (R3). The CEO's manager is the HR
 * primary (R2); with no HR holder at all, the fallback. Returns [approver, isFallback].
 */
function managerOf(org: Org, id: string, requester: string, d: string, codes: RoutingCode[]): [string, boolean] {
  let m = org.managerOf(id, d);
  while (m !== '' && !org.isActive(m, d)) {
    codes.push('APPROVER_INACTIVE_TO_MANAGER');
    m = org.managerOf(m, d);
  }
  if (m !== '') return [m, false];
  codes.push('CEO_MANAGER_IS_HR');
  const holders = org.hrHolders(d);
  if (holders.length) return [holders[0]!, false];
  return [fallback(org, requester, d, codes), true];
}

export interface RouteInput {
  readonly org: Org;
  readonly policy: RoutingThresholds;
  readonly delegations: readonly Delegation[];
  readonly requester: string;
  readonly submit: string;
  readonly workingDays: number;
}

/** R1–R9: the ordered approval chain as of the submit date. */
export function route(input: RouteInput): Step[] {
  const { org, policy, delegations, requester, submit, workingDays } = input;
  const plan: [StepId, RoutingCode][] = [['MANAGER', 'MANAGER_OF_REQUESTER']];
  if (policy.skipLevelOverDays !== null && workingDays > policy.skipLevelOverDays) plan.push(['SKIP_LEVEL', 'MANAGER_OF_MANAGER']);
  if (policy.hrOverDays !== null && workingDays > policy.hrOverDays) plan.push(['HR', 'HR_ROLE_HOLDER']);

  const steps: Step[] = [];
  for (const [stepId, nominal] of plan) {
    const codes: RoutingCode[] = [nominal];
    let appr = '';
    let fb = false;
    if (stepId === 'MANAGER') {
      [appr, fb] = managerOf(org, requester, requester, submit, codes);
    } else if (stepId === 'SKIP_LEVEL') {
      if (org.managerOf(requester, submit) === '') {
        // the CEO's chain never climbs above HR (O-9): same HR primary as the MANAGER step, collapsed by R8
        [appr, fb] = managerOf(org, requester, requester, submit, codes);
      } else {
        const [m, mfb] = managerOf(org, requester, requester, submit, codes);
        if (!mfb && m !== '') [appr, fb] = managerOf(org, m, requester, submit, codes);
        else [appr, fb] = [m, mfb];
      }
    } else {
      const holders = org.hrHolders(submit);
      appr = holders[0] ?? '';
      if (appr === '') {
        appr = fallback(org, requester, submit, codes);
        fb = true;
      }
    }
    // R4: nobody approves their own request
    if (appr !== '' && appr === requester) {
      codes.push('SELF_APPROVAL_TO_MANAGER');
      [appr, fb] = managerOf(org, requester, requester, submit, codes);
    }
    // R5: delegation, one hop, never on a fallback approver
    let kept = appr !== '';
    if (appr !== '' && !fb) {
      const dlg = delegateOf(delegations, appr, submit);
      if (dlg !== '') {
        if (delegateOf(delegations, dlg, submit) !== '' || !org.isActive(dlg, submit)) {
          codes.push('DELEGATION_DEPTH_EXCEEDED');
          appr = fallback(org, requester, submit, codes, appr);
          kept = appr !== '';
        } else if (stepRequiresHr(codes) && !org.rolesOf(dlg, submit).has(HR_ROLE)) {
          codes.push('DELEGATE_LACKS_HR_ROLE');
          appr = fallback(org, requester, submit, codes, appr);
          kept = appr !== '';
        } else if (dlg === requester) {
          codes.push('DELEGATED', 'DELEGATE_IS_REQUESTER_STEP_DROPPED');
          appr = dlg;
          kept = false;
        } else {
          codes.push('DELEGATED');
          appr = dlg;
        }
      }
    }
    // R8: one person approves once
    if (kept && steps.some((s) => s.kept && s.approver === appr)) {
      codes.push('DUPLICATE_APPROVER_COLLAPSED');
      kept = false;
    }
    steps.push({ stepId, approver: appr, codes, kept });
  }
  // R9: an empty chain gets a FALLBACK step
  if (!steps.some((s) => s.kept)) {
    const codes: RoutingCode[] = ['EMPTY_CHAIN_TO_HR'];
    const appr = fallback(org, requester, submit, codes);
    steps.push({ stepId: 'FALLBACK', approver: appr, codes, kept: appr !== '' });
  }
  return steps;
}
