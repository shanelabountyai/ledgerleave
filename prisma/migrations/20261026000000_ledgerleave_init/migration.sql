-- Ledgerleave Phase 2 tasks 2.1 + 2.2: the clone-owned tables (prisma/schema/ledgerleave.prisma) and the
-- hand-written parts Prisma cannot express — CHECK constraints that mirror the engines' closed vocabularies,
-- the append-only triggers (non-negotiable 2), and the ledger seq/entryId assignment in posting order.
-- Hand-written; never edited after it is applied (add a new migration instead).

-- ===================================================================================================== settings

CREATE TABLE "LeaveSettings" (
    "orgId" UUID NOT NULL,
    "ledgerStart" CHAR(10) NOT NULL,
    "fixtureSeed" INTEGER,
    "fixtureAsOf" CHAR(10),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveSettings_pkey" PRIMARY KEY ("orgId")
);

CREATE TABLE "PolicySet" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicySet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PolicySet_orgId_contentHash_key" ON "PolicySet"("orgId", "contentHash");
CREATE INDEX "PolicySet_orgId_createdAt_idx" ON "PolicySet"("orgId", "createdAt");

-- ======================================================================================================= inputs

CREATE TABLE "Employee" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dept" TEXT NOT NULL,
    "managerId" TEXT,
    "employmentType" TEXT NOT NULL,
    "roles" TEXT NOT NULL,
    "hireDate" CHAR(10) NOT NULL,
    "termDate" CHAR(10),
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Employee_orgId_employeeId_key" ON "Employee"("orgId", "employeeId");

CREATE TABLE "OrgChange" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "effective" CHAR(10) NOT NULL,
    "employeeId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT NOT NULL,
    "newValue" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgChange_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrgChange_orgId_effective_employeeId_field_key" ON "OrgChange"("orgId", "effective", "employeeId", "field");

CREATE TABLE "PolicyAssignment" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveType" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "start" CHAR(10) NOT NULL,
    "end" CHAR(10),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PolicyAssignment_orgId_employeeId_leaveType_start_key" ON "PolicyAssignment"("orgId", "employeeId", "leaveType", "start");

CREATE TABLE "Holiday" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "date" CHAR(10) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Holiday_orgId_date_key" ON "Holiday"("orgId", "date");

CREATE TABLE "Timesheet" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodEnd" CHAR(10) NOT NULL,
    "minutesWorked" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Timesheet_orgId_employeeId_periodEnd_key" ON "Timesheet"("orgId", "employeeId", "periodEnd");

CREATE TABLE "Delegation" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "approverId" TEXT NOT NULL,
    "delegateId" TEXT NOT NULL,
    "start" CHAR(10) NOT NULL,
    "end" CHAR(10) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Delegation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Delegation_orgId_approverId_delegateId_start_key" ON "Delegation"("orgId", "approverId", "delegateId", "start");

CREATE TABLE "OpeningBalance" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveType" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpeningBalance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OpeningBalance_orgId_employeeId_leaveType_key" ON "OpeningBalance"("orgId", "employeeId", "leaveType");

CREATE TABLE "LeaveRequest" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "requestId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveType" TEXT NOT NULL,
    "start" CHAR(10) NOT NULL,
    "end" CHAR(10) NOT NULL,
    "submittedOn" CHAR(10) NOT NULL,
    "trap" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LeaveRequest_orgId_requestId_key" ON "LeaveRequest"("orgId", "requestId");
CREATE INDEX "LeaveRequest_orgId_employeeId_idx" ON "LeaveRequest"("orgId", "employeeId");

CREATE TABLE "RequestCommand" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "requestId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "on" CHAR(10) NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestCommand_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RequestCommand_orgId_requestId_seq_key" ON "RequestCommand"("orgId", "requestId", "seq");

-- ====================================================================================================== derived

CREATE TABLE "FrozenChain" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "requestId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "workingDays" INTEGER NOT NULL,
    "minutes" INTEGER NOT NULL,
    "chain" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FrozenChain_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FrozenChain_orgId_requestId_key" ON "FrozenChain"("orgId", "requestId");

