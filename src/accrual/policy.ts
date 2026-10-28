/**
 * Policies as data (D-15, brief §3). `fixtures/policies.json` is parsed here and nowhere else; every vocabulary
 * is closed and checked on load, and the error names the field that failed (`policies[2].accrual.frequency`).
 * No expressions, no eval: a policy is numbers, enums and a tier table.
 *
 * Also read and closed here (docs/phase-1-plan.md C-1, C-2): `work_day_minutes` must be 480 (D-6) and the routing
 * table must be exactly the one the oracle runs — steps [MANAGER, SKIP_LEVEL, HR], one delegation hop, fallback
 * [HR_PRIMARY, OTHER_HR, CEO]. A different value is refused rather than silently ignored; making it configurable
 * needs a decision and a golden (D-18).
 *
 * Lineage (D-32): Adjuster's rules-as-data loader with validation on load was not readable from this session;
 * written fresh from D-15.
 */
import { type CalendarDay, calendarDay } from './calendar';
import { ROUNDINGS, type Rounding, WORK_DAY_MINUTES } from './minutes';

export const FREQUENCIES = ['MONTHLY', 'PER_PAY_PERIOD', 'ANNIVERSARY', 'PER_HOURS_WORKED'] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const PRORATIONS = ['DAILY', 'NONE'] as const;
export type Proration = (typeof PRORATIONS)[number];
export const YEAR_TYPES = ['CALENDAR', 'POLICY_YEAR', 'ANNIVERSARY'] as const;
export type YearType = (typeof YEAR_TYPES)[number];
export const LEAVE_TYPES = ['PTO', 'SICK'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const ROUTING_STEPS = ['MANAGER', 'SKIP_LEVEL', 'HR'] as const;
export const FALLBACK_ORDER = ['HR_PRIMARY', 'OTHER_HR', 'CEO'] as const;
export const DELEGATION_MAX_DEPTH = 1;

export class PolicyError extends Error {
  constructor(
    readonly field: string,
    detail: string,
  ) {
    super(`${field}: ${detail}`);
    this.name = 'PolicyError';
  }
}

export interface Tier {
  readonly minTenureMonths: number;
  readonly minutesPerPeriod: number;
}

export interface Policy {
  readonly id: string;
  readonly leaveType: LeaveType;
  readonly frequency: Frequency;
  readonly tiers: readonly Tier[]; // sorted by minTenureMonths; empty for PER_HOURS_WORKED
  readonly minutesPer60Worked: number; // PER_HOURS_WORKED only, else 0
  readonly proration: Proration;
  readonly rounding: Rounding;
  readonly yearType: YearType;
  readonly yearStarts: string; // "MM-DD"; "01-01" unless POLICY_YEAR
  readonly carryoverCapMinutes: number;
  readonly maxBalanceMinutes: number;
  readonly allowNegative: boolean;
  readonly skipLevelOverDays: number | null;
  readonly hrOverDays: number | null;
  /** A2: the highest tier whose minTenureMonths ≤ tenure; 0 when there are no tiers. */
  rate(tenureMonths: number): number;
}

export interface RoutingTable {
  readonly steps: readonly string[];
  readonly delegationMaxDepth: number;
  readonly fallbackOrder: readonly string[];
}

export interface PolicyFile {
  readonly version: number;
  readonly workDayMinutes: number;
  readonly payPeriod: { readonly anchorStart: CalendarDay; readonly lengthDays: number };
  readonly routingTable: RoutingTable;
  readonly policies: ReadonlyMap<string, Policy>;
}

// ---------------------------------------------------------------------------------------------------- helpers

type J = Record<string, unknown>;

const isObj = (v: unknown): v is J => typeof v === 'object' && v !== null && !Array.isArray(v);

function obj(v: unknown, field: string): J {
  if (!isObj(v)) throw new PolicyError(field, `expected an object, got ${describe(v)}`);
  return v;
}

function str(v: unknown, field: string): string {
  if (typeof v !== 'string' || v === '') throw new PolicyError(field, `expected a non-empty string, got ${describe(v)}`);
  return v;
}

function int(v: unknown, field: string, min = Number.NEGATIVE_INFINITY): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new PolicyError(field, `expected an integer, got ${describe(v)}`);
  if (v < min) throw new PolicyError(field, `must be ≥ ${min}, got ${v}`);
  return v;
}

