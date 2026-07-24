/**
 * The CAP-10 overdue-for-review read use-case, and the FINALIZED boundary payload story 11-2 consumes
 * unmodified (Law 7 / AD-24).
 *
 * Orchestration only: load the ORG-WIDE overdue population (one read), hand it to the ONE pure domain
 * (`computeOverdue`) with the passed `asOf` and `period`, encode every `Money` to `BoundaryMoney`
 * (Law 4 / AD-4), and attach the `asOf`/`cutoff`/`period` receipts (Law 8 / AD-20). Every judgement
 * is the domain's and the effect goes through a port, so the fast suite covering this touches no
 * database and no clock.
 *
 * ## `asOf` and `period` are parameters, and that is the whole of Law 6 / AD-22 here
 *
 * The clock is read ONCE, at the delivery boundary (story 11-2's page), and the date is passed
 * inward; the period is the user's selection. Nothing here asks what day it is, and the cutoff is
 * derived INSIDE the pure domain from the passed `asOf` — never the wall clock (AD-22, the last
 * determinism hole). Same data + same `asOf` + same `period` ⇒ byte-identical payload (Law 6 / AD-11).
 * Computed fresh per request — no materialized list, no cache (AD-12).
 *
 * ## Read-only, TOTAL (Law 5 / AD-18 / AD-20)
 *
 * No write path, no mutation, no route handler (the CSV export is story 11-2). The ONE failure arm is
 * `unavailable`: the read throwing is caught, so no exception crosses the boundary. There is
 * deliberately NO refusal and NO not-found — an empty population is a valid `answer` with `rows: []`
 * (the zero-state), and an out-of-population employee is simply absent (AD-16 refusal semantics are
 * the single-subject CAP-5 card's, not this list's).
 */

import type { EmployeeRepository } from '@/application/ports/employee-repository';
import { toBoundaryMoney, type BoundaryMoney } from '@/domain/money';
import { computeOverdue, type OverduePeriod } from '@/domain/overdue';
import type { PlainDate } from '@/domain/plain-date';

export type { OverduePeriod };

/**
 * One overdue row at the boundary (Law 8 / AD-20 / AD-4): the person, the date of the record that
 * makes them overdue, and its salary as `BoundaryMoney` (`amountMinor` a decimal string, currency
 * always present).
 */
export type OverdueRow = {
  readonly employeeId: string;
  readonly name: string;
  readonly effectiveFrom: PlainDate;
  readonly salary: BoundaryMoney;
};

/**
 * The overdue report, carrying its receipts (Law 8 / AD-20): the `asOf` the list was computed at, the
 * resolved `cutoff` (rows are strictly earlier than this), the `period` echoed for display/provenance,
 * and the `rows` ordered oldest record first then `employeeId` ascending.
 */
export type OverdueReport = {
  readonly asOf: PlainDate;
  readonly cutoff: PlainDate;
  readonly period: OverduePeriod;
  readonly rows: readonly OverdueRow[];
};

/**
 * The read payload (Law 8 / AD-20). `answer` carries the report (whose `rows` may be empty — the
 * zero-state); `unavailable` means "we could not find out" (a repository outage). Story 11-2 renders
 * every arm and adds nothing to this contract.
 */
export type GetOverdueResult =
  | { readonly kind: 'answer'; readonly report: OverdueReport }
  | { readonly kind: 'unavailable' };

/**
 * Injected, never imported: no clock, no Prisma. ONE narrow READ port reaching exactly the method
 * this read needs. `asOf` and `period` arrive per call as arguments (Law 6 / AD-22).
 */
export type OverdueDeps = {
  readonly repository: Pick<EmployeeRepository, 'findOverduePopulation'>;
};

/**
 * The overdue-for-review list over the as-of population, at `asOf`, for the selected `period`.
 *
 * One read → the ONE `computeOverdue` (cutoff from `asOf`, as-of membership, strictly-earlier list,
 * ordering) → encode every `Money` to `BoundaryMoney` → attach the `asOf`/`cutoff`/`period` receipts.
 *
 * TOTAL: any repository throw is `unavailable`, never an exception across the boundary.
 */
export async function getOverdue(
  deps: OverdueDeps,
  asOf: PlainDate,
  period: OverduePeriod,
): Promise<GetOverdueResult> {
  try {
    const population = await deps.repository.findOverduePopulation();

    const { cutoff, rows } = computeOverdue({
      candidates: population.candidates,
      asOf,
      period,
    });

    return {
      kind: 'answer',
      report: {
        asOf,
        cutoff,
        period,
        rows: rows.map((row) => ({
          employeeId: row.employeeId,
          name: row.name,
          effectiveFrom: row.effectiveFrom,
          salary: toBoundaryMoney(row.salary),
        })),
      },
    };
  } catch {
    return { kind: 'unavailable' };
  }
}
