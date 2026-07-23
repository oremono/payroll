import { describe, expect, it } from 'vitest';

import type { Gender } from '@/domain/employee-fields';
import {
  computeGenderGap,
  genderGapPctTenths,
  type GenderGapCandidate,
} from '@/domain/gender-gap';
import type { PlainDate } from '@/domain/plain-date';
import type { SalaryRecordView } from '@/domain/salary-timeline';

// Test-first (Law 1 / AD-23): red before `src/domain/gender-gap.ts` exists.
//
// The gender gap (AD-17): within ONE peer group, split the as-of population (AD-16) by gender,
// require >= 5 of EACH, and report `gap = (maleMedian - femaleMedian) / maleMedian × 100` — male
// median ALWAYS the denominator, positive means men paid more, rounded half-up to one decimal in
// exact `bigint` (never IEEE float). Reuses the ONE `median`, the ONE `resolveCurrentSalary`, the
// ONE `divideRoundHalfUp`, and `MIN_PEER_GROUP_SIZE = 5` — no second anything.
//
// Pure, TOTAL, deterministic: `asOf` is a required argument, a too-thin gender split is a RETURN
// VALUE carrying its counts, and a median of an empty gender set is never computed. This file walks
// every domain row of the spec I/O matrix and pins each branch for the 100% mutation floor.

const date = (year: number, month: number, day: number): PlainDate => ({ year, month, day });

const AS_OF = date(2026, 7, 16);
const IN_FORCE = date(2020, 1, 1);
const FUTURE = date(2027, 1, 1);

function rec(
  amountMinor: bigint,
  effectiveFrom: PlainDate = IN_FORCE,
  seq = 1n,
  currency = 'INR',
): SalaryRecordView {
  return { id: `r-${String(seq)}`, seq, effectiveFrom, salary: { amountMinor, currency } };
}

/** One single-record candidate with a gender — the common case. */
function person(
  employeeId: string,
  gender: Gender,
  amountMinor: bigint,
  effectiveFrom: PlainDate = IN_FORCE,
): GenderGapCandidate {
  return { employeeId, gender, salaryHistory: [rec(amountMinor, effectiveFrom)] };
}

/** `count` members of one gender, each on `amountMinor`, ids prefixed so they never collide. */
function cohort(
  prefix: string,
  gender: Gender,
  count: number,
  amountMinor: bigint,
): GenderGapCandidate[] {
  return Array.from({ length: count }, (_unused, index) =>
    person(`${prefix}${String(index)}`, gender, amountMinor),
  );
}

describe('genderGapPctTenths — AD-17, exact half-up, male median the denominator', () => {
  it('is POSITIVE when men earn more (the golden example: 8.0%)', () => {
    // (2_000_000 - 1_840_000) / 2_000_000 × 1000 = 160_000_000 / 2_000_000 = 80.
    expect(genderGapPctTenths(2_000_000n, 1_840_000n)).toBe(80n);
  });

  it('is NEGATIVE when women earn more (sign = women paid more)', () => {
    // (1_840_000 - 2_000_000) / 1_840_000 × 1000 = -160_000_000 / 1_840_000 → half-up -87.
    expect(genderGapPctTenths(1_840_000n, 2_000_000n)).toBe(-87n);
  });

  it('is exactly ZERO at parity', () => {
    expect(genderGapPctTenths(2_000_000n, 2_000_000n)).toBe(0n);
  });

  it('rounds 20.05% half-up to 201 tenths in bigint, never float 20.0499…', () => {
    // (20000 - 15990) / 20000 × 1000 = 4_010_000 / 20000 = 200.5 → half-up 201 → "20.1".
    expect(genderGapPctTenths(20_000n, 15_990n)).toBe(201n);
  });

  it('returns 0n rather than leaking the divider null for a degenerate zero male median', () => {
    // Unreachable past the 5-of-each gate (a non-empty positive median is > 0), but the `?? 0n`
    // keeps a DIRECT caller total — and pins the arm so a `?? 1n` mutant cannot survive.
    // Male median (the denominator) is 0n → the divider has no answer → `?? 0n`. A nonzero female
    // numerator makes a `?? 1n` mutant observable (it would return 1n, not 0n).
    expect(genderGapPctTenths(0n, 0n)).toBe(0n);
    expect(genderGapPctTenths(0n, 5n)).toBe(0n);
  });
});

