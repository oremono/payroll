/**
 * The pure distribution math the seed (CAP-11) draws salaries from. (Law 2 / AD-1, AD-14)
 *
 * No I/O, no clock, no randomness, no imports outside this layer — numbers in, numbers out. Every
 * function here is TOTAL and FINITE: it never throws and never returns `NaN`/`±Infinity` for an
 * in-range draw. The RANDOMNESS lives entirely in the caller (the seeded `Prng` port); this module
 * only turns two uniforms into a shape.
 *
 * ## Why log-normal, not normal (AD-14)
 *
 * Real salaries are right-skewed — a floor below, a long tail above — so a normal draw would erase
 * the mean-vs-median distinction the product exists to surface. `standardNormal` is the Box–Muller
 * transform of two uniforms; `logNormal` exponentiates it around a median, which is exactly the
 * right-skew a salary band has.
 *
 * These are the ONLY functions the seed's population generator (src/application/seed/population.ts)
 * uses for its distribution shape; the engineered cell LAYOUT (which cell gets how many people, the
 * planted outliers, the gender structure) is the generator's, not this module's.
 */

/** `2π`, the full turn Box–Muller's angle sweeps. A named constant so the rotation reads. */
const TWO_PI = 2 * Math.PI;

/**
 * A standard-normal sample (mean 0, variance 1) from two uniforms in `[0, 1)`, via the Box–Muller
 * transform: `sqrt(-2 ln u1) · cos(2π u2)`.
 *
 * TOTAL and FINITE across the whole input domain. The one boundary that would break it is `u1 = 0`
 * — `ln 0` is `-Infinity` and `sqrt(+Infinity)` then poisons the result — and `Prng.nextUnit`
 * returns exactly that value with non-zero probability (its range is `[0, 1)`, zero included). So a
 * `u1` at or below zero is lifted to the smallest positive double before the log, which keeps the
 * magnitude large-but-finite rather than infinite. `u2` needs no such guard: `cos` is finite
 * everywhere.
 */
export function standardNormal(u1: number, u2: number): number {
  const safeU1 = u1 <= 0 ? Number.MIN_VALUE : u1;
  return Math.sqrt(-2 * Math.log(safeU1)) * Math.cos(TWO_PI * u2);
}

/**
 * A log-normal value: `median · e^(sigma · z)`, where `z` is a `standardNormal` sample.
 *
 * `median` is the value the distribution centres on (the log-normal median is `e^μ`, so passing the
 * median directly is passing `μ = ln median`). `sigma` is the spread in log space — larger `sigma`,
 * longer tail. TOTAL and FINITE for finite inputs; strictly positive whenever `median > 0`, because
 * `e^x > 0` for every real `x`. The caller quantises this to integer minor units.
 */
export function logNormal(median: number, sigma: number, standardNormalValue: number): number {
  return median * Math.exp(sigma * standardNormalValue);
}

/**
 * The pay multiplier for a level at `rank`, compounding `stepFraction` per level above the first:
 * `(1 + stepFraction)^(rank - 1)`.
 *
 * Rank 1 (the lowest level) is the base — factor `1`. Each higher rank multiplies by
 * `1 + stepFraction`, so a ~15–20% step keeps the ladder monotonic and free of level inversions
 * (a lower level never systematically out-earns a higher one). TOTAL and FINITE.
 */
export function levelProgressionFactor(rank: number, stepFraction: number): number {
  return (1 + stepFraction) ** (rank - 1);
}

/**
 * Scale a role/level base by a country's cost-of-labour multiplier: `base · multiplier`.
 *
 * A single named operation rather than a bare product at the call site, so "the country multiplier
 * is applied HERE, once" is a fact the code states rather than one a reader reconstructs. TOTAL and
 * FINITE.
 */
export function applyCountryMultiplier(base: number, multiplier: number): number {
  return base * multiplier;
}
