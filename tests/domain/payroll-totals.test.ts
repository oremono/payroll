import { describe, expect, it } from 'vitest';

import type { FxRateRow } from '@/domain/fx';
import {
  compareStrings,
  computePayrollTotals,
  type CountryRef,
  type CurrencyRef,
  type PayrollCandidate,
  type PayrollTotalsInput,
} from '@/domain/payroll-totals';
import type { PlainDate } from '@/domain/plain-date';

// Test-first (Law 1 / AD-23): red before `src/domain/payroll-totals.ts` exists.
//
// CAP-9 (AD-13 / AD-16 / AD-2): sum each country's as-of current salaries in its OWN currency (never
// converted), then convert each country total ONCE to the reporting currency and sum — or refuse
// out loud when the rates are missing. No SQL total or count (Law 2). Money is exact integer minor
// units + code; conversion is exact rational, rounded half-up to the target unit at the final step.
//
// This file walks EVERY domain row of the spec I/O matrix and pins each branch for the 100% mutation
// floor. Pure, TOTAL, deterministic: `asOf` is a required argument, no clock/random/IO.

const date = (year: number, month: number, day: number): PlainDate => ({ year, month, day });

const AS_OF = date(2026, 7, 16);
const IN_FORCE = date(2020, 1, 1);
const FUTURE = date(2027, 1, 1);
const JUN_01 = date(2026, 6, 1);
const JUL_01 = date(2026, 7, 1);

/** A CurrencyRef = the ONE money formatter's `CurrencyFormat` (carries the minor-unit exponent). */
function currency(code: string, minorUnitExponent: number): CurrencyRef {
  return { code, symbol: '¤', minorUnitExponent, groupingStyle: 'WESTERN' };
}

function country(countryCode: string, countryName: string): CountryRef {
  return { countryCode, countryName };
}

/** One in-population employee: a single current salary record at `countryCode`. */
function person(
  countryCode: string,
  amountMinor: bigint,
  currencyCode: string,
  effectiveFrom: PlainDate = IN_FORCE,
  seq = 1n,
): PayrollCandidate {
  return {
    countryCode,
    salaryRecords: [{ effectiveFrom, seq, salary: { amountMinor, currency: currencyCode } }],
  };
}

function fxRate(
  fromCurrency: string,
  toCurrency: string,
  rateNumerator: bigint,
  rateDenominator: bigint,
  pinnedOn: PlainDate,
  rateString: string,
): FxRateRow {
  return { fromCurrency, toCurrency, rate: rateString, rateNumerator, rateDenominator, pinnedOn };
}

/** INR->USD = 0.012 at 01 Jul, as an exact 10^8-denominated rational. */
const INR_USD_JUL = fxRate('INR', 'USD', 1_200_000n, 100_000_000n, JUL_01, '0.012');

const USD = currency('USD', 2);
const INR = currency('INR', 2);
const JPY = currency('JPY', 0);
const EUR = currency('EUR', 2);

function input(overrides: Partial<PayrollTotalsInput>): PayrollTotalsInput {
  return {
    candidates: [],
    countries: [],
    currencies: [USD, INR, JPY, EUR],
    reportingCurrency: 'USD',
    fxRates: [],
    asOf: AS_OF,
    ...overrides,
  };
}

describe('compareStrings — the ONE byte-wise order, all three arms pinned directly', () => {
  it('returns -1 / 0 / 1 for less / equal / greater', () => {
    expect(compareStrings('AAA', 'BBB')).toBe(-1);
    expect(compareStrings('BBB', 'AAA')).toBe(1);
    expect(compareStrings('AAA', 'AAA')).toBe(0);
  });
});

