import { describe, expect, it } from 'vitest';

import type {
  EmployeeDetail,
  EmployeeRepository,
  PeerGroupKey,
  PeerPopulation,
} from '@/application/ports/employee-repository';
import {
  getPeerComparison,
  type PeerComparisonDeps,
} from '@/application/use-cases/peer-comparison';
import type { CurrencyFormat } from '@/domain/money';
import type { PeerCandidate } from '@/domain/peer-comparison';
import type { PlainDate } from '@/domain/plain-date';

// Test-first (Law 1 / AD-23): red before `src/application/use-cases/peer-comparison.ts` exists.
//
// Against in-memory FAKES, never a database (Law: Testing). No clock is injected and none may be:
// `asOf` is a REQUIRED ARGUMENT threaded in from the delivery boundary (Law 6 / AD-11).
//
// The use-case is TOTAL (Law 8 / AD-20): an unknown id is `not-found`; a repository throw, a null
// population (unresolvable currency), and a verdict that cannot render are all `unavailable`; and
// every answer/refusal crosses the boundary carrying its receipts — money as `BoundaryMoney`, the
// distance as a signed one-decimal string, and the ONE verdict sentence unmodified. Story 6-2
// consumes this payload and adds nothing to the contract (Law 7).
//
// This file walks EVERY row of the spec I/O matrix.

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

function peer(employeeId: string, amountMinor: bigint, effectiveFrom: PlainDate = IN_FORCE): PeerCandidate {
  return {
    employeeId,
    salaryHistory: [{ id: `${employeeId}-r`, effectiveFrom, seq: 1n, salary: { amountMinor, currency: 'INR' } }],
  };
}

function population(candidates: readonly PeerCandidate[]): PeerPopulation {
  return {
    candidates,
    roleName: 'Software Engineer',
    levelLabel: 'L4',
    countryName: 'India',
    currencyFormat: INR_FORMAT,
  };
}

/** The golden answer scenario: subject 8% under a ₹23,40,000 median, across 9 peers. */
function goldenPopulation(): PeerPopulation {
  const peers = Array.from({ length: 8 }, (_unused, index) => peer(`p${String(index)}`, 234_000_000n));
  return population([peer(SUBJECT_ID, 215_280_000n), ...peers]);
}

type FakeConfig = {
  /** `undefined` → the default subject; `null` → no such employee. */
  readonly detail?: EmployeeDetail | null;
  /** `undefined` → the golden population; `null` → an unresolvable population. */
  readonly population?: PeerPopulation | null;
  readonly throwsOn?: 'findEmployeeById' | 'findPeerPopulation';
};

