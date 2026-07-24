import { describe, expect, it } from 'vitest';

import {
  convertMinorUnits,
  resolveRateSet,
  type FxRateRow,
} from '@/domain/fx';
import type { PlainDate } from '@/domain/plain-date';

// Test-first (Law 1 / AD-23): red before `src/domain/fx.ts` exists.
//
// FX is PURE (Law 2 / AD-1): rows + an as-of date in, a resolved set or an exact integer out — no
// I/O, no clock, no randomness, no float anywhere. Two functions, and their whole contract (AD-13):
//   - `resolveRateSet` picks the ONE set at the greatest `pinnedOn <= asOf` (a "set" is every row at
//     that one date), ignoring later sets and rows above `asOf`; `null` when none is eligible.
//   - `convertMinorUnits` is exact minor-unit conversion through the ONE `divideRoundHalfUp` (AD-5),
//     scaling by the source/target exponent difference and rounding half-up to the target unit.
//
// This file walks every FX row of the spec I/O matrix and pins each branch for the 100% mutation
// floor. Deterministic: same rows + same `asOf` ⇒ same answer.

const date = (year: number, month: number, day: number): PlainDate => ({ year, month, day });

const JUN_01 = date(2026, 6, 1);
const JUL_01 = date(2026, 7, 1);

/** One fx_rate row, `rateNumerator/rateDenominator` an exact rational (adapter decomposes Decimal). */
function rate(
  fromCurrency: string,
  toCurrency: string,
  rateNumerator: bigint,
  rateDenominator: bigint,
  pinnedOn: PlainDate,
  rateString = 'n/a',
): FxRateRow {
  return { fromCurrency, toCurrency, rate: rateString, rateNumerator, rateDenominator, pinnedOn };
}

describe('resolveRateSet — the set at the greatest pinnedOn <= asOf (AD-13)', () => {
  it('returns null when there is no row at all', () => {
    expect(resolveRateSet([], date(2026, 7, 16))).toBeNull();
  });

  it('returns null when every row is pinned AFTER asOf', () => {
    const rows = [rate('INR', 'USD', 12n, 1000n, JUL_01)];
    // asOf strictly before the only set — nothing is in force yet.
    expect(resolveRateSet(rows, date(2026, 6, 30))).toBeNull();
  });

  it('INCLUDES a set pinned exactly ON asOf (the bound is inclusive)', () => {
    const rows = [rate('INR', 'USD', 12n, 1000n, JUL_01)];

    const resolved = resolveRateSet(rows, JUL_01);

    expect(resolved).not.toBeNull();
    expect(resolved?.pinnedOn).toEqual(JUL_01);
    expect(resolved?.rows).toEqual(rows);
  });

  it('picks the LATER of two eligible sets, regardless of input order', () => {
    const older = rate('INR', 'USD', 11n, 1000n, JUN_01);
    const newer = rate('INR', 'USD', 12n, 1000n, JUL_01);

    // asOf 16 Jul: both are <= asOf, the 01 Jul set wins — proven both input orders.
    const forward = resolveRateSet([older, newer], date(2026, 7, 16));
    const reversed = resolveRateSet([newer, older], date(2026, 7, 16));

    expect(forward?.pinnedOn).toEqual(JUL_01);
    expect(forward?.rows).toEqual([newer]);
    expect(reversed?.pinnedOn).toEqual(JUL_01);
    expect(reversed?.rows).toEqual([newer]);
  });

  it('resolves the EARLIER set when asOf falls between the two dates', () => {
    const older = rate('INR', 'USD', 11n, 1000n, JUN_01);
    const newer = rate('INR', 'USD', 12n, 1000n, JUL_01);

    // asOf 20 Jun: only 01 Jun is <= asOf; 01 Jul is in the future and ignored.
    const resolved = resolveRateSet([older, newer], date(2026, 6, 20));

    expect(resolved?.pinnedOn).toEqual(JUN_01);
    expect(resolved?.rows).toEqual([older]);
  });

  it('returns EVERY row sharing the winning pinnedOn, and only those', () => {
    // The 01 Jul set has two pairs; an 01 Jun row for a third pair is an EARLIER set and excluded.
    const julInr = rate('INR', 'USD', 12n, 1000n, JUL_01);
    const julEur = rate('EUR', 'USD', 108n, 100n, JUL_01);
    const junOnly = rate('GBP', 'USD', 125n, 100n, JUN_01);

    const resolved = resolveRateSet([julInr, junOnly, julEur], date(2026, 7, 16));

    expect(resolved?.pinnedOn).toEqual(JUL_01);
    expect(resolved?.rows).toEqual([julInr, julEur]);
  });
});

describe('convertMinorUnits — exact minor-unit conversion, half-up at the final step (AD-5/AD-13)', () => {
  it('converts INR (exp 2) to USD (exp 2) — the golden example', () => {
    // ₹8300.00 = 830000 minor; INR->USD = 0.012 => rateNumerator 1_200_000 / 10^8.
    const inrToUsd = rate('INR', 'USD', 1_200_000n, 100_000_000n, JUL_01, '0.012');

    // divideRoundHalfUp(830000 * 1_200_000 * 10^2, 10^8 * 10^2) = 9960 => $99.60.
    expect(convertMinorUnits(830_000n, inrToUsd, 2, 2)).toBe(9960n);
  });

  it('scales UP when the target exponent exceeds the source: JPY (exp 0) -> USD (exp 2)', () => {
    // ¥10000 = 10000 minor (exp 0); JPY->USD = 0.0065 => 650_000 / 10^8.
    const jpyToUsd = rate('JPY', 'USD', 650_000n, 100_000_000n, JUL_01, '0.0065');

    // divideRoundHalfUp(10000 * 650_000 * 10^2, 10^8 * 10^0) = 6500 => $65.00.
    expect(convertMinorUnits(10_000n, jpyToUsd, 0, 2)).toBe(6500n);
  });

  it('scales DOWN when the source exponent exceeds the target: USD (exp 2) -> JPY (exp 0)', () => {
    // $100.00 = 10000 minor (exp 2); USD->JPY = 150 => 150 * 10^8 / 10^8.
    const usdToJpy = rate('USD', 'JPY', 15_000_000_000n, 100_000_000n, JUL_01, '150');

    // divideRoundHalfUp(10000 * 15_000_000_000 * 10^0, 10^8 * 10^2) = 15000 => ¥15000.
    expect(convertMinorUnits(10_000n, usdToJpy, 2, 0)).toBe(15_000n);
  });

  it('rounds a HALF minor unit up (magnitude, then sign — AD-5)', () => {
    // amount 1 at rate 5/2, same exponents: divideRoundHalfUp(1 * 5 * 1, 2 * 1) = divide(5, 2) = 3.
    const half = rate('AAA', 'BBB', 5n, 2n, JUL_01);

    expect(convertMinorUnits(1n, half, 0, 0)).toBe(3n);
  });

  it('is TOTAL — a zero denominator (never reached with a real 10^8 rate) yields 0, not a throw', () => {
    // Mirrors distancePctTenths(5n, 0n) === 0n: the `?? 0n` idiom keeps a DIRECT caller total. The
    // orchestrator never feeds a zero denominator (rateDenominator = 10^8, 10^fromExp >= 1).
    const degenerate = rate('AAA', 'BBB', 5n, 0n, JUL_01);

    expect(convertMinorUnits(100n, degenerate, 2, 2)).toBe(0n);
  });
});
