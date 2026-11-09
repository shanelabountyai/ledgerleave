import { moduleExportTables } from '@/app/modules';
import type { ExportTable } from '@/core/tenancy/export';

// Clone-owned (v1.6.0), like org-hooks.ts: which tables a data export holds beyond the template's core ones
// (addendum §5). Add one entry per org-owned table, selecting only columns that are safe to hand over: never a
// sealed column, token hash or recovery code (INV-34 scans the output). Every query runs inside withOrg.
//   { name: 'Booking', rows: (tx, orgId) => tx.booking.findMany({ where: { orgId }, select: { id: true, startsAt: true } }) },
//
// Ledgerleave (D-64): every leave table, whole rows. None holds a secret, token or credential; the one hash,
// PolicySet.contentHash, is a sha256 of the policy JSON (recomputable from `content`) and is omitted because INV-34
// treats any 64-hex string as a token hash.
export const exportTables: readonly ExportTable[] = [
  ...moduleExportTables,
  { name: 'LeaveSettings', rows: (tx, orgId) => tx.leaveSettings.findMany({ where: { orgId } }) },
  { name: 'OrgArchive', rows: (tx, orgId) => tx.orgArchive.findMany({ where: { orgId } }) },
  { name: 'PolicySet', rows: (tx, orgId) => tx.policySet.findMany({ where: { orgId }, omit: { contentHash: true } }) },
  { name: 'Employee', rows: (tx, orgId) => tx.employee.findMany({ where: { orgId } }) },
  { name: 'OrgChange', rows: (tx, orgId) => tx.orgChange.findMany({ where: { orgId } }) },
  { name: 'PolicyAssignment', rows: (tx, orgId) => tx.policyAssignment.findMany({ where: { orgId } }) },
  { name: 'Holiday', rows: (tx, orgId) => tx.holiday.findMany({ where: { orgId } }) },
  { name: 'Timesheet', rows: (tx, orgId) => tx.timesheet.findMany({ where: { orgId } }) },
  { name: 'Delegation', rows: (tx, orgId) => tx.delegation.findMany({ where: { orgId } }) },
  { name: 'OpeningBalance', rows: (tx, orgId) => tx.openingBalance.findMany({ where: { orgId } }) },
  { name: 'LeaveRequest', rows: (tx, orgId) => tx.leaveRequest.findMany({ where: { orgId } }) },
  { name: 'RequestCommand', rows: (tx, orgId) => tx.requestCommand.findMany({ where: { orgId } }) },
  { name: 'FrozenChain', rows: (tx, orgId) => tx.frozenChain.findMany({ where: { orgId } }) },
  { name: 'RequestStep', rows: (tx, orgId) => tx.requestStep.findMany({ where: { orgId } }) },
  { name: 'RequestEvent', rows: (tx, orgId) => tx.requestEvent.findMany({ where: { orgId } }) },
  { name: 'LedgerEntry', rows: (tx, orgId) => tx.ledgerEntry.findMany({ where: { orgId }, orderBy: { seq: 'asc' } }) },
];

// An org-owned table left out on purpose, with the reason. INV-34 fails on any model with an orgId column that is in
// neither list, so a new table cannot silently drop out of every export.
export const exportSkipped: Readonly<Record<string, string>> = {};
