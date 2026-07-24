import { describe, expect, it } from 'vitest';

import { formatOverdueCsv } from '@/adapters/csv/format-overdue-csv';
import type { OverdueReport, OverdueRow } from '@/application/use-cases/overdue';
import type { CurrencyFormat } from '@/domain/money';
import type { OverduePeriod } from '@/domain/overdue';
import type { PlainDate } from '@/domain/plain-date';

// Test-first (Law 1 / AD-23): red before `src/adapters/csv/format-overdue-csv.ts` exists.
//
// The CAP-10 CSV serializer is PURE (no Date, no random, no I/O) and consumes 11-1's finalized
// `OverdueReport` UNMODIFIED. It RE-DERIVES no statistic (Law 2 / Law 8): every row's `effectiveFrom`
// and `salary`, and the `asOf`/`cutoff`/`period` receipts, all arrive computed. Money crosses through
// the ONE formatter (`formatMoney(fromBoundaryMoney(...))`) with the `CurrencyFormat` resolved by the
// row's own currency code (Law 4 / AD-4) — never a bare number, never a raw minor string; a currency
// that cannot format leaves that cell BLANK (fail closed). An absent (`null`) or empty report yields
// a header-only CSV. RFC 4180 quoting, formula-injection guard on the name, CRLF terminators.

const USD: CurrencyFormat = { code: 'USD', symbol: '$', minorUnitExponent: 2, groupingStyle: 'WESTERN' };
const INR: CurrencyFormat = { code: 'INR', symbol: '₹', minorUnitExponent: 2, groupingStyle: 'INDIAN' };
const CURRENCIES = [USD, INR];

const AS_OF: PlainDate = { year: 2026, month: 7, day: 16 };
const CUTOFF: PlainDate = { year: 2024, month: 7, day: 16 };
const PERIOD_24M: OverduePeriod = { kind: 'months', months: 24 };

const HEADER = 'Employee,Effective Date,Salary,As Of,Cutoff,Period';

function money(amountMinor: string, currency: string) {
  return { amountMinor, currency };
}

function lines(csv: string): readonly string[] {
  return csv.split('\r\n');
}

function report(rows: readonly OverdueRow[], period: OverduePeriod = PERIOD_24M): OverdueReport {
  return { asOf: AS_OF, cutoff: CUTOFF, period, rows };
}

const ROW_A: OverdueRow = {
  employeeId: 'emp-a',
  name: 'Ada Lovelace',
  effectiveFrom: { year: 2019, month: 3, day: 1 },
  salary: money('9000000', 'USD'),
};
const ROW_B: OverdueRow = {
  employeeId: 'emp-b',
  name: 'Grace Hopper',
  effectiveFrom: { year: 2024, month: 7, day: 10 },
  salary: money('8300000', 'INR'),
};

describe('formatOverdueCsv — header and header-only', () => {
  it('emits the header row for an absent (unavailable) report', () => {
    expect(lines(formatOverdueCsv(null, CURRENCIES))).toEqual([HEADER]);
  });

  it('emits header-only for an empty report (the zero state)', () => {
    expect(lines(formatOverdueCsv(report([]), CURRENCIES))).toEqual([HEADER]);
  });
});

describe('formatOverdueCsv — one row per overdue employee', () => {
  it('carries name, effective date, salary, and the asOf/cutoff/period provenance', () => {
    expect(lines(formatOverdueCsv(report([ROW_A, ROW_B]), CURRENCIES))).toEqual([
      HEADER,
      // The grouped salary carries a comma, so RFC 4180 requires the cell be quoted.
      'Ada Lovelace,2019-03-01,"$90,000 USD",2026-07-16,2024-07-16,24 months',
      'Grace Hopper,2024-07-10,"₹83,000 INR",2026-07-16,2024-07-16,24 months',
    ]);
  });

  it('renders the rows in the received order (oldest record first — the domain ordering)', () => {
    const csv = formatOverdueCsv(report([ROW_A, ROW_B]), CURRENCIES);
    const rows = lines(csv);
    expect(rows[1]?.startsWith('Ada Lovelace,')).toBe(true);
    expect(rows[2]?.startsWith('Grace Hopper,')).toBe(true);
  });

  it('carries a custom cutoff period in the Period column', () => {
    const custom: OverduePeriod = { kind: 'date', cutoff: { year: 2024, month: 1, day: 1 } };
    const csv = formatOverdueCsv(report([ROW_A], custom), CURRENCIES);
    expect(lines(csv)[1]?.endsWith(',custom cutoff')).toBe(true);
  });
});

describe('formatOverdueCsv — money fails closed to a blank cell', () => {
  it('leaves the salary blank when the currency is absent from the list', () => {
    const jpyRow: OverdueRow = {
      employeeId: 'emp-j',
      name: 'Jun',
      effectiveFrom: { year: 2020, month: 1, day: 1 },
      salary: money('500000', 'JPY'),
    };
    expect(lines(formatOverdueCsv(report([jpyRow]), CURRENCIES))[1]).toBe(
      'Jun,2020-01-01,,2026-07-16,2024-07-16,24 months',
    );
  });

  it('leaves the salary blank for a non-canonical amountMinor', () => {
    const badRow: OverdueRow = {
      employeeId: 'emp-x',
      name: 'Xavier',
      effectiveFrom: { year: 2020, month: 1, day: 1 },
      salary: money('not-a-number', 'USD'),
    };
    expect(lines(formatOverdueCsv(report([badRow]), CURRENCIES))[1]).toBe(
      'Xavier,2020-01-01,,2026-07-16,2024-07-16,24 months',
    );
  });
});

describe('formatOverdueCsv — RFC 4180 quoting and formula-injection defense', () => {
  it('quotes a name containing a comma and doubles an embedded quote', () => {
    const commaRow: OverdueRow = {
      employeeId: 'emp-c',
      name: 'Hopper, "Amazing" Grace',
      effectiveFrom: { year: 2020, month: 1, day: 1 },
      salary: money('100', 'USD'),
    };
    expect(lines(formatOverdueCsv(report([commaRow]), CURRENCIES))[1]).toBe(
      '"Hopper, ""Amazing"" Grace",2020-01-01,$1 USD,2026-07-16,2024-07-16,24 months',
    );
  });

  it('neutralizes a formula-lead name with an apostrophe prefix', () => {
    const formulaRow: OverdueRow = {
      employeeId: 'emp-f',
      name: '=SUM(A1:A9)',
      effectiveFrom: { year: 2020, month: 1, day: 1 },
      salary: money('100', 'USD'),
    };
    expect(lines(formatOverdueCsv(report([formulaRow]), CURRENCIES))[1]).toBe(
      "'=SUM(A1:A9),2020-01-01,$1 USD,2026-07-16,2024-07-16,24 months",
    );
  });

  it('terminates rows with CRLF', () => {
    const csv = formatOverdueCsv(report([ROW_A]), CURRENCIES);
    expect(csv).toContain('\r\n');
    expect(csv.split('\r\n')).toHaveLength(2);
  });
});