function bool(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') throw new PolicyError(field, `expected true or false, got ${describe(v)}`);
  return v;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new PolicyError(field, `must be one of ${allowed.join(' | ')}, got ${describe(v)}`);
  }
  return v as T;
}

function exactList(v: unknown, want: readonly string[], field: string): readonly string[] {
  if (!Array.isArray(v) || v.length !== want.length || v.some((x, i) => x !== want[i])) {
    throw new PolicyError(field, `must be exactly [${want.join(', ')}] (the order the engine runs, D-18/R7), got ${describe(v)}`);
  }
  return want;
}

const describe = (v: unknown): string => (v === undefined ? 'nothing' : JSON.stringify(v));

// ---------------------------------------------------------------------------------------------------- policy

/** Parse and validate one policy object (one element of `policies[]`). `at` prefixes every error. */
export function parsePolicy(json: unknown, at = ''): Policy {
  const f = (name: string) => (at ? `${at}.${name}` : name);
  const p = obj(json, at || 'policy');
  const id = str(p.id, f('id'));
  const leaveType = oneOf(p.leave_type, LEAVE_TYPES, f('leave_type'));
  const acc = obj(p.accrual, f('accrual'));
  const frequency = oneOf(acc.frequency, FREQUENCIES, f('accrual.frequency'));
  const proration = acc.proration === undefined ? 'NONE' : oneOf(acc.proration, PRORATIONS, f('accrual.proration'));
  const rounding = oneOf(acc.rounding, ROUNDINGS, f('accrual.rounding'));
  if (proration === 'DAILY' && frequency !== 'MONTHLY') {
    throw new PolicyError(f('accrual.proration'), `DAILY proration is defined for MONTHLY only (A3), frequency is ${frequency}`);
  }

  let tiers: Tier[] = [];
  let minutesPer60Worked = 0;
  if (frequency === 'PER_HOURS_WORKED') {
    minutesPer60Worked = int(acc.minutes_per_60_worked, f('accrual.minutes_per_60_worked'), 1);
    if (Array.isArray(acc.tiers) && acc.tiers.length) throw new PolicyError(f('accrual.tiers'), 'PER_HOURS_WORKED has a rate, not tiers');
  } else {
    if (acc.minutes_per_60_worked !== undefined) throw new PolicyError(f('accrual.minutes_per_60_worked'), `only PER_HOURS_WORKED has a rate per hour, frequency is ${frequency}`);
    if (!Array.isArray(acc.tiers) || acc.tiers.length === 0) throw new PolicyError(f('accrual.tiers'), 'a non-empty tier list is required');
    tiers = acc.tiers.map((t, i) => {
      const to = obj(t, f(`accrual.tiers[${i}]`));
      return { minTenureMonths: int(to.min_tenure_months, f(`accrual.tiers[${i}].min_tenure_months`), 0), minutesPerPeriod: int(to.minutes_per_period, f(`accrual.tiers[${i}].minutes_per_period`), 0) };
    });
    if (tiers[0]!.minTenureMonths !== 0) throw new PolicyError(f('accrual.tiers[0].min_tenure_months'), `the first tier must start at 0 months, got ${tiers[0]!.minTenureMonths}`);
    for (let i = 1; i < tiers.length; i++) {
      if (tiers[i]!.minTenureMonths <= tiers[i - 1]!.minTenureMonths) throw new PolicyError(f(`accrual.tiers[${i}].min_tenure_months`), 'tiers must be strictly increasing in tenure');
    }
  }

  const yr = obj(p.year, f('year'));
  const yearType = oneOf(yr.type, YEAR_TYPES, f('year.type'));
  let yearStarts = '01-01';
  if (yearType === 'POLICY_YEAR') {
    const s = str(yr.starts, f('year.starts'));
    if (!/^\d{2}-\d{2}$/.test(s)) throw new PolicyError(f('year.starts'), `expected MM-DD, got ${describe(s)}`);
    calendarDay(`2001-${s}`); // a day every (non-leap) year has; 02-29 would be a boundary that vanishes three years in four
    yearStarts = s;
  } else if (yr.starts !== undefined) {
    throw new PolicyError(f('year.starts'), `only POLICY_YEAR has a start date, type is ${yearType}`);
  }

  const carryoverCapMinutes = int(p.carryover_cap_minutes, f('carryover_cap_minutes'), 0);
  const maxBalanceMinutes = int(p.max_balance_minutes, f('max_balance_minutes'), 0);
  const allowNegative = bool(p.allow_negative, f('allow_negative'));

  let skipLevelOverDays: number | null = null;
  let hrOverDays: number | null = null;
  if (p.routing !== undefined) {
    const rt = obj(p.routing, f('routing'));
    skipLevelOverDays = rt.skip_level_over_days === null || rt.skip_level_over_days === undefined ? null : int(rt.skip_level_over_days, f('routing.skip_level_over_days'), 0);
    hrOverDays = rt.hr_over_days === null || rt.hr_over_days === undefined ? null : int(rt.hr_over_days, f('routing.hr_over_days'), 0);
  }

  const sortedTiers = [...tiers].sort((a, b) => a.minTenureMonths - b.minTenureMonths);
  return {
    id,
    leaveType,
    frequency,
    tiers: sortedTiers,
    minutesPer60Worked,
    proration,
    rounding,
    yearType,
    yearStarts,
    carryoverCapMinutes,
    maxBalanceMinutes,
    allowNegative,
    skipLevelOverDays,
    hrOverDays,
    rate(tenureMonths: number): number {
      let r = 0;
      for (const t of sortedTiers) if (tenureMonths >= t.minTenureMonths) r = t.minutesPerPeriod;
      return r;
    },
  };
}

