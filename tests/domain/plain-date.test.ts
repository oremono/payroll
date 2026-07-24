import { describe, expect, it } from 'vitest';

import {
  comparePlainDate,
  formatPlainDate,
  parsePlainDate,
  plainDateToIso,
  subtractMonths,
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

  // Code review 2026-07-19. `?asOf=0000-01-01` was ACCEPTED and displayed as "01 Jan 0": year zero
  // does not exist in the proleptic Gregorian calendar this module implements, and — the concrete
  // harm — `<input type="date">` cannot hold it, so reopening the picker on such a URL showed a
  // blank field. A date the product can display but not edit is not a date.
  it('rejects year 0000 — there is no year zero, and no date input can hold one', () => {
    expect(parsePlainDate('0000-01-01')).toBeNull();
  });

  it('rejects year 0000 in December too — the floor is on the year, not on a month/day pairing', () => {
    expect(parsePlainDate('0000-12-31')).toBeNull();
  });

  it('accepts year 0001 — the first year that exists, and the boundary the floor sits on', () => {
    expect(parsePlainDate('0001-01-01')).toEqual({ year: 1, month: 1, day: 1 });
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
    // Both anchors, proven independently. `x2026-07-16` alone does NOT prove `^` is load-bearing:
    // drop the anchor and the parser still returns null, because the slices then land on garbage.
    // A date concatenated with a second date is the case that separates them — unanchored at the
    // start, the pattern matches the TAIL while the slices read the perfectly valid HEAD, and a
    // 20-character string parses as 16 Jul 2026.
    ['a date with a second date appended', '2026-07-162026-07-16'],
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

  // Code review 2026-07-19. The format contract says FOUR-DIGIT year, and `plainDateToIso` had
  // padded since day one — but this function did not, so `?asOf=0001-01-01` rendered "01 Jan 1"
  // in the header while the URL and the `<time dateTime>` beside it said `0001-01-01`. Two
  // spellings of one date on one screen is exactly the drift the single display form exists to
  // prevent.
  it('pads a year below 1000 to four digits, as the format contract states', () => {
    expect(formatPlainDate({ year: 1, month: 1, day: 1 })).toBe('01 Jan 0001');
  });

  it('pads a three-digit year', () => {
    expect(formatPlainDate({ year: 999, month: 12, day: 31 })).toBe('31 Dec 0999');
  });

  it('leaves a four-digit year alone', () => {
    expect(formatPlainDate({ year: 1000, month: 1, day: 1 })).toBe('01 Jan 1000');
  });

  // Code review 2026-07-19. A month outside 1..12 ran the index off the abbreviation table and
  // `slice` — total for any input, which is why it was chosen — returned the EMPTY string, so
  // `formatPlainDate({year: 2026, month: 13, day: 15})` produced `"15  2026"`: a double space, no
  // month, and no signal at all. `money.ts` is the precedent (Law 4 / AD-4): a value that arrives
  // from outside is guarded, and the failure is a `null` return, never an exception and never a
  // malformed string that reads like an answer.
  it.each([
    ['month 13', 13],
    ['month 0', 0],
    ['a negative month', -1],
    ['a fractional month', 7.5],
    ['NaN', Number.NaN],
  ])('returns null rather than a malformed string for %s', (_name, month) => {
    expect(formatPlainDate({ year: 2026, month, day: 15 })).toBeNull();
  });

  it('formats month 1 and month 12 — the boundaries the guard must not move', () => {
    expect(formatPlainDate({ year: 2026, month: 1, day: 15 })).toBe('15 Jan 2026');
    expect(formatPlainDate({ year: 2026, month: 12, day: 15 })).toBe('15 Dec 2026');
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

// CAP-10 (AD-22, M-5): the overdue cutoff is `asOf − period`, computed by CALENDAR month subtraction
// with a day that clamps into a shorter target month (29 Feb − 1y = 28 Feb). Pure, TOTAL, and
// deterministic — no JS `Date` anywhere (Law 6 / AD-11), which is the whole reason the arithmetic is
// written out here rather than delegated. Test-first: this block lands red before `subtractMonths`
// exists, and it walks the story's leap-day and preset rows plus the boundary cases the 100% mutation
// floor needs (the year rollover, the month wrap, and the clamp in BOTH leap directions).
describe('subtractMonths', () => {
  it('subtracts within the same year without touching the day', () => {
    expect(subtractMonths({ year: 2026, month: 7, day: 16 }, 3)).toEqual({
      year: 2026,
      month: 4,
      day: 16,
    });
  });

  it('the golden domain example: 16 Jul 2026 minus 18 months is 16 Jan 2025', () => {
    expect(subtractMonths({ year: 2026, month: 7, day: 16 }, 18)).toEqual({
      year: 2025,
      month: 1,
      day: 16,
    });
  });

  // The four period presets the surface offers (story 11-2), measured back from the golden as-of.
  it.each([
    [12, { year: 2025, month: 7, day: 16 }],
    [18, { year: 2025, month: 1, day: 16 }],
    [24, { year: 2024, month: 7, day: 16 }],
    [36, { year: 2023, month: 7, day: 16 }],
  ])('subtracts the %i-month preset from 16 Jul 2026', (months, expected) => {
    expect(subtractMonths({ year: 2026, month: 7, day: 16 }, months)).toEqual(expected);
  });

  it('crosses a year boundary when the month underflows', () => {
    // January minus one month is the previous December, previous year.
    expect(subtractMonths({ year: 2026, month: 1, day: 10 }, 1)).toEqual({
      year: 2025,
      month: 12,
      day: 10,
    });
  });

  it('lands exactly on January (month index 0) without rolling the year an extra step', () => {
    // month 7 (Jul) minus 6 -> month 1 (Jan) of the SAME year: the modulo/rollover boundary.
    expect(subtractMonths({ year: 2026, month: 7, day: 16 }, 6)).toEqual({
      year: 2026,
      month: 1,
      day: 16,
    });
  });

  it('lands exactly on December of the previous year when the whole year is consumed', () => {
    // month 7 minus 7 -> month 12 (Dec) of the prior year: the other side of the wrap.
    expect(subtractMonths({ year: 2026, month: 7, day: 16 }, 7)).toEqual({
      year: 2025,
      month: 12,
      day: 16,
    });
  });

  it('is the identity for zero months', () => {
    expect(subtractMonths({ year: 2026, month: 7, day: 16 }, 0)).toEqual({
      year: 2026,
      month: 7,
      day: 16,
    });
  });

  it('subtracts a whole multiple of twelve as exactly that many years', () => {
    expect(subtractMonths({ year: 2026, month: 7, day: 16 }, 120)).toEqual({
      year: 2016,
      month: 7,
      day: 16,
    });
  });

  // The AD-22 / M-5 clamp, both leap directions. A day absent in the TARGET month drops to that
  // month's last day — 29 Feb has no counterpart in a common February.
  it('clamps 29 Feb of a leap year back onto 28 Feb of a common year (24 months)', () => {
    expect(subtractMonths({ year: 2028, month: 2, day: 29 }, 24)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
  });

  it('clamps 29 Feb of a leap year back onto 28 Feb of the prior common year (12 months)', () => {
    expect(subtractMonths({ year: 2024, month: 2, day: 29 }, 12)).toEqual({
      year: 2023,
      month: 2,
      day: 28,
    });
  });

  it('keeps 29 Feb when the target February is itself a leap February (48 months)', () => {
    // 2028 and 2024 are both leap years: no clamp, the 29th survives — the branch that proves the
    // clamp is CONDITIONAL, not applied to every February.
    expect(subtractMonths({ year: 2028, month: 2, day: 29 }, 48)).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
  });

  it('clamps the 31st onto a 30-day target month', () => {
    // 31 Jul minus one month -> June has 30 days, so the day clamps to 30.
    expect(subtractMonths({ year: 2026, month: 7, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 6,
      day: 30,
    });
  });

  it('does not clamp when the day already fits the target month', () => {
    expect(subtractMonths({ year: 2026, month: 7, day: 28 }, 1)).toEqual({
      year: 2026,
      month: 6,
      day: 28,
    });
  });

  // FIRST_YEAR invariant: the proleptic calendar has no year below 1, and `<input type="date">`
  // cannot show one. A period that would underflow past year 1 clamps to the earliest date rather
  // than emit a `{year: 0}` cutoff — the one invariant a *valid* positive period can still breach.
  it('clamps to 0001-01-01 rather than underflow below year 1', () => {
    expect(subtractMonths({ year: 1, month: 6, day: 1 }, 12)).toEqual({ year: 1, month: 1, day: 1 });
    expect(subtractMonths({ year: 1, month: 1, day: 1 }, 1)).toEqual({ year: 1, month: 1, day: 1 });
  });

  it('does NOT clamp when the result lands exactly on year 1 (the boundary is exclusive)', () => {
    // 20 Jun 0002 minus 12 months is 20 Jun 0001 — year 1 is representable, so month/day survive
    // untouched. Pins the clamp's `< FIRST_YEAR` boundary as strict, not `<=`.
    expect(subtractMonths({ year: 2, month: 6, day: 20 }, 12)).toEqual({ year: 1, month: 6, day: 20 });
  });
});
