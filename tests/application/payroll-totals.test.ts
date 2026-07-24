import { describe, expect, it } from 'vitest';

import type { PayrollTotalsPopulation } from '@/application/ports/employee-repository';
import type { FxRateRepository } from '@/application/ports/fx-rate-repository';
import type { SettingsView } from '@/application/ports/settings-repository';
import {
  getPayrollTotals,
  type PayrollTotalsDeps,
} from '@/application/use-cases/payroll-totals';
import type { FxRateRow } from '@/domain/fx';
import type { CurrencyRef, PayrollCandidate } from '@/domain/payroll-totals';
import type { PlainDate } from '@/domain/plain-date';

// Test-first (Law 1 / AD-23): red before `src/application/use-cases/payroll-totals.ts` exists.
//
// Against in-memory FAKE ports, never a database (Law: Testing). No clock is injected and none may
// be: `asOf` is a REQUIRED ARGUMENT threaded in from the delivery boundary (Law 6 / AD-11).
//
// The use-case is TOTAL (Law 8 / AD-20): it orchestrates only — Promise.all the three reads, hand
// them to the ONE pure domain (`computePayrollTotals`), encode every `Money` to `BoundaryMoney`, and
// attach `asOf`. ANY of the three reads throwing is caught and answered `unavailable`; no exception
// crosses the boundary. Story 10-2 consumes this payload unmodified (Law 7).

const date = (year: number, month: number, day: number): PlainDate => ({ year, month, day });

const AS_OF = date(2026, 7, 16);
const IN_FORCE = date(2020, 1, 1);
const JUL_01 = date(2026, 7, 1);

function currency(code: string, minorUnitExponent: number): CurrencyRef {
  return { code, symbol: '¤', minorUnitExponent, groupingStyle: 'WESTERN' };
}

function person(countryCode: string, amountMinor: bigint, currencyCode: string): PayrollCandidate {
  return {
    countryCode,
    salaryRecords: [{ effectiveFrom: IN_FORCE, seq: 1n, salary: { amountMinor, currency: currencyCode } }],
  };
}

const INR_USD_JUL: FxRateRow = {
  fromCurrency: 'INR',
  toCurrency: 'USD',
  rate: '0.012',
  rateNumerator: 1_200_000n,
  rateDenominator: 100_000_000n,
  pinnedOn: JUL_01,
};

/** The golden org-wide population: US $100.00 + India ₹8300.00, reporting USD. */
function goldenPopulation(): PayrollTotalsPopulation {
  return {
    candidates: [person('US', 10_000n, 'USD'), person('IN', 830_000n, 'INR')],
    countries: [
      { countryCode: 'IN', countryName: 'India' },
      { countryCode: 'US', countryName: 'United States' },
    ],
    currencies: [currency('USD', 2), currency('INR', 2)],
  };
}

type FakeConfig = {
  readonly population?: PayrollTotalsPopulation;
  readonly fxRates?: readonly FxRateRow[];
  readonly reportingCurrency?: string;
  readonly throwOn?: 'population' | 'fx' | 'settings';
};

function fakeDeps(config: FakeConfig = {}): PayrollTotalsDeps & { readonly calls: string[] } {
  const calls: string[] = [];
  const fxRateRepository: FxRateRepository = {
    findAllFxRates: async () => {
      calls.push('fx');
      if (config.throwOn === 'fx') throw new Error('fx read failed');
      return config.fxRates ?? [INR_USD_JUL];
    },
  };
  return {
    repository: {
      findPayrollTotalsPopulation: async () => {
        calls.push('population');
        if (config.throwOn === 'population') throw new Error('population read failed');
        return config.population ?? goldenPopulation();
      },
    },
    fxRateRepository,
    settingsRepository: {
      readSettings: async (): Promise<SettingsView> => {
        calls.push('settings');
        if (config.throwOn === 'settings') throw new Error('settings read failed');
        return { outlierThresholdPct: 20, reportingCurrency: config.reportingCurrency ?? 'USD' };
      },
    },
    calls,
  };
}

describe('getPayrollTotals — the answer payload (AD-20), boundary-encoded and carrying asOf', () => {
  it('returns per-country totals (ordered, n, boundary money) and the org-wide answer with receipts', async () => {
    const result = await getPayrollTotals(fakeDeps(), AS_OF);

    expect(result).toEqual({
      kind: 'answer',
      totals: {
        asOf: AS_OF,
        perCountry: [
          {
            countryCode: 'IN',
            countryName: 'India',
            currency: 'INR',
            n: 1,
            total: { amountMinor: '830000', currency: 'INR' },
          },
          {
            countryCode: 'US',
            countryName: 'United States',
            currency: 'USD',
            n: 1,
            total: { amountMinor: '10000', currency: 'USD' },
          },
        ],
        orgWide: {
          kind: 'answer',
          reportingCurrency: 'USD',
          total: { amountMinor: '19960', currency: 'USD' },
          ratesUsed: [{ fromCurrency: 'INR', toCurrency: 'USD', rate: '0.012', pinnedOn: JUL_01 }],
          pinnedOn: JUL_01,
        },
      },
    });
  });

  it('reads all three ports', async () => {
    const deps = fakeDeps();

    await getPayrollTotals(deps, AS_OF);

    expect([...deps.calls].sort()).toEqual(['fx', 'population', 'settings']);
  });
});

