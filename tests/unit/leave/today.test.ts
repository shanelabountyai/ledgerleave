// D-43: the org's "today" is a calendar day in its IANA zone, computed from an instant in exactly one module.
// Instants are built from epoch milliseconds (Date.UTC), never parsed from a string (D-7).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calendarDayIn, dayBefore, isTimeZone } from '@/leave-db/today';

const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => new Date(Date.UTC(y, mo - 1, d, h, mi, s));

describe('calendarDayIn (D-43)', () => {
  it('America/Chicago: the day turns at 06:00 UTC in winter, 05:00 UTC in summer', () => {
    expect(calendarDayIn('America/Chicago', at(2025, 1, 1, 5, 59, 59))).toBe('2024-12-31');
    expect(calendarDayIn('America/Chicago', at(2025, 1, 1, 6, 0, 0))).toBe('2025-01-01');
    expect(calendarDayIn('America/Chicago', at(2025, 7, 1, 4, 59, 59))).toBe('2025-06-30');
    expect(calendarDayIn('America/Chicago', at(2025, 7, 1, 5, 0, 0))).toBe('2025-07-01');
  });
  it('Pacific/Kiritimati (UTC+14): already tomorrow while UTC is still on today', () => {
    expect(calendarDayIn('Pacific/Kiritimati', at(2025, 12, 31, 9, 59, 59))).toBe('2025-12-31');
    expect(calendarDayIn('Pacific/Kiritimati', at(2025, 12, 31, 10, 0, 0))).toBe('2026-01-01');
  });
  it('a DST transition day is one calendar day on both sides of the gap', () => {
    expect(calendarDayIn('America/Chicago', at(2025, 3, 9, 7, 59))).toBe('2025-03-09'); // 01:59 CST
    expect(calendarDayIn('America/Chicago', at(2025, 3, 9, 8, 0))).toBe('2025-03-09'); // 03:00 CDT
  });
  it('the same instant is two different days in two zones', () => {
    const t = at(2025, 5, 5, 3, 0);
    expect([calendarDayIn('UTC', t), calendarDayIn('America/Chicago', t)]).toEqual(['2025-05-05', '2025-05-04']);
  });
  it('rejects a zone the runtime does not know, and an empty one', () => {
    expect(isTimeZone('America/Chicago')).toBe(true);
    expect(isTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isTimeZone('')).toBe(false);
    expect(() => calendarDayIn('Mars/Olympus_Mons', at(2025, 1, 1))).toThrow(/time zone/);
  });
  it('dayBefore is calendar arithmetic, crossing a year and a leap day', () => {
    expect(dayBefore('2025-01-01')).toBe('2024-12-31');
    expect(dayBefore('2024-03-01')).toBe('2024-02-29');
  });
});

describe('one converter (D-43, Bookable rule)', () => {
  it('only src/leave-db/today.ts formats an instant into a day in a zone', () => {
    const root = join(import.meta.dirname, '../../..');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) {
          if (n !== 'generated' && n !== 'core' && n !== 'modules') walk(p);
        } else if (/\.(ts|tsx)$/.test(n)) files.push(p);
      }
    };
    walk(join(root, 'src'));
    walk(join(root, 'scripts/leave'));
    const hits = files.filter((f) => /formatToParts|Intl\.DateTimeFormat/.test(readFileSync(f, 'utf8'))).map((f) => relative(root, f));
    expect(hits).toEqual(['src/leave-db/today.ts']);
  });
});
