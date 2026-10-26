/**
 * The simulation: everything in posting order (D-9, brief §5 L5). Builds a day plan from the window, the
 * assignments, the opening balances, the request events and the policy years, then walks the days in order and,
 * inside each day, class 0 (opening adjustments → transfers → accruals), class 1 (request events by request id and
 * seq), class 2 (year boundaries). Retroactive batches recompute forfeiture (A7). Nothing here reads a clock or a
 * file: `World` is handed in, the `Ledger` and the request states come out.
 *
 * This is the one module that imports both engines. It mirrors tools/leavelib.py `Simulation` step for step;
 * where this file and that one disagree, `leave:eval` reports a diff and the oracle wins (D-24).
 */
import { CLASS0_ORDER, POSTING_ORDER, forfeitureAt, recomputeAfter, yearBoundaries } from './boundaries';
import { type CalendarDay, addDays, calendarDay, workingDays as workingDaysOf } from './calendar';
import { accrualDates, applyMaxBalanceCap, grossAccrual } from './events';
import { type Entry, LEDGER_CODES, Ledger } from './ledger';
import type { Policy, PolicyFile } from './policy';
import { type Delegation, type Org, cmpStr } from '@/routing/org';
import { type Effects, type Request, type RequestEvent, type RequestState, applyEvent, newRequestState } from '@/routing/requests';

export interface Assignment {
  readonly employeeId: string;
  readonly leaveType: string;
  readonly policyId: string;
  readonly start: CalendarDay;
  readonly end: CalendarDay | null;
}

export interface OpeningBalance {
  readonly employeeId: string;
  readonly leaveType: string;
  readonly minutes: number;
}

export interface World {
  readonly policyFile: PolicyFile;
  readonly org: Org;
  readonly assignments: readonly Assignment[];
  readonly holidays: ReadonlySet<string>;
  /** `${employeeId}|${periodEnd}` → minutes worked. */
  readonly timesheets: ReadonlyMap<string, number>;
  readonly delegations: readonly Delegation[];
  readonly requests: readonly Request[];
  readonly events: readonly RequestEvent[];
  readonly opening: readonly OpeningBalance[];
  readonly ledgerStart: CalendarDay;
  readonly asOf: CalendarDay;
}

export const timesheetKey = (employeeId: string, periodEnd: string): string => `${employeeId}|${periodEnd}`;

type Class0Item =
  | { readonly kind: 'OPEN'; readonly employeeId: string; readonly leaveType: string; readonly minutes: number }
  | { readonly kind: 'TRANSFER'; readonly from: Assignment; readonly to: Assignment }
  | { readonly kind: 'ACCRUAL'; readonly assignment: Assignment; readonly date: CalendarDay };

interface DayPlan {
  class0: Class0Item[];
  events: RequestEvent[];
  boundaries: { assignment: Assignment; boundary: CalendarDay }[];
}

export interface SimulationResult {
  readonly ledger: Ledger;
  readonly requests: ReadonlyMap<string, RequestState>;
  readonly voided: number;
  readonly ignored: number;
  readonly recomputed: number;
}

export class Simulation {
  readonly ledger = new Ledger();
  readonly requests = new Map<string, RequestState>();
  voided = 0;
  ignored = 0;
  recomputed = 0;
  /** Boundaries already processed per employee|leave type, in order (A7 looks back at these). */
  private readonly processedBoundaries = new Map<string, CalendarDay[]>();

  constructor(readonly world: World) {}

  // ------------------------------------------------------------------------------------------------- helpers

  policy(id: string): Policy {
    const p = this.world.policyFile.policies.get(id);
    if (!p) throw new Error(`unknown policy ${JSON.stringify(id)}`);
    return p;
  }

  /** The first assignment (in fixture order) active on d for this employee and leave type. */
  assignmentOn(employeeId: string, leaveType: string, d: string): Assignment | null {
    for (const a of this.world.assignments) {
      if (a.employeeId === employeeId && a.leaveType === leaveType && a.start <= d && (a.end === null || d <= a.end)) return a;
    }
    return null;
  }

  private policyOnBoundary(employeeId: string, leaveType: string): (b: CalendarDay) => Policy {
    return (b) => {
      const a = this.assignmentOn(employeeId, leaveType, b);
      if (!a) throw new Error(`no assignment for ${employeeId} ${leaveType} on boundary ${b}`);
      return this.policy(a.policyId);
    };
  }

