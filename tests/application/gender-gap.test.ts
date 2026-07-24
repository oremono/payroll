import { describe, expect, it } from 'vitest';

import type {
  EmployeeDetail,
  EmployeeRepository,
  GenderGapPopulation,
  PeerGroupKey,
} from '@/application/ports/employee-repository';
import { getGenderGap, type GenderGapDeps } from '@/application/use-cases/gender-gap';
import type { Gender } from '@/domain/employee-fields';
import type { GenderGapCandidate } from '@/domain/gender-gap';
import type { CurrencyFormat } from '@/domain/money';
import type { PlainDate } from '@/domain/plain-date';

// Test-first (Law 1 / AD-23): red before `src/application/use-cases/gender-gap.ts` exists.
//
// Against in-memory FAKES, never a database (Law: Testing). No clock is injected and none may be:
// `asOf` is a REQUIRED ARGUMENT threaded in from the delivery boundary (Law 6 / AD-11).
//
// The use-case is TOTAL (Law 8 / AD-20): an unknown id is `not-found`; a repository throw, a null
// population, and a verdict that cannot render are all `unavailable`. The answer and the refusal both
// cross the boundary carrying their receipts — medians as `BoundaryMoney`, the gap as a signed
// one-decimal string, and the ONE verdict sentence unmodified. Story 8-2 consumes this payload and
// adds nothing to the contract (Law 7). This file walks every application row of the spec I/O matrix.

const date = (year: number, month: number, day: number): PlainDate => ({ year, month, day });

const AS_OF = date(2026, 7, 16);
const IN_FORCE = date(2020, 1, 1);
const FUTURE = date(2027, 1, 1);

const SUBJECT_ID = '018f8a1e-0000-7000-8000-000000000001';

const SUBJECT: EmployeeDetail = {
  id: SUBJECT_ID,
  name: 'Priya Nair',
  roleCode: 'SWE',
  levelCode: 'L4',
  countryCode: 'IN',
  gender: 'FEMALE',
  hireDate: IN_FORCE,
};

const INR_FORMAT: CurrencyFormat = {
  code: 'INR',
  symbol: '₹',
  minorUnitExponent: 2,
  groupingStyle: 'INDIAN',
};

const PEER_GROUP: PeerGroupKey = { roleCode: 'SWE', levelCode: 'L4', countryCode: 'IN' };

function person(
  employeeId: string,
  gender: Gender,
  amountMinor: bigint,
  effectiveFrom: PlainDate = IN_FORCE,
): GenderGapCandidate {
  return {
    employeeId,
    gender,
    salaryHistory: [
      { id: `${employeeId}-r`, effectiveFrom, seq: 1n, salary: { amountMinor, currency: 'INR' } },
    ],
  };
}

function cohort(
  prefix: string,
  gender: Gender,
  count: number,
  amountMinor: bigint,
  effectiveFrom: PlainDate = IN_FORCE,
): GenderGapCandidate[] {
  return Array.from({ length: count }, (_unused, index) =>
    person(`${prefix}${String(index)}`, gender, amountMinor, effectiveFrom),
  );
}

function population(candidates: readonly GenderGapCandidate[]): GenderGapPopulation {
  return {
    candidates,
    roleName: 'Software Engineer',
    levelLabel: 'L4',
    countryName: 'India',
    currencyFormat: INR_FORMAT,
  };
}

/** The golden answer scenario: 5 men on ₹20,000, 5 women on ₹18,400 → an 8.0% gap, men higher. */
function goldenPopulation(): GenderGapPopulation {
  return population([...cohort('m', 'MALE', 5, 2_000_000n), ...cohort('f', 'FEMALE', 5, 1_840_000n)]);
}

type FakeConfig = {
  /** `undefined` → the default subject; `null` → no such employee. */
  readonly detail?: EmployeeDetail | null;
  /** `undefined` → the golden population; `null` → an unresolvable population. */
  readonly population?: GenderGapPopulation | null;
  readonly throwsOn?: 'findEmployeeById' | 'findGenderGapPopulation';
};

