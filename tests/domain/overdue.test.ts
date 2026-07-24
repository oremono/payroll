import { describe, expect, it } from 'vitest';

import {
  compareOverdueRows,
  computeOverdue,
  type OverdueCandidate,
  type OverduePeriod,
  type OverdueRow,
} from '@/domain/overdue';
import type { Money } from '@/domain/money';
import type { PlainDate } from '@/domain/plain-date';
import type { SalaryRecordView } from '@/domain/salary-timeline';

// Test-first (Law 1 / AD-23): red before `src/domain/overdue.ts` exists.
//
// CAP-10 (AD-22 / AD-16 / AD-8): resolve the cutoff from the passed `asOf` and the period, keep only
// the as-of population (the ONE `resolveCurrentSalary`), and list those whose CURRENT record is
// STRICTLY earlier than the cutoff — a record dated exactly on the cutoff is NOT overdue. A hire
// record is a salary record. Rows are ordered oldest record first, then `employeeId` byte-wise
// ascending. Pure, TOTAL, deterministic: `asOf` and `period` are required arguments; no clock, no
// random, no I/O — the cutoff is `asOf − period`, never a wall-clock date (AD-22).
//
// This file walks EVERY domain row of the spec I/O matrix and pins each branch for the 100% mutation
// floor, plus the direct `compareOverdueRows` arms (its equal-case `0` is unreachable through the
// sort, so it is asserted directly — the same discipline `compareStrings` is held to).

const date = (year: number, month: number, day: number): PlainDate => ({ year, month, day });

const AS_OF = date(2026, 7, 16);
// period 24 months ⇒ cutoff = 16 Jul 2024 (the golden domain example).
const PERIOD_24: OverduePeriod = { kind: 'months', months: 24 };
const CUTOFF_24 = date(2024, 7, 16);

const money = (amountMinor: bigint): Money => ({ amountMinor, currency: 'USD' });

/** One salary record as a read hands it over (the resolver's ordering columns + Money). */
function record(effectiveFrom: PlainDate, amountMinor: bigint, seq = 1n): SalaryRecordView {
  return { id: `rec-${seq}`, seq, effectiveFrom, salary: money(amountMinor) };
}

function candidate(
  employeeId: string,
  name: string,
  salaryHistory: readonly SalaryRecordView[],
): OverdueCandidate {
  return { employeeId, name, salaryHistory };
}

describe('computeOverdue — cutoff resolution (AD-22)', () => {
  it('derives the cutoff from asOf and the month period (asOf − period, not the clock)', () => {
    const result = computeOverdue({ candidates: [], asOf: AS_OF, period: PERIOD_24 });
    expect(result.cutoff).toEqual(CUTOFF_24);
  });

  it('uses a custom absolute cutoff verbatim when the period is a date', () => {
    const cutoff = date(2023, 3, 10);
    const result = computeOverdue({
      candidates: [],
      asOf: AS_OF,
      period: { kind: 'date', cutoff },
    });
    expect(result.cutoff).toEqual(cutoff);
  });

  it('clamps a leap-day asOf back onto 28 Feb of the prior year (AD-22 / M-5)', () => {
    const result = computeOverdue({
      candidates: [],
      asOf: date(2028, 2, 29),
      period: { kind: 'months', months: 12 },
    });
    expect(result.cutoff).toEqual(date(2027, 2, 28));
  });
});