  private recompute(posted: readonly Entry[]): void {
    const first = posted[0];
    if (!first) return;
    const key = `${first.employeeId}|${first.leaveType}`;
    const rows = recomputeAfter(this.ledger, posted, this.processedBoundaries.get(key) ?? [], this.policyOnBoundary(first.employeeId, first.leaveType));
    this.recomputed += rows.length;
  }

  /** Post one entry and run the A7 check on it alone (the oracle's `_post(recompute=True)`). */
  private postOne(draft: Parameters<Ledger['post']>[0]): Entry {
    const e = this.ledger.post(draft);
    this.recompute([e]);
    return e;
  }

  // ------------------------------------------------------------------------------------------------- the day plan

  run(): SimulationResult {
    const w = this.world;
    const lo = w.ledgerStart;
    const hi = w.asOf;
    const anchor = w.policyFile.payPeriod.anchorStart;
    const lengthDays = w.policyFile.payPeriod.lengthDays;
    const days = new Map<string, DayPlan>();
    const plan = (d: string): DayPlan => {
      let p = days.get(d);
      if (!p) {
        p = { class0: [], events: [], boundaries: [] };
        days.set(d, p);
      }
      return p;
    };

    // opening balances, effective the day before the ledger starts (D-11)
    const openDay = addDays(lo, -1);
    const opening = [...w.opening].sort((a, b) => cmpStr(a.employeeId, b.employeeId) || cmpStr(a.leaveType, b.leaveType) || a.minutes - b.minutes);
    for (const o of opening) plan(openDay).class0.push({ kind: 'OPEN', employeeId: o.employeeId, leaveType: o.leaveType, minutes: o.minutes });

    const sortedAssignments = [...w.assignments].sort((a, b) => cmpStr(a.employeeId, b.employeeId) || cmpStr(a.leaveType, b.leaveType) || cmpStr(a.start, b.start));
    for (const a of sortedAssignments) {
      const pol = this.policy(a.policyId);
      const emp = w.org.get(a.employeeId);
      const hire = calendarDay(emp.hireDate);
      const timesheetEnds = new Set<string>();
      for (const k of w.timesheets.keys()) {
        const [eid, pe] = k.split('|');
        if (eid === a.employeeId && pe) timesheetEnds.add(pe);
      }
      for (const d of accrualDates({ policy: pol, hire, assignStart: a.start, assignEnd: a.end, lo, hi, anchor, lengthDays, timesheetEnds })) {
        plan(d).class0.push({ kind: 'ACCRUAL', assignment: a, date: d });
      }
      for (const b of yearBoundaries({ policy: pol, hire, assignStart: a.start, assignEnd: a.end, lo, hi })) {
        plan(b).boundaries.push({ assignment: a, boundary: b });
      }
      // transfer (D-14): this assignment starts the day after another one of the same leave type ends
      const prev = w.assignments.find((p) => p.employeeId === a.employeeId && p.leaveType === a.leaveType && p.end !== null && addDays(p.end, 1) === a.start);
      if (prev && lo <= a.start && a.start <= hi) plan(a.start).class0.push({ kind: 'TRANSFER', from: prev, to: a });
    }

    for (const r of w.requests) this.requests.set(r.id, newRequestState(r));
    for (const ev of w.events) if (ev.on <= w.asOf) plan(ev.on).events.push(ev);

    const ctx = this.requestContext();
    const dayKeys = [...days.keys()].sort(cmpStr);
    for (const d of dayKeys) {
      const p = days.get(d)!;
      // class 0 — opening adjustments, transfers, accruals (leavelib `_k0`); the sort is stable like Python's
      const class0 = [...p.class0].sort(compareClass0);
      for (const item of class0) this.doClass0(item, d as CalendarDay);
      // class 1 — request events by (request id, seq)
      const events = [...p.events].sort((x, y) => cmpStr(x.requestId, y.requestId) || x.seq - y.seq);
      for (const ev of events) this.doEvent(ev, ctx);
      // class 2 — boundaries by (employee, leave type)
      const boundaries = [...p.boundaries].sort((x, y) => cmpStr(x.assignment.employeeId, y.assignment.employeeId) || cmpStr(x.assignment.leaveType, y.assignment.leaveType));
      for (const b of boundaries) this.doBoundary(b.assignment, b.boundary);
    }
    return { ledger: this.ledger, requests: this.requests, voided: this.voided, ignored: this.ignored, recomputed: this.recomputed };
  }

  // ------------------------------------------------------------------------------------------------- class 0