describe('computePayrollTotals — the golden multi-currency happy path (AD-13)', () => {
  it('reports per-country totals in local currency and the org-wide total in the reporting currency', () => {
    // reporting = USD. US -> $100.00 (10000); India -> ₹8300.00 INR (830000). INR->USD 0.012 @ 01 Jul.
    const result = computePayrollTotals(
      input({
        candidates: [
          person('US', 10_000n, 'USD'),
          person('IN', 830_000n, 'INR'),
        ],
        countries: [country('IN', 'India'), country('US', 'United States')],
        // The INR->EUR row shares INR's pinnedOn but points at the WRONG target — it must be
        // filtered out (its `toCurrency` is not the reporting currency), never mistaken for the rate.
        fxRates: [INR_USD_JUL, fxRate('INR', 'EUR', 1_100_000n, 100_000_000n, JUL_01, '0.011')],
      }),
    );

    // perCountry: countryCode ASC, each in its own currency, each with n.
    expect(result.perCountry).toEqual([
      {
        countryCode: 'IN',
        countryName: 'India',
        currency: 'INR',
        n: 1,
        total: { amountMinor: 830_000n, currency: 'INR' },
      },
      {
        countryCode: 'US',
        countryName: 'United States',
        currency: 'USD',
        n: 1,
        total: { amountMinor: 10_000n, currency: 'USD' },
      },
    ]);

    // org-wide: ₹8300.00 -> $99.60 (9960) + $100.00 (10000) = $199.60 (19960); one deduped rate.
    expect(result.orgWide).toEqual({
      kind: 'answer',
      reportingCurrency: 'USD',
      total: { amountMinor: 19_960n, currency: 'USD' },
      ratesUsed: [{ fromCurrency: 'INR', toCurrency: 'USD', rate: '0.012', pinnedOn: JUL_01 }],
      pinnedOn: JUL_01,
    });
  });
});

describe('computePayrollTotals — no conversion needed: every country already in the reporting currency', () => {
  it('answers a PLAIN sum in R with ratesUsed [] and pinnedOn null — never a refusal', () => {
    const result = computePayrollTotals(
      input({
        candidates: [person('US', 10_000n, 'USD'), person('CA', 5_000n, 'USD')],
        countries: [country('CA', 'Canada'), country('US', 'United States')],
        // A rate exists but is never needed — it must NOT appear in the answer.
        fxRates: [INR_USD_JUL],
      }),
    );

    expect(result.orgWide).toEqual({
      kind: 'answer',
      reportingCurrency: 'USD',
      total: { amountMinor: 15_000n, currency: 'USD' },
      ratesUsed: [],
      pinnedOn: null,
    });
  });
});

describe('computePayrollTotals — an empty population is an answer of zero, never a refusal', () => {
  it('answers perCountry [] and an org-wide total of 0 in R, ratesUsed [], pinnedOn null', () => {
    const result = computePayrollTotals(input({ candidates: [], countries: [] }));

    expect(result.perCountry).toEqual([]);
    expect(result.orgWide).toEqual({
      kind: 'answer',
      reportingCurrency: 'USD',
      total: { amountMinor: 0n, currency: 'USD' },
      ratesUsed: [],
      pinnedOn: null,
    });
  });

  it('excludes a future-effective member so its country drops out entirely', () => {
    const result = computePayrollTotals(
      input({
        candidates: [person('IN', 830_000n, 'INR', FUTURE)],
        countries: [country('IN', 'India')],
        fxRates: [INR_USD_JUL],
      }),
    );

    // The only member is not yet in force at AS_OF -> no country, and no conversion needed.
    expect(result.perCountry).toEqual([]);
    expect(result.orgWide).toEqual({
      kind: 'answer',
      reportingCurrency: 'USD',
      total: { amountMinor: 0n, currency: 'USD' },
      ratesUsed: [],
      pinnedOn: null,
    });
  });
});

