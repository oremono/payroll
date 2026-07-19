/**
 * THE current-salary resolver (AD-8). There is exactly one, it lives here, and it is pure.
 *
 * No I/O, no clock, no randomness, no imports outside this layer — records in, one record out.
 * (Law 2 / AD-1) TOTAL: an employee with no eligible record is `null`, never an exception.
 *
 * ## The rule, and why every part of it matters
 *
 * Current salary as of `asOf` is the record with the greatest `(effectiveFrom, seq)` among those
 * whose `effectiveFrom <= asOf`.
 *
 *   - `asOf` is a REQUIRED ARGUMENT, never a clock read (Law 6 / AD-11). Same records + same as-of
 *     ⇒ identical answer, for every reader in every timezone.
 *   - The date bound is INCLUSIVE. A record dated today is in force today, which is what makes
 *     "append a record dated today" a working correction mechanism rather than one that lands
 *     tomorrow.
 *   - `seq` breaks a same-date tie, and `createdAt` may NEVER be used for it — the schema says so on
 *     the column itself. `seq` is a `BIGSERIAL`: monotonic but GAP-PRONE under rolled-back
 *     transactions, so it is ORDERED BY and never arithmetic'd on.
 *
 * The same-date tie is the DESIGNED path, not an edge case. `salary_record` admits no UPDATE
 * (Law 5 / AD-18), so a typo is corrected by appending a second record dated the same day — two
 * records sharing an `effectiveFrom` is the normal case, and which one wins is the entire question.
 *
 * ## One resolver, consumed by everything
 *
 * The timeline (Epic 5), peer comparison, outliers, the gender gap, payroll totals, and overdue all
 * read current salary through this function. None of them writes its own `ORDER BY` over
 * `salary_record`, and the database computes no statistic a user sees (Law 2). A second ordering
 * anywhere is how two surfaces start disagreeing about what someone earns.
 */

import type { Money } from './money';
import { comparePlainDate, type PlainDate } from './plain-date';

/**
 * The two columns the ordering is defined over, and nothing else.
 *
 * The resolver is generic over this rather than over a fixed row type so a later capability can hand
 * it a RICHER row — one carrying the employee, the country, whatever that capability reads — and get
 * that same row back, without anyone being tempted to re-implement the ordering for a different
 * shape. The ordering is the thing that is singular; the row is not.
 */
export type SalaryRecordOrder = {
  readonly effectiveFrom: PlainDate;
  /** `salary_record.seq`, a `BIGSERIAL`. A `bigint` because it is one — never a `number`. */
  readonly seq: bigint;
};

/** One salary record as a read hands it over: its identity, its money, and its ordering keys. */
export type SalaryRecordView = SalaryRecordOrder & {
  readonly id: string;
  /** AD-4: never bare. The currency is the record's own, never re-resolved at read time (AD-6). */
  readonly salary: Money;
};

/**
 * Is `candidate` later in the `(effectiveFrom, seq)` order than `incumbent`?
 *
 * STRICTLY later. "Greatest" admits no ties, and `salary_record.seq` is UNIQUE so a real tie cannot
 * arise — but this function is total over any list it is handed, and a non-strict comparison would
 * make the answer depend on the position of an equal pair in the input, which is exactly what AD-8
 * says it must never depend on.
 *
 * The date is tested for BOTH signs explicitly, rather than as "nonzero, then positive". The two
 * are equivalent, and that is precisely the problem: written the second way, the sign test sits on a
 * value already known to be nonzero, so relaxing it to `>= 0` changes nothing and no test can
 * distinguish the two. A rule this much later code reads through does not get to have a comparison
 * no test constrains. Three explicit arms, each independently reachable and each pinned.
 */
function isLaterThan(candidate: SalaryRecordOrder, incumbent: SalaryRecordOrder): boolean {
  const byDate = comparePlainDate(candidate.effectiveFrom, incumbent.effectiveFrom);
  if (byDate > 0) {
    return true;
  }
  if (byDate < 0) {
    return false;
  }
  // Same day — the DESIGNED path, not an edge case. `seq` decides, and `createdAt` never does.
  return candidate.seq > incumbent.seq;
}

/**
 * The record in force at `asOf`, or `null` when none is.
 *
 * A single linear pass rather than a sort: sorting would need a total comparator for records the
 * caller never asked about, and would invite a caller to reach for the sorted list and read a
 * different element from it. One answer, no intermediate ordering to misuse.
 *
 * `null` is not a failure. An employee hired after `asOf`, or one created with no salary record yet
 * (CAP-2 creates exactly that), is legitimately outside the as-of population (AD-16).
 */
export function resolveCurrentSalary<T extends SalaryRecordOrder>(
  records: readonly T[],
  asOf: PlainDate,
): T | null {
  let current: T | null = null;

  for (const record of records) {
    // Inclusive of `asOf` itself — see the header.
    if (comparePlainDate(record.effectiveFrom, asOf) > 0) {
      continue;
    }
    if (current === null || isLaterThan(record, current)) {
      current = record;
    }
  }

  return current;
}