describe('computeGenderGap — the answer arm (>= 5 of each)', () => {
  it('reports men higher: the golden 8.0% gap, both medians as Money in the single currency', () => {
    const candidates = [
      ...cohort('m', 'MALE', 5, 2_000_000n),
      ...cohort('f', 'FEMALE', 5, 1_840_000n),
    ];

    const result = computeGenderGap(candidates, AS_OF);

    expect(result).toEqual({
      kind: 'answer',
      maleN: 5,
      femaleN: 5,
      maleMedian: { amountMinor: 2_000_000n, currency: 'INR' },
      femaleMedian: { amountMinor: 1_840_000n, currency: 'INR' },
      gapPctTenths: 80n,
    });
  });

  it('reports women higher with a NEGATIVE gap', () => {
    const candidates = [
      ...cohort('m', 'MALE', 5, 1_840_000n),
      ...cohort('f', 'FEMALE', 5, 2_000_000n),
    ];

    const result = computeGenderGap(candidates, AS_OF);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') return;
    expect(result.gapPctTenths).toBe(-87n);
    expect(result.maleMedian).toEqual({ amountMinor: 1_840_000n, currency: 'INR' });
    expect(result.femaleMedian).toEqual({ amountMinor: 2_000_000n, currency: 'INR' });
  });

  it('reports parity (gap exactly zero) when the two medians match', () => {
    const candidates = [
      ...cohort('m', 'MALE', 5, 2_000_000n),
      ...cohort('f', 'FEMALE', 5, 2_000_000n),
    ];

    const result = computeGenderGap(candidates, AS_OF);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') return;
    expect(result.gapPctTenths).toBe(0n);
  });

  it('is INCLUSIVE at exactly 5 of each — 5 is sufficient, not thin', () => {
    const candidates = [
      ...cohort('m', 'MALE', 5, 3_000_000n),
      ...cohort('f', 'FEMALE', 5, 3_000_000n),
    ];

    expect(computeGenderGap(candidates, AS_OF).kind).toBe('answer');
  });

  it('takes the half-up mean of the two middle salaries for an EVEN gender count', () => {
    // Females: [800k, 900k, 1000k, 1100k, 1200k, 1300k] → mean(1000k, 1100k) = 1050k.
    const females = [
      person('f0', 'FEMALE', 800_000n),
      person('f1', 'FEMALE', 900_000n),
      person('f2', 'FEMALE', 1_000_000n),
      person('f3', 'FEMALE', 1_100_000n),
      person('f4', 'FEMALE', 1_200_000n),
      person('f5', 'FEMALE', 1_300_000n),
    ];
    const candidates = [...cohort('m', 'MALE', 5, 1_050_000n), ...females];

    const result = computeGenderGap(candidates, AS_OF);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') return;
    expect(result.femaleN).toBe(6);
    expect(result.femaleMedian).toEqual({ amountMinor: 1_050_000n, currency: 'INR' });
    expect(result.gapPctTenths).toBe(0n);
  });

  it('enters the same-day CORRECTION into the gender median, never the earlier typo (AD-8 tie-break)', () => {
    // One man carries a typo then a fix on the SAME effectiveFrom; the fix has the greater seq and is
    // current. If the typo won, the male median would be a wild number and the gap would not be 0.
    const correctedMan: GenderGapCandidate = {
      employeeId: 'm-fix',
      gender: 'MALE',
      salaryHistory: [rec(9_999_999n, IN_FORCE, 1n), rec(2_000_000n, IN_FORCE, 2n)],
    };
    const candidates = [
      correctedMan,
      ...cohort('m', 'MALE', 4, 2_000_000n),
      ...cohort('f', 'FEMALE', 5, 2_000_000n),
    ];

    const result = computeGenderGap(candidates, AS_OF);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') return;
    expect(result.maleMedian).toEqual({ amountMinor: 2_000_000n, currency: 'INR' });
    expect(result.gapPctTenths).toBe(0n);
  });
});