describe('computePayrollTotals — refusal: no rate set as of the date (AD-13)', () => {
  it('refuses org-wide with no-rate-set, pinnedOn null, missingPairs [] — perCountry still present', () => {
    // A conversion IS needed (INR), but every rate set is pinned AFTER asOf.
    const result = computePayrollTotals(
      input({
        candidates: [person('IN', 830_000n, 'INR'), person('US', 10_000n, 'USD')],
        countries: [country('IN', 'India'), country('US', 'United States')],
        fxRates: [INR_USD_JUL], // pinned 01 Jul
        asOf: date(2026, 6, 15), // before 01 Jul
      }),
    );

    // perCountry is FULLY present and in local currency — only the org-wide converted figure refuses.
    expect(result.perCountry.map((row) => row.countryCode)).toEqual(['IN', 'US']);
    expect(result.perCountry[0]?.total).toEqual({ amountMinor: 830_000n, currency: 'INR' });
    expect(result.orgWide).toEqual({
      kind: 'refusal',
      reason: 'no-rate-set',
      reportingCurrency: 'USD',
      asOf: date(2026, 6, 15),
      pinnedOn: null,
      missingPairs: [],
    });
  });
});

describe('computePayrollTotals — refusal: a resolved set lacks a needed pair (AD-13)', () => {
  it('refuses with missing-rate, the set date, and the absent pair(s) — perCountry present', () => {
    // The 01 Jul set has INR->USD but NOT EUR->USD; EUR is needed -> missing-rate.
    const result = computePayrollTotals(
      input({
        candidates: [
          person('IN', 830_000n, 'INR'),
          person('DE', 100_000n, 'EUR'),
          person('US', 10_000n, 'USD'),
        ],
        countries: [
          country('DE', 'Germany'),
          country('IN', 'India'),
          country('US', 'United States'),
        ],
        fxRates: [INR_USD_JUL],
      }),
    );

    expect(result.perCountry.map((row) => row.countryCode)).toEqual(['DE', 'IN', 'US']);
    expect(result.orgWide).toEqual({
      kind: 'refusal',
      reason: 'missing-rate',
      reportingCurrency: 'USD',
      asOf: AS_OF,
      pinnedOn: JUL_01,
      missingPairs: [{ fromCurrency: 'EUR', toCurrency: 'USD' }],
    });
  });

  it('names EVERY absent pair, ordered by fromCurrency, when several are missing', () => {
    // The set has only INR->USD; EUR and JPY both need conversion and are both absent. Country codes
    // are chosen so that iterating perCountry (countryCode ASC: C1, C2, C3) meets the currencies in
    // the order JPY, EUR, INR — the REVERSE of their sorted order — so the missingPairs order
    // ([EUR, JPY]) can only be right if the source list is sorted, not left in encounter order.
    const result = computePayrollTotals(
      input({
        candidates: [
          person('C1', 500_000n, 'JPY'),
          person('C2', 100_000n, 'EUR'),
          person('C3', 830_000n, 'INR'),
        ],
        countries: [country('C1', 'Japanland'), country('C2', 'Euroland'), country('C3', 'Rupeeland')],
        fxRates: [INR_USD_JUL],
      }),
    );

    expect(result.orgWide).toMatchObject({
      kind: 'refusal',
      reason: 'missing-rate',
      missingPairs: [
        { fromCurrency: 'EUR', toCurrency: 'USD' },
        { fromCurrency: 'JPY', toCurrency: 'USD' },
      ],
    });
  });
});

describe('computePayrollTotals — rate-set resolution by date (AD-13)', () => {
  const buildTwoSets = (asOf: PlainDate): PayrollTotalsInput =>
    input({
      candidates: [person('IN', 100_000n, 'INR')],
      countries: [country('IN', 'India')],
      fxRates: [
        fxRate('INR', 'USD', 1_000_000n, 100_000_000n, JUN_01, '0.010'), // 01 Jun set
        fxRate('INR', 'USD', 1_200_000n, 100_000_000n, JUL_01, '0.012'), // 01 Jul set
      ],
      asOf,
    });

  it('uses the 01 Jul set at asOf 16 Jul', () => {
    const result = computePayrollTotals(buildTwoSets(date(2026, 7, 16)));
    // 100000 * 0.012 = 1200 minor USD.
    expect(result.orgWide).toMatchObject({
      kind: 'answer',
      total: { amountMinor: 1_200n, currency: 'USD' },
      pinnedOn: JUL_01,
    });
  });

  it('uses the 01 Jun set at asOf 20 Jun', () => {
    const result = computePayrollTotals(buildTwoSets(date(2026, 6, 20)));
    // 100000 * 0.010 = 1000 minor USD.
    expect(result.orgWide).toMatchObject({
      kind: 'answer',
      total: { amountMinor: 1_000n, currency: 'USD' },
      pinnedOn: JUN_01,
    });
  });

  it('refuses no-rate-set at an asOf before the earliest set', () => {
    const result = computePayrollTotals(buildTwoSets(date(2026, 5, 31)));
    expect(result.orgWide).toMatchObject({ kind: 'refusal', reason: 'no-rate-set' });
  });
});

