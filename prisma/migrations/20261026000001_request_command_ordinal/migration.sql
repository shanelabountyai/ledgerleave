-- D-38: a command's position within its day for the org. The fixture import ranks a day's commands by
-- (request id, seq) — the oracle's order — and the live write path appends max+1, so the replay posts a day's
-- events in arrival order without ever re-ordering the ones already stored.
ALTER TABLE "RequestCommand" ADD COLUMN "ordinal" INTEGER NOT NULL;
ALTER TABLE "RequestCommand" ADD CONSTRAINT "RequestCommand_ordinal_check" CHECK ("ordinal" >= 1);
CREATE UNIQUE INDEX "RequestCommand_orgId_on_ordinal_key" ON "RequestCommand"("orgId", "on", "ordinal");
