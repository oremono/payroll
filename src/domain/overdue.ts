/**
 * The CAP-10 overdue-for-review core (AD-22 / AD-16 / AD-8 / AD-2): resolve the cutoff from the
 * passed `asOf` and the selected period, keep only the as-of population, and list every employee
 * whose CURRENT salary record is STRICTLY earlier than the cutoff. No I/O, no clock, no randomness,
 * no imports outside this layer. (Law 2 / AD-1)
 *
 * This forks NOTHING: in-population membership and the current record are the ONE
 * `resolveCurrentSalary` (AD-8), and the cutoff arithmetic is the ONE `subtractMonths` (AD-22). There
 * is no second resolver and no second `ORDER BY` over the salary series.
 *
 * ## Why the cutoff is resolved HERE, in the pure layer (AD-22 — the determinism hole)
 *
 * CAP-10 is the last edge of the determinism promise: if the shell could pass a today-derived cutoff,
 * winding `asOf` back would not reproduce a prior day's overdue list, and Home's count would become
 * clock-dependent. `computeOverdue` takes the `period` SELECTION and derives the cutoff from the
 * passed `asOf` itself, so a wall-clock cutoff is structurally impossible — the shell supplies only
 * `asOf` (an already-resolved `PlainDate`) and the selection. The preset chip and the custom date
 * "resolve to the same cutoff by the same rule": both produce ONE `cutoff`, and the strictly-earlier
 * comparison is the only overdue code path.
 *
 * ## The rule, and every part of it (AD-22)
 *
 *   - `cutoff` = `period.cutoff` for a custom date, else `subtractMonths(asOf, period.months)`.
 *   - Membership = the as-of population (AD-16): an employee with no record in force at `asOf`
 *     (`resolveCurrentSalary === null`) appears in NO row — silent exclusion, no refusal row on a
 *     list surface (that is CAP-5's single-subject semantics).
 *   - Overdue IFF `comparePlainDate(current.effectiveFrom, cutoff) < 0` — STRICTLY earlier. A record
 *     dated EXACTLY on the cutoff is NOT overdue.
 *   - A HIRE record is a salary record (AD-22): a hire-only employee whose hire predates the cutoff
 *     IS overdue — the finding CAP-10 exists to surface. Never special-cased out.
 *   - Judged on the CURRENT record — the greatest `(effectiveFrom, seq) ≤ asOf` (AD-8) — never the
 *     oldest or newest-ever.
 *
 * Every function here is TOTAL and deterministic (Law 8 / AD-20): an empty population is an answer of
 * `rows: []` (the zero-state), never a refusal; `asOf` and `period` are required explicit arguments;
 * same data + same `asOf` + same `period` ⇒ byte-identical result.
 */

import type { Money } from './money';
import { comparePlainDate, subtractMonths, type PlainDate } from './plain-date';
import { resolveCurrentSalary, type SalaryRecordView } from './salary-timeline';

/**
 * The period the overdue list is measured back over. A preset chip is a `months` VALUE (12 / 18 / 24
 * / 36, any positive int) and the custom date field is a `date` VALUE — not a second code path
 * (AD-22). Both resolve to one `cutoff` by the same rule.
 */
export type OverduePeriod =
  | { readonly kind: 'months'; readonly months: number }
  | { readonly kind: 'date'; readonly cutoff: PlainDate };

/**
 * One employee for the org-wide overdue sweep: their identity plus their whole UNORDERED append-only
 * salary history reduced to the resolver's view. The domain resolves the as-of current record and
 * membership; the read imposes no `ORDER BY` and no as-of filter (AD-8 / AD-16).
 */
export type OverdueCandidate = {
  readonly employeeId: string;
  readonly name: string;
  readonly salaryHistory: readonly SalaryRecordView[];
};

/**
 * One overdue row, Money-typed and pre-boundary: the person, the date of the record that makes them
 * overdue, and its salary in the record's OWN currency (AD-4 / AD-6). The use-case encodes `salary`
 * to `BoundaryMoney`; nothing here has crossed a boundary yet.
 */
