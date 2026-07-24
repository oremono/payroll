/**
 * The gender-distribution core (CAP-8, AD-16 / AD-2): fold the ORG-WIDE candidate set into per-level
 * gender counts. No I/O, no clock, no randomness, no imports outside this layer. (Law 2 / AD-1)
 *
 * This forks NOTHING: in-population membership is the ONE `resolveCurrentSalary` (AD-8) — the exact
 * test the sibling CAP-7 uses — so there is no second membership predicate. Gender is verbatim
 * `MALE`/`FEMALE` (Law 3) and is only ever the SLICE dimension: the group axis is `level` alone
 * (role and country are deliberately ignored per the SPEC), and gender is never part of a group
 * identity.
 *
 * ## Why this counts PEOPLE, not records (AD-2)
 *
 * A person with two salary records (a same-day correction) is ONE increment in exactly one gender
 * bucket. `resolveCurrentSalary`'s AD-8 tie-break picks the current record, but the count is over
 * distinct in-population EMPLOYEES — never the cardinality of `salary_record`, and never a SQL
 * `COUNT`/`GROUP BY`. The whole point of CAP-8 is a count SQL does not compute (Law 2).
 *
 * ## Why the level axis is is_active-INCLUSIVE
 *
 * The axis is the reference taxonomy, not just the levels that happen to hold people: enumerating
 * EVERY level guarantees each in-population employee's `levelCode` has a bucket (no orphan is
 * silently dropped) and honours "is_active never hides existing statistics" — an inactive level that
 * still holds an in-population employee MUST appear. The `active OR total > 0` output filter then
 * drops only RETIRED, EMPTY levels as noise. Rows are strictly rank-ordered (`level.rank` exists to
 * order this chart), so the output is deterministic regardless of the axis's input order.
 *
 * Every function here is TOTAL (Law 8 / AD-20): an empty population is a valid answer of zeros, never
 * a refusal — CAP-8 has no `n >= 5` gate and no subject employee. `asOf` is a required explicit
 * argument; same data + same `asOf` ⇒ byte-identical result.
 */

import type { Gender } from './employee-fields';
import type { PlainDate } from './plain-date';
import { resolveCurrentSalary, type SalaryRecordOrder } from './salary-timeline';

/**
 * One candidate for the org-wide sweep: the employee's `gender`, their `levelCode` (the group axis),
 * and their whole UNORDERED append-only salary history reduced to the ordering columns membership
 * reads (AD-8). No money, no median, no id: CAP-8 is a people-counting capability, so the candidate
 * carries only what a count needs. Mirrors the CAP-7 `GenderGapCandidate` shape without the `Money`.
 */
export type GenderDistributionCandidate = {
  readonly gender: Gender;
  readonly levelCode: string;
  readonly salaryRecords: readonly SalaryRecordOrder[];
};

/**
 * One row of the level axis, as the reference taxonomy hands it over: the `code`, its display `name`,
 * its `rank` (the total order the chart is drawn in), and `isActive`. Resolved is_active-INCLUSIVE by
 * the read; `isActive` gates only the output filter here, never whether a person is counted.
 */
export type LevelAxisEntry = {
  readonly levelCode: string;
  readonly levelLabel: string;
  readonly rank: number;
  readonly isActive: boolean;
};

/**
 * One per-level count in the finalized payload: the level's `code` and `label`, the two gender counts
 * (both ALWAYS present — the absent gender is `0`), and `total = maleN + femaleN`. The number shown
 * is the number counted.
 */
export type GenderLevelCount = {
  readonly levelCode: string;
  readonly levelLabel: string;
  readonly maleN: number;
  readonly femaleN: number;
  readonly total: number;
};

/**
 * The domain outcome: the rank-ordered per-level counts and the org-wide `totals`. The use-case adds
 * `asOf` to form the boundary `distribution`; the domain owns the counts alone (it knows no dates
 * beyond the `asOf` it is handed). `totals` reconcile with the sum of the per-level counts by
 * construction.
 */
export type GenderDistributionResult = {
  readonly levels: readonly GenderLevelCount[];
  readonly totals: { readonly male: number; readonly female: number; readonly total: number };
};

/**
 * The gender distribution across levels, over the as-of population.
 *
 * The order is the whole rule (AD-16 / AD-2):
 *   1. In-population = every candidate with a salary in force at `asOf` (the ONE resolver, AD-8).
 *      Membership is by PERSON, so each in-population candidate is counted exactly once.
 *   2. For each `level` — rank-ordered, is_active-inclusive — count the in-population people whose
 *      `levelCode` matches, split by gender. Both counts are the exact cardinalities of the in-memory
 *      sets, computed here — never a `COUNT`, never the table.
 *   3. A level is emitted iff it is `isActive` OR holds at least one in-population person
 *      (`total > 0`); an inactive, empty level is dropped as retired noise.
 *   4. `totals` are the org-wide sums over every level's counts — reconciling with the per-level rows
 *      by construction (the only omitted levels are empty, contributing nothing).
 *
 * TOTAL and deterministic: an empty population answers all-zero active levels, never a refusal.
 */
export function computeGenderDistribution(
  levels: readonly LevelAxisEntry[],
  candidates: readonly GenderDistributionCandidate[],
  asOf: PlainDate,
): GenderDistributionResult {
  // The in-population set (AD-16), resolved ONCE per candidate through the ONE resolver (AD-8). A
  // candidate with no salary in force at `asOf` — future-hired, or with no record yet — is simply
  // absent, never counted at any level.
  const inPopulation = candidates.filter(
    (candidate) => resolveCurrentSalary(candidate.salaryRecords, asOf) !== null,
  );

  // Strictly ascending by `rank` on a COPY, so the caller's axis is undisturbed and the output order
  // does not depend on the order the axis was handed in. `rank` is UNIQUE at the source (`level.rank`
  // is a UNIQUE column), so the comparison is total and cannot reshuffle on a tie.
  const rows = [...levels]
    .sort((a, b) => a.rank - b.rank)
    .map((level) => {
      const atLevel = inPopulation.filter((candidate) => candidate.levelCode === level.levelCode);
      const maleN = atLevel.filter((candidate) => candidate.gender === 'MALE').length;
      const femaleN = atLevel.filter((candidate) => candidate.gender === 'FEMALE').length;
      return {
        isActive: level.isActive,
        count: {
          levelCode: level.levelCode,
          levelLabel: level.levelLabel,
          maleN,
          femaleN,
          total: maleN + femaleN,
        },
      };
    });

  // Org-wide totals over EVERY level's counts (before the output filter): the omitted levels are
  // empty by definition, so this equals the sum of the emitted rows — the reconciliation the spec
  // requires between `totals` and the per-level counts.
  const totals = rows.reduce(
    (accumulator, { count }) => ({
      male: accumulator.male + count.maleN,
      female: accumulator.female + count.femaleN,
      total: accumulator.total + count.total,
    }),
    { male: 0, female: 0, total: 0 },
  );

  // A level appears iff it is active OR holds an in-population person: taxonomy completeness for the
  // active axis, existing-statistics visibility for an inactive level that still holds people, and
  // omission only for the retired-and-empty.
  const emitted = rows
    .filter(({ isActive, count }) => isActive || count.total > 0)
    .map(({ count }) => count);

  return { levels: emitted, totals };
}
