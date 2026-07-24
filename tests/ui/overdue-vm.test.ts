import { describe, expect, it } from 'vitest';

import type { GetOverdueResult, OverdueReport, OverdueRow } from '@/application/use-cases/overdue';
import type { CurrencyFormat } from '@/domain/money';
import type { OverduePeriod } from '@/domain/overdue';
import type { PlainDate } from '@/domain/plain-date';
import {
  buildOverdue,
  buildOverdueSummary,
  formatOverduePeriodLabel,
  OVERDUE_PAGE_SIZE,
  OVERDUE_UNAVAILABLE_HEADING,
  OVERDUE_UNAVAILABLE_STATEMENT,
  OVERDUE_ZERO_STATE,
  PERIOD_PRESETS,
} from '@/ui/overdue-vm';

// Test-first (Law 1 / AD-23): red before `src/ui/overdue-vm.ts` exists.
//
// The CAP-10 overdue surface's VM/markup split — the same one `payroll-totals-vm.ts` makes, and the
// same reason: no jsdom, no @testing-library, and `src/ui/*.tsx` sits outside the coverage gate.
// Every judgement — arm selection, per-row salary through the ONE money formatter (fail CLOSED to
// `null`), the in-memory pagination slice + clamp + status line, the `asOf`/`cutoff`/period-label
// receipts, and Home's compact count — lives in this PURE builder and is proven here.
//
// It consumes story 11-1's finalized `GetOverdueResult` UNMODIFIED (Law 7 / AD-24). The builder
// RE-DERIVES no statistic: the count is `report.rows.length`, each row's fields arrive computed, and
// the rows are rendered in the received order (oldest record first). No `Date`, no clock, no I/O.

const USD: CurrencyFormat = { code: 'USD', symbol: '$', minorUnitExponent: 2, groupingStyle: 'WESTERN' };
const INR: CurrencyFormat = { code: 'INR', symbol: '₹', minorUnitExponent: 2, groupingStyle: 'INDIAN' };
const CURRENCIES = [USD, INR];

const AS_OF: PlainDate = { year: 2026, month: 7, day: 16 };
const CUTOFF: PlainDate = { year: 2024, month: 7, day: 16 };
const PERIOD_24M: OverduePeriod = { kind: 'months', months: 24 };

function money(amountMinor: string, currency: string) {
  return { amountMinor, currency };
}

function row(
  employeeId: string,
  name: string,
  effectiveFrom: PlainDate,
  salary: { amountMinor: string; currency: string },
): OverdueRow {
  return { employeeId, name, effectiveFrom, salary };
}

function answer(
  rows: readonly OverdueRow[],
  period: OverduePeriod = PERIOD_24M,
  asOf: PlainDate = AS_OF,
  cutoff: PlainDate = CUTOFF,
): GetOverdueResult {
  const report: OverdueReport = { asOf, cutoff, period, rows };
  return { kind: 'answer', report };
}

const ROW_A = row('emp-a', 'Ada Lovelace', { year: 2019, month: 3, day: 1 }, money('9000000', 'USD'));
const ROW_B = row('emp-b', 'Grace Hopper', { year: 2024, month: 7, day: 10 }, money('8300000', 'INR'));

describe('buildOverdue — the unavailable arm', () => {
  it('returns the shared calm heading/statement (never role="alert")', () => {
    const vm = buildOverdue({ kind: 'unavailable' }, CURRENCIES, 1);
    expect(vm).toEqual({
      kind: 'unavailable',
      heading: OVERDUE_UNAVAILABLE_HEADING,
      statement: OVERDUE_UNAVAILABLE_STATEMENT,
    });
  });
});

