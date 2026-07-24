import { describe, expect, it } from 'vitest';

import type { Gender } from '@/domain/employee-fields';
import {
  computeGenderDistribution,
  type GenderDistributionCandidate,
  type LevelAxisEntry,
} from '@/domain/gender-distribution';
import type { PlainDate } from '@/domain/plain-date';
import type { SalaryRecordOrder } from '@/domain/salary-timeline';

// Test-first (Law 1 / AD-23): red before `src/domain/gender-distribution.ts` exists.
//
// CAP-8 (AD-16 / AD-2): fold the ORG-WIDE candidate set into per-level gender counts. Membership is
// the ONE `resolveCurrentSalary` (AD-8) — an employee is in-population iff a salary is in force at
// `asOf`. Count PEOPLE, not records: a person with two same-day records is ONE increment. The level
// axis is the reference taxonomy, resolved is_active-INCLUSIVE and rank-ordered; a level appears iff
// it is active OR holds an in-population person. `totals` are the org-wide sums.
//
// Pure, TOTAL, deterministic: `asOf` is a required argument, no clock/random/IO. This file walks
// EVERY domain row of the spec I/O matrix and pins each branch for the 100% mutation floor.

const date = (year: number, month: number, day: number): PlainDate => ({ year, month, day });

const AS_OF = date(2026, 7, 16);
const IN_FORCE = date(2020, 1, 1);
const FUTURE = date(2027, 1, 1);

/** One in-force salary record — the only two ordering columns membership reads (AD-8). */
function rec(effectiveFrom: PlainDate = IN_FORCE, seq = 1n): SalaryRecordOrder {
  return { effectiveFrom, seq };
}

/** One single-record candidate at a level with a gender — the common case. */
function person(
  gender: Gender,
  levelCode: string,
  effectiveFrom: PlainDate = IN_FORCE,
): GenderDistributionCandidate {
  return { gender, levelCode, salaryRecords: [rec(effectiveFrom)] };
}

/** `count` people of one gender at `levelCode`, all in force since `IN_FORCE`. */
function cohort(gender: Gender, levelCode: string, count: number): GenderDistributionCandidate[] {
  return Array.from({ length: count }, () => person(gender, levelCode));
}

function level(
  levelCode: string,
  rank: number,
  isActive: boolean,
  levelLabel: string = levelCode,
): LevelAxisEntry {
  return { levelCode, levelLabel, rank, isActive };
}

describe('computeGenderDistribution — the golden multi-level happy path', () => {
  it('rank-orders per-level counts, omits the inactive-empty level, and sums org-wide totals', () => {
    // levels: L1(rank 1, active), L2(rank 2, active), LX(rank 9, inactive)
    // in-population: L1 → 3 MALE, 2 FEMALE · L2 → 1 FEMALE · LX → 0
    const levels = [level('L1', 1, true), level('L2', 2, true), level('LX', 9, false)];
    const candidates = [
      ...cohort('MALE', 'L1', 3),
      ...cohort('FEMALE', 'L1', 2),
      ...cohort('FEMALE', 'L2', 1),
    ];

    const result = computeGenderDistribution(levels, candidates, AS_OF);

    expect(result).toEqual({
      levels: [
        { levelCode: 'L1', levelLabel: 'L1', maleN: 3, femaleN: 2, total: 5 },
        { levelCode: 'L2', levelLabel: 'L2', maleN: 0, femaleN: 1, total: 1 },
      ],
      totals: { male: 3, female: 3, total: 6 },
    });
  });

  it('carries the level.name label verbatim onto each row', () => {
    const levels = [level('L1', 1, true, 'Junior'), level('L2', 2, true, 'Senior')];
    const candidates = [...cohort('MALE', 'L1', 1), ...cohort('FEMALE', 'L2', 1)];

    const result = computeGenderDistribution(levels, candidates, AS_OF);

    expect(result.levels.map((row) => row.levelLabel)).toEqual(['Junior', 'Senior']);
  });
});

