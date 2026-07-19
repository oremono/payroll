import { describe, expect, it } from 'vitest';

import type { Money } from '@/domain/money';
import type { PlainDate } from '@/domain/plain-date';
import { resolveCurrentSalary, type SalaryRecordView } from '@/domain/salary-timeline';

// Test-first (Law 1 / AD-23): red before `src/domain/salary-timeline.ts` exists.
//
// This file pins AD-8 — THE current-salary resolver, of which there is exactly one in the whole
// product. Every later capability (the timeline, peer comparison, outliers, the gender gap, payroll
// totals, overdue) reads current salary through this function rather than writing its own
// `ORDER BY`, so the ordering asserted here is load-bearing well beyond CAP-3.
//
// The rule, verbatim: current salary is the record with the greatest `(effectiveFrom, seq)` where
// `effectiveFrom <= asOf`. `createdAt` is NEVER an ordering key — it is audit data, and the schema
// says so on the column itself.
//
// The same-date TIE is the DESIGNED path, not an edge case. A same-day correction is CAP-3's only
// correction mechanism (`salary_record` admits no UPDATE), so two records sharing an `effectiveFrom`
// is the normal case rather than an unlucky one.

const INR = (amountMinor: bigint): Money => ({ amountMinor, currency: 'INR' });

const date = (year: number, month: number, day: number): PlainDate => ({ year, month, day });

/** A record as the resolver sees it — id and money ride along; only the ORDER is judged. */
function record(
  id: string,
  effectiveFrom: PlainDate,
  seq: bigint,
  amountMinor: bigint,
): SalaryRecordView {
  return { id, effectiveFrom, seq, salary: INR(amountMinor) };
}

const HIRE = record('hire', date(2021, 6, 1), 1n, 2_000_000n);
const RAISE_2023 = record('raise-2023', date(2023, 4, 1), 2n, 2_400_000n);
const RAISE_2025 = record('raise-2025', date(2025, 1, 15), 3n, 3_000_000n);

describe('resolveCurrentSalary — the ONE current-salary resolver (AD-8)', () => {
  it('returns the record with the greatest effectiveFrom at or before asOf', () => {
    const current = resolveCurrentSalary([HIRE, RAISE_2023, RAISE_2025], date(2026, 7, 19));

    expect(current).toBe(RAISE_2025);
  });

  it('ignores records that take effect AFTER asOf', () => {
    // The as-of date is the whole point of AD-11: asking what someone earned on 2024-01-01 must not
    // be answered with a raise that had not happened yet.
    const current = resolveCurrentSalary([HIRE, RAISE_2023, RAISE_2025], date(2024, 1, 1));

    expect(current).toBe(RAISE_2023);
  });

  it('INCLUDES a record effective exactly ON asOf — the boundary is inclusive', () => {
    // A record dated today is in force today. That inclusiveness is what makes "append a record
    // dated today" a working correction mechanism rather than a change that lands tomorrow.
    const current = resolveCurrentSalary([HIRE, RAISE_2025], date(2025, 1, 15));

    expect(current).toBe(RAISE_2025);
  });

  it('is indifferent to the ORDER of the input list', () => {
    // The list arrives from a repository read, and no caller may depend on its ordering — that is
    // precisely the second `ORDER BY` AD-8 forbids.
    const shuffled = [RAISE_2025, HIRE, RAISE_2023];

    expect(resolveCurrentSalary(shuffled, date(2026, 7, 19))).toBe(RAISE_2025);
  });

  describe('the same-date tie, broken by seq — CAP-3\'s only correction mechanism', () => {
    // A typo corrected on the day it was entered produces two records sharing one `effectiveFrom`.
    // The later INSERT wins, and `seq` (a BIGSERIAL) is the only key that says which that was.
    const TYPO = record('typo', date(2026, 3, 1), 10n, 9_999_999n);
    const CORRECTION = record('correction', date(2026, 3, 1), 11n, 2_500_000n);

    it('returns the greater seq regardless of input order', () => {
      expect(resolveCurrentSalary([TYPO, CORRECTION], date(2026, 3, 1))).toBe(CORRECTION);
      expect(resolveCurrentSalary([CORRECTION, TYPO], date(2026, 3, 1))).toBe(CORRECTION);
    });

    it('breaks the tie on seq and NEVER on createdAt or on list position', () => {
      // The correction was inserted SECOND (greater seq) but is placed FIRST in the list here, and
      // its amount is smaller. Anything reading position, insertion order, or magnitude picks the
      // typo; only `seq` picks the correction.
      expect(resolveCurrentSalary([CORRECTION, TYPO], date(2030, 1, 1))?.id).toBe('correction');
    });

    it('prefers a LATER date even when it carries a SMALLER seq, in EITHER list order', () => {
      // `seq` is a tie-break, not the primary key of the ordering. A backdated correction appended
      // today has the greatest `seq` in the table and must still not outrank a later effective date.
      //
      // BOTH orders, deliberately. With the backdated record second, it has to fail to displace an
      // incumbent it out-ranks on `seq` alone — the direction in which "the dates differ, so the
      // seqs are irrelevant" is actually load-bearing. With it first, the later record merely has
      // to win normally.
      const backdated = record('backdated', date(2022, 1, 1), 99n, 1n);

      expect(resolveCurrentSalary([backdated, RAISE_2025], date(2026, 7, 19))).toBe(RAISE_2025);
      expect(resolveCurrentSalary([RAISE_2025, backdated], date(2026, 7, 19))).toBe(RAISE_2025);
    });

    it('requires seq to be STRICTLY greater to displace an equal-dated record', () => {
      // `salary_record.seq` is UNIQUE, so equal seqs cannot arise from the database — but this
      // function is TOTAL over any list it is handed, and "greatest" means strictly greater. With a
      // non-strict comparison the answer would depend on list position, which is the one thing AD-8
      // says it must never depend on.
      const first = record('first', date(2026, 3, 1), 7n, 1_000_000n);
      const second = record('second', date(2026, 3, 1), 7n, 2_000_000n);

      expect(resolveCurrentSalary([first, second], date(2026, 3, 1))).toBe(first);
    });
  });

  describe('total — every input has an answer, and none of them is an exception', () => {
    it('answers null for an empty list', () => {
      expect(resolveCurrentSalary([], date(2026, 7, 19))).toBeNull();
    });

    it('answers null when EVERY record takes effect after asOf', () => {
      // An employee hired after the as-of date, or one created with no salary yet: legitimately
      // outside the as-of population (AD-16), not an error.
      expect(resolveCurrentSalary([RAISE_2023, RAISE_2025], date(2021, 1, 1))).toBeNull();
    });

    it('returns the single record when there is exactly one, and it is eligible', () => {
      expect(resolveCurrentSalary([HIRE], date(2021, 6, 1))).toBe(HIRE);
    });

    it('returns null for a single record dated one day after asOf', () => {
      expect(resolveCurrentSalary([HIRE], date(2021, 5, 31))).toBeNull();
    });
  });
});
