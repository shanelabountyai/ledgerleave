-- Ledgerleave (D-46 dropped BillingAccount; stub copied from gavel). The template's v1.6.0 RLS policy migrations (20261105000000 to 20261108000002)
-- each ALTER "BillingAccount"; editing them would be foundation drift. An empty stand-in lets them apply, and
-- 20261108000003_billing_rls_stub_drop removes it again. IF NOT EXISTS so a database that still has the table is untouched.
CREATE TABLE IF NOT EXISTS "BillingAccount" ("orgId" UUID NOT NULL);
