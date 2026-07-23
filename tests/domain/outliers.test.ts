import { describe, expect, it } from 'vitest';

import type { Money } from '@/domain/money';
import {
  sweepOutliers,
  type OutlierGroupInput,
  type OutlierGroupResult,
} from '@/domain/outliers';
import type { PeerCandidate } from '@/domain/peer-comparison';
import type { PlainDate } from '@/domain/plain-date';
import type { SalaryRecordView } from '@/domain/salary-timeline';

// Test-first (Law 1 / AD-23): red before `src/domain/outliers.ts` exists.
//
// `sweepOutliers` is PURE and TOTAL (Law 2 / AD-1, Law 8 / AD-20): it never reads a clock, never
// reads settings, never throws. The as-of date AND the threshold are REQUIRED ARGUMENTS threaded in
// from the boundary (Law 6 / AD-11, AD-19) — the threshold arrives already in tenths-of-percent so
// the whole flag test is exact `bigint` arithmetic (AD-5). It reuses the CAP-5 primitives verbatim:
// the ONE resolver (`resolveCurrentSalary`, AD-8) for in-population membership, the ONE median
// (AD-3), and the ONE `distancePctTenths` (AD-5). There is no second median/resolver/distance here.
//
// Per group (AD-16): the in-population set is every candidate with a salary in force at `asOf`;
// `n` is that exact set's cardinality, never a COUNT. `n = 0` is OMITTED (nobody to compare);
// `1 <= n < 5` is a `thin-peer-group` refusal naming `n`, never widened, no median; `n >= 5`
// computes the median and flags every member whose signed distance's MAGNITUDE strictly exceeds the
// threshold — a group with no flagged member is omitted entirely. Only findings-bearing groups are
// returned.
//
// This file walks every I/O-matrix domain row, including the exact 19.9 / 20.0 / 20.1 boundary in
// both directions.

const date = (year: number, month: number, day: number): PlainDate => ({ year, month, day });

const AS_OF = date(2026, 7, 16);
const IN_FORCE = date(2021, 6, 1); // effective well before AS_OF
const FUTURE = date(2027, 1, 1); // effective AFTER AS_OF — outside the population

// 20% expressed in tenths-of-percent, exactly as the use-case hands it in (BigInt(20) * 10n).
const THRESHOLD_20 = 200n;

const money = (amountMinor: bigint, currency = 'INR'): Money => ({ amountMinor, currency });

function rec(
  id: string,
  effectiveFrom: PlainDate,
  seq: bigint,
  amountMinor: bigint,
  currency = 'INR',
): SalaryRecordView {
  return { id, effectiveFrom, seq, salary: money(amountMinor, currency) };
}

/** A candidate whose single record is in force at AS_OF (unless overridden). */
function peer(
  employeeId: string,
  amountMinor: bigint,
  options: { effectiveFrom?: PlainDate; currency?: string } = {},
): PeerCandidate {
  const { effectiveFrom = IN_FORCE, currency = 'INR' } = options;
  return { employeeId, salaryHistory: [rec(`${employeeId}-r`, effectiveFrom, 1n, amountMinor, currency)] };
}

function group(key: string, candidates: readonly PeerCandidate[]): OutlierGroupInput {
  return { key, candidates };
}

