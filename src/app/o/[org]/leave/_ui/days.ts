// Display only (D-60): ledger rows, engines and CSVs stay integer minutes. Days = minutes / work_day_minutes, 2 decimals
// half-up, trailing zeros trimmed, "day" only at exactly 1. Integer arithmetic throughout: no float touches a minute.
export const WORK_DAY_MINUTES = 480; // D-6; fixtures/policies.json work_day_minutes

export function formatDays(minutes: number, workDay = WORK_DAY_MINUTES): string {
  const abs = Math.abs(minutes);
  const hundredths = Math.floor((abs * 200 + workDay) / (2 * workDay)); // half-up of abs*100/workDay
  const frac = String(hundredths % 100).padStart(2, '0').replace(/0+$/, '');
  const n = `${Math.floor(hundredths / 100)}${frac ? `.${frac}` : ''}`;
  return `${minutes < 0 && hundredths > 0 ? '−' : ''}${n} ${hundredths === 100 ? 'day' : 'days'}`;
}