CREATE TABLE "RequestStep" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "requestId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "stepId" TEXT NOT NULL,
    "approver" TEXT NOT NULL,
    "codes" TEXT[],
    "kept" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestStep_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RequestStep_orgId_requestId_index_key" ON "RequestStep"("orgId", "requestId", "index");
CREATE INDEX "RequestStep_orgId_approver_idx" ON "RequestStep"("orgId", "approver");

CREATE TABLE "RequestEvent" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "requestId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "on" CHAR(10) NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "logLines" TEXT[],
    "stateAfter" TEXT NOT NULL,
    "stepAfter" INTEGER NOT NULL,
    "finalCodeAfter" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RequestEvent_orgId_requestId_seq_key" ON "RequestEvent"("orgId", "requestId", "seq");

CREATE TABLE "LedgerEntry" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "entryId" TEXT NOT NULL DEFAULT '',
    "employeeId" TEXT NOT NULL,
    "leaveType" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "effective" CHAR(10) NOT NULL,
    "posted" CHAR(10) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "cappedMinutes" INTEGER NOT NULL,
    "codes" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LedgerEntry_orgId_seq_key" ON "LedgerEntry"("orgId", "seq");
CREATE UNIQUE INDEX "LedgerEntry_natural_key" ON "LedgerEntry"("orgId", "employeeId", "leaveType", "policyId", "kind", "effective", "posted", "minutes", "codes", "ref");
CREATE INDEX "LedgerEntry_orgId_employeeId_leaveType_effective_idx" ON "LedgerEntry"("orgId", "employeeId", "leaveType", "effective");

-- ================================================================================================= foreign keys

