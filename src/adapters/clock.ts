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
 * The pure half, exported so it can be tested against fixed epoch values rather than against
 * whatever time the suite happens to run at. Separating it is what makes the day-boundary cases
 * (`…T23:59:59.999Z`, `…T00:00:00.000Z`) assertable at all.
 *
 * `getUTCMonth()` is 0-based; `PlainDate.month` is 1-based, like the ISO string it round-trips to.
 */
export function toUtcPlainDate(epochMs: number): PlainDate {
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
