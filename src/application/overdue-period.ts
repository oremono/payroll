import type { OverduePeriod } from '@/domain/overdue';
import { parsePlainDate, plainDateToIso } from '@/domain/plain-date';

/**
 * The `?period=` search param's delivery-boundary policy, in one total function — the exact
 * `resolveAsOf` discipline (`src/application/as-of.ts`), applied to CAP-10's period selection.
 *
 * Story 11-1 flagged this as its residual risk: the pure core (`computeOverdue`) trusts an
 * already-validated non-negative-integer `months` or a parsed custom cutoff, and it is THIS function
 * that has to earn that trust. The `?period=` param is HOSTILE by definition — anything a person or a
 * stale link can type, including a repeated param, which Next hands over as an array. Every rejection
 * resolves to the default preset rather than raising, because there is deliberately no error surface
 * for a bad period: a mistyped or stale URL should render the 2-year list, which is both the safe
 * answer and the one the chips then show selected.
 *
 * Clock-free (Law 6): the period is a pure function of the string alone. The cutoff is derived inside
 * the domain from the passed `asOf`; nothing here reads a clock or an as-of date. TOTAL (Law: domain
 * and application functions never throw).
 *
 * Canonical URL form (resolver-owned, mirrored by `overduePeriodToParam`):
 *   - `Nm` for a month period — any POSITIVE, SAFE-INTEGER count of months (the four chips offer
 *     12 / 18 / 24 / 36). `0m`, `-3m`, and `1.5m` are not positive integers and fall back.
 *   - `YYYY-MM-DD` for a custom absolute cutoff, parsed by the ONE `parsePlainDate` (an impossible
 *     calendar date → fall back).
 *   - Absent, ambiguous, or unparseable → the default preset.
 */

/** The default period a surface picks when none is named: 2 years (24 months). */
export const DEFAULT_OVERDUE_PERIOD: OverduePeriod = { kind: 'months', months: 24 };

/** A month period's canonical param shape: one or more digits, then the `m` suffix. Anchored. */
const MONTHS_PARAM_PATTERN = /^(\d+)m$/;

/**
 * Resolve the `?period=` param to one `OverduePeriod`. Total over `string | string[] | undefined` —
 * exactly the shapes `searchParams`/`URLSearchParams.getAll` can produce.
 */
export function resolveOverduePeriod(param: string | readonly string[] | undefined): OverduePeriod {
  if (param === undefined) {
    return DEFAULT_OVERDUE_PERIOD;
  }

  if (typeof param !== 'string') {
    // A repeated param (`?period=a&period=b`) is AMBIGUOUS, and an ambiguous param is not a
    // selection — picking the first would silently choose one of two contradictory instructions.
    // Zero values is the same non-answer. Exactly one value is a selection; recursing hands it the
    // string path.
    if (param.length !== 1) {
      return DEFAULT_OVERDUE_PERIOD;
    }
    return resolveOverduePeriod(param[0]);
  }

  const monthsMatch = MONTHS_PARAM_PATTERN.exec(param);
  if (monthsMatch !== null) {
    // The pattern guarantees only digits, so `Number` is a non-negative value; the guard keeps it a
    // POSITIVE, SAFE integer. `0m` (not positive) and an overflowing count (past
    // `Number.MAX_SAFE_INTEGER`, where the domain's month arithmetic would stop being exact) fall
    // back rather than reach the pure core.
    const months = Number(monthsMatch[1]);
    if (Number.isSafeInteger(months) && months >= 1) {
      return { kind: 'months', months };
    }
    return DEFAULT_OVERDUE_PERIOD;
  }

  const cutoff = parsePlainDate(param);
  if (cutoff !== null) {
    return { kind: 'date', cutoff };
  }

  return DEFAULT_OVERDUE_PERIOD;
}

/**
 * The canonical URL form of a period — the inverse of `resolveOverduePeriod` on any period the
 * resolver can produce: `Nm` for a month period, `YYYY-MM-DD` for a custom cutoff. Used by the page
 * and the export route to serialize the resolved period back onto every pager and export href, so a
 * shared or bookmarked link reproduces the view.
 */
export function overduePeriodToParam(period: OverduePeriod): string {
  if (period.kind === 'date') {
    return plainDateToIso(period.cutoff);
  }
  return `${period.months}m`;
}
