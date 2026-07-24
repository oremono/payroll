import { describe, expect, it } from 'vitest';

import {
  applyCountryMultiplier,
  levelProgressionFactor,
  logNormal,
  standardNormal,
} from '@/domain/salary-distribution';

// Test-first (Law 1 / AD-23). The pure distribution math is held to 100% coverage AND 0 surviving
// mutants (src/domain), so every assertion below pins an EXACT value computed independently with
// `Math`, not a property the formula could satisfy while wrong. A mutant that flips `-2`, swaps
// `cos` for `/`, or drops the `exp` diverges from the inline reference and dies.

const TWO_PI = 2 * Math.PI;

describe('standardNormal — Box–Muller from two uniforms', () => {
  it('matches the closed form sqrt(-2 ln u1) · cos(2π u2) for interior points', () => {
    // u2 = 1/3 gives cos(2π/3) = -0.5 — a factor that is neither 0 nor 1, so a `·`→`/` mutant on the
    // outer product (which is identical to `·1`) cannot hide, and the sign is exercised.
    const u1 = 0.5;
    const u2 = 1 / 3;
    const expected = Math.sqrt(-2 * Math.log(u1)) * Math.cos(TWO_PI * u2);

    expect(standardNormal(u1, u2)).toBeCloseTo(expected, 12);
    // Independently: sqrt(-2·ln0.5)=sqrt(1.3863)=1.1774, ·cos(120°)=-0.5 ⇒ -0.5887.
    expect(standardNormal(u1, u2)).toBeCloseTo(-0.58871, 4);
  });

  it('is zero when the angle lands on a quarter turn (cos = 0)', () => {
    // u2 = 1/4 ⇒ 2π·¼ = π/2 ⇒ cos = 0. A mutant shrinking `2π` to `π` would give cos(π/4)≠0 here.
    expect(standardNormal(0.5, 0.25)).toBeCloseTo(0, 12);
  });

  it('takes the positive magnitude when the angle is zero (cos = 1)', () => {
    expect(standardNormal(0.5, 0)).toBeCloseTo(Math.sqrt(-2 * Math.log(0.5)), 12);
    // Larger u1 ⇒ smaller magnitude, because -ln u1 shrinks toward 0.
    expect(standardNormal(0.9, 0)).toBeCloseTo(Math.sqrt(-2 * Math.log(0.9)), 12);
    expect(standardNormal(0.9, 0)).toBeLessThan(standardNormal(0.5, 0));
  });

  it('stays FINITE at the u1 = 0 boundary rather than exploding to Infinity/NaN', () => {
    // Prng.nextUnit() returns [0,1) — zero included — so log(0) = -Infinity is a real input. The
    // guard lifts u1 to the smallest positive double, keeping the value large but finite.
    const atZero = standardNormal(0, 0);
    expect(Number.isFinite(atZero)).toBe(true);
    expect(atZero).toBeCloseTo(Math.sqrt(-2 * Math.log(Number.MIN_VALUE)), 6);
    // A negative u1 (out of contract, but the guard is `<= 0`) takes the same safe path.
    expect(standardNormal(-1, 0)).toBe(atZero);
  });

  it('does not lift an ordinary positive u1 (the guard is only the boundary)', () => {
    // If the guard fired for u1 > 0, this would equal the u1=0 value instead of its own.
    expect(standardNormal(0.25, 0)).toBeCloseTo(Math.sqrt(-2 * Math.log(0.25)), 12);
    expect(standardNormal(0.25, 0)).not.toBeCloseTo(standardNormal(0, 0), 6);
  });
});

describe('logNormal — median · e^(sigma · z)', () => {
  it('returns the median exactly when sigma is zero (e^0 = 1)', () => {
    expect(logNormal(150_000, 0, 3.2)).toBe(150_000);
  });

  it('scales the median by e^(sigma·z) for a non-trivial draw', () => {
    // sigma·z = 0.5·2 = 1 ⇒ ×e = ×2.71828.
    expect(logNormal(100_000, 0.5, 2)).toBeCloseTo(100_000 * Math.E, 6);
    // A negative z pulls below the median (the left half of the skew).
    expect(logNormal(100_000, 0.5, -2)).toBeCloseTo(100_000 / Math.E, 6);
  });

  it('is strictly positive for any finite z when the median is positive', () => {
    for (const z of [-8, -1, 0, 1, 8]) {
      expect(logNormal(90_000, 0.3, z)).toBeGreaterThan(0);
    }
  });
});

describe('levelProgressionFactor — (1 + step)^(rank − 1)', () => {
  it('is 1 at rank 1 regardless of the step (no level above the floor yet)', () => {
    expect(levelProgressionFactor(1, 0.18)).toBe(1);
    expect(levelProgressionFactor(1, 0.5)).toBe(1);
  });

  it('compounds the step for each rank above the first', () => {
    expect(levelProgressionFactor(2, 0.18)).toBeCloseTo(1.18, 12);
    expect(levelProgressionFactor(3, 0.18)).toBeCloseTo(1.18 ** 2, 12);
    expect(levelProgressionFactor(6, 0.18)).toBeCloseTo(1.18 ** 5, 12);
  });

  it('is monotonic increasing in rank, so no level inverts the one below it', () => {
    const factors = [1, 2, 3, 4, 5, 6].map((rank) => levelProgressionFactor(rank, 0.18));
    for (let i = 1; i < factors.length; i += 1) {
      expect(factors[i]).toBeGreaterThan(factors[i - 1] as number);
    }
  });
});

describe('applyCountryMultiplier — base · multiplier', () => {
  it('multiplies (never adds) the base by the multiplier', () => {
    expect(applyCountryMultiplier(100_000, 0.35)).toBe(35_000);
    expect(applyCountryMultiplier(100_000, 1)).toBe(100_000);
    expect(applyCountryMultiplier(100_000, 2.5)).toBe(250_000);
  });
});
