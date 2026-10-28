/**
 * Accrual events A1–A5 (docs/domain-brief.md §5) as pure functions. Nothing here knows about a ledger: the caller
 * supplies the balance before the event and gets back what to post. Every number is integer minutes (D-6).
 *
 * The functions mirror tools/leavelib.py `accrual_minutes` and `accrual_dates` clause for clause; that file is the
 * spec made executable and the TypeScript must agree with it on every row (D-24).
 */
import {
  type CalendarDay,
  addDays,
  addMonthsClamped,
  completedMonths,
  daysBetween,
  daysInMonth,
  firstDayOfMonth,
  lastDayOfMonth,
  maxDay,
  minDay,
  monthOf,
  payPeriodEnds,
  yearOf,
} from './calendar';
import { assertMinutes, roundDiv } from './minutes';
import type { Policy } from './policy';

export const ACCRUAL_CODES = {
  MONTHLY: 'ACCRUAL_MONTHLY',
  PAY_PERIOD: 'ACCRUAL_PAY_PERIOD',
  HOURS_WORKED: 'ACCRUAL_HOURS_WORKED',
  ANNIVERSARY: 'ACCRUAL_ANNIVERSARY',
  PRORATED_DAILY: 'PRORATED_DAILY',
  MAX_BALANCE_CAP: 'MAX_BALANCE_CAP',
} as const;

export interface AccrualEventInput {
  readonly policy: Policy;
  /** The employee's REAL hire date: tenure for tiers counts from here, not from the assignment (D-11, D-14). */
  readonly hire: CalendarDay;
  readonly assignStart: CalendarDay;
  readonly assignEnd: CalendarDay | null;
  /** The event date (a month end, a period end, an anniversary). */
  readonly date: CalendarDay;
  /** PER_HOURS_WORKED: minutes worked in the period ending on `date`. */
  readonly workedMinutes?: number;
}

export interface GrossAccrual {
  readonly minutes: number;
  readonly codes: string[];
}

/** A2–A4: the gross accrual for the event dated `date`, before the max-balance cap. */
export function grossAccrual(input: AccrualEventInput): GrossAccrual {
  const { policy, hire, assignStart, assignEnd, date } = input;
  const codes: string[] = [];
  const tenure = completedMonths(hire, date);
  switch (policy.frequency) {
    case 'PER_HOURS_WORKED': {
      codes.push(ACCRUAL_CODES.HOURS_WORKED);
      const worked = assertMinutes(input.workedMinutes ?? 0, 'workedMinutes');
      return { minutes: roundDiv(worked * policy.minutesPer60Worked, 60, policy.rounding), codes };
    }
    case 'MONTHLY': {
      codes.push(ACCRUAL_CODES.MONTHLY);
      const rate = policy.rate(tenure);
      if (policy.proration === 'DAILY') {
        const lo = maxDay(firstDayOfMonth(date), assignStart);
        const hi = assignEnd === null ? date : minDay(date, assignEnd);
        const activeDays = daysBetween(lo, hi) + 1;
        const dim = daysInMonth(yearOf(date), monthOf(date));
        if (activeDays < dim) {
          codes.push(ACCRUAL_CODES.PRORATED_DAILY);
          return { minutes: roundDiv(rate * activeDays, dim, policy.rounding), codes };
        }
      }
      return { minutes: rate, codes };
    }
    case 'PER_PAY_PERIOD':
      codes.push(ACCRUAL_CODES.PAY_PERIOD);
      return { minutes: policy.rate(tenure), codes };
    case 'ANNIVERSARY':
      codes.push(ACCRUAL_CODES.ANNIVERSARY);
      return { minutes: policy.rate(tenure), codes };
    default: {
      const never: never = policy.frequency;
      throw new Error(`unknown frequency ${String(never)}`);
    }
  }
}

export interface CappedAccrual {
  readonly posted: number;
  readonly capped: number;
  readonly codes: string[];
}

/** A5: room = max(0, max − balance before); posted = min(gross, room); the shortfall is recorded, not lost. */
export function applyMaxBalanceCap(gross: number, maxBalanceMinutes: number, balanceBefore: number): CappedAccrual {
  assertMinutes(gross, 'gross');
  assertMinutes(maxBalanceMinutes, 'maxBalanceMinutes');
  assertMinutes(balanceBefore, 'balanceBefore');
  const room = Math.max(0, maxBalanceMinutes - balanceBefore);
  const posted = Math.min(gross, room);
  const capped = gross - posted;
  return { posted, capped, codes: capped > 0 ? [ACCRUAL_CODES.MAX_BALANCE_CAP] : [] };
}

export interface AccrualDatesInput {
  readonly policy: Policy;
  readonly hire: CalendarDay;
  readonly assignStart: CalendarDay;
  readonly assignEnd: CalendarDay | null;
  /** The ledger window. */
  readonly lo: CalendarDay;
  readonly hi: CalendarDay;
  readonly anchor: CalendarDay;
  readonly lengthDays: number;
  /** PER_HOURS_WORKED: the period ends this employee has a timesheet row for. */
  readonly timesheetEnds: ReadonlySet<string>;
}

/** A1: the dates on which this assignment posts an accrual inside [lo, hi], in order. */
export function accrualDates(input: AccrualDatesInput): CalendarDay[] {
  const { policy, hire, assignStart, assignEnd, lo, hi, anchor, lengthDays, timesheetEnds } = input;
  const start = maxDay(lo, assignStart);
  const end = assignEnd === null ? hi : minDay(hi, assignEnd);
  if (start > end) return [];
  const out: CalendarDay[] = [];
  switch (policy.frequency) {
    case 'MONTHLY': {
      // A3: one event on the last day of each month the assignment touches, the month it ends in included
      // (prorated by active days); the event date may fall after the assignment's end.
      let d = lastDayOfMonth(start);
      const last = minDay(hi, lastDayOfMonth(end));
      while (d <= last) {
        out.push(d);
        d = lastDayOfMonth(addDays(d, 1));
      }
      break;
    }
    case 'PER_PAY_PERIOD':
    case 'PER_HOURS_WORKED': {
      for (const e of payPeriodEnds(anchor, lengthDays, start, end)) {
        if (policy.frequency === 'PER_PAY_PERIOD' || timesheetEnds.has(e)) out.push(e); // A4: active on the period end
      }
      break;
    }
    case 'ANNIVERSARY': {
      for (let n = 1; ; n++) {
        const d = addMonthsClamped(hire, 12 * n);
        if (d > end) break;
        if (d >= start) out.push(d);
      }
      break;
    }
    default: {
      const never: never = policy.frequency;
      throw new Error(`unknown frequency ${String(never)}`);
    }
  }
  return out;
}
