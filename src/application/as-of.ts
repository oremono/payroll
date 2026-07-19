import { comparePlainDate, parsePlainDate, type PlainDate } from '@/domain/plain-date';

/**
 * The as-of date's delivery-boundary policy, in one total function.
 *
 * The as-of date lives in the URL as `?asOf=YYYY-MM-DD` (story 1-6's one architectural decision):
 * reads are Server Components calling inward in-process (AD-21), and determinism (AD-11 / AD-19)
 * wants the as-of date visible in the address bar so a view is reproducible, bookmarkable, and
 * shareable. That makes this function's input HOSTILE by definition — anything a person or a stale
 * link can type, including a repeated param, which Next hands over as an array.
 *
 * Clock-free (Law 6): `today` is a required parameter, resolved once at the boundary from the
 * `Clock` port. Nothing here reads a clock, so the whole policy is testable without one.
 *
 * TOTAL (Law: domain and application functions never throw). Every rejection resolves to `today`
 * rather than raising, because there is deliberately NO error surface for a bad as-of date: a
 * mistyped or stale URL should render today's findings, which is both the safe answer and the one
 * the header then displays, so the fallback is never silent.
 */
export function resolveAsOf(
  param: string | readonly string[] | undefined,
  today: PlainDate,
): PlainDate {
  if (param === undefined) {
    return today;
  }

  if (typeof param !== 'string') {
    // A repeated param (`?asOf=a&asOf=b`) is AMBIGUOUS, and an ambiguous param is not a date —
    // picking the first would silently choose one of two contradictory instructions. Zero values
    // is the same non-answer. Exactly one value is a date, and recursing hands it the string path.
    if (param.length !== 1) {
      return today;
    }
    return resolveAsOf(param[0], today);
  }

  const parsed = parsePlainDate(param);
  if (parsed === null) {
    return today;
  }

  // A future as-of date is meaningless: no salary record may be effective-dated ahead of today
  // (Law 5 / AD-18), so winding forward can only ever reproduce today's answer while claiming to
  // be a different question. Clamped, not refused — same reasoning as every other fallback here.
  if (comparePlainDate(parsed, today) > 0) {
    return today;
  }

  return parsed;
}
