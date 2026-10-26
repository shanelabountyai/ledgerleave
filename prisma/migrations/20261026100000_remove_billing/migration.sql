-- D-46 (owner decision 2026-10-26): the billing module is removed by the template's manifest
-- (scripts/foundation-modules.ts). Its three applied migrations (*_billing_init, *_billing_event_order,
-- *_billing_subscription_id) are left as they are — an applied migration is never edited or deleted — and this
-- clone migration drops what they created, so the database matches a schema with no billing.prisma.
DROP TABLE "BillingAccount";
DROP TABLE "StripeEvent";
