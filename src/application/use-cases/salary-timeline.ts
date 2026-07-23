/**
 * The CAP-4 read use-case, and the FINALIZED boundary payload story 5-2 consumes unmodified.
 *
 * Orchestration only: read the append-only series through the one port, resolve the current record
 * and order the timeline with the ONE domain comparison, then encode money for the boundary. Every
 * judgement is borrowed from `src/domain/**` and the effect goes through a port, so this file is
 * testable against fakes and the fast suite that covers it touches no database and no clock.
 *
 * ## `asOf` is a parameter, and that is the whole of Law 6 here
 *
 * The clock port is read ONCE, at the delivery boundary (story 5-2's page), and the date is passed
 * inward. Nothing in this file asks what day it is. Same records + same `asOf` ⇒ identical payload,
 * which is what makes the as-of control testable at all (Law 6 / AD-11).
 *
 * ## Every function here is TOTAL (Law 8 / AD-20)
 *
 * A `null` from the read is a `not-found` payload; an adapter that THROWS is caught and answered as
 * `unavailable`, mirroring the reads in `use-cases/employees.ts`. `not-found` and `unavailable` are
 * deliberately different answers — one means "there is no such person", the other "we could not find
 * out" — and a present employee with an empty history is NEITHER: it is a `timeline` with no rows.
 * A read that threw would force story 5-2 to invent error handling the contract never gave it, which
 * is exactly the "frontend adds nothing to the contract" Law 7 forbids.
 *
 * ## Read-only (Law 5 / AD-18)
 *
 * There is no write path here and none on the port for this capability. The timeline is purely a
 * consumer of the append-only series; the current record is the ONE resolver's pick (AD-8), never a
 * second determination, and the head of the ordered list is that same record by construction.
 */

import type { EmployeeRepository } from '@/application/ports/employee-repository';
import { toBoundaryMoney, type BoundaryMoney } from '@/domain/money';
import type { PlainDate } from '@/domain/plain-date';
import { orderSalaryTimeline, resolveCurrentSalary } from '@/domain/salary-timeline';

/**
 * One salary record as it crosses to a surface: identity, effective date, and money as
 * `BoundaryMoney`. `seq` is ABSENT — it never leaves the domain (AD-8); the current record is marked
 * by `id` on the view below.
 */
export type SalaryTimelineRow = {
  readonly id: string;
  /** A calendar date, matching the sibling `EmployeeDetail` read on the same page. */
  readonly effectiveFrom: PlainDate;
  /** AD-4: `amountMinor` a DECIMAL STRING, carrying the record's own currency (AD-6). */
  readonly salary: BoundaryMoney;
};

/**
 * The salary timeline as of a date. `records` are NEWEST-FIRST and `currentSalaryRecordId` is the
 * ONE resolver's pick (AD-8) — which is `records[0]?.id` by construction, because the ordering and
 * the resolver share one comparison. `null` when no record is in force at `asOf` (every record is
 * future, or the history is empty).
 */
export type SalaryTimelineView = {
  readonly employeeId: string;
  readonly asOf: PlainDate;
  readonly records: readonly SalaryTimelineRow[];
  readonly currentSalaryRecordId: string | null;
};

/**
 * The read payload (Law 8 / AD-20). `not-found` and `unavailable` are distinct outcomes, and a
 * present employee with an empty history is a `timeline` with no rows — see the module header.
 */
export type GetSalaryTimelineResult =
  | { readonly kind: 'timeline'; readonly timeline: SalaryTimelineView }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable' };

/**
 * Injected, never imported: no clock, no Prisma, no id generator. A read needs only the repository —
 * `asOf` arrives per call, as an argument.
 */
export type SalaryTimelineDeps = {
  readonly repository: EmployeeRepository;
};

/**
 * The salary timeline for one employee as of `asOf`.
 *
 * The order is load-bearing but small: read the whole series, `null` ⇒ `not-found`; resolve the
 * current record with the ONE resolver (AD-8); order the series newest-first through the ONE
 * comparison; then map each row to the boundary shape — money to `BoundaryMoney`, `seq` dropped.
 * The head of the ordered list is the resolved current record by construction, so
 * `currentSalaryRecordId` and `records[0]?.id` cannot disagree.
 *
 * TOTAL: a repository throw is `unavailable`, never an exception.
 */
export async function getSalaryTimeline(
  deps: SalaryTimelineDeps,
  employeeId: string,
  asOf: PlainDate,
): Promise<GetSalaryTimelineResult> {
  try {
    const history = await deps.repository.findSalaryHistory(employeeId);
    if (history === null) {
      return { kind: 'not-found' };
    }

    // The current record is the ONE resolver's pick (AD-8) — never a second determination. The
    // ordered head below is this same record, because both share `compareSalaryOrder`.
    const current = resolveCurrentSalary(history, asOf);
    const ordered = orderSalaryTimeline(history, asOf);

    return {
      kind: 'timeline',
      timeline: {
        employeeId,
        asOf,
        records: ordered.map((record) => ({
          id: record.id,
          effectiveFrom: record.effectiveFrom,
          // The first OUTBOUND toBoundaryMoney call site (Law 4 / AD-4): amountMinor becomes a
          // decimal string a React prop / JSON boundary can carry. `seq` is simply not copied.
          salary: toBoundaryMoney(record.salary),
        })),
        currentSalaryRecordId: current?.id ?? null,
      },
    };
  } catch {
    return { kind: 'unavailable' };
  }
}
