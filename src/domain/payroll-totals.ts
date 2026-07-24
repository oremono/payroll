/**
 * The CAP-9 payroll-totals core (AD-13 / AD-16 / AD-2): fold the ORG-WIDE as-of population into
 * per-country totals in each country's OWN currency, then convert each country total ONCE to the
 * reporting currency and sum — or return an org-wide REFUSAL when the rates needed are missing. No
 * I/O, no clock, no randomness, no imports outside this layer. (Law 2 / AD-1)
 *
 * This forks NOTHING: in-population membership and the current salary are the ONE
 * `resolveCurrentSalary` (AD-8), the exponent-aware conversion and rate-set resolution are the ONE
 * `fx.ts` pair (AD-13), and every rounding is the ONE `divideRoundHalfUp` those reuse (AD-5). There
 * is no second resolver, no second rounding rule, and no cross-currency arithmetic in a per-country
 * figure.
 *
 * ## The order is the rule (AD-13), and it is fixed
 *
 *   1. Sum each country's in-population current salaries in that country's SINGLE currency (AD-6) —
 *      the per-country total, which NEVER converts.
 *   2. The needed pairs are the distinct `{ countryCurrency -> reportingCurrency }` where the two
 *      differ; a country already in R needs no rate and is absent from `ratesUsed`.
 *   3. Resolve the ONE rate set at the greatest `pinnedOn <= asOf` over the needed pairs; require
 *      every needed pair present in it.
 *   4. Convert each country total ONCE and sum the converted totals. Integer sums are
 *      order-independent, so per-country ordering is display-only (`countryCode` ascending).
 *
 * Never per-employee conversion, and the org-wide total is rounded to the target unit at the final
 * conversion step ONLY.
 *
 * ## Why per-country never refuses, and the org-wide is the sole refusal site
 *
 * A per-country total is single-currency and never converts (AD-13), so it is always computable —
 * `perCountry` is present in every outcome, answer or refusal. Only the org-wide converted figure
 * can lack rates, so the refusal is nested inside `orgWide`, and the whole result is otherwise an
 * answer. A repository outage is the use-case's `unavailable`, a separate concern this pure layer
 * never sees.
 *
 * Every function here is TOTAL (Law 8 / AD-20): a missing rate set or pair is a RETURN VALUE, never
 * an exception; an empty population is an answer of zero, never a refusal. `asOf` is a required
 * explicit argument; same data + same `asOf` ⇒ byte-identical result.
 */

import {
  convertMinorUnits,
  resolveRateSet,
  type CurrencyPair,
  type FxRateRow,
} from './fx';
import type { CurrencyFormat, Money } from './money';
import type { PlainDate } from './plain-date';
import { resolveCurrentSalary, type SalaryRecordOrder } from './salary-timeline';

/**
 * One in-population salary record as the read hands it over: the two ordering columns membership
 * reads (AD-8) plus the record's own `Money`. No `id` — a total is a money capability, not a record
 * one; it needs the amount and currency, never the record identity.
 */
export type PayrollSalaryRecord = SalaryRecordOrder & {
  /** AD-4: never bare. The currency is the record's own, never re-resolved from the country (AD-6). */
  readonly salary: Money;
};

/**
 * One employee for the org-wide sweep: their `countryCode` and whole UNORDERED append-only salary
 * history reduced to the ordering columns + money. The domain resolves the as-of current salary and
 * membership; the read imposes no `ORDER BY` and no as-of filter (AD-8 / AD-16).
 */
export type PayrollCandidate = {
  readonly countryCode: string;
  readonly salaryRecords: readonly PayrollSalaryRecord[];
};

/** One country's display naming, resolved is_active-inclusively by the read (AD-16). */
export type CountryRef = {
  readonly countryCode: string;
  readonly countryName: string;
};

/**
 * One currency reference: the ONE money formatter's `CurrencyFormat`, whose `minorUnitExponent` the
 * conversion needs (JPY 0 / USD 2 / INR 2 — never a hard-coded 100, Law 4 / AD-4). The read guards
 * each with `isSupportedExponent` before it becomes a `CurrencyRef`.
 */
export type CurrencyRef = CurrencyFormat;

/**
 * One per-country total (Money-typed, pre-boundary): the country's codes, its SINGLE currency, the
 * in-population headcount, and the sum in LOCAL currency. The use-case encodes `total` to
 * `BoundaryMoney`; nothing here has crossed a boundary yet.
 */
export type CountryTotal = {
  readonly countryCode: string;
  readonly countryName: string;
  readonly currency: string;
  readonly n: number;
  readonly total: Money;
};

/**
 * One rate as a receipt (Law 8 / AD-20): the pair, the display `rate` string, and the set's
 * `pinnedOn`. Exactly the row applied — never a widened or guessed rate.
 */
export type RateReceipt = {
  readonly fromCurrency: string;
  readonly toCurrency: string;
  readonly rate: string;
  readonly pinnedOn: PlainDate;
};

