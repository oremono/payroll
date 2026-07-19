import { describe, expect, it } from 'vitest';

import {
  comparePlainDate,
  formatPlainDate,
  parsePlainDate,
  plainDateToIso,
  type PlainDate,
} from '@/domain/plain-date';

// Test-first (Law 1 / AD-23): this spec lands, red, before `src/domain/plain-date.ts` exists.
//
// It mirrors the story's I/O & Edge-Case Matrix row for row and then adds the boundary cases the
// matrix implies but does not enumerate — the first and last month, the first and last day of a
// month, every 30-day month, all three leap-year rules, and the shape rejections that the ISO
// pattern is the only thing standing between us and a `NaN` date. Those extras are not padding:
// the domain gate is 100% MUTATION score, not 100% coverage, so each one is the only test that can
// kill a specific mutant (a moved boundary, a flipped `||`, an unanchored pattern).
//
// The as-of date is a plain-date VALUE OBJECT, never a JS `Date` and never a timestamp (Law 6 /
// AD-11) — which is why every case below is expressed as `{year, month, day}` and a string, and why
// no test in this file reads a clock.

const JUL_16_2026: PlainDate = { year: 2026, month: 7, day: 16 };

describe('parsePlainDate', () => {
  it('parses a well-formed ISO calendar date', () => {
    expect(parsePlainDate('2026-07-16')).toEqual(JUL_16_2026);
  });

  it('parses the first day of a month, zero-padded', () => {
    expect(parsePlainDate('2026-07-01')).toEqual({ year: 2026, month: 7, day: 1 });
  });

  it('parses January — the first valid month', () => {
    expect(parsePlainDate('2026-01-15')).toEqual({ year: 2026, month: 1, day: 15 });
  });

  it('parses December — the last valid month', () => {
    expect(parsePlainDate('2026-12-25')).toEqual({ year: 2026, month: 12, day: 25 });
  });

  it('accepts the 31st in a 31-day month', () => {
    expect(parsePlainDate('2026-01-31')).toEqual({ year: 2026, month: 1, day: 31 });
  });

  it('parses a year below 1000 without losing its leading zeros', () => {
    expect(parsePlainDate('0012-01-02')).toEqual({ year: 12, month: 1, day: 2 });
  });

  it('rejects month 00 — a month is 1-based', () => {
    expect(parsePlainDate('2026-00-10')).toBeNull();
  });

  it('rejects month 13', () => {
    expect(parsePlainDate('2026-13-01')).toBeNull();
  });

  it('rejects day 00', () => {
    expect(parsePlainDate('2026-07-00')).toBeNull();
  });

  it('rejects 30 February — an impossible calendar date, not merely an out-of-range number', () => {
    expect(parsePlainDate('2026-02-30')).toBeNull();
  });

  it.each([
    ['April', '2026-04-30', '2026-04-31'],
    ['June', '2026-06-30', '2026-06-31'],
    ['September', '2026-09-30', '2026-09-31'],
    ['November', '2026-11-30', '2026-11-31'],
  ])('accepts the 30th but rejects the 31st in %s', (_month, thirtieth, thirtyFirst) => {
    expect(parsePlainDate(thirtieth)).not.toBeNull();
    expect(parsePlainDate(thirtyFirst)).toBeNull();
  });

  it('accepts 29 February in a year divisible by 4', () => {
    expect(parsePlainDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
  });

  it('accepts 29 February in a year divisible by 400 — the century that IS a leap year', () => {
    expect(parsePlainDate('2000-02-29')).toEqual({ year: 2000, month: 2, day: 29 });
  });

  it('rejects 29 February in a century year not divisible by 400', () => {
    expect(parsePlainDate('1900-02-29')).toBeNull();
  });

  it('rejects 29 February in a common year', () => {
    expect(parsePlainDate('2026-02-29')).toBeNull();
  });

  it('accepts 28 February in a common year — the boundary the leap rule moves', () => {
    expect(parsePlainDate('2026-02-28')).toEqual({ year: 2026, month: 2, day: 28 });
  });

  // Shape rejections. Every one of these is a string a URL can carry, and the parser is TOTAL:
  // a malformed input is a `null` return, never an exception (Law: domain functions never throw).
  it.each([
    ['day-first', '12-05-2026'],
    ['unpadded month', '2026-5-12'],
    ['a timestamp, not a date', '2026-05-12T00:00:00Z'],
    ['empty', ''],
    ['a word', 'tomorrow'],
    ['slash separators', '2026/07/16'],
    ['no separators', '20260716'],
    ['a short day', '2026-07-1'],
    ['an over-long month', '2026-007-16'],
    ['an over-long year', '20261-07-16'],
    ['a short year', '202-07-16'],
    ['leading whitespace', ' 2026-07-16'],
    ['trailing whitespace', '2026-07-16 '],
    ['a prefix before the date', 'x2026-07-16'],
    ['a suffix after the date', '2026-07-16x'],
    ['letters in the year', 'abcd-07-16'],
    ['letters in the month', '2026-ab-16'],
    ['letters in the day', '2026-07-ab'],
  ])('returns null for %s', (_name, input) => {
    expect(parsePlainDate(input)).toBeNull();
  });
});

describe('formatPlainDate', () => {
  it('renders a zero-padded day, a three-letter month, and a four-digit year', () => {
    expect(formatPlainDate(JUL_16_2026)).toBe('16 Jul 2026');
  });

  it('zero-pads a single-digit day', () => {
    expect(formatPlainDate({ year: 2026, month: 7, day: 1 })).toBe('01 Jul 2026');
  });

  it('does not pad a two-digit day it already has', () => {
    expect(formatPlainDate({ year: 2026, month: 7, day: 10 })).toBe('10 Jul 2026');
  });

  // All twelve abbreviations, because the month name is looked up positionally: an off-by-one or a
  // wrong stride would still render *a* month, just the wrong one, on every dated answer in the
  // product.
  it.each([
    [1, '15 Jan 2026'],
    [2, '15 Feb 2026'],
    [3, '15 Mar 2026'],
    [4, '15 Apr 2026'],
    [5, '15 May 2026'],
    [6, '15 Jun 2026'],
    [7, '15 Jul 2026'],
    [8, '15 Aug 2026'],
    [9, '15 Sep 2026'],
    [10, '15 Oct 2026'],
    [11, '15 Nov 2026'],
    [12, '15 Dec 2026'],
  ])('renders month %i as its three-letter abbreviation', (month, expected) => {
    expect(formatPlainDate({ year: 2026, month, day: 15 })).toBe(expected);
  });
});

describe('plainDateToIso', () => {
  it('renders the canonical YYYY-MM-DD form', () => {
    expect(plainDateToIso(JUL_16_2026)).toBe('2026-07-16');
  });

  it('zero-pads a single-digit month and day', () => {
    expect(plainDateToIso({ year: 2026, month: 3, day: 4 })).toBe('2026-03-04');
  });

  it('zero-pads a year below 1000 to four digits', () => {
    expect(plainDateToIso({ year: 12, month: 1, day: 2 })).toBe('0012-01-02');
  });

  it('round-trips through parsePlainDate', () => {
    expect(parsePlainDate(plainDateToIso(JUL_16_2026))).toEqual(JUL_16_2026);
  });
});

describe('comparePlainDate', () => {
  it('returns a negative number when the earlier year comes first', () => {
    expect(comparePlainDate({ year: 2025, month: 7, day: 16 }, JUL_16_2026)).toBeLessThan(0);
  });

  it('returns a positive number when the later year comes first', () => {
    expect(comparePlainDate({ year: 2027, month: 7, day: 16 }, JUL_16_2026)).toBeGreaterThan(0);
  });

  it('falls through to the month when the years match', () => {
    expect(comparePlainDate({ year: 2026, month: 5, day: 16 }, JUL_16_2026)).toBeLessThan(0);
  });

  it('orders a later month after an earlier one within the same year', () => {
    expect(comparePlainDate({ year: 2026, month: 9, day: 16 }, JUL_16_2026)).toBeGreaterThan(0);
  });

  it('falls through to the day when the year and month both match', () => {
    expect(comparePlainDate({ year: 2026, month: 7, day: 15 }, JUL_16_2026)).toBeLessThan(0);
  });

  it('orders a later day after an earlier one within the same month', () => {
    expect(comparePlainDate({ year: 2026, month: 7, day: 17 }, JUL_16_2026)).toBeGreaterThan(0);
  });

  it('returns zero for two equal dates', () => {
    expect(comparePlainDate({ year: 2026, month: 7, day: 16 }, JUL_16_2026)).toBe(0);
  });

  it('ignores a lower month when the year is already later — year dominates', () => {
    expect(comparePlainDate({ year: 2027, month: 1, day: 1 }, JUL_16_2026)).toBeGreaterThan(0);
  });
});
