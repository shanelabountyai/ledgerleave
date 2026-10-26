// D-23: which outbox rows one applied event owes. Pure: event + request state in → notifications out. The replay
// enqueues these only for RequestEvent rows it INSERTS, so a second replay queues nothing (task 2.6 idempotence).
//   APPROVAL_REQUESTED — to the approver of a kept step when it becomes current: after SUBMIT (step 1), after a
//                        non-final APPROVE (the next step), after REASSIGN (the step's new approver).
//   APPROVED / DENIED  — to the requester on the final state (a system denial at submit is a DENIED too).
//   CANCEL             — nothing (D-23 lists three templates; a cancel is the requester's own act or HR's).
import type { Effects, RequestEvent, RequestState } from '@/routing/requests';
import { keptSteps } from '@/routing/requests';
import type { LeaveTemplate } from './templates';

export interface Notification {
  readonly template: LeaveTemplate;
  readonly to: string; // employee id; the replay resolves the address
  readonly data: Record<string, string>;
}

export const eventOutcome = (fx: Effects): 'APPLIED' | 'VOID' | 'IGNORED' => (fx.kind === 'none' && fx.voided ? 'VOID' : fx.kind === 'none' && fx.ignored ? 'IGNORED' : 'APPLIED');

export function notificationsFor(ev: RequestEvent, rs: RequestState, fx: Effects): Notification[] {
  if (eventOutcome(fx) !== 'APPLIED') return [];
  const r = rs.req;
  const base = { requestId: r.id, employeeId: r.employeeId, leaveType: r.leaveType, start: r.start, end: r.end, workingDays: String(rs.workingDays), on: ev.on };
  const current = () => {
    const step = keptSteps(rs)[rs.step];
    if (!step) throw new Error(`request ${r.id} is PENDING with no step ${rs.step}`);
    return { template: 'APPROVAL_REQUESTED' as const, to: step.approver, data: { ...base, stepId: step.stepId, approver: step.approver } };
  };
  switch (ev.action) {
    case 'SUBMIT':
      if (rs.state === 'PENDING') return [current()];
      if (rs.state === 'DENIED') return [{ template: 'DENIED', to: r.employeeId, data: { ...base, code: rs.finalCode } }];
      return []; // UNROUTABLE: stays SUBMITTED, nobody to ask (brief §11: count 0 in the fixtures)
    case 'APPROVE':
      if (rs.state === 'PENDING') return [current()];
      return [{ template: 'APPROVED', to: r.employeeId, data: { ...base } }];
    case 'DENY':
      return [{ template: 'DENIED', to: r.employeeId, data: { ...base, code: rs.finalCode } }];
    case 'REASSIGN':
      return [current()];
    case 'CANCEL':
      return [];
  }
}