/**
 * The org-wide figure: an `answer` carrying its receipts (the reporting `total`, the deduped
 * `ratesUsed`, and the set's `pinnedOn`), or a `refusal` naming why and — for `missing-rate` — which
 * pairs are absent. `pinnedOn`/`ratesUsed` are `null`/`[]` when no conversion was needed.
 */
export type OrgWideTotal =
  | {
      readonly kind: 'answer';
      readonly reportingCurrency: string;
      readonly total: Money;
      readonly ratesUsed: readonly RateReceipt[];
      readonly pinnedOn: PlainDate | null;
    }
  | {
      readonly kind: 'refusal';
      readonly reason: 'no-rate-set' | 'missing-rate';
      readonly reportingCurrency: string;
      readonly asOf: PlainDate;
      readonly pinnedOn: PlainDate | null;
      readonly missingPairs: readonly CurrencyPair[];
    };

/** The domain outcome: the per-country totals (always) and the org-wide answer-or-refusal. */
export type PayrollTotalsResult = {
  readonly perCountry: readonly CountryTotal[];
  readonly orgWide: OrgWideTotal;
};

/** Everything `computePayrollTotals` folds. The use-case assembles it from three reads + `asOf`. */
export type PayrollTotalsInput = {
  readonly candidates: readonly PayrollCandidate[];
  readonly countries: readonly CountryRef[];
  readonly currencies: readonly CurrencyRef[];
  readonly reportingCurrency: string;
  readonly fxRates: readonly FxRateRow[];
  readonly asOf: PlainDate;
};

/**
 * THE order over strings, byte-wise so it is deterministic across environments (never
 * `localeCompare`, whose output depends on the Node ICU build — Law 6). Ordering `countryCode` rows
 * and the source-currency list.
 *
 * EXPORTED so its three arms are pinned DIRECTLY: it sorts single-key lists here (country codes,
 * currency codes are each unique), so the equal-case `0` never falls through to a second key the way
 * a chained tie-break would — a sort cannot observe `-1` vs `0` on two equal, unique keys. A direct
 * test asserting `-1`/`0`/`1` is what keeps every arm live under mutation.
 */
export function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/** A running per-country aggregate: the sum in minor units, the headcount, and the single currency. */
type CountryAggregate = {
  sumMinor: bigint;
  n: number;
  readonly currency: string;
};

/**
 * The per-country totals over the as-of population, ordered by `countryCode` ascending.
 *
 * Each in-population employee (the ONE resolver, AD-8) contributes exactly their as-of current
 * salary to exactly one country and increments that country's `n` once — people, not records
 * (AD-2). A country with no in-population employee never becomes a row. The currency is taken from
 * the resolved salary (AD-6), so no per-country figure mixes currencies.
 */
function foldPerCountry(
  candidates: readonly PayrollCandidate[],
  countries: readonly CountryRef[],
  asOf: PlainDate,
): readonly CountryTotal[] {
  const byCountry = new Map<string, CountryAggregate>();

  for (const candidate of candidates) {
    const current = resolveCurrentSalary(candidate.salaryRecords, asOf);
    // Not in-population at `asOf` — future-hired, or with no record yet (AD-16). Never counted.
    if (current === null) {
      continue;
    }
    const existing = byCountry.get(candidate.countryCode);
    if (existing === undefined) {
      byCountry.set(candidate.countryCode, {
        sumMinor: current.salary.amountMinor,
        n: 1,
        currency: current.salary.currency,
      });
    } else {
      existing.sumMinor += current.salary.amountMinor;
      existing.n += 1;
    }
  }

  const countryNames = new Map(countries.map((ref) => [ref.countryCode, ref.countryName]));

  return [...byCountry.entries()]
    .map(([countryCode, aggregate]) => ({
      countryCode,
      // Falls back to the code when no CountryRef matches — total for a country whose label the read
      // did not carry (unreachable for an FK-backed employee, but keeps the fold total either way).
      countryName: countryNames.get(countryCode) ?? countryCode,
      currency: aggregate.currency,
      n: aggregate.n,
      total: { amountMinor: aggregate.sumMinor, currency: aggregate.currency },
    }))
    .sort((a, b) => compareStrings(a.countryCode, b.countryCode));
}

/**
 * The distinct source currencies that need converting — every per-country currency that differs from
 * the reporting currency, deduped and ordered so `ratesUsed`/`missingPairs` are deterministic. A
 * country already in R contributes directly and is absent here.
 */
function neededSourceCurrencies(
  perCountry: readonly CountryTotal[],
  reportingCurrency: string,
): readonly string[] {
  const seen = new Set<string>();
  for (const country of perCountry) {
    if (country.currency !== reportingCurrency) {
      seen.add(country.currency);
    }
  }
  return [...seen].sort(compareStrings);
}