describe('computePayrollTotals — exponent-aware conversion, JPY exp 0 (AD-13 / AD-4)', () => {
  it('scales a JPY (exp 0) country total into the USD (exp 2) reporting currency', () => {
    // ¥1,000,000 = 1000000 minor (exp 0); JPY->USD = 0.0065.
    const result = computePayrollTotals(
      input({
        candidates: [person('JP', 1_000_000n, 'JPY')],
        countries: [country('JP', 'Japan')],
        fxRates: [fxRate('JPY', 'USD', 650_000n, 100_000_000n, JUL_01, '0.0065')],
      }),
    );

    // divideRoundHalfUp(1000000 * 650000 * 10^2, 10^8 * 10^0) = 650000 => $6,500.00.
    expect(result.orgWide).toMatchObject({
      kind: 'answer',
      total: { amountMinor: 650_000n, currency: 'USD' },
    });
  });
});

describe('computePayrollTotals — a person with multiple records contributes ONE amount (AD-8 / AD-2)', () => {
  it('sums the as-of current salary once and counts the person once in n', () => {
    // A same-day correction: two records sharing effectiveFrom, the greater-seq one current.
    const corrected: PayrollCandidate = {
      countryCode: 'US',
      salaryRecords: [
        { effectiveFrom: IN_FORCE, seq: 1n, salary: { amountMinor: 999n, currency: 'USD' } },
        { effectiveFrom: IN_FORCE, seq: 2n, salary: { amountMinor: 10_000n, currency: 'USD' } },
      ],
    };

    const result = computePayrollTotals(
      input({ candidates: [corrected], countries: [country('US', 'United States')] }),
    );

    expect(result.perCountry).toEqual([
      {
        countryCode: 'US',
        countryName: 'United States',
        currency: 'USD',
        n: 1,
        total: { amountMinor: 10_000n, currency: 'USD' },
      },
    ]);
  });
});

describe('computePayrollTotals — the as-of population defines every figure (AD-16)', () => {
  it('drops a not-yet-effective member, lowering that country total and n', () => {
    const result = computePayrollTotals(
      input({
        candidates: [
          person('US', 10_000n, 'USD'),
          person('US', 5_000n, 'USD'),
          person('US', 7_000n, 'USD', FUTURE), // excluded at AS_OF
        ],
        countries: [country('US', 'United States')],
      }),
    );

    expect(result.perCountry).toEqual([
      {
        countryCode: 'US',
        countryName: 'United States',
        currency: 'USD',
        n: 2,
        total: { amountMinor: 15_000n, currency: 'USD' },
      },
    ]);
  });
});

describe('computePayrollTotals — reporting country mixed in with converted countries', () => {
  it('adds R-countries directly (absent from ratesUsed) and converts the rest', () => {
    const result = computePayrollTotals(
      input({
        candidates: [person('US', 10_000n, 'USD'), person('IN', 830_000n, 'INR')],
        countries: [country('IN', 'India'), country('US', 'United States')],
        fxRates: [INR_USD_JUL],
      }),
    );

    expect(result.orgWide).toMatchObject({
      kind: 'answer',
      total: { amountMinor: 19_960n, currency: 'USD' },
      // Only the non-reporting source appears — USD is added directly, never a rate.
      ratesUsed: [{ fromCurrency: 'INR', toCurrency: 'USD', rate: '0.012', pinnedOn: JUL_01 }],
    });
  });
});

