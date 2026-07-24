import { describe, expect, it } from 'vitest';

import { formatPayrollTotalsCsv } from '@/adapters/csv/format-payroll-totals-csv';
import type { PayrollTotals } from '@/application/use-cases/payroll-totals';
import type { CurrencyFormat } from '@/domain/money';
import type { PlainDate } from '@/domain/plain-date';

// Test-first (Law 1 / AD-23): red before `src/adapters/csv/format-payroll-totals-csv.ts` exists.
//
// The CSV serializer is PURE (no Date, no random, no I/O) and consumes 10-1's finalized payload
// UNMODIFIED. It RE-DERIVES no statistic (Law 2 / Law 8): `n`, per-country `total`, the org-wide
// `total`, `ratesUsed`, and `pinnedOn` all arrive computed. Money crosses through the ONE formatter
// (`formatMoney(fromBoundaryMoney(...))`) with the `CurrencyFormat` resolved by the row's own
// currency code (Law 4 / AD-4) — never a bare number, never a raw minor string; a currency that
// cannot format leaves that money cell BLANK (fail closed). An absent (`null`) payload — the
// `unavailable` arm — yields a header-only CSV.

const USD: CurrencyFormat = { code: 'USD', symbol: '$', minorUnitExponent: 2, groupingStyle: 'WESTERN' };
const INR: CurrencyFormat = { code: 'INR', symbol: '₹', minorUnitExponent: 2, groupingStyle: 'INDIAN' };
const CURRENCIES = [USD, INR];

const AS_OF: PlainDate = { year: 2026, month: 7, day: 16 };
const PINNED: PlainDate = { year: 2026, month: 7, day: 1 };

const HEADER = 'Country,Currency,Headcount,Annual Payroll Total,FX Rate,Rate Pinned On,As Of';

function money(amountMinor: string, currency: string) {
  return { amountMinor, currency };
}

function lines(csv: string): readonly string[] {
  return csv.split('\r\n');
}

const IN_ROW = {
  countryCode: 'IN',
  countryName: 'India',
  currency: 'INR',
  n: 2,
  total: money('830000', 'INR'),
};
const US_ROW = {
  countryCode: 'US',
  countryName: 'United States',
  currency: 'USD',
  n: 1,
  total: money('10000', 'USD'),
};

describe('formatPayrollTotalsCsv — header and header-only', () => {
  it('emits the header row for an absent (unavailable) payload', () => {
    expect(lines(formatPayrollTotalsCsv(null, CURRENCIES))).toEqual([HEADER]);
  });
});

describe('formatPayrollTotalsCsv — one row per country plus an org-wide summary (converted)', () => {
  it('carries currency, headcount, local total, the FX rate applied, its pinned date, and the as-of', () => {
    const totals: PayrollTotals = {
      asOf: AS_OF,
      perCountry: [IN_ROW, US_ROW],
      orgWide: {
        kind: 'answer',
        reportingCurrency: 'USD',
        total: money('19960', 'USD'),
        ratesUsed: [{ fromCurrency: 'INR', toCurrency: 'USD', rate: '0.012', pinnedOn: PINNED }],
        pinnedOn: PINNED,
      },
    };

    expect(lines(formatPayrollTotalsCsv(totals, CURRENCIES))).toEqual([
      HEADER,
      // India: converted, so it carries the INR→USD rate + its pinned date.
      'India,INR,2,"₹8,300 INR",0.012,2026-07-01,2026-07-16',
      // United States: already the reporting currency — no rate, blank FX/pinned cells.
      'United States,USD,1,$100 USD,,,2026-07-16',
      // Org-wide summary: the converted total in the reporting currency, its set date, blank headcount.
      'Org-wide,USD,,$199.60 USD,,2026-07-01,2026-07-16',
    ]);
  });
});

describe('formatPayrollTotalsCsv — no conversion needed', () => {
  it('leaves every FX cell blank and summarizes the plain sum', () => {
    const totals: PayrollTotals = {
      asOf: AS_OF,
      perCountry: [US_ROW],
      orgWide: {
        kind: 'answer',
        reportingCurrency: 'USD',
        total: money('10000', 'USD'),
        ratesUsed: [],
        pinnedOn: null,
      },
    };

    expect(lines(formatPayrollTotalsCsv(totals, CURRENCIES))).toEqual([
      HEADER,
      'United States,USD,1,$100 USD,,,2026-07-16',
      'Org-wide,USD,,$100 USD,,,2026-07-16',
    ]);
  });
});