describe('buildOverdue — an answer with rows', () => {
  it('formats each row (name, effective date, salary) in the received order', () => {
    const vm = buildOverdue(answer([ROW_A, ROW_B]), CURRENCIES, 1);
    expect(vm.kind).toBe('answer');
    if (vm.kind !== 'answer') return;
    expect(vm.rows).toEqual([
      {
        employeeId: 'emp-a',
        name: 'Ada Lovelace',
        effectiveFrom: '01 Mar 2019',
        effectiveFromIso: '2019-03-01',
        salary: '$90,000 USD',
      },
      {
        employeeId: 'emp-b',
        name: 'Grace Hopper',
        effectiveFrom: '10 Jul 2024',
        effectiveFromIso: '2024-07-10',
        salary: '₹83,000 INR',
      },
    ]);
  });

  it('counts exactly report.rows.length and states it as of the as-of date', () => {
    const vm = buildOverdue(answer([ROW_A, ROW_B]), CURRENCIES, 1);
    if (vm.kind !== 'answer') throw new Error('expected answer');
    expect(vm.count).toBe(2);
    expect(vm.countStatement).toBe('2 people overdue as of 16 Jul 2026');
  });

  it('pluralizes a single overdue person', () => {
    const vm = buildOverdue(answer([ROW_A]), CURRENCIES, 1);
    if (vm.kind !== 'answer') throw new Error('expected answer');
    expect(vm.countStatement).toBe('1 person overdue as of 16 Jul 2026');
  });

  it('carries the asOf / cutoff / period-label receipts', () => {
    const vm = buildOverdue(answer([ROW_A, ROW_B]), CURRENCIES, 1);
    if (vm.kind !== 'answer') throw new Error('expected answer');
    expect(vm.asOf).toBe('16 Jul 2026');
    expect(vm.cutoff).toBe('16 Jul 2024');
    expect(vm.periodLabel).toBe('2 years');
  });

  it('reports a single full page in the status line', () => {
    const vm = buildOverdue(answer([ROW_A, ROW_B]), CURRENCIES, 1);
    if (vm.kind !== 'answer') throw new Error('expected answer');
    expect(vm.statusLine).toBe('Overdue 1–2 of 2 · Page 1 of 1');
    expect(vm.pageNumber).toBe(1);
    expect(vm.pageCount).toBe(1);
    expect(vm.hasPrevious).toBe(false);
    expect(vm.hasNext).toBe(false);
  });
});

describe('buildOverdue — money fails closed', () => {
  it('withholds a salary whose currency is absent from the list', () => {
    const jpyRow = row('emp-j', 'Jun', { year: 2020, month: 1, day: 1 }, money('500000', 'JPY'));
    const vm = buildOverdue(answer([jpyRow]), CURRENCIES, 1);
    if (vm.kind !== 'answer') throw new Error('expected answer');
    expect(vm.rows[0]?.salary).toBeNull();
  });

  it('withholds a salary whose amountMinor is not a canonical minor-unit string', () => {
    const badRow = row('emp-x', 'Xavier', { year: 2020, month: 1, day: 1 }, money('not-a-number', 'USD'));
    const vm = buildOverdue(answer([badRow]), CURRENCIES, 1);
    if (vm.kind !== 'answer') throw new Error('expected answer');
    expect(vm.rows[0]?.salary).toBeNull();
  });
});

describe('buildOverdue — the zero state', () => {
  it('returns the calm empty arm with receipts, not an answer with no rows', () => {
    const vm = buildOverdue(answer([]), CURRENCIES, 1);
    expect(vm).toEqual({
      kind: 'empty',
      statement: OVERDUE_ZERO_STATE,
      asOf: '16 Jul 2026',
      cutoff: '16 Jul 2024',
      periodLabel: '2 years',
    });
  });
});