describe('computePayrollTotals — two countries sharing a currency convert once each, one deduped rate', () => {
  it('applies the same EUR->USD rate to both totals and lists it ONCE in ratesUsed', () => {
    const result = computePayrollTotals(
      input({
        candidates: [
          person('DE', 100_000n, 'EUR'),
          person('FR', 200_000n, 'EUR'),
        ],
        countries: [country('DE', 'Germany'), country('FR', 'France')],
        fxRates: [fxRate('EUR', 'USD', 108_000_000n, 100_000_000n, JUL_01, '1.08')],
      }),
    );

    // DE €1000.00 -> $1080.00 (108000); FR €2000.00 -> $2160.00 (216000); total $3240.00 (324000).
    expect(result.orgWide).toEqual({
      kind: 'answer',
      reportingCurrency: 'USD',
      total: { amountMinor: 324_000n, currency: 'USD' },
      ratesUsed: [{ fromCurrency: 'EUR', toCurrency: 'USD', rate: '1.08', pinnedOn: JUL_01 }],
      pinnedOn: JUL_01,
    });
    // Both countries are present, each in EUR.
    expect(result.perCountry.map((row) => row.total.amountMinor)).toEqual([100_000n, 200_000n]);
  });
});

describe('computePayrollTotals — the rate filter ignores irrelevant fx_rate rows', () => {
  it('does not resolve a set from rows whose pair is not needed', () => {
    // Only GBP->USD exists (never needed); INR is needed -> no relevant row -> no-rate-set.
    const result = computePayrollTotals(
      input({
        candidates: [person('IN', 830_000n, 'INR'), person('US', 10_000n, 'USD')],
        countries: [country('IN', 'India'), country('US', 'United States')],
        fxRates: [
          fxRate('GBP', 'USD', 125_000_000n, 100_000_000n, JUL_01, '1.25'),
          // A reverse-direction row for the needed currency: USD->INR is NOT INR->USD, so ignored.
          fxRate('USD', 'INR', 8_300_000_000n, 100_000_000n, JUL_01, '83'),
        ],
      }),
    );

    expect(result.orgWide).toMatchObject({ kind: 'refusal', reason: 'no-rate-set' });
  });
});

describe('computePayrollTotals — a country whose currency lacks a reference uses exponent 0 (total)', () => {
  it('stays TOTAL for a currency absent from `currencies`, converting at exponent 0', () => {
    // ZZZ is not in `currencies` (unreachable in production: every currency is FK-present with a
    // CHECKed 0..4 exponent). The fold must not throw — the exponent falls back to 0.
    const result = computePayrollTotals(
      input({
        candidates: [person('ZZ', 1_000n, 'ZZZ')],
        countries: [country('ZZ', 'Zedland')],
        currencies: [USD], // deliberately omits ZZZ
        fxRates: [fxRate('ZZZ', 'USD', 100_000_000n, 100_000_000n, JUL_01, '1')],
      }),
    );

    // fromExp defaults to 0, toExp (USD) is 2: divideRoundHalfUp(1000 * 10^8 * 10^2, 10^8 * 10^0)
    // = 100000.
    expect(result.orgWide).toMatchObject({
      kind: 'answer',
      total: { amountMinor: 100_000n, currency: 'USD' },
    });
  });
});

describe('computePayrollTotals — a country whose name is absent falls back to its code (total)', () => {
  it('uses the countryCode as the name when no CountryRef matches', () => {
    const result = computePayrollTotals(
      input({ candidates: [person('US', 10_000n, 'USD')], countries: [] }),
    );

    expect(result.perCountry[0]).toMatchObject({ countryCode: 'US', countryName: 'US' });
  });
});

describe('computePayrollTotals — determinism (Law 6 / AD-11)', () => {
  it('returns a deep-equal result for the same input', () => {
    const build = (): PayrollTotalsInput =>
      input({
        candidates: [person('IN', 830_000n, 'INR'), person('US', 10_000n, 'USD')],
        countries: [country('IN', 'India'), country('US', 'United States')],
        fxRates: [INR_USD_JUL],
      });

    expect(computePayrollTotals(build())).toEqual(computePayrollTotals(build()));
  });
});