function fakeDeps(config: FakeConfig = {}): GenderGapDeps & {
  readonly askedById: string[];
  readonly askedForGroup: PeerGroupKey[];
} {
  const askedById: string[] = [];
  const askedForGroup: PeerGroupKey[] = [];

  const repository = {
    findEmployeeById: async (employeeId: string) => {
      askedById.push(employeeId);
      if (config.throwsOn === 'findEmployeeById') {
        throw new Error('the database is not answering');
      }
      return config.detail === undefined ? SUBJECT : config.detail;
    },
    findGenderGapPopulation: async (group: PeerGroupKey) => {
      askedForGroup.push(group);
      if (config.throwsOn === 'findGenderGapPopulation') {
        throw new Error('the database is not answering');
      }
      return config.population === undefined ? goldenPopulation() : config.population;
    },
    // Nothing else is reachable from this read use-case; rejecting stubs keep that true.
    loadReferenceData: () => Promise.reject(new Error('not reachable')),
    createEmployeesWithSalaries: () => Promise.reject(new Error('not reachable')),
    createEmployee: () => Promise.reject(new Error('not reachable')),
    updateEmployee: () => Promise.reject(new Error('not reachable')),
    listEmployees: () => Promise.reject(new Error('not reachable')),
    loadFormOptions: () => Promise.reject(new Error('not reachable')),
    appendSalaryRecord: () => Promise.reject(new Error('not reachable')),
    findSalaryHistory: () => Promise.reject(new Error('not reachable')),
    findPeerPopulation: () => Promise.reject(new Error('not reachable')),
    findAllPeerGroups: () => Promise.reject(new Error('not reachable')),
    findGenderDistributionPopulation: () => Promise.reject(new Error('not reachable')),
    findPayrollTotalsPopulation: () => Promise.reject(new Error('not reachable')),
  } satisfies EmployeeRepository;

  return { repository, askedById, askedForGroup };
}

describe('getGenderGap — the answer payload (AD-20), every field a receipt', () => {
  it('returns the finalized answer with both medians, signed gap, currency, counts, and the ONE verdict', async () => {
    const result = await getGenderGap(fakeDeps(), SUBJECT_ID, AS_OF);

    expect(result).toEqual({
      kind: 'answer',
      gap: {
        employeeId: SUBJECT_ID,
        asOf: AS_OF,
        peerGroup: {
          roleCode: 'SWE',
          levelCode: 'L4',
          countryCode: 'IN',
          roleName: 'Software Engineer',
          levelLabel: 'L4',
          countryName: 'India',
        },
        maleN: 5,
        femaleN: 5,
        currency: 'INR',
        maleMedian: { amountMinor: '2000000', currency: 'INR' },
        femaleMedian: { amountMinor: '1840000', currency: 'INR' },
        gapPct: '8.0',
        verdict:
          'Men are paid 8.0% more than women at the median — ₹20,000 INR across 5 men vs ₹18,400 INR across 5 women — Software Engineer · L4 · India, as of 16 Jul 2026.',
      },
    });
  });

  it('every monetary field is a BoundaryMoney decimal string, never a number or bigint (Law 4)', async () => {
    const result = await getGenderGap(fakeDeps(), SUBJECT_ID, AS_OF);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') return;
    expect(typeof result.gap.maleMedian.amountMinor).toBe('string');
    expect(typeof result.gap.femaleMedian.amountMinor).toBe('string');
  });

  it('looks the subject up by id, then the population by the subject\'s own triple', async () => {
    const deps = fakeDeps();

    await getGenderGap(deps, SUBJECT_ID, AS_OF);

    expect(deps.askedById).toEqual([SUBJECT_ID]);
    expect(deps.askedForGroup).toEqual([PEER_GROUP]);
  });

  it('carries a NEGATIVE gap string when women earn more', async () => {
    const candidates = [
      ...cohort('m', 'MALE', 5, 1_840_000n),
      ...cohort('f', 'FEMALE', 5, 2_000_000n),
    ];

    const result = await getGenderGap(fakeDeps({ population: population(candidates) }), SUBJECT_ID, AS_OF);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') return;
    expect(result.gap.gapPct).toBe('-8.7');
  });
});