describe('computeGenderDistribution — the empty population is an answer of zeros, never a refusal', () => {
  it('presents active levels at 0/0, omits inactive-empty levels, totals are zero', () => {
    const levels = [level('L1', 1, true), level('L2', 2, true), level('LX', 9, false)];

    const result = computeGenderDistribution(levels, [], AS_OF);

    expect(result).toEqual({
      levels: [
        { levelCode: 'L1', levelLabel: 'L1', maleN: 0, femaleN: 0, total: 0 },
        { levelCode: 'L2', levelLabel: 'L2', maleN: 0, femaleN: 0, total: 0 },
      ],
      totals: { male: 0, female: 0, total: 0 },
    });
  });
});

describe('computeGenderDistribution — count PEOPLE, not records (AD-8 tie-break, AD-2)', () => {
  it('counts a person with two same-day records exactly once', () => {
    // A same-day correction: two records sharing `effectiveFrom`, the greater-seq one current. Either
    // way the PERSON is one increment in one bucket — never two.
    const corrected: GenderDistributionCandidate = {
      gender: 'MALE',
      levelCode: 'L1',
      salaryRecords: [rec(IN_FORCE, 1n), rec(IN_FORCE, 2n)],
    };
    const levels = [level('L1', 1, true)];

    const result = computeGenderDistribution(levels, [corrected], AS_OF);

    expect(result.levels).toEqual([
      { levelCode: 'L1', levelLabel: 'L1', maleN: 1, femaleN: 0, total: 1 },
    ]);
    expect(result.totals).toEqual({ male: 1, female: 0, total: 1 });
  });
});

describe('computeGenderDistribution — the as-of population defines every count (AD-16)', () => {
  it('excludes a member whose only salary is not yet effective, lowering that level and totals', () => {
    const levels = [level('L1', 1, true)];
    const candidates = [
      ...cohort('MALE', 'L1', 2),
      person('MALE', 'L1', FUTURE), // not yet in force at AS_OF → excluded
    ];

    const result = computeGenderDistribution(levels, candidates, AS_OF);

    expect(result.levels).toEqual([
      { levelCode: 'L1', levelLabel: 'L1', maleN: 2, femaleN: 0, total: 2 },
    ]);
    expect(result.totals).toEqual({ male: 2, female: 0, total: 2 });
  });

  it('excludes a person with no salary record at all (never counted anywhere)', () => {
    const levels = [level('L1', 1, true)];
    const noSalary: GenderDistributionCandidate = { gender: 'FEMALE', levelCode: 'L1', salaryRecords: [] };

    const result = computeGenderDistribution(levels, [noSalary], AS_OF);

    expect(result.levels).toEqual([
      { levelCode: 'L1', levelLabel: 'L1', maleN: 0, femaleN: 0, total: 0 },
    ]);
    expect(result.totals).toEqual({ male: 0, female: 0, total: 0 });
  });
});

describe('computeGenderDistribution — the level axis is strictly rank-ordered', () => {
  it('emits levels ascending by rank even when handed them out of order', () => {
    // Ranks out of insertion order: the output MUST be strictly ascending by rank.
    const levels = [level('L3', 3, true), level('L1', 1, true), level('L2', 2, true)];
    const candidates = [
      ...cohort('MALE', 'L1', 1),
      ...cohort('FEMALE', 'L2', 1),
      ...cohort('MALE', 'L3', 1),
    ];

    const result = computeGenderDistribution(levels, candidates, AS_OF);

    expect(result.levels.map((row) => row.levelCode)).toEqual(['L1', 'L2', 'L3']);
  });
});

