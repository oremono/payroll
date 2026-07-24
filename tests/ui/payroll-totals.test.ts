import { describe, expect, it } from 'vitest';

import type {
  GetPayrollTotalsResult,
  PayrollCountryTotal,
  PayrollOrgWideTotal,
} from '@/application/use-cases/payroll-totals';
import type { CurrencyFormat } from '@/domain/money';
import type { PlainDate } from '@/domain/plain-date';
import {
  buildPayrollTotals,
  PAYROLL_TOTALS_UNAVAILABLE_HEADING,
  PAYROLL_TOTALS_UNAVAILABLE_STATEMENT,
} from '@/ui/payroll-totals-vm';

// Test-first (Law 1 / AD-23): red before `src/ui/payroll-totals-vm.ts` exists.
//
// 10-2 is the CAP-9 UI. Same VM/markup split, and the same reason, as `peer-comparison-vm.ts`: no
// jsdom, no @testing-library, and `src/ui/*.tsx` sits outside the coverage gate. Every judgement the
// payroll-totals surface makes — selecting the arm, formatting every per-country total through the
// ONE money formatter (fail closed), composing the org-wide answer headline + provenance caption +
// `ratesUsed` disclosure, or the org-wide refusal heading/statement, and selecting the top-5 pulse
// rows — lives in the PURE builder tested here.
//
// It consumes story 10-1's finalized payload UNMODIFIED (Law 7 / AD-24): `n`, per-country `total`,
// org-wide `total`, `ratesUsed`, and `pinnedOn` all arrive computed. The builder re-derives no
// statistic; it only SELECTS the arm, FORMATS money/dates, and picks the pulse rows.

const USD: CurrencyFormat = { code: 'USD', symbol: '$', minorUnitExponent: 2, groupingStyle: 'WESTERN' };
const INR: CurrencyFormat = { code: 'INR', symbol: '₹', minorUnitExponent: 2, groupingStyle: 'INDIAN' };
const JPY: CurrencyFormat = { code: 'JPY', symbol: '¥', minorUnitExponent: 0, groupingStyle: 'WESTERN' };
const CURRENCIES = [USD, INR, JPY];

const AS_OF: PlainDate = { year: 2026, month: 7, day: 16 };
const PINNED: PlainDate = { year: 2026, month: 7, day: 1 };

function money(amountMinor: string, currency: string) {
  return { amountMinor, currency };
}

function answer(
  perCountry: readonly PayrollCountryTotal[],
  orgWide: PayrollOrgWideTotal,
  asOf: PlainDate = AS_OF,
): GetPayrollTotalsResult {
  return { kind: 'answer', totals: { asOf, perCountry, orgWide } };
}

const IN_ROW: PayrollCountryTotal = {
  countryCode: 'IN',
  countryName: 'India',
  currency: 'INR',
  n: 2,
  total: money('830000', 'INR'),
};
const US_ROW: PayrollCountryTotal = {
  countryCode: 'US',
  countryName: 'United States',
  currency: 'USD',
  n: 1,
  total: money('10000', 'USD'),
};

const CONVERTED_ORG_WIDE: PayrollOrgWideTotal = {
  kind: 'answer',
  reportingCurrency: 'USD',
  total: money('19960', 'USD'),
  ratesUsed: [{ fromCurrency: 'INR', toCurrency: 'USD', rate: '0.012', pinnedOn: PINNED }],
  pinnedOn: PINNED,
};

describe('buildPayrollTotals — the converted org-wide answer', () => {
  it('formats every per-country total in its own currency, in delivered order, keyed on countryCode', () => {
    const vm = buildPayrollTotals(answer([IN_ROW, US_ROW], CONVERTED_ORG_WIDE), CURRENCIES);

    expect(vm.kind === 'answer' && vm.perCountry).toEqual([
      { countryCode: 'IN', countryName: 'India', currency: 'INR', n: 2, total: '₹8,300 INR' },
      { countryCode: 'US', countryName: 'United States', currency: 'USD', n: 1, total: '$100 USD' },
    ]);
  });

  it('composes the org-wide headline, the converted provenance caption, and the ratesUsed disclosure', () => {
    const vm = buildPayrollTotals(answer([IN_ROW, US_ROW], CONVERTED_ORG_WIDE), CURRENCIES);

    expect(vm.kind === 'answer' && vm.orgWide).toEqual({
      kind: 'answer',
      headline: '$199.60 USD',
      reportingCurrency: 'USD',
      caption: 'Converted to USD at rates pinned 01 Jul 2026, as of 16 Jul 2026',
      rates: [{ fromCurrency: 'INR', toCurrency: 'USD', rate: '0.012', pinnedOn: '01 Jul 2026' }],
    });
  });
});

