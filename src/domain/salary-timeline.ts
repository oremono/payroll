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
 * THE `(effectiveFrom, seq)` comparison, and the only one. Negative when `a` orders BEFORE `b`,
 * positive when after, zero when neither (same date AND same seq).
 *
 * There is exactly one of these because there is exactly one ordering (AD-8): the resolver reads it
 * to find "greatest", and the timeline reads it to sort newest-first. A second comparator anywhere
 * is how the tie-break forks and two surfaces begin disagreeing about which record is current — so
 * both route through here, and the agreement between them is a mechanical consequence rather than a
 * thing each maintains independently. `SalaryRecordOrder` is the whole of what it reads; a richer
 * row rides along untouched.
 *
 * A THREE-WAY sign: `1` when `a` orders after `b`, `-1` when before, `0` when neither — the last
 * only for a record measured against one sharing BOTH its date and its `seq`. `salary_record.seq` is
 * UNIQUE so that never happens for two distinct rows, but the function is TOTAL over any list it is
 * handed and the `0` is what a comparator must return for a genuine tie: the resolver reads it as
 * "not strictly later" (`> 0` is false, so the incumbent is kept), and `Array.prototype.sort` reads
 * it as "equal", leaving the pair in input order. Both are pinned by a test, so the `0` is live, not
 * decoration.
 *
 * STRICT on `seq`, and the two `seq` arms are written for BOTH signs explicitly rather than as
 * "nonzero, then positive": the second form would sit a sign test on a value already known to be
 * nonzero, so relaxing it changes nothing and no test could distinguish the two — a comparison this
 * much later code reads through does not get one no test constrains. The date is returned as the raw
 * `comparePlainDate` result; both callers read only its SIGN, never its magnitude.
 */
function compareSalaryOrder(a: SalaryRecordOrder, b: SalaryRecordOrder): number {
  const byDate = comparePlainDate(a.effectiveFrom, b.effectiveFrom);
  if (byDate !== 0) {
    return byDate;
  }
  // Same day — the DESIGNED path, not an edge case. `seq` decides, and `createdAt` never does.
  if (a.seq > b.seq) {
    return 1;
  }
  if (a.seq < b.seq) {
    return -1;
  }
  return 0;
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
    // STRICTLY later — `compareSalaryOrder(record, current) > 0`. The one comparison the timeline
    // also sorts by, so the resolver's pick and the timeline's head cannot fork (AD-8).
    if (current === null || compareSalaryOrder(record, current) > 0) {
      current = record;
    }
  }

  return current;
}

/**
 * The salary timeline as of `asOf`: every eligible record, NEWEST FIRST — a DISPLAY ordering, not a
 * second answer to "what is current" (that is still and only `resolveCurrentSalary`, AD-8).
 *
 * As-of filtered the same way the resolver is: a record with `effectiveFrom <= asOf` is in, one
 * after `asOf` is out. The bound is INCLUSIVE, so a record dated exactly on `asOf` shows — the same
 * inclusiveness that makes "append a record dated today" a working correction. Because future-dating
 * is rejected on write, at the default `asOf` = today every record is visible, and rewinding the
 * control only hides not-yet-effective records.
 *
 * Sorted through the ONE `compareSalaryOrder` (descending), so `orderSalaryTimeline(records, asOf)[0]`
 * is exactly `resolveCurrentSalary(records, asOf)` — the agreement is a consequence of sharing the
 * comparison, not a coincidence a test hopes for. Pure and TOTAL: an empty or all-future list is
 * `[]`, never an exception. Computes on a COPY (`filter` already allocates one) so the caller's list
 * is never disturbed.
 */
export function orderSalaryTimeline<T extends SalaryRecordOrder>(
  records: readonly T[],
  asOf: PlainDate,
): readonly T[] {
  return records
    .filter((record) => comparePlainDate(record.effectiveFrom, asOf) <= 0)
    .sort((a, b) => compareSalaryOrder(b, a));
}
