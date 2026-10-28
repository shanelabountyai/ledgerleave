/**
 * Year boundaries and carryover (A6–A7, D-9, D-10). A boundary is the last day of a policy year; at the END of that
 * day — after the day's accruals and request events (D-9) — the part of the balance above the carryover cap is
 * removed as a FORFEITURE row. A later entry whose effective date lies in a closed year (a cancellation's
 * reversal, a late sick approval) re-derives every forfeiture from that boundary on and posts the delta as one
 * CARRYOVER_RECOMPUTED row per boundary (A7). Accruals are never recomputed (D-10).
 */
import { type CalendarDay, addDays, addMonthsClamped, fromParts, maxDay, minDay, yearOf } from './calendar';
import { type Entry, LEDGER_CODES, type Ledger } from './ledger';
import type { Policy } from './policy';

/**
 * D-9: posting order within one day. Class 0 opening adjustments, transfers, accruals; class 1 request events by
 * (request id, seq); class 2 year boundaries. GA-06 and GA-14 move if these move.
 */
export const POSTING_ORDER = Object.freeze({
  OPEN_TRANSFER_ACCRUAL: 0,
  REQUEST_EVENTS: 1,
  YEAR_BOUNDARIES: 2,
} as const);
export type PostingClass = (typeof POSTING_ORDER)[keyof typeof POSTING_ORDER];

/** Inside class 0: opening adjustments first, then transfers, then accruals (leavelib `_k0`). */
export const CLASS0_ORDER = Object.freeze({ OPEN: 0, TRANSFER: 1, ACCRUAL: 2 } as const);

export interface BoundaryInput {
  readonly policy: Policy;
  readonly hire: CalendarDay;
  readonly assignStart: CalendarDay;
  readonly assignEnd: CalendarDay | null;
  readonly lo: CalendarDay;
  readonly hi: CalendarDay;
}

/** A6: the last day of each policy year inside the assignment and [lo, hi]. */
export function yearBoundaries(input: BoundaryInput): CalendarDay[] {
  const { policy, hire, assignStart, assignEnd, lo, hi } = input;
  const start = maxDay(lo, assignStart);
  const end = assignEnd === null ? hi : minDay(hi, assignEnd);
  const out: CalendarDay[] = [];
  switch (policy.yearType) {
    case 'CALENDAR': {
      for (let y = yearOf(start); y <= yearOf(end); y++) {
        const b = fromParts(y, 12, 31);
        if (start <= b && b <= end) out.push(b);
      }
      break;
    }
    case 'POLICY_YEAR': {
      const mm = Number(policy.yearStarts.slice(0, 2));
      const dd = Number(policy.yearStarts.slice(3, 5));
      for (let y = yearOf(start); y <= yearOf(end) + 1; y++) {
        const b = addDays(fromParts(y, mm, dd), -1); // the day before the year starts
        if (start <= b && b <= end) out.push(b);
      }
      break;
    }
    case 'ANNIVERSARY': {
      for (let n = 1; ; n++) {
        const b = addMonthsClamped(hire, 12 * n);
        if (b > end) break;
        if (b >= start) out.push(b);
      }
      break;
    }
    default: {
      const never: never = policy.yearType;
      throw new Error(`unknown year type ${String(never)}`);
    }
  }
  return out;
}

/** A6: what a boundary removes: max(0, balance at end of the boundary day − carryover cap). */
export function forfeitureAt(balanceAtEndOfDay: number, carryoverCapMinutes: number): number {
  return Math.max(0, balanceAtEndOfDay - carryoverCapMinutes);
}

/**
 * A7, applied after a BATCH of posted non-forfeiture entries (one approval's usage rows, one cancellation's
 * reversals, or a single other entry). If the earliest effective date of the batch is on or before the latest
 * boundary already processed for this employee/leave type, every processed boundary B ≥ that date is re-derived
 * in order: target = max(0, S(B) − cap) with S(B) = Σ entries effective ≤ B excluding forfeitures effective exactly
 * on B; the non-zero delta is posted as CARRYOVER_RECOMPUTED effective B, posted on the trigger's posting date,
 * ref the trigger's ref. Returns the rows posted. One recompute per batch, never per row (review log, GA-10).
 */
export function recomputeAfter(
  ledger: Ledger,
  posted: readonly Entry[],
  processedBoundaries: readonly CalendarDay[],
  policyOn: (boundary: CalendarDay) => Policy,
): Entry[] {
  if (posted.length === 0 || processedBoundaries.length === 0) return [];
  let trigger = posted[0]!;
  for (const e of posted) if (e.effective < trigger.effective) trigger = e; // Python min(): first minimal element wins
  if (trigger.kind === 'FORFEITURE') return [];
  const last = processedBoundaries[processedBoundaries.length - 1]!;
  if (trigger.effective > last) return [];

  const out: Entry[] = [];
  for (const b of processedBoundaries) {
    if (b < trigger.effective) continue;
    const pol = policyOn(b);
    let s = 0;
    for (const x of ledger.rows(trigger.employeeId, trigger.leaveType)) {
      if (x.effective <= b && !(x.kind === 'FORFEITURE' && x.effective === b)) s += x.minutes;
    }
    const target = forfeitureAt(s, pol.carryoverCapMinutes);
    const delta = target - ledger.forfeitedAt(trigger.employeeId, trigger.leaveType, b);
    if (delta !== 0) {
      out.push(
        ledger.post({
          employeeId: trigger.employeeId,
          leaveType: trigger.leaveType,
          policyId: pol.id,
          kind: 'FORFEITURE',
          effective: b,
          posted: trigger.posted,
          minutes: -delta,
          cappedMinutes: 0,
          codes: LEDGER_CODES.CARRYOVER_RECOMPUTED,
          ref: trigger.ref,
        }),
      );
    }
  }
  return out;
}