/**
 * The org-wide total in the reporting currency, or a refusal (AD-13). See the module header for the
 * fixed order. `perCountry` is already computed and is returned by the caller regardless of this
 * outcome.
 */
function computeOrgWide(
  perCountry: readonly CountryTotal[],
  currencies: readonly CurrencyRef[],
  reportingCurrency: string,
  fxRates: readonly FxRateRow[],
  asOf: PlainDate,
): OrgWideTotal {
  const sources = neededSourceCurrencies(perCountry, reportingCurrency);

  // No conversion needed: every country is already in R (or the population is empty). A PLAIN sum in
  // R, carrying no rates — NOT a refusal (the matrix's "No conversion needed"/"Empty population").
  if (sources.length === 0) {
    const totalMinor = perCountry.reduce((sum, country) => sum + country.total.amountMinor, 0n);
    return {
      kind: 'answer',
      reportingCurrency,
      total: { amountMinor: totalMinor, currency: reportingCurrency },
      ratesUsed: [],
      pinnedOn: null,
    };
  }

  const neededSet = new Set(sources);
  // Only the rows for the needed pairs (`source -> R`), so resolution both honours "convert only
  // what's needed" and ignores every unrelated or reverse-direction row.
  const relevant = fxRates.filter(
    (row) => row.toCurrency === reportingCurrency && neededSet.has(row.fromCurrency),
  );
  const resolved = resolveRateSet(relevant, asOf);
  if (resolved === null) {
    return {
      kind: 'refusal',
      reason: 'no-rate-set',
      reportingCurrency,
      asOf,
      pinnedOn: null,
      missingPairs: [],
    };
  }

  // The set's rate per source currency. The `@@unique([fromCurrency, toCurrency, pinnedOn])` and the
  // fixed `toCurrency = R` make `fromCurrency` unique within the set, so no dedup guard is needed.
  const rateByFrom = new Map<string, FxRateRow>();
  for (const row of resolved.rows) {
    rateByFrom.set(row.fromCurrency, row);
  }

  const missingPairs = sources
    .filter((from) => !rateByFrom.has(from))
    .map((from) => ({ fromCurrency: from, toCurrency: reportingCurrency }));
  if (missingPairs.length > 0) {
    return {
      kind: 'refusal',
      reason: 'missing-rate',
      reportingCurrency,
      asOf,
      // The set's own date — the caller must know which set was short.
      pinnedOn: resolved.pinnedOn,
      missingPairs,
    };
  }

  const exponentByCode = new Map(currencies.map((ref) => [ref.code, ref.minorUnitExponent]));
  // Falls back to 0 for a currency the read did not carry — unreachable in production (every
  // currency is FK-present with a CHECKed 0..4 exponent that `isSupportedExponent` accepts), and
  // keeping the fold TOTAL rather than letting `BigInt(undefined)` throw (Law 8). The `?? 0n`
  // philosophy: a degenerate input yields a deterministic value, not an exception.
  const exponentOf = (code: string): number => exponentByCode.get(code) ?? 0;
  const toExponent = exponentOf(reportingCurrency);

  let totalMinor = 0n;
  for (const country of perCountry) {
    if (country.currency === reportingCurrency) {
      // Already in R — contributes directly, no rate (AD-13).
      totalMinor += country.total.amountMinor;
    } else {
      // Present past the missing-pair gate above — the `as` asserts what that gate guarantees.
      const row = rateByFrom.get(country.currency) as FxRateRow;
      totalMinor += convertMinorUnits(
        country.total.amountMinor,
        row,
        exponentOf(country.currency),
        toExponent,
      );
    }
  }

  // One receipt per needed source currency — deduped by construction (two countries sharing a
  // currency convert with, and cite, the SAME rate once).
  const ratesUsed = sources.map((from) => {
    const row = rateByFrom.get(from) as FxRateRow;
    return {
      fromCurrency: row.fromCurrency,
      toCurrency: row.toCurrency,
      rate: row.rate,
      pinnedOn: row.pinnedOn,
    };
  });

  return {
    kind: 'answer',
    reportingCurrency,
    total: { amountMinor: totalMinor, currency: reportingCurrency },
    ratesUsed,
    pinnedOn: resolved.pinnedOn,
  };
}

/**
 * The payroll totals over the as-of population: per-country totals in local currency (always) and
 * the org-wide total in the reporting currency or a refusal (AD-13). See the module header for the
 * fixed order and why the org-wide figure is the sole refusal site.
 *
 * TOTAL and deterministic: an empty population answers zero; a missing rate set or pair is a return
 * value; same input ⇒ byte-identical result.
 */
export function computePayrollTotals(input: PayrollTotalsInput): PayrollTotalsResult {
  const perCountry = foldPerCountry(input.candidates, input.countries, input.asOf);
  const orgWide = computeOrgWide(
    perCountry,
    input.currencies,
    input.reportingCurrency,
    input.fxRates,
    input.asOf,
  );
  return { perCountry, orgWide };
}