describe('computeGenderDistribution — is_active gates output, never existing statistics (AD-16)', () => {
  it('keeps an ACTIVE EMPTY level present at 0/0 (taxonomy completeness)', () => {
    const levels = [level('L1', 1, true), level('L2', 2, true)];
    const candidates = [...cohort('MALE', 'L1', 1)];

    const result = computeGenderDistribution(levels, candidates, AS_OF);

    expect(result.levels).toEqual([
      { levelCode: 'L1', levelLabel: 'L1', maleN: 1, femaleN: 0, total: 1 },
      { levelCode: 'L2', levelLabel: 'L2', maleN: 0, femaleN: 0, total: 0 },
    ]);
  });

  it('keeps an INACTIVE level that still holds in-population people, with its real counts', () => {
    // is_active never hides existing statistics: an inactive level with people MUST appear.
    const levels = [level('L1', 1, true), level('LX', 9, false)];
    const candidates = [...cohort('MALE', 'L1', 1), ...cohort('FEMALE', 'LX', 2)];

    const result = computeGenderDistribution(levels, candidates, AS_OF);

    expect(result.levels).toEqual([
      { levelCode: 'L1', levelLabel: 'L1', maleN: 1, femaleN: 0, total: 1 },
      { levelCode: 'LX', levelLabel: 'LX', maleN: 0, femaleN: 2, total: 2 },
    ]);
    expect(result.totals).toEqual({ male: 1, female: 2, total: 3 });
  });

  it('OMITS an inactive EMPTY level as retired noise', () => {
    const levels = [level('L1', 1, true), level('LX', 9, false)];
    const candidates = [...cohort('MALE', 'L1', 1)];

    const result = computeGenderDistribution(levels, candidates, AS_OF);

    expect(result.levels.map((row) => row.levelCode)).toEqual(['L1']);
  });

  it('drops an inactive level whose only member is not in the as-of population', () => {
    // The level is inactive AND its lone member is future-effective → in-population total is 0 → omit.
    const levels = [level('L1', 1, true), level('LX', 9, false)];
    const candidates = [...cohort('MALE', 'L1', 1), person('FEMALE', 'LX', FUTURE)];

    const result = computeGenderDistribution(levels, candidates, AS_OF);

    expect(result.levels.map((row) => row.levelCode)).toEqual(['L1']);
    expect(result.totals).toEqual({ male: 1, female: 0, total: 1 });
  });
});

describe('computeGenderDistribution — gender exhaustiveness: both fields always present', () => {
  it('reports femaleN 0 for a MALE-only population, at each level and in totals', () => {
    const levels = [level('L1', 1, true)];
    const candidates = [...cohort('MALE', 'L1', 3)];

    const result = computeGenderDistribution(levels, candidates, AS_OF);

    expect(result.levels).toEqual([
      { levelCode: 'L1', levelLabel: 'L1', maleN: 3, femaleN: 0, total: 3 },
    ]);
    expect(result.totals).toEqual({ male: 3, female: 0, total: 3 });
  });

  it('reports maleN 0 for a FEMALE-only population, at each level and in totals', () => {
    const levels = [level('L1', 1, true)];
    const candidates = [...cohort('FEMALE', 'L1', 2)];

    const result = computeGenderDistribution(levels, candidates, AS_OF);

    expect(result.levels).toEqual([
      { levelCode: 'L1', levelLabel: 'L1', maleN: 0, femaleN: 2, total: 2 },
    ]);
    expect(result.totals).toEqual({ male: 0, female: 2, total: 2 });
  });
});

describe('computeGenderDistribution — determinism (Law 6 / AD-11)', () => {
  it('returns a deep-equal result for the same data and asOf', () => {
    const levels = [level('L2', 2, true), level('L1', 1, true)];
    const candidates = [...cohort('MALE', 'L1', 2), ...cohort('FEMALE', 'L2', 1)];

    const first = computeGenderDistribution(levels, candidates, AS_OF);
    const second = computeGenderDistribution(levels, candidates, AS_OF);

    expect(first).toEqual(second);
  });
});
