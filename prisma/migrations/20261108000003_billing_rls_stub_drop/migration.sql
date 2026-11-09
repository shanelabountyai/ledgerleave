-- Ledgerleave (from gavel): drops the stand-in from 20261104235959_billing_rls_stub once the template's RLS policy migrations have applied.
DROP TABLE IF EXISTS "BillingAccount";