describe('buildPayrollTotals — the no-conversion-needed answer', () => {
  it('states summed-directly with no rates disclosure when nothing converted', () => {
    const orgWide: PayrollOrgWideTotal = {
      kind: 'answer',
      reportingCurrency: 'USD',
      total: money('10000', 'USD'),
      ratesUsed: [],
      pinnedOn: null,
    };
    const vm = buildPayrollTotals(answer([US_ROW], orgWide), CURRENCIES);

    expect(vm.kind === 'answer' && vm.orgWide).toEqual({
      kind: 'answer',
      headline: '$100 USD',
      reportingCurrency: 'USD',
      caption: 'Summed directly in USD — no conversion, as of 16 Jul 2026',
      rates: [],
    });
  });
});

describe('buildPayrollTotals — the org-wide refusal (a calm region, not an error)', () => {
  it('names no-rate-set and the as-of, while the per-country table stays fully present', () => {
    const orgWide: PayrollOrgWideTotal = {
      kind: 'refusal',
      reason: 'no-rate-set',
      reportingCurrency: 'USD',
      asOf: AS_OF,
      pinnedOn: null,
      missingPairs: [],
    };
    const vm = buildPayrollTotals(answer([IN_ROW, US_ROW], orgWide), CURRENCIES);

    expect(vm.kind === 'answer' && vm.perCountry).toHaveLength(2);
    expect(vm.kind === 'answer' && vm.orgWide).toEqual({
      kind: 'refusal',
      heading: 'Org-wide total unavailable',
      statement:
        "No FX rate set is pinned on or before 16 Jul 2026, so the org-wide total in USD can't be shown. Per-country totals are unaffected.",
    });
  });

  it('names the absent pair(s) and the set pinned date for missing-rate', () => {
    const orgWide: PayrollOrgWideTotal = {
      kind: 'refusal',
      reason: 'missing-rate',
      reportingCurrency: 'USD',
      asOf: AS_OF,
      pinnedOn: PINNED,
      missingPairs: [
        { fromCurrency: 'EUR', toCurrency: 'USD' },
        { fromCurrency: 'JPY', toCurrency: 'USD' },
      ],
    };
    const vm = buildPayrollTotals(answer([IN_ROW], orgWide), CURRENCIES);

    expect(vm.kind === 'answer' && vm.orgWide).toEqual({
      kind: 'refusal',
      heading: 'Org-wide total unavailable',
      statement:
        "The rate set pinned 01 Jul 2026 is missing EUR → USD, JPY → USD, so the org-wide total in USD can't be shown. Per-country totals are unaffected.",
    });
  });
});

describe('buildPayrollTotals — unavailable', () => {
  it('maps unavailable to the module-level heading and statement', () => {
    const vm = buildPayrollTotals({ kind: 'unavailable' }, CURRENCIES);

    expect(vm).toEqual({
      kind: 'unavailable',
      heading: PAYROLL_TOTALS_UNAVAILABLE_HEADING,
      statement: PAYROLL_TOTALS_UNAVAILABLE_STATEMENT,
    });
  });
});

describe('buildPayrollTotals — empty population', () => {
  it('carries no per-country rows and no pulse rows, but a headline of zero', () => {
    const orgWide: PayrollOrgWideTotal = {
      kind: 'answer',
      reportingCurrency: 'USD',
      total: money('0', 'USD'),
      ratesUsed: [],
      pinnedOn: null,
    };
    const vm = buildPayrollTotals(answer([], orgWide), CURRENCIES);

    expect(vm.kind === 'answer' && vm.perCountry).toEqual([]);
    expect(vm.kind === 'answer' && vm.pulse).toEqual([]);
    expect(vm.kind === 'answer' && vm.orgWide.kind === 'answer' && vm.orgWide.headline).toBe('$0 USD');
  });
});

