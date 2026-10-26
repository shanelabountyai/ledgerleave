// D-23 outbox templates, registered into the foundation's notifications module at runtime (the Callboard pattern;
// src/modules/notifications/templates.ts is template-owned and not edited). Importing this module is the
// registration. Data is plain strings only: outbox rows are readable to anyone with database access.
import { templates } from '@/modules/notifications/templates';

export const LEAVE_TEMPLATES = ['APPROVAL_REQUESTED', 'APPROVED', 'DENIED'] as const;
export type LeaveTemplate = (typeof LEAVE_TEMPLATES)[number];

const s = (v: unknown) => String(v ?? '');

templates.APPROVAL_REQUESTED = (d) => ({
  subject: `Leave request ${s(d.requestId)} needs your approval (${s(d.stepId)})`,
  body: `${s(d.employeeId)} asks for ${s(d.leaveType)} ${s(d.start)}..${s(d.end)} (${s(d.workingDays)} working days). You are the ${s(d.stepId)} approver as of ${s(d.on)}.`,
});
templates.APPROVED = (d) => ({
  subject: `Leave request ${s(d.requestId)} approved`,
  body: `Your ${s(d.leaveType)} request ${s(d.start)}..${s(d.end)} was approved on ${s(d.on)}.`,
});
templates.DENIED = (d) => ({
  subject: `Leave request ${s(d.requestId)} denied`,
  body: `Your ${s(d.leaveType)} request ${s(d.start)}..${s(d.end)} was denied on ${s(d.on)}: ${s(d.code)}.`,
});
