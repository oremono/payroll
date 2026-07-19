import { afterEach, describe, expect, it, vi } from 'vitest';

import { systemClock, toUtcPlainDate } from '@/adapters/clock';

// Test-first (Law 1 / AD-23), and deliberately so: story 1-3's review recorded that the ONE file
// that shipped without a test was the one file with bugs, and that "an adapter is production code
// and Law 1 binds it exactly as it binds the domain". This is that lesson applied.
//
// The suite is DETERMINISTIC — it never reads the real clock. `toUtcPlainDate` is exercised against
// fixed epoch values, and `systemClock` against a frozen system time. A test that asserted "today
// is today" would pass on every possible implementation, including a wrong one.
//
// The cases that matter are the day boundaries. This machine, CI, and Vercel all run in different
// zones; a `getFullYear()` where a `getUTCFullYear()` belongs is invisible for 20-odd hours a day
// and then silently reports the wrong calendar day, which is exactly the class of bug that breaks
// "same data + same as-of ⇒ same answer" (Law 6 / AD-11, AD-19).

afterEach(() => {
  vi.useRealTimers();
});

describe('toUtcPlainDate', () => {
  it('returns the UTC calendar date of a mid-day instant', () => {
    // 2026-07-16T00:00:00.000Z
    expect(toUtcPlainDate(Date.UTC(2026, 6, 16, 12, 0, 0))).toEqual({
      year: 2026,
      month: 7,
      day: 16,
    });
  });

  it('returns the same date at the FIRST millisecond of a UTC day', () => {
    expect(toUtcPlainDate(Date.UTC(2026, 6, 16, 0, 0, 0, 0))).toEqual({
      year: 2026,
      month: 7,
      day: 16,
    });
  });

  it('returns the same date at the LAST millisecond of a UTC day — no local-timezone shift', () => {
    expect(toUtcPlainDate(Date.UTC(2026, 6, 16, 23, 59, 59, 999))).toEqual({
      year: 2026,
      month: 7,
      day: 16,
    });
  });

  it('rolls the day over at the UTC midnight that follows', () => {
    expect(toUtcPlainDate(Date.UTC(2026, 6, 17, 0, 0, 0, 0))).toEqual({
      year: 2026,
      month: 7,
      day: 17,
    });
  });

  it('reports a 1-based month, not the 0-based one the platform hands out', () => {
    expect(toUtcPlainDate(Date.UTC(2026, 0, 5)).month).toBe(1);
  });

  it('rolls the year over at the last instant of 31 December UTC', () => {
    expect(toUtcPlainDate(Date.UTC(2026, 11, 31, 23, 59, 59, 999))).toEqual({
      year: 2026,
      month: 12,
      day: 31,
    });
  });

  it('reports the leap day as a calendar date like any other', () => {
    expect(toUtcPlainDate(Date.UTC(2024, 1, 29, 6, 30))).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
  });

  it('reports the UTC date at the epoch itself', () => {
    expect(toUtcPlainDate(0)).toEqual({ year: 1970, month: 1, day: 1 });
  });
});

describe('systemClock', () => {
  it('implements the Clock port by reporting the frozen instant as a UTC PlainDate', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 12, 9, 0, 0)));

    expect(systemClock.todayUtc()).toEqual({ year: 2026, month: 5, day: 12 });
  });

  it('reports the UTC date, not the local one, at an instant where the two differ', () => {
    // 23:30 UTC — in every zone east of UTC this instant is already the NEXT calendar day locally,
    // and in every zone west of it, still that day. A local read would disagree with UTC for one
    // of the two, so asserting UTC pins the only reading that is the same everywhere.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 12, 23, 30, 0)));

    expect(systemClock.todayUtc()).toEqual({ year: 2026, month: 5, day: 12 });
  });
});
