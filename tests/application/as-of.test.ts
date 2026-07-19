import { describe, expect, it } from 'vitest';

import { resolveAsOf } from '@/application/as-of';
import type { PlainDate } from '@/domain/plain-date';

// Test-first (Law 1 / AD-23): red before `src/application/as-of.ts` exists.
//
// `resolveAsOf` is the WHOLE boundary policy for the `?asOf=` search param, in one total function.
// Everything hostile a URL can carry arrives here, and nothing downstream ever sees anything but a
// valid `PlainDate` — there is no error surface for a bad as-of date, by design (a stale bookmark
// should show today's findings, not a stack trace).
//
// `today` is a PARAMETER, never read (Law 6 / AD-11). That is what makes every case below
// deterministic: the suite touches no clock, so it means the same thing on 16 Jul 2026 as it will
// in 2030.

const TODAY: PlainDate = { year: 2026, month: 7, day: 16 };

describe('resolveAsOf', () => {
  it('defaults to today when the param is absent', () => {
    expect(resolveAsOf(undefined, TODAY)).toEqual(TODAY);
  });

  it('resolves a valid past date to itself', () => {
    expect(resolveAsOf('2026-05-12', TODAY)).toEqual({ year: 2026, month: 5, day: 12 });
  });

  it('resolves a date equal to today to today', () => {
    expect(resolveAsOf('2026-07-16', TODAY)).toEqual(TODAY);
  });

  it('clamps a future date to today — a future as-of date is meaningless', () => {
    expect(resolveAsOf('2026-07-17', TODAY)).toEqual(TODAY);
  });

  it('clamps a far-future date to today', () => {
    expect(resolveAsOf('2099-01-01', TODAY)).toEqual(TODAY);
  });

  it('resolves the day before today, proving the clamp is not an off-by-one', () => {
    expect(resolveAsOf('2026-07-15', TODAY)).toEqual({ year: 2026, month: 7, day: 15 });
  });

  it.each([
    ['day-first', '12-05-2026'],
    ['unpadded month', '2026-5-12'],
    ['a timestamp', '2026-05-12T00:00:00Z'],
    ['empty', ''],
    ['a word', 'tomorrow'],
    ['an impossible calendar date', '2026-02-30'],
    ['month 13', '2026-13-01'],
    ['month 00', '2026-00-10'],
  ])('falls back to today for %s, and never throws', (_name, param) => {
    expect(() => resolveAsOf(param, TODAY)).not.toThrow();
    expect(resolveAsOf(param, TODAY)).toEqual(TODAY);
  });

  // Next hands a page an ARRAY when a search param repeats (`?asOf=a&asOf=b`), and the client's
  // `URLSearchParams.getAll` always hands one. Exactly one value is a date; zero and many are not.
  it('falls back to today for a repeated param — an ambiguous param is not a date', () => {
    expect(resolveAsOf(['2026-05-12', '2026-01-01'], TODAY)).toEqual(TODAY);
  });

  it('falls back to today for an empty list of values', () => {
    expect(resolveAsOf([], TODAY)).toEqual(TODAY);
  });

  it('resolves a single-valued list, which is what URLSearchParams.getAll yields', () => {
    expect(resolveAsOf(['2026-05-12'], TODAY)).toEqual({ year: 2026, month: 5, day: 12 });
  });

  it('clamps a single-valued list holding a future date', () => {
    expect(resolveAsOf(['2099-01-01'], TODAY)).toEqual(TODAY);
  });

  it('falls back to today for a single-valued list holding rubbish', () => {
    expect(resolveAsOf(['tomorrow'], TODAY)).toEqual(TODAY);
  });
});
