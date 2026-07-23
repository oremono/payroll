import { describe, expect, it } from 'vitest';

import type {
  SalaryTimelineRow,
  SalaryTimelineView,
} from '@/application/use-cases/salary-timeline';
import type { CurrencyFormat } from '@/domain/money';
import type { PlainDate } from '@/domain/plain-date';
import {
  buildSalaryTimeline,
  TIMELINE_CURRENCY_UNREADABLE_STATEMENT,
} from '@/ui/salary-timeline-vm';

// Test-first (Law 1 / AD-23): red before `src/ui/salary-timeline.ts` exists.
//
// Same split, and the same reason, as `salary-change-form.ts`: no jsdom, no @testing-library, and
// `src/ui/*.tsx` sits outside the coverage gate. Every judgement the timeline surface makes — the
// per-row money and date formatting, the row-over-row percent, the `(Hire)` marker, and the
// fail-closed `withheld` — lives in the PURE module tested here, so `salary-timeline.tsx` is left
// with markup and nothing to get wrong.
//
// ## It consumes story 5-1's fixed payload and adds nothing to the contract (Law 7 / AD-24)
//
// `SalaryTimelineView` arrives NEWEST-FIRST; the builder preserves that order, resolves each row's
// `CurrencyFormat` by the row's OWN `salary.currency` (never from a country, never converted —
// AD-6), and derives the percent-change and `(Hire)` marker at build time (DR9), never storing them.

const INR: CurrencyFormat = {
  code: 'INR',
  symbol: '₹',
  minorUnitExponent: 2,
  groupingStyle: 'INDIAN',
};

// The anti-hard-coded-100 currency (Law 4 / AD-4): JPY has no minor unit at all.
const JPY: CurrencyFormat = {
  code: 'JPY',
  symbol: '¥',
  minorUnitExponent: 0,
  groupingStyle: 'WESTERN',
};

function date(year: number, month: number, day: number): PlainDate {
  return { year, month, day };
}

function row(
  id: string,
  effectiveFrom: PlainDate,
  amountMinor: string,
  currency = 'INR',
): SalaryTimelineRow {
  return { id, effectiveFrom, salary: { amountMinor, currency } };
}

function view(records: readonly SalaryTimelineRow[]): SalaryTimelineView {
  return {
    employeeId: 'emp-1',
    asOf: date(2026, 7, 16),
    records,
    // The head is the current record by the 5-1 contract; `null` for an empty history.
    currentSalaryRecordId: records[0]?.id ?? null,
  };
}