  private doClass0(item: Class0Item, d: CalendarDay): void {
    const w = this.world;
    if (item.kind === 'OPEN') {
      const a = this.assignmentOn(item.employeeId, item.leaveType, w.ledgerStart);
      this.postOne({
        employeeId: item.employeeId, leaveType: item.leaveType, policyId: a ? a.policyId : '', kind: 'ADJUSTMENT',
        effective: d, posted: d, minutes: item.minutes, cappedMinutes: 0, codes: LEDGER_CODES.OPENING_BALANCE, ref: '',
      });
      return;
    }
    if (item.kind === 'TRANSFER') {
      const { from, to } = item;
      const bal = this.ledger.balance(from.employeeId, from.leaveType, d);
      this.postOne({
        employeeId: from.employeeId, leaveType: from.leaveType, policyId: from.policyId, kind: 'TRANSFER_OUT',
        effective: d, posted: d, minutes: -bal, cappedMinutes: 0, codes: LEDGER_CODES.POLICY_TRANSFER_OUT, ref: to.policyId,
      });
      this.postOne({
        employeeId: to.employeeId, leaveType: to.leaveType, policyId: to.policyId, kind: 'TRANSFER_IN',
        effective: d, posted: d, minutes: bal, cappedMinutes: 0, codes: LEDGER_CODES.POLICY_TRANSFER_IN, ref: from.policyId,
      });
      return;
    }
    const a = item.assignment;
    const pol = this.policy(a.policyId);
    const emp = w.org.get(a.employeeId);
    const worked = w.timesheets.get(timesheetKey(a.employeeId, item.date)) ?? 0;
    const gross = grossAccrual({ policy: pol, hire: calendarDay(emp.hireDate), assignStart: a.start, assignEnd: a.end, date: item.date, workedMinutes: worked });
    const bal = this.ledger.balance(a.employeeId, a.leaveType, item.date);
    const cap = applyMaxBalanceCap(gross.minutes, pol.maxBalanceMinutes, bal);
    this.postOne({
      employeeId: a.employeeId, leaveType: a.leaveType, policyId: a.policyId, kind: 'ACCRUAL',
      effective: item.date, posted: item.date, minutes: cap.posted, cappedMinutes: cap.capped,
      codes: [...gross.codes, ...cap.codes].join('+'),
      ref: pol.frequency === 'PER_HOURS_WORKED' ? `${item.date}:${worked}` : item.date,
    });
  }

  // ------------------------------------------------------------------------------------------------- class 2

  private doBoundary(a: Assignment, b: CalendarDay): void {
    const pol = this.policy(a.policyId);
    const forfeit = forfeitureAt(this.ledger.balance(a.employeeId, a.leaveType, b), pol.carryoverCapMinutes);
    if (forfeit > 0) {
      this.ledger.post({
        employeeId: a.employeeId, leaveType: a.leaveType, policyId: a.policyId, kind: 'FORFEITURE',
        effective: b, posted: b, minutes: -forfeit, cappedMinutes: 0, codes: LEDGER_CODES.CARRYOVER_FORFEITURE, ref: b,
      });
    }
    const key = `${a.employeeId}|${a.leaveType}`;
    const list = this.processedBoundaries.get(key);
    if (list) list.push(b);
    else this.processedBoundaries.set(key, [b]);
  }

  // ------------------------------------------------------------------------------------------------- class 1

  requestContext() {
    const w = this.world;
    return {
      org: w.org,
      delegations: w.delegations,
      workDayMinutes: w.policyFile.workDayMinutes,
      policyFor: (id: string) => this.policy(id),
      assignmentPolicyOn: (eid: string, lt: string, day: string) => this.assignmentOn(eid, lt, day)?.policyId ?? null,
      workingDays: (start: string, end: string) => workingDaysOf(calendarDay(start), calendarDay(end), w.holidays) as string[],
      available: (eid: string, lt: string) => this.ledger.available(eid, lt),
      usageRowsFor: (eid: string, lt: string, rid: string) => this.ledger.usageRowsFor(eid, lt, rid),
    };
  }

  private doEvent(ev: RequestEvent, ctx: ReturnType<Simulation['requestContext']>): void {
    const rs = this.requests.get(ev.requestId);
    if (!rs) throw new Error(`event for unknown request ${ev.requestId}`);
    const fx: Effects = applyEvent(rs, ev, ctx);
    this.applyEffects(rs, fx);
  }

