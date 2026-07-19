import type { Clock } from '@/application/ports/clock';
import type { PlainDate } from '@/domain/plain-date';

/**
 * Clock adapter — the ONLY sanctioned home for `Date.now()` / `new Date()` in the entire codebase,
 * and the only implementation of the `Clock` port. (Law 6 / AD-11, AD-19)
 *
 * Nothing in `src/domain/**` or `src/application/**` may read the clock — lint enforces it — so
 * they take the as-of date as an explicit argument. When a boundary needs "now", it comes from
 * here, once, and travels inward as a value.
 *
 * "Today" is the current date in **UTC**, deliberately, not in the server's or the viewer's zone.
 * One organisation, one calendar: a local reading would make the same URL mean different things in
 * Singapore and in London, and "same data + same as-of ⇒ same answer" would stop being true.
 *
 * The instant is discarded at the moment it is read. `Date` appears in exactly two expressions
 * below and never escapes this module — what leaves is a `PlainDate`, so no time-of-day can leak
 * into a calendar comparison downstream.
 *
 * (Story 1-1's throwing stub, `nowUtcDate`, is gone: it had no port, no consumer, and no test. It
 * is replaced rather than kept because a second spelling of "now" is exactly the thing this file
 * exists to prevent.)
 */

/**
 * The ECMAScript time-value range: ±100,000,000 days either side of the epoch. One millisecond
 * past it, `new Date` is an Invalid Date and every getter returns NaN.
 */
const MAX_TIME_VALUE = 8_640_000_000_000_000;
const MIN_TIME_VALUE = -MAX_TIME_VALUE;

/**
 * The pure half, exported so it can be tested against fixed epoch values rather than against
 * whatever time the suite happens to run at. Separating it is what makes the day-boundary cases
 * (`…T23:59:59.999Z`, `…T00:00:00.000Z`) assertable at all.
 *
 * `getUTCMonth()` is 0-based; `PlainDate.month` is 1-based, like the ISO string it round-trips to.
 */
export function toUtcPlainDate(epochMs: number): PlainDate {
  // The guard, and why it THROWS (code review 2026-07-19).
  //
  // Unguarded, `toUtcPlainDate(NaN)` returned `{year: NaN, month: NaN, day: NaN}` — a `PlainDate`
  // in shape and nothing in substance. That value then failed OPEN rather than closed: every
  // comparison against NaN is false, so `comparePlainDate` returned NaN and
  // `comparePlainDate(parsed, today) > 0` was false for every parsed date, which silently retired
  // the ratified "a future as-of date is clamped to today" policy while every surface still
  // rendered and every test still passed. A finite value outside the ECMAScript time range reaches
  // the same place through an Invalid Date.
  //
  // A THROW, not a `null` — the one place in this codebase where that is the honest answer. The
  // domain is total by contract because its inputs are hostile URL params with a safe fallback
  // (today). A clock has no fallback: if it cannot say what day it is, there is no other source of
  // "now" to reach for, and inventing one would corrupt every dated answer downstream rather than
  // failing. Adapters may throw; the pure layers may not (Law 6 / AD-11, AD-1).
  if (!Number.isFinite(epochMs) || epochMs < MIN_TIME_VALUE || epochMs > MAX_TIME_VALUE) {
    throw new RangeError(
      `toUtcPlainDate: ${String(epochMs)} is not a representable instant. A clock that cannot ` +
        'name the day has no answer to fall back on, so this fails loudly rather than yielding a ' +
        'NaN-filled PlainDate that would silently disable the future-as-of clamp.',
    );
  }

  const instant = new Date(epochMs);
  return {
    year: instant.getUTCFullYear(),
    month: instant.getUTCMonth() + 1,
    day: instant.getUTCDate(),
  };
}

/** The `Clock` implementation the composition root injects. The one impure line in the file. */
export const systemClock: Clock = {
  todayUtc: () => toUtcPlainDate(Date.now()),
};