describe('computeOverdue — the overdue rule: strictly earlier than the cutoff (AD-22)', () => {
  it('includes an employee whose current record is one day before the cutoff', () => {
    const result = computeOverdue({
      candidates: [candidate('e1', 'Ana', [record(date(2024, 7, 15), 100n)])],
      asOf: AS_OF,
      period: PERIOD_24,
    });
    expect(result.rows).toEqual<readonly OverdueRow[]>([
      { employeeId: 'e1', name: 'Ana', effectiveFrom: date(2024, 7, 15), salary: money(100n) },
    ]);
  });

  it('EXCLUDES an employee whose current record is exactly on the cutoff (on-cutoff is not overdue)', () => {
    const result = computeOverdue({
      candidates: [candidate('e1', 'Ana', [record(CUTOFF_24, 100n)])],
      asOf: AS_OF,
      period: PERIOD_24,
    });
    expect(result.rows).toEqual([]);
  });

  it('EXCLUDES an employee whose current record is one day after the cutoff', () => {
    const result = computeOverdue({
      candidates: [candidate('e1', 'Ana', [record(date(2024, 7, 17), 100n)])],
      asOf: AS_OF,
      period: PERIOD_24,
    });
    expect(result.rows).toEqual([]);
  });
});

describe('computeOverdue — a hire record is a salary record (AD-22)', () => {
  it('surfaces a hire-only employee whose single record long predates the cutoff', () => {
    const result = computeOverdue({
      candidates: [candidate('e1', 'Old Timer', [record(date(2019, 3, 1), 500n)])],
      asOf: AS_OF,
      period: PERIOD_24,
    });
    expect(result.rows).toEqual<readonly OverdueRow[]>([
      {
        employeeId: 'e1',
        name: 'Old Timer',
        effectiveFrom: date(2019, 3, 1),
        salary: money(500n),
      },
    ]);
  });
});

describe('computeOverdue — as-of population membership (AD-16)', () => {
  it('excludes an employee hired after asOf (no record in force) — no row, no refusal', () => {
    const result = computeOverdue({
      candidates: [candidate('e1', 'Future', [record(date(2026, 8, 1), 100n)])],
      asOf: AS_OF,
      period: PERIOD_24,
    });
    expect(result.rows).toEqual([]);
  });

  it('excludes an employee with no salary records at all', () => {
    const result = computeOverdue({
      candidates: [candidate('e1', 'Empty', [])],
      asOf: AS_OF,
      period: PERIOD_24,
    });
    expect(result.rows).toEqual([]);
  });
});

describe('computeOverdue — judged on the CURRENT record, not the oldest/newest-ever (AD-8)', () => {
  it('uses the greatest (effectiveFrom, seq) ≤ asOf; a recent raise clears an old hire', () => {
    // Hired 2019 but raised 2025 (after the cutoff): the CURRENT record is 2025, so NOT overdue —
    // proof the rule reads the current record, not the oldest one on file.
    const result = computeOverdue({
      candidates: [
        candidate('e1', 'Raised', [record(date(2019, 1, 1), 100n, 1n), record(date(2025, 6, 1), 200n, 2n)]),
      ],
      asOf: AS_OF,
      period: PERIOD_24,
    });
    expect(result.rows).toEqual([]);
  });

  it('breaks a same-date tie by seq: the later-seq current record decides overdue-ness', () => {
    // Two records dated the same day BEFORE the cutoff (a correction). The greater-seq one is current
    // and its date is what the row carries; both predate the cutoff, so the employee is overdue once.
    const result = computeOverdue({
      candidates: [
        candidate('e1', 'Corrected', [
          record(date(2023, 1, 1), 100n, 1n),
          record(date(2023, 1, 1), 150n, 2n),
        ]),
      ],
      asOf: AS_OF,
      period: PERIOD_24,
    });
    expect(result.rows).toEqual<readonly OverdueRow[]>([
      { employeeId: 'e1', name: 'Corrected', effectiveFrom: date(2023, 1, 1), salary: money(150n) },
    ]);
  });

  it('ignores a not-yet-effective future record and judges the record in force at asOf', () => {
    // Current record (2023) is overdue; a 2027 record exists but is after asOf, so it does not save
    // the employee from the list.
    const result = computeOverdue({
      candidates: [
        candidate('e1', 'Pending', [record(date(2023, 1, 1), 100n, 1n), record(date(2027, 1, 1), 300n, 2n)]),
      ],
      asOf: AS_OF,
      period: PERIOD_24,
    });
    expect(result.rows).toEqual<readonly OverdueRow[]>([
      { employeeId: 'e1', name: 'Pending', effectiveFrom: date(2023, 1, 1), salary: money(100n) },
    ]);
  });
});