  private applyEffects(rs: RequestState, fx: Effects): void {
    const r = rs.req;
    if (fx.kind === 'none') {
      if (fx.voided) this.voided += 1;
      if (fx.ignored) this.ignored += 1;
      return;
    }
    const posted: Entry[] = [];
    if (fx.kind === 'usage') {
      for (const day of fx.days) {
        posted.push(
          this.ledger.post({
            employeeId: r.employeeId, leaveType: r.leaveType, policyId: fx.policyId, kind: 'USAGE',
            effective: calendarDay(day), posted: calendarDay(fx.postedOn), minutes: -fx.minutesPerDay, cappedMinutes: 0,
            codes: LEDGER_CODES.USAGE_APPROVED, ref: r.id,
          }),
        );
      }
    } else {
      for (const u of fx.rows) {
        posted.push(
          this.ledger.post({
            employeeId: r.employeeId, leaveType: r.leaveType, policyId: u.policyId, kind: 'USAGE_REVERSAL',
            effective: calendarDay(u.effective), posted: calendarDay(fx.postedOn), minutes: -u.minutes, cappedMinutes: 0,
            codes: LEDGER_CODES.USAGE_REVERSED_CANCELLED, ref: r.id,
          }),
        );
      }
    }
    this.recompute(posted); // A7: one recompute per approval or cancellation, not one per day
  }
}

/** leavelib `_k0` as a tuple: (class rank, employee, leave type[, policy]) compared element by element like Python. */
function class0Key(item: Class0Item): [number, string, string, string] {
  switch (item.kind) {
    case 'OPEN':
      return [CLASS0_ORDER.OPEN, item.employeeId, item.leaveType, ''];
    case 'TRANSFER':
      return [CLASS0_ORDER.TRANSFER, item.to.employeeId, item.to.leaveType, ''];
    case 'ACCRUAL':
      return [CLASS0_ORDER.ACCRUAL, item.assignment.employeeId, item.assignment.leaveType, item.assignment.policyId];
  }
}

function compareClass0(x: Class0Item, y: Class0Item): number {
  const a = class0Key(x);
  const b = class0Key(y);
  return a[0] - b[0] || cmpStr(a[1], b[1]) || cmpStr(a[2], b[2]) || cmpStr(a[3], b[3]);
}

/** D-9 as data, for anyone who wants to assert the order without reading this file. */
export const DAY_CLASSES = [POSTING_ORDER.OPEN_TRANSFER_ACCRUAL, POSTING_ORDER.REQUEST_EVENTS, POSTING_ORDER.YEAR_BOUNDARIES] as const;

// ----------------------------------------------------------------------------------------------------- reporting

export interface EmployeeYearRow {
  readonly employeeId: string;
  readonly year: number;
  readonly leaveType: string;
  readonly opening: number;
  readonly accrued: number;
  readonly capped: number;
  readonly used: number;
  readonly forfeited: number;
  readonly balanceEnd: number;
}

/**
 * Per employee, year, leave type: opening (everything effective before the year), accrued, capped, used (net of
 * reversals), forfeited, balance at year end (L1). Transfers net to zero inside a leave type and are not shown.
 * Mirrors leavelib `employee_year_rows`; `ledger:verify` recomputes the same table from ledger.csv alone.
 */
export function employeeYearRows(entries: readonly Entry[], employeeIds: readonly string[], years: readonly number[]): EmployeeYearRow[] {
  const byKey = new Map<string, Entry[]>();
  for (const e of entries) {
    const k = `${e.employeeId}|${e.leaveType}`;
    const list = byKey.get(k);
    if (list) list.push(e);
    else byKey.set(k, [e]);
  }
  const rows: EmployeeYearRow[] = [];
  for (const eid of [...employeeIds].sort(cmpStr)) {
    for (const lt of ['PTO', 'SICK']) {
      const ents = byKey.get(`${eid}|${lt}`);
      if (!ents || ents.length === 0) continue;
      for (const y of years) {
        const ys = `${y}-01-01`;
        const ye = `${y}-12-31`;
        const inYear = ents.filter((x) => ys <= x.effective && x.effective <= ye);
        if (inYear.length === 0 && !ents.some((x) => x.effective < ys)) continue;
        let opening = 0;
        let accrued = 0;
        let capped = 0;
        let used = 0;
        let forfeited = 0;
        let balanceEnd = 0;
        for (const x of ents) {
          if (x.effective < ys) opening += x.minutes;
          if (x.effective <= ye) balanceEnd += x.minutes;
        }
        for (const x of inYear) {
          if (x.kind === 'ACCRUAL') {
            accrued += x.minutes;
            capped += x.cappedMinutes;
          } else if (x.kind === 'USAGE' || x.kind === 'USAGE_REVERSAL') used -= x.minutes;
          else if (x.kind === 'FORFEITURE') forfeited -= x.minutes;
        }
        rows.push({ employeeId: eid, year: y, leaveType: lt, opening, accrued, capped, used, forfeited, balanceEnd });
      }
    }
  }
  return rows;
}