ALTER TABLE "LeaveSettings" ADD CONSTRAINT "LeaveSettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PolicySet" ADD CONSTRAINT "PolicySet_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrgChange" ADD CONSTRAINT "OrgChange_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PolicyAssignment" ADD CONSTRAINT "PolicyAssignment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Delegation" ADD CONSTRAINT "Delegation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequestCommand" ADD CONSTRAINT "RequestCommand_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequestCommand" ADD CONSTRAINT "RequestCommand_orgId_requestId_fkey" FOREIGN KEY ("orgId", "requestId") REFERENCES "LeaveRequest"("orgId", "requestId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FrozenChain" ADD CONSTRAINT "FrozenChain_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FrozenChain" ADD CONSTRAINT "FrozenChain_orgId_requestId_fkey" FOREIGN KEY ("orgId", "requestId") REFERENCES "LeaveRequest"("orgId", "requestId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RequestStep" ADD CONSTRAINT "RequestStep_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequestStep" ADD CONSTRAINT "RequestStep_orgId_requestId_fkey" FOREIGN KEY ("orgId", "requestId") REFERENCES "LeaveRequest"("orgId", "requestId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RequestEvent" ADD CONSTRAINT "RequestEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequestEvent" ADD CONSTRAINT "RequestEvent_orgId_requestId_fkey" FOREIGN KEY ("orgId", "requestId") REFERENCES "LeaveRequest"("orgId", "requestId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================= hand-written: closed vocabularies
-- Each list mirrors a TypeScript constant; tests/integration/leave/schema.test.ts reads these back from pg_constraint
-- and asserts set equality, so adding a kind, action or state is never one edit (Bookable's status-enum rule).

ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_kind_check"
  CHECK ("kind" IN ('ACCRUAL', 'USAGE', 'USAGE_REVERSAL', 'ADJUSTMENT', 'FORFEITURE', 'TRANSFER_OUT', 'TRANSFER_IN'));
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_effective_check" CHECK ("effective" ~ '^\d{4}-\d{2}-\d{2}$');
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_posted_check" CHECK ("posted" ~ '^\d{4}-\d{2}-\d{2}$');
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_cappedMinutes_check" CHECK ("cappedMinutes" >= 0);

ALTER TABLE "RequestCommand" ADD CONSTRAINT "RequestCommand_action_check"
  CHECK ("action" IN ('SUBMIT', 'APPROVE', 'DENY', 'CANCEL', 'REASSIGN'));
ALTER TABLE "RequestCommand" ADD CONSTRAINT "RequestCommand_on_check" CHECK ("on" ~ '^\d{4}-\d{2}-\d{2}$');
ALTER TABLE "RequestCommand" ADD CONSTRAINT "RequestCommand_seq_check" CHECK ("seq" >= 1);

ALTER TABLE "RequestEvent" ADD CONSTRAINT "RequestEvent_action_check"
  CHECK ("action" IN ('SUBMIT', 'APPROVE', 'DENY', 'CANCEL', 'REASSIGN'));
ALTER TABLE "RequestEvent" ADD CONSTRAINT "RequestEvent_outcome_check"
  CHECK ("outcome" IN ('APPLIED', 'VOID', 'IGNORED'));
ALTER TABLE "RequestEvent" ADD CONSTRAINT "RequestEvent_stateAfter_check"
  CHECK ("stateAfter" IN ('DRAFT', 'SUBMITTED', 'PENDING', 'APPROVED', 'DENIED', 'CANCELLED'));
ALTER TABLE "RequestEvent" ADD CONSTRAINT "RequestEvent_on_check" CHECK ("on" ~ '^\d{4}-\d{2}-\d{2}$');

ALTER TABLE "RequestStep" ADD CONSTRAINT "RequestStep_stepId_check"
  CHECK ("stepId" IN ('MANAGER', 'SKIP_LEVEL', 'HR', 'FALLBACK'));

ALTER TABLE "OrgChange" ADD CONSTRAINT "OrgChange_field_check"
  CHECK ("field" IN ('MANAGER', 'ROLE_GRANTED', 'ROLE_REVOKED'));

-- ============================================================================== hand-written: append-only triggers
-- Non-negotiable 2. BEFORE UPDATE OR DELETE raises; INSERT is untouched; TRUNCATE is a statement, not a row
-- operation, so row triggers do not fire on it and tests can still empty the tables (same shape as INV-19).

CREATE FUNCTION leave_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (ledgerleave non-negotiable 2): % refused', TG_TABLE_NAME, TG_OP;
END;
$$;

CREATE TRIGGER "LedgerEntry_append_only" BEFORE UPDATE OR DELETE ON "LedgerEntry" FOR EACH ROW EXECUTE FUNCTION leave_append_only();
CREATE TRIGGER "RequestCommand_append_only" BEFORE UPDATE OR DELETE ON "RequestCommand" FOR EACH ROW EXECUTE FUNCTION leave_append_only();
CREATE TRIGGER "RequestEvent_append_only" BEFORE UPDATE OR DELETE ON "RequestEvent" FOR EACH ROW EXECUTE FUNCTION leave_append_only();
CREATE TRIGGER "FrozenChain_append_only" BEFORE UPDATE OR DELETE ON "FrozenChain" FOR EACH ROW EXECUTE FUNCTION leave_append_only();
CREATE TRIGGER "RequestStep_append_only" BEFORE UPDATE OR DELETE ON "RequestStep" FOR EACH ROW EXECUTE FUNCTION leave_append_only();

-- ======================================================================= hand-written: ledger seq in posting order
-- L3: seq and entryId ("L-" + 6-digit seq) are assigned by the database per org, in insert order. A caller may
-- pass seq = 0 ("assign me") or the exact next value; anything else is refused, so a replay that writes out of
-- order fails loudly instead of renumbering. The (orgId, seq) unique index makes two concurrent inserts collide
-- rather than interleave; writers serialise on the org (src/leave-db/replay.ts takes the Org row lock).

CREATE FUNCTION ledger_entry_assign_seq() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  next_seq INTEGER;
BEGIN
  SELECT COALESCE(MAX("seq"), 0) + 1 INTO next_seq FROM "LedgerEntry" WHERE "orgId" = NEW."orgId";
  IF NEW."seq" <> 0 AND NEW."seq" <> next_seq THEN
    RAISE EXCEPTION 'LedgerEntry seq % is not the next seq % for this org (posting order)', NEW."seq", next_seq;
  END IF;
  NEW."seq" := next_seq;
  NEW."entryId" := 'L-' || lpad(next_seq::text, 6, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER "LedgerEntry_assign_seq" BEFORE INSERT ON "LedgerEntry" FOR EACH ROW EXECUTE FUNCTION ledger_entry_assign_seq();
