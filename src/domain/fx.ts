/**
 * FX rate-set resolution and exact minor-unit conversion (CAP-9, AD-13). PURE: no I/O, no clock, no
 * randomness, no imports outside this layer, and — the point of this module — NO FLOAT. (Law 2 /
 * AD-1) Every function here is TOTAL: a failure is a value (`null`, or `0n`), never an exception.
 *
 * FX lives HERE and not in `money.ts`: that module's own header forbids hosting FX, so the ONE
 * rounding primitive it exports (`divideRoundHalfUp`, AD-5) is imported and reused rather than
 * re-implemented. There is no second rounding rule and no decimal library — `bigint` is exact.
 *
 * ## The direction is fixed (AD-13)
 *
 * `fx_rate(fromCurrency = C, toCurrency = R, rate)` means "1 unit of C = `rate` units of R". `rate`
 * is carried as an exact rational `rateNumerator / rateDenominator` (the adapter decomposes the
 * stored `Decimal(18,8)` into `{ rate: string, rateNumerator, rateDenominator = 10^8 }` with no
 * float), and the string form rides along ONLY as the receipt the payload displays — never as a
 * number the arithmetic reads.
 *
 * ## A rate set is a date (AD-13)
 *
 * A "rate set" is every `fx_rate` row sharing one `pinnedOn`, written whole or not at all. A
 * conversion uses the set with the greatest `pinnedOn <= asOf`. `resolveRateSet` finds that one
 * date and returns every row at it; the orchestrator then requires each pair it needs to be present
 * in that set, or refuses — it never mixes rows from two dates.
 */

import { divideRoundHalfUp } from './money';
import { comparePlainDate, type PlainDate } from './plain-date';

/**
 * One `fx_rate` row as the read hands it over. `rate` is the display string (the receipt);
 * `rateNumerator / rateDenominator` is the SAME value as an exact rational the arithmetic uses —
 * two forms of one number, decomposed by the adapter so the domain never parses a decimal.
 */
export type FxRateRow = {
  readonly fromCurrency: string;
  readonly toCurrency: string;
  /** The display form, e.g. `"0.012"` — a RECEIPT, never read by the conversion arithmetic. */
  readonly rate: string;
  readonly rateNumerator: bigint;
  /** `10^8` for a `Decimal(18,8)`, and provably positive — see `convertMinorUnits`. */
  readonly rateDenominator: bigint;
  readonly pinnedOn: PlainDate;
};

/** A currency conversion direction, `from -> to`. The unit `resolveRateSet` and refusals speak in. */
export type CurrencyPair = {
  readonly fromCurrency: string;
  readonly toCurrency: string;
};

/** The resolved rate set: its identifying `pinnedOn` and every row written at that date. */
export type ResolvedRateSet = {
  readonly pinnedOn: PlainDate;
  readonly rows: readonly FxRateRow[];
};

/**
 * The rate set in force at `asOf`: every row at the single greatest `pinnedOn <= asOf`, or `null`
 * when no row is pinned on or before `asOf` (AD-13).
 *
 * A single linear pass finds the winning date, then a filter collects every row at it — a "set" is a
 * date, and two rows sharing that date are the designed case (one set covers many pairs). The
 * `pinnedOn <= asOf` bound is INCLUSIVE, the same inclusiveness `resolveCurrentSalary` gives `asOf`:
 * a set pinned exactly on the as-of date is in force that day. Rows pinned AFTER `asOf` are ignored,
 * so a future set never leaks into a past view (determinism, Law 6).
 */
export function resolveRateSet(
  rows: readonly FxRateRow[],
  asOf: PlainDate,
): ResolvedRateSet | null {
  // Eligible = pinned on or BEFORE `asOf`. Inclusive of `asOf` itself (see the header); a future
  // set is dropped here and can never leak into a past view.
  const eligible = rows.filter((row) => comparePlainDate(row.pinnedOn, asOf) <= 0);
  if (eligible.length === 0) {
    return null;
  }

  // The GREATEST eligible date is the head of a descending sort on a COPY — the tie-break between
  // rows sharing that date is immaterial (a "set" is a date, and the filter below collects every
  // row at it), so the ordering primitive is the ONE `comparePlainDate` and no bespoke max-loop is
  // written. `eligible` is non-empty, so the head is present.
  const [greatest] = [...eligible].sort((a, b) => comparePlainDate(b.pinnedOn, a.pinnedOn));
  const winningDate = (greatest as FxRateRow).pinnedOn;

  return {
    pinnedOn: winningDate,
    rows: eligible.filter((row) => comparePlainDate(row.pinnedOn, winningDate) === 0),
  };
}

/**
 * Convert `amountMinor` (integer minor units of the source currency `C`) into integer minor units of
 * the target currency `R`, using `rate` (`1 C = rate R`) and the two currencies' minor-unit
 * exponents. Exact, through the ONE `divideRoundHalfUp` (AD-5), rounded half-up to the target unit
 * at THIS — the final — step, and never before.
 *
 * `minorR = divideRoundHalfUp(amountMinor * rateNumerator * 10^toExponent, rateDenominator * 10^fromExponent)`
 *
 * The `10^toExponent / 10^fromExponent` factor is what makes the exponents matter: a JPY (exp 0)
 * total converting to a USD (exp 2) reporting currency scales UP by 100, and the reverse scales
 * down — never a hard-coded 100 (Law 4 / AD-4).
 *
 * The `?? 0n` is the established `peer-comparison.ts` / `gender-gap.ts` idiom (a `divideRoundHalfUp`
 * that returns a plain `bigint`), kept so a DIRECT caller handing a degenerate zero denominator gets
 * a value rather than a leaked `null`. Through the orchestrator the denominator is provably positive
 * (`rateDenominator = 10^8`, `10^fromExponent >= 1`), so that arm is never reached there — NO
 * reachable-looking guard is added, exactly as those siblings add none.
 */
export function convertMinorUnits(
  amountMinor: bigint,
  rate: FxRateRow,
  fromExponent: number,
  toExponent: number,
): bigint {
  return (
    divideRoundHalfUp(
      amountMinor * rate.rateNumerator * 10n ** BigInt(toExponent),
      rate.rateDenominator * 10n ** BigInt(fromExponent),
    ) ?? 0n
  );
}