describe('getPayrollTotals — no conversion needed and empty population are answers, never refusals', () => {
  it('answers a plain sum in R with ratesUsed [] and pinnedOn null when every country is in R', async () => {
    const population: PayrollTotalsPopulation = {
      candidates: [person('US', 10_000n, 'USD'), person('CA', 5_000n, 'USD')],
      countries: [
        { countryCode: 'CA', countryName: 'Canada' },
        { countryCode: 'US', countryName: 'United States' },
      ],
      currencies: [currency('USD', 2)],
    };

    const result = await getPayrollTotals(fakeDeps({ population }), AS_OF);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') return;
    expect(result.totals.orgWide).toEqual({
      kind: 'answer',
      reportingCurrency: 'USD',
      total: { amountMinor: '15000', currency: 'USD' },
      ratesUsed: [],
      pinnedOn: null,
    });
  });

  it('answers perCountry [] and an org-wide 0 in R for an empty population', async () => {
    const population: PayrollTotalsPopulation = {
      candidates: [],
      countries: [],
      currencies: [currency('USD', 2)],
    };

    const result = await getPayrollTotals(fakeDeps({ population, fxRates: [] }), AS_OF);

    expect(result).toEqual({
      kind: 'answer',
      totals: {
        asOf: AS_OF,
        perCountry: [],
        orgWide: {
          kind: 'answer',
          reportingCurrency: 'USD',
          total: { amountMinor: '0', currency: 'USD' },
          ratesUsed: [],
          pinnedOn: null,
        },
      },
    });
  });
});

describe('getPayrollTotals — org-wide refusals, with perCountry still fully present (AD-13)', () => {
  it('refuses no-rate-set when a conversion is needed but no set resolves — perCountry present', async () => {
    const result = await getPayrollTotals(fakeDeps({ fxRates: [] }), AS_OF);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') return;
    // Per-country totals are still there, each in local currency.
    expect(result.totals.perCountry.map((row) => row.countryCode)).toEqual(['IN', 'US']);
    expect(result.totals.perCountry[0]?.total).toEqual({ amountMinor: '830000', currency: 'INR' });
    expect(result.totals.orgWide).toEqual({
      kind: 'refusal',
      reason: 'no-rate-set',
      reportingCurrency: 'USD',
      asOf: AS_OF,
      pinnedOn: null,
      missingPairs: [],
    });
  });

  it('refuses missing-rate naming the absent pair when the resolved set lacks it', async () => {
    const population: PayrollTotalsPopulation = {
      candidates: [person('IN', 830_000n, 'INR'), person('DE', 100_000n, 'EUR')],
      countries: [
        { countryCode: 'DE', countryName: 'Germany' },
        { countryCode: 'IN', countryName: 'India' },
      ],
      currencies: [currency('USD', 2), currency('INR', 2), currency('EUR', 2)],
    };

    const result = await getPayrollTotals(fakeDeps({ population, fxRates: [INR_USD_JUL] }), AS_OF);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') return;
    expect(result.totals.orgWide).toEqual({
      kind: 'refusal',
      reason: 'missing-rate',
      reportingCurrency: 'USD',
      asOf: AS_OF,
      pinnedOn: JUL_01,
      missingPairs: [{ fromCurrency: 'EUR', toCurrency: 'USD' }],
    });
  });
});

describe('getPayrollTotals — a non-USD reporting currency threads through settings', () => {
  it('uses settings.reportingCurrency as the org-wide target', async () => {
    // Reporting INR: the US total converts, India is already in R.
    const population: PayrollTotalsPopulation = {
      candidates: [person('IN', 830_000n, 'INR'), person('US', 10_000n, 'USD')],
      countries: [
        { countryCode: 'IN', countryName: 'India' },
        { countryCode: 'US', countryName: 'United States' },
      ],
      currencies: [currency('USD', 2), currency('INR', 2)],
    };
    const usdToInr: FxRateRow = {
      fromCurrency: 'USD',
      toCurrency: 'INR',
      rate: '83',
      rateNumerator: 8_300_000_000n,
      rateDenominator: 100_000_000n,
      pinnedOn: JUL_01,
    };

    const result = await getPayrollTotals(
      fakeDeps({ population, fxRates: [usdToInr], reportingCurrency: 'INR' }),
      AS_OF,
    );

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') return;
    // $100.00 -> ₹8300.00 (830000) + ₹8300.00 (830000) = ₹16600.00 (1660000).
    expect(result.totals.orgWide).toMatchObject({
      kind: 'answer',
      reportingCurrency: 'INR',
      total: { amountMinor: '1660000', currency: 'INR' },
      ratesUsed: [{ fromCurrency: 'USD', toCurrency: 'INR', rate: '83', pinnedOn: JUL_01 }],
    });
  });
});

describe('getPayrollTotals — totality (AD-20): any read throwing becomes unavailable', () => {
  it('answers unavailable when the population read throws', async () => {
    await expect(getPayrollTotals(fakeDeps({ throwOn: 'population' }), AS_OF)).resolves.toEqual({
      kind: 'unavailable',
    });
  });

  it('answers unavailable when the fx read throws', async () => {
    await expect(getPayrollTotals(fakeDeps({ throwOn: 'fx' }), AS_OF)).resolves.toEqual({
      kind: 'unavailable',
    });
  });

  it('answers unavailable when the settings read throws', async () => {
    await expect(getPayrollTotals(fakeDeps({ throwOn: 'settings' }), AS_OF)).resolves.toEqual({
      kind: 'unavailable',
    });
  });
});

describe('getPayrollTotals — determinism (Law 6 / AD-11)', () => {
  it('returns byte-identical payloads for the same data and asOf', async () => {
    const first = await getPayrollTotals(fakeDeps(), AS_OF);
    const second = await getPayrollTotals(fakeDeps(), AS_OF);

    expect(first).toEqual(second);
  });
});
