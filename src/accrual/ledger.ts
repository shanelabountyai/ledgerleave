/**
 * The append-only ledger of minutes (D-8, brief §5 L1–L5). A balance is never stored: `balance(asOf)` sums the
 * entries effective on or before the date whenever they were posted (L1); `available` sums every posted entry
 * including future-dated approved usage (L2). Entries are only ever appended; `seq` and `entry_id` are assigned
 * at posting and never reused.
 *
 * Lineage (D-32): LoanBook's append-only ledger with reversing entries that reference the original was not
 * readable from this session; written fresh from L1–L5 and D-8. `USAGE_REVERSAL` rows mirror each `USAGE` row
 * (same effective date, negated minutes, ref the same request) and are posted on the cancel date.
 */
import type { CalendarDay } from './calendar';
import { assertMinutes } from './minutes';

export const ENTRY_KINDS = ['ACCRUAL', 'USAGE', 'USAGE_REVERSAL', 'ADJUSTMENT', 'FORFEITURE', 'TRANSFER_OUT', 'TRANSFER_IN'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const LEDGER_CODES = {
  OPENING_BALANCE: 'OPENING_BALANCE',
  USAGE_APPROVED: 'USAGE_APPROVED',
  USAGE_REVERSED_CANCELLED: 'USAGE_REVERSED_CANCELLED',
  CARRYOVER_FORFEITURE: 'CARRYOVER_FORFEITURE',
  CARRYOVER_RECOMPUTED: 'CARRYOVER_RECOMPUTED',
  POLICY_TRANSFER_OUT: 'POLICY_TRANSFER_OUT',
  POLICY_TRANSFER_IN: 'POLICY_TRANSFER_IN',
} as const;

/** L3. `codes` is the `+`-joined reason list exactly as the CSV carries it. */
export interface Entry {
  readonly entryId: string; // "L-" + 6-digit seq
  readonly employeeId: string;
  readonly leaveType: string;
  readonly policyId: string;
  readonly kind: EntryKind;
  readonly effective: CalendarDay; // the day it counts on
  readonly posted: CalendarDay; // the day it was written
  readonly minutes: number; // signed
  readonly cappedMinutes: number;
  readonly codes: string;
  readonly ref: string; // request id, period end, boundary date, other policy id, ""
  readonly seq: number;
}

export type EntryDraft = Omit<Entry, 'entryId' | 'seq'>;

export const entryKey = (employeeId: string, leaveType: string): string => `${employeeId}|${leaveType}`;

export class Ledger {
  private readonly all: Entry[] = [];
  private readonly byKey = new Map<string, Entry[]>();

  get entries(): readonly Entry[] {
    return this.all;
  }

  /** Append one entry; assigns seq and entry_id. Nothing is ever updated or removed. */
  post(draft: EntryDraft): Entry {
    assertMinutes(draft.minutes, 'minutes');
    assertMinutes(draft.cappedMinutes, 'cappedMinutes');
    const seq = this.all.length + 1;
    const e: Entry = { ...draft, seq, entryId: `L-${String(seq).padStart(6, '0')}` };
    this.all.push(e);
    const k = entryKey(e.employeeId, e.leaveType);
    const list = this.byKey.get(k);
    if (list) list.push(e);
    else this.byKey.set(k, [e]);
    return e;
  }

  rows(employeeId: string, leaveType: string): readonly Entry[] {
    return this.byKey.get(entryKey(employeeId, leaveType)) ?? [];
  }

  /** L1: Σ minutes of entries effective ≤ asOf, whenever posted. */
  balance(employeeId: string, leaveType: string, asOf: CalendarDay): number {
    let s = 0;
    for (const e of this.rows(employeeId, leaveType)) if (e.effective <= asOf) s += e.minutes;
    return s;
  }

  /** L2: Σ every posted entry, including approved future-dated usage — what the submit check uses (A8). */
  available(employeeId: string, leaveType: string): number {
    let s = 0;
    for (const e of this.rows(employeeId, leaveType)) s += e.minutes;
    return s;
  }

  /** Minutes forfeited at boundary b (positive number), across CARRYOVER_FORFEITURE and CARRYOVER_RECOMPUTED rows. */
  forfeitedAt(employeeId: string, leaveType: string, b: CalendarDay): number {
    let s = 0;
    for (const e of this.rows(employeeId, leaveType)) if (e.kind === 'FORFEITURE' && e.effective === b) s -= e.minutes;
    return s;
  }

  /** The USAGE rows an approval wrote for one request — what a cancellation mirrors (S4). */
  usageRowsFor(employeeId: string, leaveType: string, requestId: string): readonly Entry[] {
    return this.rows(employeeId, leaveType).filter((e) => e.kind === 'USAGE' && e.ref === requestId);
  }
}