describe('getGenderGap — the refusal carries both counts (AD-20)', () => {
  it('refuses insufficient-gender, naming both counts and the short gender, never widening', async () => {
    const candidates = [
      ...cohort('m', 'MALE', 8, 2_000_000n),
      ...cohort('f', 'FEMALE', 4, 1_840_000n),
    ];

    const result = await getGenderGap(fakeDeps({ population: population(candidates) }), SUBJECT_ID, AS_OF);

    expect(result).toEqual({
      kind: 'refusal',
      refusal: {
        reason: 'insufficient-gender',
        peerGroup: {
          roleCode: 'SWE',
          levelCode: 'L4',
          countryCode: 'IN',
          roleName: 'Software Engineer',
          levelLabel: 'L4',
          countryName: 'India',
        },
        counts: { male: 8, female: 4 },
        shortGender: 'FEMALE',
        asOf: AS_OF,
        verdict:
          'No gender gap — Software Engineer · L4 · India has 8 men and 4 women as of 16 Jul 2026, and a gap needs at least 5 of each. Too few women.',
      },
    });
  });

  it('recomputes the per-gender count when the as-of date drops a not-yet-effective member', async () => {
    // Five women, but one takes effect AFTER asOf — outside the population (AD-16). femaleN is really
    // 4, so it refuses; the count is the exact in-memory cardinality, never a COUNT query.
    const candidates = [
      ...cohort('m', 'MALE', 5, 2_000_000n),
      ...cohort('f', 'FEMALE', 4, 1_840_000n),
      person('f-future', 'FEMALE', 1_840_000n, FUTURE),
    ];

    const result = await getGenderGap(fakeDeps({ population: population(candidates) }), SUBJECT_ID, AS_OF);

    expect(result.kind).toBe('refusal');
    if (result.kind !== 'refusal') return;
    expect(result.refusal.counts).toEqual({ male: 5, female: 4 });
    expect(result.refusal.shortGender).toBe('FEMALE');
  });
});

describe('getGenderGap — not-found, unavailable, and totality (AD-20)', () => {
  it('answers not-found for an unknown employee, without loading a population', async () => {
    const deps = fakeDeps({ detail: null });

    const result = await getGenderGap(deps, 'no-such-id', AS_OF);

    expect(result).toEqual({ kind: 'not-found' });
    expect(deps.askedForGroup).toEqual([]);
  });

  it('answers unavailable when the population cannot be resolved (e.g. an unformattable currency)', async () => {
    const result = await getGenderGap(fakeDeps({ population: null }), SUBJECT_ID, AS_OF);

    expect(result).toEqual({ kind: 'unavailable' });
  });

  it('answers unavailable when findEmployeeById throws — the throw does NOT propagate', async () => {
    await expect(
      getGenderGap(fakeDeps({ throwsOn: 'findEmployeeById' }), SUBJECT_ID, AS_OF),
    ).resolves.toEqual({ kind: 'unavailable' });
  });

  it('answers unavailable when findGenderGapPopulation throws', async () => {
    await expect(
      getGenderGap(fakeDeps({ throwsOn: 'findGenderGapPopulation' }), SUBJECT_ID, AS_OF),
    ).resolves.toEqual({ kind: 'unavailable' });
  });

  it('answers unavailable when the verdict cannot be composed (a malformed asOf), never a broken sentence', async () => {
    const result = await getGenderGap(fakeDeps(), SUBJECT_ID, { year: 2026, month: 13, day: 1 });

    expect(result).toEqual({ kind: 'unavailable' });
  });
});

describe('getGenderGap — determinism (Law 6 / AD-11)', () => {
  it('returns byte-identical payloads for the same data and asOf', async () => {
    const first = await getGenderGap(fakeDeps(), SUBJECT_ID, AS_OF);
    const second = await getGenderGap(fakeDeps(), SUBJECT_ID, AS_OF);

    expect(first).toEqual(second);
  });
});