describe('formatPayrollTotalsCsv — the org-wide refusal is data, not an error', () => {
  it('summarizes no-rate-set with per-country rows still fully present and blank FX cells', () => {
    const totals: PayrollTotals = {
      asOf: AS_OF,
      perCountry: [IN_ROW, US_ROW],
      orgWide: {
        kind: 'refusal',
        reason: 'no-rate-set',
        reportingCurrency: 'USD',
        asOf: AS_OF,
        pinnedOn: null,
        missingPairs: [],
      },
    };

    expect(lines(formatPayrollTotalsCsv(totals, CURRENCIES))).toEqual([
      HEADER,
      // No ratesUsed on a refusal, so both per-country FX cells are blank.
      'India,INR,2,"₹8,300 INR",,,2026-07-16',
      'United States,USD,1,$100 USD,,,2026-07-16',
      'Org-wide,USD,,Unavailable — no rate set as of 2026-07-16,,,2026-07-16',
    ]);
  });

  it('names the missing pair(s) and the set date for missing-rate', () => {
    const totals: PayrollTotals = {
      asOf: AS_OF,
      perCountry: [IN_ROW],
      orgWide: {
        kind: 'refusal',
        reason: 'missing-rate',
        reportingCurrency: 'USD',
        asOf: AS_OF,
        pinnedOn: PINNED,
        missingPairs: [{ fromCurrency: 'INR', toCurrency: 'USD' }],
      },
    };

    const rows = lines(formatPayrollTotalsCsv(totals, CURRENCIES));
    expect(rows[rows.length - 1]).toBe(
      'Org-wide,USD,,Unavailable — missing rate INR→USD,,2026-07-01,2026-07-16',
    );
  });
});

describe('formatPayrollTotalsCsv — money fails closed (Law 4 / AD-4)', () => {
  it('leaves a per-country total blank when its currency cannot be resolved, never a raw minor string', () => {
    const totals: PayrollTotals = {
      asOf: AS_OF,
      perCountry: [IN_ROW],
      orgWide: {
        kind: 'answer',
        reportingCurrency: 'USD',
        total: money('9960', 'USD'),
        ratesUsed: [{ fromCurrency: 'INR', toCurrency: 'USD', rate: '0.012', pinnedOn: PINNED }],
        pinnedOn: PINNED,
      },
    };

    // Only USD is known — the INR total cell is blank, not "830000".
    const csv = formatPayrollTotalsCsv(totals, [USD]);
    expect(csv).not.toContain('830000');
    expect(lines(csv)[1]).toBe('India,INR,2,,0.012,2026-07-01,2026-07-16');
  });
});

describe('formatPayrollTotalsCsv — quoting and formula-guard (RFC 4180 / injection defense)', () => {
  it('quotes a comma-bearing country name and neutralizes a formula-lead country name', () => {
    const totals: PayrollTotals = {
      asOf: AS_OF,
      perCountry: [
        { countryCode: 'XA', countryName: '=CMD()', currency: 'USD', n: 1, total: money('10000', 'USD') },
        { countryCode: 'XB', countryName: 'Bonaire, Sint Eustatius', currency: 'USD', n: 1, total: money('10000', 'USD') },
      ],
      orgWide: {
        kind: 'answer',
        reportingCurrency: 'USD',
        total: money('20000', 'USD'),
        ratesUsed: [],
        pinnedOn: null,
      },
    };
    const csv = formatPayrollTotalsCsv(totals, CURRENCIES);

    // The formula-lead name is apostrophe-prefixed; the comma-bearing name is RFC-quoted.
    expect(csv).toContain(`'=CMD()`);
    expect(csv).not.toContain('\n=CMD()');
    expect(csv).toContain('"Bonaire, Sint Eustatius"');
  });
});

describe('formatPayrollTotalsCsv — determinism (Law 6)', () => {
  it('is byte-identical across runs for the same payload', () => {
    const totals: PayrollTotals = {
      asOf: AS_OF,
      perCountry: [IN_ROW, US_ROW],
      orgWide: {
        kind: 'answer',
        reportingCurrency: 'USD',
        total: money('19960', 'USD'),
        ratesUsed: [{ fromCurrency: 'INR', toCurrency: 'USD', rate: '0.012', pinnedOn: PINNED }],
        pinnedOn: PINNED,
      },
    };
    expect(formatPayrollTotalsCsv(totals, CURRENCIES)).toBe(formatPayrollTotalsCsv(totals, CURRENCIES));
  });
});