describe('sweepOutliers — the answer arm (AD-16 / AD-5)', () => {
  it('flags a member ABOVE the threshold (+25%), carrying n, median, currency, and the signed distance', () => {
    // Sorted currents [1m, 1m, 1m, 1m, 1.25m] → median 1m; the 1.25m member is +25.0% = 250 tenths.
    const g = group('SWE|L4|IN', [
      peer('e1', 1_000_000n),
      peer('e2', 1_000_000n),
      peer('e3', 1_000_000n),
      peer('e4', 1_000_000n),
      peer('e5', 1_250_000n),
    ]);

    const result = sweepOutliers([g], AS_OF, THRESHOLD_20);

    expect(result).toEqual<readonly OutlierGroupResult[]>([
      {
        key: 'SWE|L4|IN',
        kind: 'outliers',
        n: 5,
        medianMinor: 1_000_000n,
        currency: 'INR',
        outliers: [{ employeeId: 'e5', salaryMinor: 1_250_000n, distancePctTenths: 250n }],
      },
    ]);
  });

  it('flags a member BELOW the threshold (−30%), the sign carrying direction', () => {
    // Sorted [700k, 1m, 1m, 1m, 1m] → median 1m; the 700k member is −30.0% = −300 tenths.
    const g = group('g', [
      peer('e1', 1_000_000n),
      peer('e2', 1_000_000n),
      peer('e3', 1_000_000n),
      peer('e4', 1_000_000n),
      peer('low', 700_000n),
    ]);

    const result = sweepOutliers([g], AS_OF, THRESHOLD_20);

    expect(result).toHaveLength(1);
    const only = result[0];
    expect(only?.kind).toBe('outliers');
    if (only?.kind !== 'outliers') return;
    expect(only.outliers).toEqual([
      { employeeId: 'low', salaryMinor: 700_000n, distancePctTenths: -300n },
    ]);
  });

  it('lists EVERY beyond-threshold member (both directions), one entry each', () => {
    // Sorted [700k, 1m, 1m, 1m, 1.3m] → median 1m; 1.3m is +300 tenths, 700k is −300 tenths.
    const g = group('g', [
      peer('e1', 1_000_000n),
      peer('e2', 1_000_000n),
      peer('e3', 1_000_000n),
      peer('high', 1_300_000n),
      peer('low', 700_000n),
    ]);

    const result = sweepOutliers([g], AS_OF, THRESHOLD_20);

    expect(result).toHaveLength(1);
    const only = result[0];
    if (only?.kind !== 'outliers') throw new Error('expected outliers');
    // Order is the domain's input order — the use-case owns the display sort.
    expect(only.outliers).toEqual([
      { employeeId: 'high', salaryMinor: 1_300_000n, distancePctTenths: 300n },
      { employeeId: 'low', salaryMinor: 700_000n, distancePctTenths: -300n },
    ]);
  });
});

describe('sweepOutliers — boundary exactness, STRICT bigint (AD-5 / NFR6)', () => {
  // A group whose median is a fixed 1_000_000 minor units, with a single probe member. The other
  // four sit exactly on the median (distance 0), so ONLY the probe can flag.
  function probeGroup(probeMinor: bigint): OutlierGroupInput {
    return group('g', [
      peer('e1', 1_000_000n),
      peer('e2', 1_000_000n),
      peer('e3', 1_000_000n),
      peer('e4', 1_000_000n),
      peer('probe', probeMinor),
    ]);
  }

  it('does NOT flag a member at exactly 19.9% (199 tenths) — group omitted', () => {
    // (1_199_000 − 1_000_000) / 1_000_000 = 19.9% = 199 tenths.
    expect(sweepOutliers([probeGroup(1_199_000n)], AS_OF, THRESHOLD_20)).toEqual([]);
  });

  it('does NOT flag a member at exactly 20.0% (200 tenths) — strict, so group omitted', () => {
    // 200 tenths is NOT > 200 tenths. The number shown is the number judged.
    expect(sweepOutliers([probeGroup(1_200_000n)], AS_OF, THRESHOLD_20)).toEqual([]);
  });

  it('DOES flag a member at exactly 20.1% (201 tenths)', () => {
    const result = sweepOutliers([probeGroup(1_201_000n)], AS_OF, THRESHOLD_20);
    expect(result).toHaveLength(1);
    const only = result[0];
    if (only?.kind !== 'outliers') throw new Error('expected outliers');
    expect(only.outliers).toEqual([
      { employeeId: 'probe', salaryMinor: 1_201_000n, distancePctTenths: 201n },
    ]);
  });

  it('does NOT flag exactly −20.0% (−200 tenths) but DOES flag −20.1% (−201 tenths)', () => {
    // 800_000 → −20.0% = −200 tenths (no flag). 799_000 → −20.1% = −201 tenths (flag).
    expect(sweepOutliers([probeGroup(800_000n)], AS_OF, THRESHOLD_20)).toEqual([]);

    const flagged = sweepOutliers([probeGroup(799_000n)], AS_OF, THRESHOLD_20);
    expect(flagged).toHaveLength(1);
    const only = flagged[0];
    if (only?.kind !== 'outliers') throw new Error('expected outliers');
    expect(only.outliers[0]?.distancePctTenths).toBe(-201n);
  });

  it('rounds the magnitude half-up to one decimal BEFORE the strict compare — 20.05% flags as 20.1', () => {
    // median 2_000_000; probe 2_401_000 → 20.05% = 200.5 tenths → half-up 201 tenths → flags.
    // In IEEE double, 0.2005 * 1000 reads as 200.4999… and would round the wrong way and NOT flag.
    const g = group('g', [
      peer('e1', 2_000_000n),
      peer('e2', 2_000_000n),
      peer('e3', 2_000_000n),
      peer('e4', 2_000_000n),
      peer('probe', 2_401_000n),
    ]);

    const result = sweepOutliers([g], AS_OF, THRESHOLD_20);
    expect(result).toHaveLength(1);
    const only = result[0];
    if (only?.kind !== 'outliers') throw new Error('expected outliers');
    expect(only.outliers).toEqual([
      { employeeId: 'probe', salaryMinor: 2_401_000n, distancePctTenths: 201n },
    ]);
  });
});

