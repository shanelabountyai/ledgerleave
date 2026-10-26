// Phase 2 task 2.7: the ledger as the DATABASE holds it, in the engine's Entry shape, so scripts/leave/verify.ts
// can recompute every employee-year row from LedgerEntry alone and diff it against expected_balances.csv — the
// same `verifyEntries` as the Phase 1 file form. Product code never reads expected_*.csv; the verify script does.
import { calendarDay } from '@/accrual/calendar';
import { ENTRY_KINDS, type Entry, type EntryKind } from '@/accrual/ledger';
import type { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';

export async function ledgerEntriesFromDb(client: PrismaClient | Prisma.TransactionClient, orgId: string): Promise<Entry[]> {
  const rows = await client.ledgerEntry.findMany({ where: { orgId }, orderBy: { seq: 'asc' } });
  return rows.map((r) => {
    if (!(ENTRY_KINDS as readonly string[]).includes(r.kind)) throw new Error(`LedgerEntry ${r.entryId}: unknown kind ${JSON.stringify(r.kind)}`);
    return {
      entryId: r.entryId, employeeId: r.employeeId, leaveType: r.leaveType, policyId: r.policyId, kind: r.kind as EntryKind,
      effective: calendarDay(r.effective), posted: calendarDay(r.posted), minutes: r.minutes, cappedMinutes: r.cappedMinutes, codes: r.codes, ref: r.ref, seq: r.seq,
    };
  });
}

/** expected_requests.csv's columns, rebuilt from LeaveRequest + FrozenChain + RequestEvent rows alone (no engine run). */
export interface DbRequestRow {
  readonly request_id: string;
  readonly employee_id: string;
  readonly leave_type: string;
  readonly policy_id: string;
  readonly start: string;
  readonly end: string;
  readonly submitted_on: string;
  readonly working_days: number;
  readonly minutes: number;
  readonly chain: string;
  readonly final_state: string;
  readonly final_code: string;
  readonly log: string;
}

export async function requestRowsFromDb(client: PrismaClient | Prisma.TransactionClient, orgId: string): Promise<DbRequestRow[]> {
  const requests = await client.leaveRequest.findMany({ where: { orgId }, orderBy: { requestId: 'asc' } });
  const chains = new Map((await client.frozenChain.findMany({ where: { orgId } })).map((c) => [c.requestId, c]));
  const events = await client.requestEvent.findMany({ where: { orgId }, orderBy: [{ requestId: 'asc' }, { seq: 'asc' }] });
  const byRequest = new Map<string, typeof events>();
  for (const e of events) {
    const list = byRequest.get(e.requestId);
    if (list) list.push(e);
    else byRequest.set(e.requestId, [e]);
  }
  return requests.map((r) => {
    const c = chains.get(r.requestId);
    const evs = byRequest.get(r.requestId) ?? [];
    const last = evs[evs.length - 1];
    const state = last ? (last.stateAfter === 'PENDING' ? `PENDING_${last.stepAfter + 1}` : last.stateAfter) : 'DRAFT';
    return {
      request_id: r.requestId, employee_id: r.employeeId, leave_type: r.leaveType, policy_id: c?.policyId ?? '', start: r.start, end: r.end, submitted_on: r.submittedOn,
      working_days: c?.workingDays ?? 0, minutes: c?.minutes ?? 0, chain: c?.chain ?? '', final_state: state, final_code: last?.finalCodeAfter ?? '',
      log: evs.flatMap((e) => e.logLines).join(';'),
    };
  });
}
