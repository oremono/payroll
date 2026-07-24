/**
 * The CAP-8 gender-distribution read use-case, and the FINALIZED boundary payload story 9-2 consumes
 * unmodified (Law 7 / AD-24).
 *
 * Orchestration only: load the ORG-WIDE gender-distribution population (the level axis + every
 * gender-and-level-tagged candidate), hand it to the ONE pure domain (`computeGenderDistribution`),
 * and attach the `asOf` receipt. Every judgement is the domain's and every effect goes through the
 * port, so the fast suite covering this touches no database and no clock.
 *
 * ## `asOf` is a parameter, and that is the whole of Law 6 here
 *
 * The clock is read ONCE, at the delivery boundary (story 9-2's page), and the date is passed inward.
 * Nothing here asks what day it is. Same data + same `asOf` ⇒ byte-identical payload (Law 6 / AD-11).
 *
 * ## Every function here is TOTAL (Law 8 / AD-20)
 *
 * There is exactly ONE failure arm: a repository throw is caught and answered `unavailable`, so no
 * exception crosses the boundary. There is deliberately NO refusal, NO not-found, and NO `n >= 5`
 * gate — CAP-8 is org-wide (no subject employee) and an empty population is a valid `answer` of zeros
 * (the domain returns all-zero active levels), not a refusal. The union is `answer | unavailable`.
 *
 * ## Read-only, fresh per request (Law 5 / AD-18 / AD-2 / AD-12)
 *
 * No write path, no mutation, no route handler. The distribution is computed fresh per request and
 * never materialized or cached; the database SELECTs the candidate set and the level axis, and the
 * domain computes every per-level and org-wide count a user sees (Law 2 / AD-2).
 */

import type { EmployeeRepository } from '@/application/ports/employee-repository';
import { computeGenderDistribution, type GenderLevelCount } from '@/domain/gender-distribution';
import type { PlainDate } from '@/domain/plain-date';

/**
 * The distribution, carrying its receipts (Law 8 / AD-20): the `asOf` the counts were computed at,
 * the rank-ordered per-level counts (a level appears iff active OR it holds an in-population person),
 * and the org-wide `totals`. Counts are plain numbers and `asOf` crosses as a `PlainDate` — no money
 * and no median here, so nothing needs boundary encoding (consistent with the gender-gap payload).
 */
export type GenderDistribution = {
  readonly asOf: PlainDate;
  readonly levels: readonly GenderLevelCount[];
  readonly totals: { readonly male: number; readonly female: number; readonly total: number };
};

/**
 * The read payload (Law 8 / AD-20). `answer` carries its receipts; `unavailable` means "we could not
 * find out". There is no `refusal` and no `not-found` — CAP-8 has no subject and no `n >= 5` gate, so
 * an empty distribution is an `answer` of zeros. Story 9-2 renders both arms and adds nothing.
 */
export type GetGenderDistributionResult =
  | { readonly kind: 'answer'; readonly distribution: GenderDistribution }
  | { readonly kind: 'unavailable' };

/**
 * Injected, never imported: no clock, no Prisma, no id generator. A read needs only the repository —
 * `asOf` arrives per call, as an argument. A `Pick` because this read reaches exactly one method.
 */
export type GenderDistributionDeps = {
  readonly repository: Pick<EmployeeRepository, 'findGenderDistributionPopulation'>;
};

/**
 * The gender distribution across levels, over the as-of population.
 *
 * The order is the rule (AD-16 / AD-2): load the org-wide population (level axis + candidates), run
 * the ONE `computeGenderDistribution` (as-of membership, per-level gender counts, the
 * `active OR total > 0` filter, org-wide totals), and attach `asOf`.
 *
 * TOTAL: any repository throw is `unavailable`, never an exception across the boundary.
 */
export async function getGenderDistribution(
  deps: GenderDistributionDeps,
  asOf: PlainDate,
): Promise<GetGenderDistributionResult> {
  try {
    const population = await deps.repository.findGenderDistributionPopulation();

    // The ONE domain (AD-16 / AD-2): as-of membership, per-level gender counts, org-wide totals.
    const { levels, totals } = computeGenderDistribution(
      population.levels,
      population.candidates,
      asOf,
    );

    return { kind: 'answer', distribution: { asOf, levels, totals } };
  } catch {
    return { kind: 'unavailable' };
  }
}