describe('computeGenderGap — the insufficient-gender refusal (carries both counts)', () => {
  it('refuses with shortGender FEMALE when only women are short, naming both counts, computing no median', () => {
    const candidates = [
      ...cohort('m', 'MALE', 8, 2_000_000n),
      ...cohort('f', 'FEMALE', 4, 1_840_000n),
    ];

    const result = computeGenderGap(candidates, AS_OF);

    expect(result).toEqual({
      kind: 'insufficient-gender',
      maleN: 8,
      femaleN: 4,
      shortGender: 'FEMALE',
    });
  });

  it('refuses with shortGender MALE when only men are short', () => {
    const candidates = [
      ...cohort('m', 'MALE', 4, 2_000_000n),
      ...cohort('f', 'FEMALE', 7, 1_840_000n),
    ];

    const result = computeGenderGap(candidates, AS_OF);

    expect(result).toEqual({
      kind: 'insufficient-gender',
      maleN: 4,
      femaleN: 7,
      shortGender: 'MALE',
    });
  });

  it('refuses with shortGender BOTH when both are short (group total < 5 too)', () => {
    const candidates = [
      ...cohort('m', 'MALE', 3, 2_000_000n),
      ...cohort('f', 'FEMALE', 2, 1_840_000n),
    ];

    const result = computeGenderGap(candidates, AS_OF);

    expect(result).toEqual({
      kind: 'insufficient-gender',
      maleN: 3,
      femaleN: 2,
      shortGender: 'BOTH',
    });
  });

  it('refuses BOTH on an empty as-of group — 0/0, no n=0 median arithmetic', () => {
    expect(computeGenderGap([], AS_OF)).toEqual({
      kind: 'insufficient-gender',
      maleN: 0,
      femaleN: 0,
      shortGender: 'BOTH',
    });
  });

  it('holds the 4/5 boundary: 4 of a gender is short even though the other has exactly 5', () => {
    // Pins `< 5` against a `<= 5` slip on the male side: 4 must refuse while the female 5 is fine.
    const candidates = [
      ...cohort('m', 'MALE', 4, 2_000_000n),
      ...cohort('f', 'FEMALE', 5, 2_000_000n),
    ];

    const result = computeGenderGap(candidates, AS_OF);

    expect(result.kind).toBe('insufficient-gender');
    if (result.kind !== 'insufficient-gender') return;
    expect(result.shortGender).toBe('MALE');
  });
});

describe('computeGenderGap — the as-of population defines the split (AD-16)', () => {
  it('excludes a not-yet-effective member, dropping a gender below 5 into a refusal', () => {
    // Five women, but one takes effect AFTER asOf — outside the population, so femaleN is really 4.
    const candidates = [
      ...cohort('m', 'MALE', 5, 2_000_000n),
      ...cohort('f', 'FEMALE', 4, 1_840_000n),
      person('f-future', 'FEMALE', 1_840_000n, FUTURE),
    ];

    const result = computeGenderGap(candidates, AS_OF);

    expect(result).toEqual({
      kind: 'insufficient-gender',
      maleN: 5,
      femaleN: 4,
      shortGender: 'FEMALE',
    });
  });

  it('counts only in-population members, never the raw candidate list', () => {
    // A rewind that keeps both genders at 5 still answers — proof the future member is simply gone,
    // not miscounted into the split.
    const candidates = [
      ...cohort('m', 'MALE', 5, 2_000_000n),
      ...cohort('f', 'FEMALE', 5, 1_840_000n),
      person('m-future', 'MALE', 5_000_000n, FUTURE),
    ];

    const result = computeGenderGap(candidates, AS_OF);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') return;
    expect(result.maleN).toBe(5);
    expect(result.maleMedian).toEqual({ amountMinor: 2_000_000n, currency: 'INR' });
  });
});