describe('computeOverdue — ordering: oldest record first, then employeeId ascending', () => {
  it('orders overdue rows by effectiveFrom ascending regardless of input order', () => {
    const c2019 = candidate('e1', 'C', [record(date(2019, 1, 1), 100n)]);
    const a2024 = candidate('e2', 'A', [record(date(2024, 7, 10), 200n)]);
    const result = computeOverdue({
      // Input NEWEST first — the output must still be oldest first.
      candidates: [a2024, c2019],
      asOf: AS_OF,
      period: PERIOD_24,
    });
    expect(result.rows.map((row) => row.employeeId)).toEqual(['e1', 'e2']);
  });

  it('breaks a same effectiveFrom tie by employeeId ascending, independent of input order', () => {
    const same = date(2023, 5, 1);
    const zeb = candidate('zeb', 'Zeb', [record(same, 100n)]);
    const abe = candidate('abe', 'Abe', [record(same, 100n)]);
    const forward = computeOverdue({ candidates: [zeb, abe], asOf: AS_OF, period: PERIOD_24 });
    const reversed = computeOverdue({ candidates: [abe, zeb], asOf: AS_OF, period: PERIOD_24 });
    expect(forward.rows.map((row) => row.employeeId)).toEqual(['abe', 'zeb']);
    expect(reversed.rows.map((row) => row.employeeId)).toEqual(['abe', 'zeb']);
  });
});

describe('computeOverdue — the mixed golden population', () => {
  it('keeps only strictly-earlier in-population rows, oldest first (the spec golden example)', () => {
    // A: current 10 Jul 2024 < cutoff -> OVERDUE. B: 16 Jul 2024 == cutoff -> not overdue.
    // C: hire 2019 -> OVERDUE. D: hired after asOf -> excluded.
    const a = candidate('A', 'A', [record(date(2024, 7, 10), 100n)]);
    const b = candidate('B', 'B', [record(CUTOFF_24, 200n)]);
    const c = candidate('C', 'C', [record(date(2019, 1, 1), 300n)]);
    const d = candidate('D', 'D', [record(date(2026, 8, 1), 400n)]);

    const result = computeOverdue({ candidates: [a, b, c, d], asOf: AS_OF, period: PERIOD_24 });

    expect(result.rows).toEqual<readonly OverdueRow[]>([
      { employeeId: 'C', name: 'C', effectiveFrom: date(2019, 1, 1), salary: money(300n) },
      { employeeId: 'A', name: 'A', effectiveFrom: date(2024, 7, 10), salary: money(100n) },
    ]);
  });
});

describe('computeOverdue — custom cutoff date governs overdue-ness while asOf governs membership', () => {
  it('measures rows against the custom cutoff but drops members outside the asOf population', () => {
    const period: OverduePeriod = { kind: 'date', cutoff: date(2022, 1, 1) };
    // e1: current 2021 < 2022 cutoff, in population at asOf -> OVERDUE.
    // e2: current 2021 but the ONLY later record is dated after asOf; still in population via 2021.
    // e3: hired after asOf -> out of population, excluded even though 2021 < cutoff would qualify.
    const e1 = candidate('e1', 'One', [record(date(2021, 6, 1), 100n)]);
    const e3 = candidate('e3', 'Three', [record(date(2026, 9, 1), 300n)]);

    const result = computeOverdue({ candidates: [e1, e3], asOf: AS_OF, period });

    expect(result.cutoff).toEqual(date(2022, 1, 1));
    expect(result.rows.map((row) => row.employeeId)).toEqual(['e1']);
  });
});

