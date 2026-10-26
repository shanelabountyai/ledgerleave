-- D-42 (owner decision 2026-10-26, closes O-12): which signed-in User acts as which Employee is an explicit,
-- nullable link set by an audited HR action. At most one employee per user per org. Deleting the user clears the
-- link (Employee is an input table, not append-only, so SET NULL is safe here).
ALTER TABLE "Employee" ADD COLUMN "userId" UUID;
CREATE UNIQUE INDEX "Employee_orgId_userId_key" ON "Employee"("orgId", "userId");
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