describe('sweepOutliers — omissions and refusals (AD-16)', () => {
  it('OMITS a group of ≥5 with no beyond-threshold member (no section at all)', () => {
    // Distances −100, −50, 0, +50, +100 tenths — none exceeds 200.
    const g = group('g', [
      peer('e1', 900_000n),
      peer('e2', 950_000n),
      peer('e3', 1_000_000n),
      peer('e4', 1_050_000n),
      peer('e5', 1_100_000n),
    ]);

    expect(sweepOutliers([g], AS_OF, THRESHOLD_20)).toEqual([]);
  });

  it('REFUSES a thin group (1 ≤ n < 5) with thin-peer-group and the exact n, no median', () => {
    const g = group('thin', [
      peer('e1', 1_000_000n),
      peer('e2', 2_000_000n),
      peer('e3', 3_000_000n),
      peer('e4', 4_000_000n),
    ]);

    expect(sweepOutliers([g], AS_OF, THRESHOLD_20)).toEqual([
      { key: 'thin', kind: 'thin-peer-group', n: 4 },
    ]);
  });

  it('REFUSES a group of a single in-population member as thin (n = 1), never n = 0', () => {
    const g = group('solo', [peer('e1', 1_000_000n)]);

    expect(sweepOutliers([g], AS_OF, THRESHOLD_20)).toEqual([
      { key: 'solo', kind: 'thin-peer-group', n: 1 },
    ]);
  });

  it('OMITS a group whose members are all out-of-population at asOf (n = 0) — not a refusal row', () => {
    // Every member is future-dated (or has no salary), so n = 0. Degenerate, not thin: omitted.
    const g = group('empty', [
      peer('e1', 1_000_000n, { effectiveFrom: FUTURE }),
      peer('e2', 1_000_000n, { effectiveFrom: FUTURE }),
      { employeeId: 'e3', salaryHistory: [] },
    ]);

    expect(sweepOutliers([g], AS_OF, THRESHOLD_20)).toEqual([]);
  });

  it('recomputes n when the as-of date drops a not-yet-effective peer, crossing 5 → 4 into a refusal', () => {
    // Five candidates, but one is future at AS_OF → outside the population (AD-16). n is really 4.
    const g = group('rewound', [
      peer('e1', 1_000_000n),
      peer('e2', 1_000_000n),
      peer('e3', 1_000_000n),
      peer('e4', 1_000_000n),
      peer('e5', 5_000_000n, { effectiveFrom: FUTURE }),
    ]);

    expect(sweepOutliers([g], AS_OF, THRESHOLD_20)).toEqual([
      { key: 'rewound', kind: 'thin-peer-group', n: 4 },
    ]);
  });
});

describe('sweepOutliers — same-day correction resolves through the ONE resolver (AD-8)', () => {
  it('uses the greatest (effectiveFrom, seq) record — the correction, not the typo — in the statistic', () => {
    // `corrected` has a typo (seq 10) and a same-day fix (seq 11). The fix, 5_000_000, is current
    // and must be the amount judged; were the typo current, its 100 would enter the median instead.
    const corrected: PeerCandidate = {
      employeeId: 'corrected',
      salaryHistory: [
        rec('typo', date(2026, 3, 1), 10n, 100n),
        rec('fix', date(2026, 3, 1), 11n, 5_000_000n),
      ],
    };
    const g = group('g', [
      peer('e1', 1_000_000n),
      peer('e2', 1_000_000n),
      peer('e3', 1_000_000n),
      peer('e4', 1_000_000n),
      corrected,
    ]);

    const result = sweepOutliers([g], AS_OF, THRESHOLD_20);
    expect(result).toHaveLength(1);
    const only = result[0];
    if (only?.kind !== 'outliers') throw new Error('expected outliers');
    // Median of [1m, 1m, 1m, 1m, 5m] is 1m; the correction 5m is +400.0% = 4000 tenths, flagged.
    expect(only.medianMinor).toBe(1_000_000n);
    expect(only.outliers).toEqual([
      { employeeId: 'corrected', salaryMinor: 5_000_000n, distancePctTenths: 4000n },
    ]);
  });
});

