/**
 * Minutes — the one unit module (D-6). Time is integer minutes; a work day is 480. No float ever touches a
 * minute: every division goes through `roundDiv` with the policy's rounding rule, applied once per accrual
 * event (C5), and `engine:lint` bans the Math rounding family and every float formatter under the engines.
 *
 * Lineage: the shape is LoanBook's `src/ledger/money.ts` (integer cents, one module, assert at the boundary),
 * which was not readable from this session (D-32) — written fresh from C5 and D-6.
 */

export const WORK_DAY_MINUTES = 480;

export type Rounding = 'HALF_UP' | 'FLOOR';
export const ROUNDINGS: readonly Rounding[] = ['HALF_UP', 'FLOOR'];

export class InvalidMinutes extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMinutes';
  }
}

/** A signed integer number of minutes. Throws on anything else; never rounds. */
export function assertMinutes(n: number, what = 'minutes'): number {
  if (!Number.isInteger(n)) throw new InvalidMinutes(`${what} must be an integer, got ${String(n)}`);
  return n;
}

/** Python-style floor division on integers: the quotient rounds toward −∞, so floorDiv(-1, 14) = -1. */
export function floorDiv(a: number, b: number): number {
  assertMinutes(a, 'floorDiv numerator');
  assertMinutes(b, 'floorDiv denominator');
  if (b === 0) throw new InvalidMinutes('floorDiv by zero');
  const r = ((a % b) + b) % b; // Python-style modulo: always in [0, b) for b > 0
  return (a - r) / b; // exact: (a - r) is a multiple of b
}

/**
 * C5: integer division with the policy's rounding rule. n ≥ 0, d > 0, both integers.
 *   FLOOR   = ⌊n / d⌋
 *   HALF_UP = ⌊(2n + d) / 2d⌋   (an exact .5 rounds up: 605·3/30 = 60.5 → 61, GA-04)
 */
export function roundDiv(n: number, d: number, mode: Rounding): number {
  assertMinutes(n, 'roundDiv numerator');
  assertMinutes(d, 'roundDiv denominator');
  if (n < 0) throw new InvalidMinutes(`roundDiv numerator must be ≥ 0, got ${n}`);
  if (d <= 0) throw new InvalidMinutes(`roundDiv denominator must be > 0, got ${d}`);
  switch (mode) {
    case 'FLOOR':
      return floorDiv(n, d);
    case 'HALF_UP':
      return floorDiv(2 * n + d, 2 * d);
    default: {
      const never: never = mode;
      throw new InvalidMinutes(`unknown rounding ${String(never)}`);
    }
  }
}