describe('buildSalaryTimeline', () => {
  it('preserves newest-first order and marks the oldest row as the hire', () => {
    // (1091000 − 1000000) / 1000000 = +9.1% → +9%; (1220000 − 1091000) / 1091000 = +11.8% → +12%.
    const result = buildSalaryTimeline(
      view([
        row('r3', date(2026, 1, 1), '1220000'),
        row('r2', date(2025, 1, 1), '1091000'),
        row('r1', date(2024, 1, 1), '1000000'),
      ]),
      [INR],
    );

    expect(result).toEqual({
      kind: 'timeline',
      rows: [
        {
          id: 'r3',
          date: { iso: '2026-01-01', label: '01 Jan 2026' },
          amountText: '₹12,200 INR',
          marker: { kind: 'change', percentText: '+12%' },
        },
        {
          id: 'r2',
          date: { iso: '2025-01-01', label: '01 Jan 2025' },
          amountText: '₹10,910 INR',
          marker: { kind: 'change', percentText: '+9%' },
        },
        {
          id: 'r1',
          date: { iso: '2024-01-01', label: '01 Jan 2024' },
          amountText: '₹10,000 INR',
          marker: { kind: 'hire' },
        },
      ],
    });
  });

  it('formats an increase as +N%', () => {
    const result = buildSalaryTimeline(
      view([row('r2', date(2026, 1, 1), '110000'), row('r1', date(2025, 1, 1), '100000')]),
      [INR],
    );

    expect(result.kind === 'timeline' && result.rows[0]?.marker).toEqual({
      kind: 'change',
      percentText: '+10%',
    });
  });

  it('formats a decrease as -N% with the sign carrying direction', () => {
    const result = buildSalaryTimeline(
      view([row('r2', date(2026, 1, 1), '90000'), row('r1', date(2025, 1, 1), '100000')]),
      [INR],
    );

    expect(result.kind === 'timeline' && result.rows[0]?.marker).toEqual({
      kind: 'change',
      percentText: '-10%',
    });
  });

  it('formats no change as 0%', () => {
    const result = buildSalaryTimeline(
      view([row('r2', date(2026, 1, 1), '100000'), row('r1', date(2025, 1, 1), '100000')]),
      [INR],
    );

    expect(result.kind === 'timeline' && result.rows[0]?.marker).toEqual({
      kind: 'change',
      percentText: '0%',
    });
  });

  it('rounds the percent magnitude half-up to an integer (positive)', () => {
    // (112500 − 100000) / 100000 = +12.5% → +13% (half-up, away from zero).
    const result = buildSalaryTimeline(
      view([row('r2', date(2026, 1, 1), '112500'), row('r1', date(2025, 1, 1), '100000')]),
      [INR],
    );

    expect(result.kind === 'timeline' && result.rows[0]?.marker).toEqual({
      kind: 'change',
      percentText: '+13%',
    });
  });

  it('rounds the percent magnitude half-up then reapplies the sign (negative)', () => {
    // (95500 − 100000) / 100000 = −4.5% → −5% (magnitude rounded away from zero, sign reapplied).
    const result = buildSalaryTimeline(
      view([row('r2', date(2026, 1, 1), '95500'), row('r1', date(2025, 1, 1), '100000')]),
      [INR],
    );

    expect(result.kind === 'timeline' && result.rows[0]?.marker).toEqual({
      kind: 'change',
      percentText: '-5%',
    });
  });

  it('marks a single record as the hire with no percent chip', () => {
    const result = buildSalaryTimeline(view([row('r1', date(2024, 6, 1), '1000000')]), [INR]);

    expect(result).toEqual({
      kind: 'timeline',
      rows: [
        {
          id: 'r1',
          date: { iso: '2024-06-01', label: '01 Jun 2024' },
          amountText: '₹10,000 INR',
          marker: { kind: 'hire' },
        },
      ],
    });
  });

  it('returns an empty timeline (not withheld) for an employee with no records', () => {
    expect(buildSalaryTimeline(view([]), [INR])).toEqual({ kind: 'timeline', rows: [] });
  });

  it('shows both rows and a normal percent for a same-day correction', () => {
    // Two records share their effective date; the percent is computed between them normally.
    const result = buildSalaryTimeline(
      view([
        row('r2', date(2026, 7, 16), '110000'),
        row('r1', date(2026, 7, 16), '100000'),
      ]),
      [INR],
    );

    expect(result).toEqual({
      kind: 'timeline',
      rows: [
        {
          id: 'r2',
          date: { iso: '2026-07-16', label: '16 Jul 2026' },
          amountText: '₹1,100 INR',
          marker: { kind: 'change', percentText: '+10%' },
        },
        {
          id: 'r1',
          date: { iso: '2026-07-16', label: '16 Jul 2026' },
          amountText: '₹1,000 INR',
          marker: { kind: 'hire' },
        },
      ],
    });
  });

  it('formats a zero-exponent currency without a hard-coded 100 (Law 4)', () => {
    const result = buildSalaryTimeline(view([row('r1', date(2024, 1, 1), '500000', 'JPY')]), [JPY]);

    expect(result.kind === 'timeline' && result.rows[0]?.amountText).toBe('¥500,000 JPY');
  });

  it('withholds the whole timeline when a row currency is absent from the reference list', () => {
    const result = buildSalaryTimeline(view([row('r1', date(2024, 1, 1), '1000000', 'USD')]), [
      INR,
    ]);

    expect(result).toEqual({
      kind: 'withheld',
      statement: TIMELINE_CURRENCY_UNREADABLE_STATEMENT,
    });
  });

  it('withholds when a row currency has an unsupported exponent', () => {
    const unusable: CurrencyFormat = { ...INR, minorUnitExponent: 5 };
    const result = buildSalaryTimeline(view([row('r1', date(2024, 1, 1), '1000000')]), [unusable]);

    expect(result).toEqual({
      kind: 'withheld',
      statement: TIMELINE_CURRENCY_UNREADABLE_STATEMENT,
    });
  });

  it('withholds when an amount is not a canonical minor-unit string (no bare number shown)', () => {
    const result = buildSalaryTimeline(view([row('r1', date(2024, 1, 1), '01')]), [INR]);

    expect(result).toEqual({
      kind: 'withheld',
      statement: TIMELINE_CURRENCY_UNREADABLE_STATEMENT,
    });
  });

  it('derives +N% / -N% across a multi-row timeline that both rises and falls', () => {
    // A raise then a cut, newest-first: r3 (900k) vs r2 (1000k) = −10%; r2 vs r1 (800k) = +25%.
    const result = buildSalaryTimeline(
      view([
        row('r3', date(2026, 1, 1), '900000'),
        row('r2', date(2025, 1, 1), '1000000'),
        row('r1', date(2024, 1, 1), '800000'),
      ]),
      [INR],
    );

    expect(result.kind === 'timeline' && result.rows.map((r) => r.marker)).toEqual([
      { kind: 'change', percentText: '-10%' },
      { kind: 'change', percentText: '+25%' },
      { kind: 'hire' },
    ]);
  });

  it('derives the percent for a zero-exponent currency (exponent-independent, Law 4)', () => {
    // JPY has no minor unit: 5,500,000 vs 5,000,000 = +10%, computed on the raw minor units all the same.
    const result = buildSalaryTimeline(
      view([
        row('r2', date(2026, 1, 1), '5500000', 'JPY'),
        row('r1', date(2025, 1, 1), '5000000', 'JPY'),
      ]),
      [JPY],
    );

    expect(result.kind === 'timeline' && result.rows[0]).toEqual({
      id: 'r2',
      date: { iso: '2026-01-01', label: '01 Jan 2026' },
      amountText: '¥5,500,000 JPY',
      marker: { kind: 'change', percentText: '+10%' },
    });
  });

  it('withholds when two adjacent rows are in different (both-resolvable) currencies', () => {
    // No FX conversion at read time (AD-6): a percent across two currencies is not a real figure, so
    // even though BOTH formats are present, the whole timeline fails closed rather than print one.
    const result = buildSalaryTimeline(
      view([
        row('r2', date(2026, 1, 1), '5000000', 'JPY'),
        row('r1', date(2024, 1, 1), '100000', 'INR'),
      ]),
      [INR, JPY],
    );

    expect(result).toEqual({
      kind: 'withheld',
      statement: TIMELINE_CURRENCY_UNREADABLE_STATEMENT,
    });
  });

  it('withholds the WHOLE timeline when only one of several rows is unreadable', () => {
    // A defensive mixed-currency history fails closed rather than showing some rows and hiding one.
    const result = buildSalaryTimeline(
      view([
        row('r2', date(2026, 1, 1), '1100000', 'INR'),
        row('r1', date(2024, 1, 1), '1000000', 'USD'),
      ]),
      [INR],
    );

    expect(result.kind).toBe('withheld');
  });

  it('is deterministic — same input yields the same output', () => {
    const records = [
      row('r2', date(2026, 1, 1), '1100000'),
      row('r1', date(2024, 1, 1), '1000000'),
    ];

    expect(buildSalaryTimeline(view(records), [INR])).toEqual(
      buildSalaryTimeline(view(records), [INR]),
    );
  });
});
