/**
 * THE canonical fairness statistics: the ONE median (AD-3) and the min–max spread. There is exactly
 * one median in the whole product, it lives here, and CAP-6 (outliers) and CAP-7 (gender gap) reuse
 * it unchanged — a second median anywhere is how two surfaces start disagreeing about the middle.
 *
 * No I/O, no clock, no randomness, no imports outside this layer — numbers in, a number out. (Law 2
 * / AD-1) Every function here is TOTAL: an empty set has no median and no spread, so both answer
 * `null` rather than throwing, and the caller gates on `n >= 5` (AD-16) before it ever asks.
 *
 * Everything is `bigint` minor units. Money never appears bare here (AD-4): the caller strips the
 * group's single-currency `amountMinor` values off, computes, and re-attaches the currency on the
 * way out. A statistic computed across two currencies would be meaningless, and the peer group is
 * single-currency by construction (country immutable, currency follows country), so this module
 * never sees more than one.
 */

import { divideRoundHalfUp } from './money';

/**
 * THE ascending order over minor-unit amounts — negative when `a` orders before `b`, positive when
 * after, zero when equal. Both `median` and `spread` sort through this ONE comparator rather than an
 * inline arrow, so the ordering is defined (and TESTED) in a single place.
 *
 * That it is a named, directly-tested function is what makes the zero arm real: a median or a min is
 * INVARIANT to the relative order of equal elements, so a `< → <=` slip in an inline comparator
 * would be invisible through either aggregate (an equivalent mutant). Pinned here by its own test —
 * `compareAmountsMinor(5n, 5n) === 0` — the arm becomes observable and the slip is caught.
 */
export function compareAmountsMinor(a: bigint, b: bigint): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/**
 * The median of a set of integer minor-unit amounts, or `null` when the set is EMPTY (AD-3).
 *
 * Sort ASCENDING; an ODD count answers the middle element; an EVEN count answers the arithmetic mean
 * of the two middle elements, rounded HALF-UP to the nearest minor unit through the ONE
 * `divideRoundHalfUp` — the same exact-integer rounding the distance uses, never IEEE double.
 * `(1 + 2) / 2` is `2`, not `1`: the mean of a pay pair is not silently floored.
 *
 * ## One expression for both parities, and why the empty case needs no guard
 *
 * The two central elements sit at `floor((n-1)/2)` and `floor(n/2)` — the SAME index for an odd `n`
 * (one middle element) and the two inner indices for an even one. `slice` between them yields a one-
 * or two-element window, and the median is `sum / window.length` rounded half-up. This unifies the
 * odd and even cases into one exact division (an odd window of length 1 divides by `1n`, returning
 * the element untouched). For an EMPTY set the window is itself empty, the sum is `0n`, and the
 * length is `0`, so the division is by `0n` — which `divideRoundHalfUp` answers with `null`. So the
 * emptiness answer falls out of the same expression; a separate `length === 0` guard would be
 * redundant (an equivalent mutant, since the fall-through already returns `null`) and is omitted.
 *
 * Reads the window through `slice`/`reduce`, never `sorted[i]`: under `noUncheckedIndexedAccess` an
 * index yields `bigint | undefined`, and the `undefined` guard that would follow is unreachable for
 * an in-range index — uncoverable in a module held to 100% (the reasoning `money.ts` gives for its
 * `?? ''`). Sorts a COPY, so the caller's list is left untouched.
 */
export function median(amountsMinor: readonly bigint[]): bigint | null {
  const sorted = [...amountsMinor].sort(compareAmountsMinor);
  const count = sorted.length;

  // The one-or-two central elements. Equal indices for an odd count, the two inner ones for even; an
  // empty set yields an empty window, whose zero length makes the division below `null`.
  const middle = sorted.slice(Math.floor((count - 1) / 2), Math.floor(count / 2) + 1);
  const sum = middle.reduce((total, amount) => total + amount, 0n);

  return divideRoundHalfUp(sum, BigInt(middle.length));
}

/**
 * The minimum and maximum of a set of integer minor-unit amounts, or `null` when EMPTY.
 *
 * The spread is the min–max RANGE (AD-3 / epic context), never an inter-quartile range and never a
 * standard deviation. Sorts through the ONE `compareAmountsMinor` and reads the ENDS: the minimum is
 * the head (destructured, so its `undefined` is the empty-set answer — a REACHABLE, load-bearing
 * check, not a guard on an in-range index), and the maximum is the LAST element, folded out with a
 * `reduce` seeded at the minimum rather than read by index.
 *
 * No inline `<`/`>` here on purpose: a `< → <=` slip in a hand-rolled min/max loop is INVISIBLE
 * (updating `min` to an equal value changes nothing — an equivalent mutant). Delegating the order to
 * `compareAmountsMinor` (whose zero arm is tested directly) and the selection to `slice`/`reduce`
 * leaves nothing here whose mutation is unobservable.
 */
export function spread(amountsMinor: readonly bigint[]): { min: bigint; max: bigint } | null {
  const sorted = [...amountsMinor].sort(compareAmountsMinor);
  const [min, ...rest] = sorted;
  if (min === undefined) {
    return null;
  }

  // Sorted ascending, so the last element is the maximum. `reduce` seeded at `min` returns the final
  // element (or `min` itself for a single-element set), without an index read that would be
  // `bigint | undefined`. The seed is load-bearing: a single-element `rest` is empty, and a
  // `reduce` with no seed over an empty array throws.
  const max = rest.reduce((_previous, current) => current, min);
  return { min, max };
}