function fakeDeps(config: FakeConfig = {}): PeerComparisonDeps & {
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
    findPeerPopulation: async (group: PeerGroupKey) => {
      askedForGroup.push(group);
      if (config.throwsOn === 'findPeerPopulation') {
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
    findAllPeerGroups: () => Promise.reject(new Error('not reachable')),
    findGenderGapPopulation: () => Promise.reject(new Error('not reachable')),
    findGenderDistributionPopulation: () => Promise.reject(new Error('not reachable')),
  } satisfies EmployeeRepository;

  return { repository, askedById, askedForGroup };
}

describe('getPeerComparison — the answer payload (AD-20), every field a receipt', () => {
  it('returns the finalized answer with median, spread, signed distance, currency, n, and the ONE verdict', async () => {
    const deps = fakeDeps();

    const result = await getPeerComparison(deps, SUBJECT_ID, AS_OF);

    expect(result).toEqual({
      kind: 'answer',
      comparison: {
        employeeId: SUBJECT_ID,
        asOf: AS_OF,
        peerGroup: { roleCode: 'SWE', levelCode: 'L4', countryCode: 'IN' },
        n: 9,
        currency: 'INR',
        subjectSalary: { amountMinor: '215280000', currency: 'INR' },
        peerMedian: { amountMinor: '234000000', currency: 'INR' },
        spread: {
          min: { amountMinor: '215280000', currency: 'INR' },
          max: { amountMinor: '234000000', currency: 'INR' },
        },
        distancePct: '-8.0',
        verdict:
          'Priya Nair is 8.0% under the peer median (₹23,40,000 INR), based on 9 peers — Software Engineer · L4 · India — as of 16 Jul 2026.',
      },
    });
  });

  it('every monetary field is a BoundaryMoney decimal string, never a number or bigint (Law 4)', async () => {
    const result = await getPeerComparison(fakeDeps(), SUBJECT_ID, AS_OF);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') return;
    const money = [
      result.comparison.subjectSalary,
      result.comparison.peerMedian,
      result.comparison.spread.min,
      result.comparison.spread.max,
    ];
    for (const value of money) {
      expect(typeof value.amountMinor).toBe('string');
    }
  });

  it('looks the subject up by id, then the population by the subject\'s own triple', async () => {
    const deps = fakeDeps();

    await getPeerComparison(deps, SUBJECT_ID, AS_OF);

    expect(deps.askedById).toEqual([SUBJECT_ID]);
    expect(deps.askedForGroup).toEqual([PEER_GROUP]);
  });

  it('takes the half-up mean of the two middle salaries for an EVEN group (n=6)', async () => {
    // Sorted currents [800k, 900k, 1000k, 1100k, 1200k, 1300k] → median mean(1000k, 1100k) = 1050k.
    const candidates = [
      peer(SUBJECT_ID, 900_000n),
      peer('p1', 800_000n),
      peer('p2', 1_000_000n),
      peer('p3', 1_100_000n),
      peer('p4', 1_200_000n),
      peer('p5', 1_300_000n),
    ];

    const result = await getPeerComparison(fakeDeps({ population: population(candidates) }), SUBJECT_ID, AS_OF);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') return;
    expect(result.comparison.n).toBe(6);
    expect(result.comparison.peerMedian).toEqual({ amountMinor: '1050000', currency: 'INR' });
    // (900k - 1050k)/1050k = -14.285…% → -14.3.
    expect(result.comparison.distancePct).toBe('-14.3');
  });

  it('carries a POSITIVE distance string when the subject earns above the median', async () => {
    const candidates = [
      peer(SUBJECT_ID, 1_200_000n),
      peer('p1', 800_000n),
      peer('p2', 900_000n),
      peer('p3', 1_000_000n),
      peer('p4', 1_100_000n),
    ];

    const result = await getPeerComparison(fakeDeps({ population: population(candidates) }), SUBJECT_ID, AS_OF);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') return;
    expect(result.comparison.distancePct).toBe('20.0');
  });
});

describe('getPeerComparison — the refusals carry their counts (AD-20)', () => {
  it('refuses a thin peer group, naming n, never widening', async () => {
    const candidates = [peer(SUBJECT_ID, 900_000n), peer('p1', 800_000n), peer('p2', 1_000_000n)];

    const result = await getPeerComparison(fakeDeps({ population: population(candidates) }), SUBJECT_ID, AS_OF);

    expect(result).toEqual({
      kind: 'refusal',
      refusal: {
        reason: 'thin-peer-group',
        peerGroup: { roleCode: 'SWE', levelCode: 'L4', countryCode: 'IN' },
        counts: { n: 3 },
        asOf: AS_OF,
        verdict:
          'No comparison — Software Engineer · L4 · India has only 3 people as of 16 Jul 2026. A fair comparison needs at least 5.',
      },
    });
  });

  it('recomputes n when the as-of date drops a not-yet-effective peer, crossing below 5', async () => {
    // Five candidates, but p4 takes effect AFTER AS_OF — outside the population (AD-16). The group
    // is really 4, so it refuses; the count is the exact in-memory cardinality, never a COUNT query.
    const candidates = [
      peer(SUBJECT_ID, 900_000n),
      peer('p1', 800_000n),
      peer('p2', 1_000_000n),
      peer('p3', 1_100_000n),
      peer('p4', 1_200_000n, FUTURE),
    ];

    const result = await getPeerComparison(fakeDeps({ population: population(candidates) }), SUBJECT_ID, AS_OF);

    expect(result.kind).toBe('refusal');
    if (result.kind !== 'refusal') return;
    expect(result.refusal.reason).toBe('thin-peer-group');
    if (result.refusal.reason !== 'thin-peer-group') return;
    expect(result.refusal.counts.n).toBe(4);
  });

  it('refuses no-salary-as-of — distinct from thin-peer-group — when the subject has no salary at asOf', async () => {
    // The subject's only record is future; peers are plentiful, but there is no subject salary. This
    // is `no-salary-as-of`, NOT thin-peer-group, and no median is computed.
    const candidates = [
      peer(SUBJECT_ID, 900_000n, FUTURE),
      peer('p1', 800_000n),
      peer('p2', 1_000_000n),
      peer('p3', 1_100_000n),
      peer('p4', 1_200_000n),
    ];

    const result = await getPeerComparison(fakeDeps({ population: population(candidates) }), SUBJECT_ID, AS_OF);

    expect(result).toEqual({
      kind: 'refusal',
      refusal: {
        reason: 'no-salary-as-of',
        asOf: AS_OF,
        verdict: 'No comparison — Priya Nair has no salary on record as of 16 Jul 2026.',
      },
    });
  });
});

describe('getPeerComparison — not-found, unavailable, and totality (AD-20)', () => {
  it('answers not-found for an unknown employee, without loading a population', async () => {
    const deps = fakeDeps({ detail: null });

    const result = await getPeerComparison(deps, 'no-such-id', AS_OF);

    expect(result).toEqual({ kind: 'not-found' });
    // The population is never read for an id that resolves to no employee.
    expect(deps.askedForGroup).toEqual([]);
  });

  it('answers unavailable when the population cannot be resolved (e.g. an unformattable currency)', async () => {
    const result = await getPeerComparison(fakeDeps({ population: null }), SUBJECT_ID, AS_OF);

    expect(result).toEqual({ kind: 'unavailable' });
  });

  it('answers unavailable when findEmployeeById throws — the throw does NOT propagate', async () => {
    await expect(
      getPeerComparison(fakeDeps({ throwsOn: 'findEmployeeById' }), SUBJECT_ID, AS_OF),
    ).resolves.toEqual({ kind: 'unavailable' });
  });

  it('answers unavailable when findPeerPopulation throws', async () => {
    await expect(
      getPeerComparison(fakeDeps({ throwsOn: 'findPeerPopulation' }), SUBJECT_ID, AS_OF),
    ).resolves.toEqual({ kind: 'unavailable' });
  });

  it('answers unavailable when the verdict cannot be composed (a malformed asOf), never a broken sentence', async () => {
    // A month-13 asOf renders no date; the verdict is `null` and the use-case maps that to
    // unavailable rather than emitting an answer with a hole where the sentence should be.
    const result = await getPeerComparison(fakeDeps(), SUBJECT_ID, { year: 2026, month: 13, day: 1 });

    expect(result).toEqual({ kind: 'unavailable' });
  });
});

describe('getPeerComparison — determinism (Law 6 / AD-11)', () => {
  it('returns byte-identical payloads for the same data and asOf', async () => {
    const first = await getPeerComparison(fakeDeps(), SUBJECT_ID, AS_OF);
    const second = await getPeerComparison(fakeDeps(), SUBJECT_ID, AS_OF);

    expect(first).toEqual(second);
  });
});
