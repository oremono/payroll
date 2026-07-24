import { describe, expect, it } from 'vitest';

import type { GenderDistributionPopulation } from '@/application/ports/employee-repository';
import {
  getGenderDistribution,
  type GenderDistributionDeps,
} from '@/application/use-cases/gender-distribution';
import type { Gender } from '@/domain/employee-fields';
import type {
  GenderDistributionCandidate,
  LevelAxisEntry,
} from '@/domain/gender-distribution';
import type { PlainDate } from '@/domain/plain-date';

// Test-first (Law 1 / AD-23): red before `src/application/use-cases/gender-distribution.ts` exists.
//
// Against an in-memory FAKE port, never a database (Law: Testing). No clock is injected and none may
// be: `asOf` is a REQUIRED ARGUMENT threaded in from the delivery boundary (Law 6 / AD-11).
//
// The use-case is TOTAL (Law 8 / AD-20): it orchestrates only — load the org-wide population, hand it
// to the ONE pure domain (`computeGenderDistribution`), and return the finalized answer carrying its
// `asOf`. A repository throw is caught and answered `unavailable`; no exception crosses the boundary.
// There is NO refusal, NO not-found, NO n>=5 gate — an empty population is a valid answer of zeros.
// Story 9-2 consumes this payload unmodified (Law 7).

const date = (year: number, month: number, day: number): PlainDate => ({ year, month, day });

const AS_OF = date(2026, 7, 16);
const IN_FORCE = date(2020, 1, 1);
const FUTURE = date(2027, 1, 1);

function level(
  levelCode: string,
  rank: number,
  isActive: boolean,
  levelLabel: string = levelCode,
): LevelAxisEntry {
  return { levelCode, levelLabel, rank, isActive };
}

function person(
  gender: Gender,
  levelCode: string,
  effectiveFrom: PlainDate = IN_FORCE,
): GenderDistributionCandidate {
  return { gender, levelCode, salaryRecords: [{ effectiveFrom, seq: 1n }] };
}

function cohort(gender: Gender, levelCode: string, count: number): GenderDistributionCandidate[] {
  return Array.from({ length: count }, () => person(gender, levelCode));
}

/** The golden org-wide population: L1 → 3M/2F, L2 → 1F, LX inactive-empty (omitted by the domain). */
function goldenPopulation(): GenderDistributionPopulation {
  return {
    levels: [level('L1', 1, true, 'Junior'), level('L2', 2, true, 'Senior'), level('LX', 9, false)],
    candidates: [
      ...cohort('MALE', 'L1', 3),
      ...cohort('FEMALE', 'L1', 2),
      ...cohort('FEMALE', 'L2', 1),
    ],
  };
}

type FakeConfig = {
  /** `undefined` → the golden population. */
  readonly population?: GenderDistributionPopulation;
  readonly throws?: boolean;
};

function fakeDeps(config: FakeConfig = {}): GenderDistributionDeps & { readonly calls: number[] } {
  const calls: number[] = [];
  return {
    repository: {
      findGenderDistributionPopulation: async () => {
        calls.push(1);
        if (config.throws === true) {
          throw new Error('the database is not answering');
        }
        return config.population ?? goldenPopulation();
      },
    },
    calls,
  };
}

describe('getGenderDistribution — the answer payload (AD-20), carrying its asOf receipt', () => {
  it('returns the finalized answer: rank-ordered per-level counts, org-wide totals, and asOf', async () => {
    const result = await getGenderDistribution(fakeDeps(), AS_OF);

    expect(result).toEqual({
      kind: 'answer',
      distribution: {
        asOf: AS_OF,
        levels: [
          { levelCode: 'L1', levelLabel: 'Junior', maleN: 3, femaleN: 2, total: 5 },
          { levelCode: 'L2', levelLabel: 'Senior', maleN: 0, femaleN: 1, total: 1 },
        ],
        totals: { male: 3, female: 3, total: 6 },
      },
    });
  });

  it('loads the org-wide population exactly once', async () => {
    const deps = fakeDeps();

    await getGenderDistribution(deps, AS_OF);

    expect(deps.calls).toEqual([1]);
  });

  it('threads asOf into the domain: a rewind that drops a not-yet-effective member lowers the count', async () => {
    const population: GenderDistributionPopulation = {
      levels: [level('L1', 1, true)],
      candidates: [...cohort('MALE', 'L1', 2), person('MALE', 'L1', FUTURE)],
    };

    const result = await getGenderDistribution(fakeDeps({ population }), AS_OF);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') return;
    expect(result.distribution.levels).toEqual([
      { levelCode: 'L1', levelLabel: 'L1', maleN: 2, femaleN: 0, total: 2 },
    ]);
    expect(result.distribution.totals).toEqual({ male: 2, female: 0, total: 2 });
  });
});

describe('getGenderDistribution — an empty population is an answer of zeros, never a refusal', () => {
  it('answers active levels at 0/0 with zero totals when no one is in-population', async () => {
    const population: GenderDistributionPopulation = {
      levels: [level('L1', 1, true), level('LX', 9, false)],
      candidates: [],
    };

    const result = await getGenderDistribution(fakeDeps({ population }), AS_OF);

    expect(result).toEqual({
      kind: 'answer',
      distribution: {
        asOf: AS_OF,
        levels: [{ levelCode: 'L1', levelLabel: 'L1', maleN: 0, femaleN: 0, total: 0 }],
        totals: { male: 0, female: 0, total: 0 },
      },
    });
  });
});

describe('getGenderDistribution — totality (AD-20): a throw becomes unavailable', () => {
  it('answers unavailable when findGenderDistributionPopulation throws — the throw does NOT propagate', async () => {
    await expect(getGenderDistribution(fakeDeps({ throws: true }), AS_OF)).resolves.toEqual({
      kind: 'unavailable',
    });
  });
});

describe('getGenderDistribution — determinism (Law 6 / AD-11)', () => {
  it('returns byte-identical payloads for the same data and asOf', async () => {
    const first = await getGenderDistribution(fakeDeps(), AS_OF);
    const second = await getGenderDistribution(fakeDeps(), AS_OF);

    expect(first).toEqual(second);
  });
});