describe('computeOverdue — zero-state and determinism', () => {
  it('answers rows: [] for an empty candidate list (never throws, never unavailable)', () => {
    const result = computeOverdue({ candidates: [], asOf: AS_OF, period: PERIOD_24 });
    expect(result).toEqual({ cutoff: CUTOFF_24, rows: [] });
  });

  it('answers rows: [] when everyone is in-population but on-or-after the cutoff', () => {
    const result = computeOverdue({
      candidates: [
        candidate('e1', 'A', [record(CUTOFF_24, 100n)]),
        candidate('e2', 'B', [record(date(2025, 1, 1), 200n)]),
      ],
      asOf: AS_OF,
      period: PERIOD_24,
    });
    expect(result.rows).toEqual([]);
  });

  it('is deterministic: value-equal but DISTINCT inputs yield byte-identical output', () => {
    // Build the inputs twice so the two calls share no object reference — a pure function must
    // answer by value, not by identity (a shared-array mutation or clock read would break this).
    const build = () => [candidate('e1', 'Ana', [record(date(2019, 1, 1), 100n)])];
    const first = computeOverdue({ candidates: build(), asOf: date(2026, 7, 16), period: { kind: 'months', months: 24 } });
    const second = computeOverdue({ candidates: build(), asOf: date(2026, 7, 16), period: { kind: 'months', months: 24 } });
    expect(first).toEqual(second);
  });

  it('recomputes cutoff AND membership when asOf is wound back (the AD-22 determinism promise)', () => {
    // One employee, current record dated 10 Jul 2024 — held fixed while only asOf moves.
    const staff = [candidate('e1', 'Ana', [record(date(2024, 7, 10), 100n)])];

    // As-of 2026: cutoff 16 Jul 2024, and 10 Jul 2024 < cutoff ⇒ overdue.
    const now = computeOverdue({ candidates: staff, asOf: date(2026, 7, 16), period: PERIOD_24 });
    expect(now.cutoff).toEqual(date(2024, 7, 16));
    expect(now.rows.map((row) => row.employeeId)).toEqual(['e1']);

    // Wind asOf back one year: the cutoff moves to 16 Jul 2023, so the SAME record is no longer
    // strictly-earlier — the overdue set is recomputed from asOf, not the clock.
    const earlier = computeOverdue({ candidates: staff, asOf: date(2025, 7, 16), period: PERIOD_24 });
    expect(earlier.cutoff).toEqual(date(2023, 7, 16));
    expect(earlier.rows).toEqual([]);

    // Wind past the record's own date: the employee drops OUT of the as-of population entirely.
    const before = computeOverdue({ candidates: staff, asOf: date(2024, 1, 1), period: PERIOD_24 });
    expect(before.rows).toEqual([]);
  });
});

// The row comparator is exported so its every arm is pinned DIRECTLY — the sort observes only its
// sign and its equal-case `0` is unreachable through distinct ids, exactly as `compareStrings` is.
describe('compareOverdueRows', () => {
  const row = (employeeId: string, effectiveFrom: PlainDate): OverdueRow => ({
    employeeId,
    name: employeeId,
    effectiveFrom,
    salary: money(1n),
  });

  it('orders the earlier record first (negative)', () => {
    expect(compareOverdueRows(row('a', date(2019, 1, 1)), row('b', date(2024, 1, 1)))).toBeLessThan(0);
  });

  it('orders the later record after (positive)', () => {
    expect(compareOverdueRows(row('a', date(2024, 1, 1)), row('b', date(2019, 1, 1)))).toBeGreaterThan(0);
  });

  it('breaks a same-date tie by employeeId ascending (negative then positive)', () => {
    const same = date(2023, 1, 1);
    expect(compareOverdueRows(row('abe', same), row('zeb', same))).toBe(-1);
    expect(compareOverdueRows(row('zeb', same), row('abe', same))).toBe(1);
  });

  it('returns 0 for the same date and the same employeeId', () => {
    const same = date(2023, 1, 1);
    expect(compareOverdueRows(row('same', same), row('same', same))).toBe(0);
  });
});