describe('sweepOutliers — the threshold is a pure parameter (Law 6 / AD-19)', () => {
  it('produces DIFFERENT findings for the same data under different thresholds', () => {
    // The probe is +25.0% = 250 tenths. It flags under a 10% threshold (100 tenths) and is within a
    // 30% one (300 tenths) — a pure function of the threshold, no clock, no settings read.
    const g = group('g', [
      peer('e1', 1_000_000n),
      peer('e2', 1_000_000n),
      peer('e3', 1_000_000n),
      peer('e4', 1_000_000n),
      peer('probe', 1_250_000n),
    ]);

    const at10 = sweepOutliers([g], AS_OF, 100n);
    expect(at10).toHaveLength(1);
    expect(at10[0]?.kind).toBe('outliers');

    const at30 = sweepOutliers([g], AS_OF, 300n);
    expect(at30).toEqual([]);
  });
});

describe('sweepOutliers — currency isolation across groups (AD-3-currency)', () => {
  it('judges each group within its OWN currency and carries that currency on the result', () => {
    const inr = group('A|L4|IN', [
      peer('a1', 1_000_000n, { currency: 'INR' }),
      peer('a2', 1_000_000n, { currency: 'INR' }),
      peer('a3', 1_000_000n, { currency: 'INR' }),
      peer('a4', 1_000_000n, { currency: 'INR' }),
      peer('aHigh', 1_500_000n, { currency: 'INR' }),
    ]);
    const usd = group('A|L4|US', [
      peer('u1', 2_000_000n, { currency: 'USD' }),
      peer('u2', 2_000_000n, { currency: 'USD' }),
      peer('u3', 2_000_000n, { currency: 'USD' }),
      peer('u4', 2_000_000n, { currency: 'USD' }),
      peer('uHigh', 3_000_000n, { currency: 'USD' }),
    ]);

    const result = sweepOutliers([inr, usd], AS_OF, THRESHOLD_20);

    expect(result).toHaveLength(2);
    const [a, b] = result;
    if (a?.kind !== 'outliers' || b?.kind !== 'outliers') throw new Error('expected two outlier groups');
    expect(a.currency).toBe('INR');
    expect(a.medianMinor).toBe(1_000_000n);
    expect(b.currency).toBe('USD');
    expect(b.medianMinor).toBe(2_000_000n);
  });
});

describe('sweepOutliers — returns ONLY findings-bearing groups, in input order', () => {
  it('keeps outlier and thin groups, omits within-threshold and empty ones, preserving order', () => {
    const outlierGroup = group('1-outlier', [
      peer('e1', 1_000_000n),
      peer('e2', 1_000_000n),
      peer('e3', 1_000_000n),
      peer('e4', 1_000_000n),
      peer('e5', 1_400_000n),
    ]);
    const withinGroup = group('2-within', [
      peer('w1', 1_000_000n),
      peer('w2', 1_010_000n),
      peer('w3', 1_020_000n),
      peer('w4', 1_030_000n),
      peer('w5', 1_040_000n),
    ]);
    const thinGroup = group('3-thin', [peer('t1', 1_000_000n), peer('t2', 2_000_000n)]);
    const emptyGroup = group('4-empty', [peer('x1', 1_000_000n, { effectiveFrom: FUTURE })]);

    const result = sweepOutliers([outlierGroup, withinGroup, thinGroup, emptyGroup], AS_OF, THRESHOLD_20);

    expect(result.map((r) => r.key)).toEqual(['1-outlier', '3-thin']);
    expect(result[0]?.kind).toBe('outliers');
    expect(result[1]).toEqual({ key: '3-thin', kind: 'thin-peer-group', n: 2 });
  });

  it('returns [] when there are no outliers and no thin groups anywhere', () => {
    const withinGroup = group('g', [
      peer('w1', 1_000_000n),
      peer('w2', 1_010_000n),
      peer('w3', 1_020_000n),
      peer('w4', 1_030_000n),
      peer('w5', 1_040_000n),
    ]);

    expect(sweepOutliers([withinGroup], AS_OF, THRESHOLD_20)).toEqual([]);
  });

  it('returns [] for no groups at all', () => {
    expect(sweepOutliers([], AS_OF, THRESHOLD_20)).toEqual([]);
  });
});

describe('sweepOutliers — determinism (Law 6 / AD-11)', () => {
  it('returns an identical result for the same groups, asOf, and threshold', () => {
    const g = group('g', [
      peer('e1', 1_000_000n),
      peer('e2', 1_000_000n),
      peer('e3', 1_000_000n),
      peer('e4', 1_000_000n),
      peer('e5', 1_500_000n),
    ]);

    expect(sweepOutliers([g], AS_OF, THRESHOLD_20)).toEqual(sweepOutliers([g], AS_OF, THRESHOLD_20));
  });
});