describe('buildOverdue — in-memory pagination', () => {
  const MANY: readonly OverdueRow[] = Array.from({ length: 30 }, (_unused, index) =>
    row(
      `emp-${String(index).padStart(2, '0')}`,
      `Person ${index}`,
      { year: 2024, month: 1, day: 1 },
      money('1000', 'USD'),
    ),
  );

  it('page size is 25', () => {
    expect(OVERDUE_PAGE_SIZE).toBe(25);
  });

  it('slices page 1 to the first 25 rows', () => {
    const vm = buildOverdue(answer(MANY), CURRENCIES, 1);
    if (vm.kind !== 'answer') throw new Error('expected answer');
    expect(vm.rows).toHaveLength(25);
    expect(vm.rows[0]?.employeeId).toBe('emp-00');
    expect(vm.statusLine).toBe('Overdue 1–25 of 30 · Page 1 of 2');
    expect(vm.hasPrevious).toBe(false);
    expect(vm.hasNext).toBe(true);
  });

  it('slices page 2 to the remaining 5 rows', () => {
    const vm = buildOverdue(answer(MANY), CURRENCIES, 2);
    if (vm.kind !== 'answer') throw new Error('expected answer');
    expect(vm.rows).toHaveLength(5);
    expect(vm.rows[0]?.employeeId).toBe('emp-25');
    expect(vm.statusLine).toBe('Overdue 26–30 of 30 · Page 2 of 2');
    expect(vm.pageNumber).toBe(2);
    expect(vm.hasPrevious).toBe(true);
    expect(vm.hasNext).toBe(false);
  });

  it('clamps a page past the end to the effective last page, not the requested number', () => {
    const vm = buildOverdue(answer(MANY), CURRENCIES, 99);
    if (vm.kind !== 'answer') throw new Error('expected answer');
    expect(vm.pageNumber).toBe(2);
    expect(vm.rows[0]?.employeeId).toBe('emp-25');
    expect(vm.statusLine).toBe('Overdue 26–30 of 30 · Page 2 of 2');
  });

  it('clamps a non-positive or non-integer requested page to page 1', () => {
    for (const requested of [0, -5, 1.5, Number.NaN]) {
      const vm = buildOverdue(answer(MANY), CURRENCIES, requested);
      if (vm.kind !== 'answer') throw new Error('expected answer');
      expect(vm.pageNumber).toBe(1);
    }
  });
});

describe('formatOverduePeriodLabel', () => {
  it.each([
    [12, '1 year'],
    [18, '18 months'],
    [24, '2 years'],
    [36, '3 years'],
  ])('labels the %d-month preset as %s', (months, label) => {
    expect(formatOverduePeriodLabel({ kind: 'months', months })).toBe(label);
  });

  it('labels a non-preset month count in months', () => {
    expect(formatOverduePeriodLabel({ kind: 'months', months: 7 })).toBe('7 months');
  });

  it('labels a custom cutoff as its display date', () => {
    expect(formatOverduePeriodLabel({ kind: 'date', cutoff: { year: 2024, month: 7, day: 16 } })).toBe(
      '16 Jul 2024',
    );
  });

  it('exposes the four preset chips in order', () => {
    expect(PERIOD_PRESETS.map((preset) => preset.months)).toEqual([12, 18, 24, 36]);
  });
});

describe('buildOverdueSummary — the Home compact count', () => {
  it('counts report.rows.length and states it as of the as-of date', () => {
    const vm = buildOverdueSummary(answer([ROW_A, ROW_B]));
    expect(vm).toEqual({
      kind: 'count',
      count: 2,
      statement: '2 people overdue as of 16 Jul 2026',
    });
  });

  it('states a zero count calmly, still naming the as-of date', () => {
    const vm = buildOverdueSummary(answer([]));
    expect(vm).toEqual({
      kind: 'count',
      count: 0,
      statement: '0 people overdue as of 16 Jul 2026',
    });
  });

  it('returns the shared calm region on unavailable', () => {
    const vm = buildOverdueSummary({ kind: 'unavailable' });
    expect(vm).toEqual({
      kind: 'unavailable',
      heading: OVERDUE_UNAVAILABLE_HEADING,
      statement: OVERDUE_UNAVAILABLE_STATEMENT,
    });
  });
});