export type OverdueRow = {
  readonly employeeId: string;
  readonly name: string;
  readonly effectiveFrom: PlainDate;
  readonly salary: Money;
};

/** Everything `computeOverdue` folds. The use-case assembles it from one read + `asOf` + `period`. */
export type ComputeOverdueInput = {
  readonly candidates: readonly OverdueCandidate[];
  readonly asOf: PlainDate;
  readonly period: OverduePeriod;
};

/** The domain outcome: the resolved `cutoff` (a receipt) and the overdue `rows` (already ordered). */
export type OverdueComputation = {
  readonly cutoff: PlainDate;
  readonly rows: readonly OverdueRow[];
};

/**
 * THE cutoff, resolved from the passed `asOf` and the selection (AD-22). A custom date is used
 * verbatim; a month period is `subtractMonths(asOf, months)` — day-clamped into a short month by that
 * ONE helper (29 Feb − 1y = 28 Feb). Never a wall-clock read: `asOf` is the only date it starts from.
 */
function resolveCutoff(asOf: PlainDate, period: OverduePeriod): PlainDate {
  if (period.kind === 'date') {
    return period.cutoff;
  }
  return subtractMonths(asOf, period.months);
}

/**
 * THE overdue-row ordering, and the only one: oldest record first (`comparePlainDate` on
 * `effectiveFrom`), then `employeeId` byte-wise ascending as the tie-break. Byte-wise (never
 * `localeCompare`, whose output depends on the Node ICU build — Law 6) so the order is deterministic
 * across environments.
 *
 * EXPORTED so its three arms are pinned DIRECTLY. The sort observes only the SIGN, and two distinct
 * rows never share both an `effectiveFrom` and an `employeeId` (one row per employee), so the
 * equal-case `0` is unreachable through the sort — a sort cannot distinguish `-1` from `0` on it. A
 * direct test asserting `-1`/`0`/`1` is what keeps every arm live under mutation, exactly as
 * `compareStrings` is held.
 */
export function compareOverdueRows(a: OverdueRow, b: OverdueRow): number {
  const byDate = comparePlainDate(a.effectiveFrom, b.effectiveFrom);
  if (byDate !== 0) {
    return byDate;
  }
  if (a.employeeId < b.employeeId) {
    return -1;
  }
  if (a.employeeId > b.employeeId) {
    return 1;
  }
  return 0;
}

/**
 * The overdue-for-review list over the as-of population, at `asOf`, for the selected `period`.
 *
 * For each candidate the ONE resolver (AD-8) finds the current record; a `null` drops the employee
 * (out of the as-of population, AD-16 — no row, no refusal). An in-population employee is kept IFF
 * their current record is STRICTLY earlier than the cutoff (AD-22). Rows carry the current record's
 * date and its own Money, ordered oldest-first then `employeeId` ascending.
 *
 * TOTAL and deterministic: an empty or all-recent population answers `rows: []`; same inputs ⇒
 * byte-identical result. Computes on a fresh array, so the caller's list is never disturbed.
 */
export function computeOverdue(input: ComputeOverdueInput): OverdueComputation {
  const cutoff = resolveCutoff(input.asOf, input.period);

  const rows: OverdueRow[] = [];
  for (const candidate of input.candidates) {
    const current = resolveCurrentSalary(candidate.salaryHistory, input.asOf);
    // Not in-population at `asOf` — future-hired, or with no record yet (AD-16). Never listed.
    if (current === null) {
      continue;
    }
    // STRICTLY earlier than the cutoff. On-cutoff is NOT overdue (AD-22).
    if (comparePlainDate(current.effectiveFrom, cutoff) < 0) {
      rows.push({
        employeeId: candidate.employeeId,
        name: candidate.name,
        effectiveFrom: current.effectiveFrom,
        salary: current.salary,
      });
    }
  }

  rows.sort(compareOverdueRows);
  return { cutoff, rows };
}
