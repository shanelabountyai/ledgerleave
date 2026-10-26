-- D-47 (owner decision 2026-10-26): an org with append-only history is archived, never deleted. Archiving is one
-- row, written once: UPDATE and DELETE are refused by the same append-only trigger function as the ledger, so a
-- cascaded org delete is refused here too. archivedBy is deliberately not a foreign key (a user delete must never
-- cascade into an append-only row).
CREATE TABLE "OrgArchive" (
    "orgId" UUID NOT NULL,
    "archivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedBy" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    CONSTRAINT "OrgArchive_pkey" PRIMARY KEY ("orgId")
);
ALTER TABLE "OrgArchive" ADD CONSTRAINT "OrgArchive_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrgArchive" ADD CONSTRAINT "OrgArchive_reason_check" CHECK (length(btrim("reason")) > 0);
CREATE TRIGGER "OrgArchive_append_only" BEFORE UPDATE OR DELETE ON "OrgArchive" FOR EACH ROW EXECUTE FUNCTION leave_append_only();
