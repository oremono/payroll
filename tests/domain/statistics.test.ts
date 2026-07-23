import { describe, expect, it } from 'vitest';

import { compareAmountsMinor, median, spread } from '@/domain/statistics';

// Test-first (Law 1 / AD-23): red before `src/domain/statistics.ts` exists.
//
// This file pins the ONE canonical median (AD-3) and the min–max spread — the first fairness
// statistics in the product, reused unchanged by CAP-6 (outliers) and CAP-7 (gender gap). There is
// exactly one median in the whole codebase, and it lives here.
//
// The rule, verbatim (AD-3): sort ASCENDING by integer minor units; an ODD count answers the
// middle element; an EVEN count answers the arithmetic mean of the two middle elements, rounded
// HALF-UP to the nearest minor unit via `divideRoundHalfUp` (never IEEE double). A median of an
// EMPTY set is never computed — it is `null`, and the caller gates on `n >= 5`.
//
// Both functions operate on `bigint` minor units. Money never appears bare here — the caller hands
// down the group's single-currency `amountMinor` values and re-attaches the currency on the way out.

describe('compareAmountsMinor — the ONE ascending order, all three arms', () => {
  // Tested DIRECTLY, including the zero arm, because a median and a min are both invariant to the
  // order of EQUAL elements — a `< → <=` slip is invisible through either aggregate but not here.
  it('orders a smaller amount BEFORE a larger one', () => {
    expect(compareAmountsMinor(1n, 2n)).toBe(-1);
  });

  it('orders a larger amount AFTER a smaller one', () => {
    expect(compareAmountsMinor(2n, 1n)).toBe(1);
  });

  it('answers zero for two equal amounts — the arm that makes the operator strict', () => {
    expect(compareAmountsMinor(5n, 5n)).toBe(0);
  });
});

describe('median — the ONE canonical median (AD-3)', () => {
  it('answers null for an empty set — a median of nothing is never computed', () => {
    // The caller gates on `n >= 5`; this is the totality contract, not a reachable statistic.
    expect(median([])).toBeNull();
  });

  it('answers the single element when there is exactly one', () => {
    expect(median([2_340_000n])).toBe(2_340_000n);
  });

  it('answers the MIDDLE element for an odd count', () => {
    // Sorted ascending: [1, 2, 3] → 2. The input is deliberately UNSORTED so a comparator that
    // never sorts (or sorts the wrong way) is caught.
    expect(median([3n, 1n, 2n])).toBe(2n);
  });

  it('sorts NUMERICALLY, not lexicographically, before taking the middle', () => {
    // The default `Array.prototype.sort` coerces to strings: "10" < "2" < "3", which would put 10
    // in the middle of a three-element set. Numeric ordering is [2, 3, 10] → 3. Only a numeric
    // comparator answers 3n here.
    expect(median([10n, 2n, 3n])).toBe(3n);
  });

  it('answers the arithmetic MEAN of the two middle elements for an even count', () => {
    // Sorted [2, 4] → mean 3. Distinct from BOTH middle elements, so a mutant that returns one of
    // them (the odd-count branch applied to an even set) cannot survive.
    expect(median([2n, 4n])).toBe(3n);
  });

  it('takes the two INNER middle elements for a larger even count, not the outer pair', () => {
    // Sorted [1, 2, 3, 4] → the inner pair is (2, 3), mean 3 (half-up). A mutant reading (1, 2) or
    // (3, 4) answers 2 or 4, both wrong.
    expect(median([1n, 2n, 3n, 4n])).toBe(3n);
  });

  it('rounds the even-count mean HALF-UP to the nearest minor unit', () => {
    // (1 + 2) / 2 = 1.5, which rounds UP to 2 — never truncated down to 1. This is the same
    // exact-arithmetic seed the distance uses; a floor or banker's-rounding mutant answers 1.
    expect(median([1n, 2n])).toBe(2n);
  });

  it('handles EQUAL peers — two people on the same salary sort as equal', () => {
    // Salaries collide (two peers earning the same), so the comparator's equality arm is a real
    // path, not a defensive one: an odd all-equal set answers that shared value.
    expect(median([5n, 5n, 5n])).toBe(5n);
    // …and an even all-equal set means it with itself, unchanged by the half-up rounding.
    expect(median([5n, 5n])).toBe(5n);
  });

  it('does not MUTATE the input array', () => {
    // The list arrives from a repository read no caller may disturb — the sort runs on a copy.
    const input = [3n, 1n, 2n];

    median(input);

    expect(input).toEqual([3n, 1n, 2n]);
  });

  it('is indifferent to the ORDER of the input for an even count', () => {
    // Sorted [1, 2, 3, 4] regardless of arrival order → inner pair (2, 3) → 3.
    expect(median([4n, 1n, 3n, 2n])).toBe(3n);
  });
});

describe('spread — the min–max range (never IQR, never stddev)', () => {
  it('answers null for an empty set', () => {
    expect(spread([])).toBeNull();
  });

  it('answers {min, max} both equal to the single element when there is one', () => {
    expect(spread([2_340_000n])).toEqual({ min: 2_340_000n, max: 2_340_000n });
  });

  it('answers the minimum and maximum of an unsorted set', () => {
    expect(spread([3n, 1n, 2n])).toEqual({ min: 1n, max: 3n });
  });

  it('finds the min and max independent of input order', () => {
    expect(spread([5n, 9n, 1n, 7n])).toEqual({ min: 1n, max: 9n });
    expect(spread([9n, 1n, 7n, 5n])).toEqual({ min: 1n, max: 9n });
  });

  it('does not MUTATE the input array', () => {
    const input = [3n, 1n, 2n];

    spread(input);

    expect(input).toEqual([3n, 1n, 2n]);
  });
});
