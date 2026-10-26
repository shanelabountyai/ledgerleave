-- D-43 (owner decision 2026-10-26, closes O-13): the org's IANA time zone, whose calendar day is "today" for live
-- actions and the nightly close. Validated against Intl.supportedValuesOf('timeZone') by the one module that reads
-- it (src/leave-db/today.ts); the database only refuses an empty value.
ALTER TABLE "LeaveSettings" ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'America/Chicago';
ALTER TABLE "LeaveSettings" ADD CONSTRAINT "LeaveSettings_timeZone_check" CHECK ("timeZone" <> '');
