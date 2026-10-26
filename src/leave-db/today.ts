/**
 * D-43 (owner decision 2026-10-26, closes O-13): "today" for an org is the calendar day in its IANA time zone
 * (`LeaveSettings.timeZone`), and THIS is the one module that turns an instant into a `CalendarDay` — Bookable's
 * one-converter rule. The engines never see a clock or a zone: live actions take the day this module returns, and
 * the nightly close replays the day before it. No date library: `Intl.DateTimeFormat#formatToParts` reads the
 * zone's wall-clock date for the instant; nothing here parses a string into a Date or reads the process zone.
 */
import { type CalendarDay, addDays, calendarDay } from '@/accrual/calendar';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Is this an IANA zone the runtime can convert into? (The value written to `LeaveSettings.timeZone` must be.) */
export function isTimeZone(zone: string): boolean {
  if (zone === '') return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar day in `zone` at `instant`. Throws on an unknown zone rather than falling back to the process zone. */
export function calendarDayIn(zone: string, instant: Date): CalendarDay {
  let f = formatters.get(zone);
  if (!f) {
    if (!isTimeZone(zone)) throw new Error(`unknown time zone "${zone}" (D-43: LeaveSettings.timeZone must be an IANA zone)`);
    f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', calendar: 'gregory', numberingSystem: 'latn' });
    formatters.set(zone, f);
  }
  const part = (t: string) => f.formatToParts(instant).find((p) => p.type === t)?.value ?? '';
  return calendarDay(`${part('year')}-${part('month')}-${part('day')}`);
}

/** The day before, on the calendar axis (the nightly close's "yesterday"). */
export const dayBefore = (d: string): CalendarDay => addDays(calendarDay(d), -1);

type Reader = Pick<Prisma.TransactionClient, 'leaveSettings'>;

/** The org's zone; an org with no LeaveSettings row uses the column default. */
export async function orgTimeZone(orgId: string, tx: Reader = db): Promise<string> {
  const s = await tx.leaveSettings.findUnique({ where: { orgId }, select: { timeZone: true } });
  return s?.timeZone ?? 'America/Chicago';
}

/** Today for the org, from the injectable clock (`@/core/clock`), in the org's zone. */
export async function todayFor(orgId: string, tx: Reader = db): Promise<CalendarDay> {
  return calendarDayIn(await orgTimeZone(orgId, tx), now());
}