/** Parse the whole `policies.json` text. Throws PolicyError naming the first bad field. */
export function loadPolicyFile(text: string): PolicyFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new PolicyError('(file)', `not JSON: ${(e as Error).message}`);
  }
  const root = obj(json, '(file)');
  const version = int(root.version, 'version', 1);
  const workDayMinutes = int(root.work_day_minutes, 'work_day_minutes', 1);
  if (workDayMinutes !== WORK_DAY_MINUTES) throw new PolicyError('work_day_minutes', `must be ${WORK_DAY_MINUTES} (D-6), got ${workDayMinutes}`);

  const pp = obj(root.pay_period, 'pay_period');
  let anchorStart: CalendarDay;
  try {
    anchorStart = calendarDay(str(pp.anchor_start, 'pay_period.anchor_start'));
  } catch (e) {
    if (e instanceof PolicyError) throw e;
    throw new PolicyError('pay_period.anchor_start', (e as Error).message);
  }
  const lengthDays = int(pp.length_days, 'pay_period.length_days', 1);

  const rt = obj(root.routing_table, 'routing_table');
  const routingTable: RoutingTable = {
    steps: exactList(rt.steps, ROUTING_STEPS, 'routing_table.steps'),
    delegationMaxDepth: int(rt.delegation_max_depth, 'routing_table.delegation_max_depth', 1),
    fallbackOrder: exactList(rt.fallback_order, FALLBACK_ORDER, 'routing_table.fallback_order'),
  };
  if (routingTable.delegationMaxDepth !== DELEGATION_MAX_DEPTH) {
    throw new PolicyError('routing_table.delegation_max_depth', `must be ${DELEGATION_MAX_DEPTH} (R5: one hop), got ${routingTable.delegationMaxDepth}`);
  }

  if (!Array.isArray(root.policies) || root.policies.length === 0) throw new PolicyError('policies', 'expected a non-empty list');
  const policies = new Map<string, Policy>();
  root.policies.forEach((pj, i) => {
    const p = parsePolicy(pj, `policies[${i}]`);
    if (policies.has(p.id)) throw new PolicyError(`policies[${i}].id`, `duplicate policy id ${p.id}`);
    policies.set(p.id, p);
  });

  return { version, workDayMinutes, payPeriod: { anchorStart, lengthDays }, routingTable, policies };
}
