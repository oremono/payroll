import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OVERDUE_PERIOD,
  overduePeriodToParam,
  resolveOverduePeriod,
} from '@/application/overdue-period';
import type { OverduePeriod } from '@/domain/overdue';

// Test-first (Law 1 / AD-23): red before `src/application/overdue-period.ts` exists.
//
// `resolveOverduePeriod` is the WHOLE delivery-boundary policy for the `?period=` search param, in
// one total function — the `resolveAsOf` discipline story 11-1 named as the residual risk this story
// must close. The pure core (`computeOverdue`) trusts an already-validated non-negative integer
// `months` or a parsed custom cutoff; everything hostile a URL can carry is answered HERE and never
// reaches the domain. A repeated param arrives as an array (Next / `URLSearchParams.getAll`).
//
// Clock-free (Law 6): the period is a pure function of the string alone — no `asOf`, no clock. The
// cutoff is derived inside the domain from the passed `asOf`; this module only decides which period
// VALUE the selection is.

describe('resolveOverduePeriod — the default', () => {
  it('is the 2-year (24-month) preset', () => {
    expect(DEFAULT_OVERDUE_PERIOD).toEqual({ kind: 'months', months: 24 });
  });

  it('falls back to the default when the param is absent', () => {
    expect(resolveOverduePeriod(undefined)).toEqual(DEFAULT_OVERDUE_PERIOD);
  });
});

describe('resolveOverduePeriod — the month presets', () => {
  it.each([
    ['1 year', '12m', 12],
    ['18 months', '18m', 18],
    ['2 years', '24m', 24],
    ['3 years', '36m', 36],
  ])('resolves the %s chip (%s) to a months period', (_name, param, months) => {
    expect(resolveOverduePeriod(param)).toEqual({ kind: 'months', months });
  });

  it('accepts any positive integer number of months, not only the four chips', () => {
    expect(resolveOverduePeriod('7m')).toEqual({ kind: 'months', months: 7 });
  });
});

describe('resolveOverduePeriod — a custom cutoff date', () => {
  it('resolves a canonical YYYY-MM-DD to a date period', () => {
    expect(resolveOverduePeriod('2024-07-16')).toEqual({
      kind: 'date',
      cutoff: { year: 2024, month: 7, day: 16 },
    });
  });

  it('resolves 29 Feb of a leap year (a real date) to a date period', () => {
    expect(resolveOverduePeriod('2024-02-29')).toEqual({
      kind: 'date',
      cutoff: { year: 2024, month: 2, day: 29 },
    });
  });
});

describe('resolveOverduePeriod — hostile input falls back to the default, never throws', () => {
  it.each([
    ['negative months', '-3m'],
    ['zero months', '0m'],
    ['fractional months', '1.5m'],
    ['a bare number with no suffix', '24'],
    ['a word', 'banana'],
    ['empty', ''],
    ['whitespace', '   '],
    ['a plausible but impossible date', '2023-02-29'],
    ['month 13', '2024-13-01'],
    ['an unsafe-integer month count', '99999999999999999999m'],
    ['a timestamp', '2024-07-16T00:00:00Z'],
  ])('falls back for %s', (_name, param) => {
    expect(() => resolveOverduePeriod(param)).not.toThrow();
    expect(resolveOverduePeriod(param)).toEqual(DEFAULT_OVERDUE_PERIOD);
  });

  // Next hands a page an ARRAY when a search param repeats (`?period=a&period=b`), and the client's
  // `URLSearchParams.getAll` always hands one. Exactly one value is a selection; zero and many are not.
  it('falls back for a repeated param — an ambiguous param is not a selection', () => {
    expect(resolveOverduePeriod(['12m', '36m'])).toEqual(DEFAULT_OVERDUE_PERIOD);
  });

  it('falls back for an empty list of values', () => {
    expect(resolveOverduePeriod([])).toEqual(DEFAULT_OVERDUE_PERIOD);
  });

  it('resolves a single-valued list, which is what URLSearchParams.getAll yields', () => {
    expect(resolveOverduePeriod(['18m'])).toEqual({ kind: 'months', months: 18 });
  });

  it('resolves a single-valued list holding a custom date', () => {
    expect(resolveOverduePeriod(['2024-07-16'])).toEqual({
      kind: 'date',
      cutoff: { year: 2024, month: 7, day: 16 },
    });
  });

  it('falls back for a single-valued list holding rubbish', () => {
    expect(resolveOverduePeriod(['banana'])).toEqual(DEFAULT_OVERDUE_PERIOD);
  });
});

describe('overduePeriodToParam — canonical URL form', () => {
  it('encodes a months period as `Nm`', () => {
    expect(overduePeriodToParam({ kind: 'months', months: 24 })).toBe('24m');
    expect(overduePeriodToParam({ kind: 'months', months: 18 })).toBe('18m');
  });

  it('encodes a custom cutoff as YYYY-MM-DD', () => {
    expect(overduePeriodToParam({ kind: 'date', cutoff: { year: 2024, month: 7, day: 16 } })).toBe(
      '2024-07-16',
    );
  });

  it('round-trips with the resolver for every preset', () => {
    for (const months of [12, 18, 24, 36]) {
      const period: OverduePeriod = { kind: 'months', months };
      expect(resolveOverduePeriod(overduePeriodToParam(period))).toEqual(period);
    }
  });

  it('round-trips with the resolver for a custom cutoff', () => {
    const period: OverduePeriod = { kind: 'date', cutoff: { year: 2024, month: 7, day: 16 } };
    expect(resolveOverduePeriod(overduePeriodToParam(period))).toEqual(period);
  });
});