describe('buildPayrollTotals — money fails closed (Law 4 / AD-4)', () => {
  it('withholds a per-country total whose currency is absent from the reference list', () => {
    const vm = buildPayrollTotals(answer([IN_ROW, US_ROW], CONVERTED_ORG_WIDE), [USD]);

    // INR is not in the list — its total is withheld (null), never a bare/raw amount; USD still formats.
    expect(vm.kind === 'answer' && vm.perCountry.map((row) => row.total)).toEqual([null, '$100 USD']);
    // A raw minor string never leaks anywhere.
    expect(JSON.stringify(vm)).not.toContain('830000');
  });

  it('withholds the org-wide headline when the reporting currency cannot format', () => {
    const orgWide: PayrollOrgWideTotal = {
      kind: 'answer',
      reportingCurrency: 'EUR',
      total: money('19960', 'EUR'),
      ratesUsed: [],
      pinnedOn: null,
    };
    const vm = buildPayrollTotals(answer([US_ROW], orgWide), CURRENCIES);

    expect(vm.kind === 'answer' && vm.orgWide.kind === 'answer' && vm.orgWide.headline).toBeNull();
  });
});

describe('buildPayrollTotals — the by-country pulse (headcount, never payroll magnitude)', () => {
  it('selects the top 5 countries by n descending, tie-broken by countryCode ascending', () => {
    const rows: PayrollCountryTotal[] = [
      { countryCode: 'AA', countryName: 'A', currency: 'USD', n: 5, total: money('100', 'USD') },
      { countryCode: 'BB', countryName: 'B', currency: 'USD', n: 9, total: money('100', 'USD') },
      { countryCode: 'CC', countryName: 'C', currency: 'USD', n: 5, total: money('100', 'USD') },
      { countryCode: 'DD', countryName: 'D', currency: 'USD', n: 1, total: money('100', 'USD') },
      { countryCode: 'EE', countryName: 'E', currency: 'USD', n: 7, total: money('100', 'USD') },
      { countryCode: 'FF', countryName: 'F', currency: 'USD', n: 7, total: money('100', 'USD') },
    ];
    const orgWide: PayrollOrgWideTotal = {
      kind: 'answer',
      reportingCurrency: 'USD',
      total: money('600', 'USD'),
      ratesUsed: [],
      pinnedOn: null,
    };
    const vm = buildPayrollTotals(answer(rows, orgWide), CURRENCIES);

    // n desc: BB(9), EE(7), FF(7), AA(5), CC(5) — DD(1) drops off the bottom; ties (7/7, 5/5) go by
    // countryCode asc. Each pulse row carries its formatted LOCAL total (never bar-compared).
    expect(vm.kind === 'answer' && vm.pulse).toEqual([
      { countryCode: 'BB', countryName: 'B', n: 9, total: '$1 USD' },
      { countryCode: 'EE', countryName: 'E', n: 7, total: '$1 USD' },
      { countryCode: 'FF', countryName: 'F', n: 7, total: '$1 USD' },
      { countryCode: 'AA', countryName: 'A', n: 5, total: '$1 USD' },
      { countryCode: 'CC', countryName: 'C', n: 5, total: '$1 USD' },
    ]);
  });

  it('does not mutate the delivered per-country order when selecting the pulse', () => {
    const rows: PayrollCountryTotal[] = [
      { countryCode: 'IN', countryName: 'India', currency: 'INR', n: 2, total: money('830000', 'INR') },
      { countryCode: 'US', countryName: 'United States', currency: 'USD', n: 9, total: money('10000', 'USD') },
    ];
    const vm = buildPayrollTotals(answer(rows, CONVERTED_ORG_WIDE), CURRENCIES);

    expect(vm.kind === 'answer' && vm.perCountry.map((row) => row.countryCode)).toEqual(['IN', 'US']);
    // The pulse re-orders by n desc without touching perCountry.
    expect(vm.kind === 'answer' && vm.pulse.map((row) => row.countryCode)).toEqual(['US', 'IN']);
  });
});

describe('buildPayrollTotals — determinism (Law 6)', () => {
  it('is byte-identical across runs for the same payload', () => {
    const input = answer([IN_ROW, US_ROW], CONVERTED_ORG_WIDE);
    expect(buildPayrollTotals(input, CURRENCIES)).toEqual(buildPayrollTotals(input, CURRENCIES));
  });
});
