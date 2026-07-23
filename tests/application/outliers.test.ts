import { describe, expect, it } from 'vitest';

import type {
  EmployeeRepository,
  OutlierCandidate,
  PeerGroupKey,
  PeerGroupPopulation,
} from '@/application/ports/employee-repository';
import {
  getOutlierFindings,
  type GetOutlierFindingsResult,
  type OutlierFindingsDeps,
} from '@/application/use-cases/outliers';
import type { CurrencyFormat } from '@/domain/money';
import type { PlainDate } from '@/domain/plain-date';

// Test-first (Law 1 / AD-23): red before `src/application/use-cases/outliers.ts` exists.
//
// Against in-memory FAKES, never a database (Law: Testing). No clock is injected and none may be:
// `asOf` AND `thresholdPct` are REQUIRED ARGUMENTS threaded in from the delivery boundary (Law 6 /
// AD-11, AD-19). The use-case reuses the pure sweep (`sweepOutliers`) and encodes its result for the
// boundary — money as `BoundaryMoney`, distance as a signed one-decimal string — sorting groups by
// (roleCode, levelCode, countryCode) asc and findings by abs(distance) desc then employeeId asc.
//
// TOTAL (Law 8 / AD-20): a repository throw is `unavailable`; every finding/refusal crosses the
// boundary carrying its receipts. This file walks the I/O matrix.

const date = (year: number, month: number, day: number): PlainDate => ({ year, month, day });

const AS_OF = date(2026, 7, 16);
const IN_FORCE = date(2021, 6, 1);
const FUTURE = date(2027, 1, 1);

const INR_FORMAT: CurrencyFormat = {
  code: 'INR',
  symbol: '₹',
  minorUnitExponent: 2,
  groupingStyle: 'INDIAN',
};
const USD_FORMAT: CurrencyFormat = {
  code: 'USD',
  symbol: '$',
  minorUnitExponent: 2,
  groupingStyle: 'WESTERN',
};

function candidate(
  employeeId: string,
  name: string,
  amountMinor: bigint,
  options: { effectiveFrom?: PlainDate; currency?: string } = {},
): OutlierCandidate {
  const { effectiveFrom = IN_FORCE, currency = 'INR' } = options;
  return {
    employeeId,
    name,
    salaryHistory: [
      { id: `${employeeId}-r`, effectiveFrom, seq: 1n, salary: { amountMinor, currency } },
    ],
  };
}

function population(
  key: PeerGroupKey,
  labels: { roleName: string; levelLabel: string; countryName: string },
  candidates: readonly OutlierCandidate[],
  currencyFormat: CurrencyFormat = INR_FORMAT,
): PeerGroupPopulation {
  return { key, ...labels, currencyFormat, candidates };
}

const SWE_L4_IN: PeerGroupKey = { roleCode: 'SWE', levelCode: 'L4', countryCode: 'IN' };
const SWE_L4_IN_LABELS = { roleName: 'Software Engineer', levelLabel: 'L4', countryName: 'India' };

type FakeConfig = {
  readonly populations?: readonly PeerGroupPopulation[];
  readonly throws?: boolean;
};

function fakeDeps(config: FakeConfig = {}): OutlierFindingsDeps & { readonly calls: number } {
  const state = { calls: 0 };
  const repository = {
    findAllPeerGroups: async () => {
      state.calls += 1;
      if (config.throws === true) {
        throw new Error('the database is not answering');
      }
      return config.populations ?? [];
    },
    // Nothing else is reachable from this read use-case; rejecting stubs keep that true.
    loadReferenceData: () => Promise.reject(new Error('not reachable')),
    createEmployeesWithSalaries: () => Promise.reject(new Error('not reachable')),
    createEmployee: () => Promise.reject(new Error('not reachable')),
    updateEmployee: () => Promise.reject(new Error('not reachable')),
    findEmployeeById: () => Promise.reject(new Error('not reachable')),
    listEmployees: () => Promise.reject(new Error('not reachable')),
    loadFormOptions: () => Promise.reject(new Error('not reachable')),
    appendSalaryRecord: () => Promise.reject(new Error('not reachable')),
    findSalaryHistory: () => Promise.reject(new Error('not reachable')),
    findPeerPopulation: () => Promise.reject(new Error('not reachable')),
    findGenderGapPopulation: () => Promise.reject(new Error('not reachable')),
  } satisfies EmployeeRepository;

  return {
    repository,
    get calls() {
      return state.calls;
    },
  };
}

/** Five in-triple members whose median is 1_000_000, plus a probe at `probeMinor`. */
function probePopulation(probeMinor: bigint): PeerGroupPopulation {
  return population(SWE_L4_IN, SWE_L4_IN_LABELS, [
    candidate('e1', 'A', 1_000_000n),
    candidate('e2', 'B', 1_000_000n),
    candidate('e3', 'C', 1_000_000n),
    candidate('e4', 'D', 1_000_000n),
    candidate('probe', 'Priya Nair', probeMinor),
  ]);
}

describe('getOutlierFindings — the outlier group payload (AD-20), every field a receipt', () => {
  it('returns a finalized findings group with peerMedian, n, currency, and one finding per flagged member', async () => {
    const result = await getOutlierFindings(fakeDeps({ populations: [probePopulation(1_250_000n)] }), AS_OF, 20);

    expect(result).toEqual<GetOutlierFindingsResult>({
      kind: 'findings',
      report: {
        asOf: AS_OF,
        thresholdPct: 20,
        groups: [
          {
            kind: 'outliers',
            peerGroup: {
              roleCode: 'SWE',
              levelCode: 'L4',
              countryCode: 'IN',
              roleName: 'Software Engineer',
              levelLabel: 'L4',
              countryName: 'India',
            },
            n: 5,
            currency: 'INR',
            peerMedian: { amountMinor: '1000000', currency: 'INR' },
            findings: [
              {
                employeeId: 'probe',
                employeeName: 'Priya Nair',
                salary: { amountMinor: '1250000', currency: 'INR' },
                distancePct: '25.0',
              },
            ],
          },
        ],
      },
    });
  });

  it('carries a NEGATIVE signed distance when the member is below the median', async () => {
    const result = await getOutlierFindings(fakeDeps({ populations: [probePopulation(700_000n)] }), AS_OF, 20);

    expect(result.kind).toBe('findings');
    if (result.kind !== 'findings') return;
    expect(result.report.groups[0]?.kind).toBe('outliers');
    const g = result.report.groups[0];
    if (g?.kind !== 'outliers') return;
    expect(g.findings).toEqual([
      {
        employeeId: 'probe',
        employeeName: 'Priya Nair',
        salary: { amountMinor: '700000', currency: 'INR' },
        distancePct: '-30.0',
      },
    ]);
  });

  it('encodes every monetary field as a BoundaryMoney decimal string (Law 4)', async () => {
    const result = await getOutlierFindings(fakeDeps({ populations: [probePopulation(1_250_000n)] }), AS_OF, 20);

    if (result.kind !== 'findings') throw new Error('expected findings');
    const g = result.report.groups[0];
    if (g?.kind !== 'outliers') throw new Error('expected outliers group');
    expect(typeof g.peerMedian.amountMinor).toBe('string');
    expect(typeof g.findings[0]?.salary.amountMinor).toBe('string');
  });
});

describe('getOutlierFindings — threshold conversion and boundary exactness (AD-5)', () => {
  it('converts the integer-percent threshold to tenths at the edge: 20.0% does NOT flag, 20.1% does', async () => {
    // 1_200_000 → +20.0% (200 tenths) — not beyond 200; 1_201_000 → +20.1% (201 tenths) — beyond.
    const at20 = await getOutlierFindings(fakeDeps({ populations: [probePopulation(1_200_000n)] }), AS_OF, 20);
    expect(at20).toEqual({ kind: 'findings', report: { asOf: AS_OF, thresholdPct: 20, groups: [] } });

    const at201 = await getOutlierFindings(fakeDeps({ populations: [probePopulation(1_201_000n)] }), AS_OF, 20);
    if (at201.kind !== 'findings') throw new Error('expected findings');
    expect(at201.report.groups).toHaveLength(1);
  });

  it('produces different findings under different thresholds — a pure function of thresholdPct', async () => {
    // The probe is +25.0%. Flags at threshold 10, within at threshold 30.
    const at10 = await getOutlierFindings(fakeDeps({ populations: [probePopulation(1_250_000n)] }), AS_OF, 10);
    if (at10.kind !== 'findings') throw new Error('expected findings');
    expect(at10.report.groups).toHaveLength(1);
    expect(at10.report.thresholdPct).toBe(10);

    const at30 = await getOutlierFindings(fakeDeps({ populations: [probePopulation(1_250_000n)] }), AS_OF, 30);
    expect(at30).toEqual({ kind: 'findings', report: { asOf: AS_OF, thresholdPct: 30, groups: [] } });
  });
});

describe('getOutlierFindings — omissions, refusals, and empty (AD-16 / AD-20)', () => {
  it('omits a group of ≥5 with no beyond-threshold member', async () => {
    const within = population(SWE_L4_IN, SWE_L4_IN_LABELS, [
      candidate('e1', 'A', 1_000_000n),
      candidate('e2', 'B', 1_010_000n),
      candidate('e3', 'C', 1_020_000n),
      candidate('e4', 'D', 1_030_000n),
      candidate('e5', 'E', 1_040_000n),
    ]);

    const result = await getOutlierFindings(fakeDeps({ populations: [within] }), AS_OF, 20);
    expect(result).toEqual({ kind: 'findings', report: { asOf: AS_OF, thresholdPct: 20, groups: [] } });
  });

  it('emits a thin group as an inline refusal naming n, never widened, no median', async () => {
    const thin = population(SWE_L4_IN, SWE_L4_IN_LABELS, [
      candidate('e1', 'A', 1_000_000n),
      candidate('e2', 'B', 2_000_000n),
      candidate('e3', 'C', 3_000_000n),
    ]);

    const result = await getOutlierFindings(fakeDeps({ populations: [thin] }), AS_OF, 20);

    expect(result).toEqual({
      kind: 'findings',
      report: {
        asOf: AS_OF,
        thresholdPct: 20,
        groups: [
          {
            kind: 'refusal',
            peerGroup: {
              roleCode: 'SWE',
              levelCode: 'L4',
              countryCode: 'IN',
              roleName: 'Software Engineer',
              levelLabel: 'L4',
              countryName: 'India',
            },
            counts: { n: 3 },
            reason: 'thin-peer-group',
          },
        ],
      },
    });
  });

  it('omits an n=0 group (all members future at asOf) — not a refusal row', async () => {
    const empty = population(SWE_L4_IN, SWE_L4_IN_LABELS, [
      candidate('e1', 'A', 1_000_000n, { effectiveFrom: FUTURE }),
      candidate('e2', 'B', 1_000_000n, { effectiveFrom: FUTURE }),
    ]);

    const result = await getOutlierFindings(fakeDeps({ populations: [empty] }), AS_OF, 20);
    expect(result).toEqual({ kind: 'findings', report: { asOf: AS_OF, thresholdPct: 20, groups: [] } });
  });

  it('returns kind:findings with groups:[] when there are no outliers and no thin groups', async () => {
    const result = await getOutlierFindings(fakeDeps({ populations: [] }), AS_OF, 20);
    expect(result).toEqual({ kind: 'findings', report: { asOf: AS_OF, thresholdPct: 20, groups: [] } });
  });
});

describe('getOutlierFindings — deterministic ordering (Law 6 / NFR1)', () => {
  it('sorts findings within a group by abs(distance) desc, tie-break employeeId asc', async () => {
    // Sorted currents [1m, 1m, 1m, 1.5m, 1.5m] → median 1m. The two 1.5m members are each +50.0%
    // (500 tenths); the three 1m members sit on the median (within). The +50% pair TIES, broken by
    // employeeId asc. The within members exercise the "candidate not flagged" join arm.
    const pop = population(SWE_L4_IN, SWE_L4_IN_LABELS, [
      candidate('c', 'C', 1_000_000n),
      candidate('d', 'D', 1_000_000n),
      candidate('e', 'E', 1_000_000n),
      candidate('b-hi', 'BHi', 1_500_000n),
      candidate('a-hi', 'AHi', 1_500_000n),
    ]);

    const result = await getOutlierFindings(fakeDeps({ populations: [pop] }), AS_OF, 20);
    if (result.kind !== 'findings') throw new Error('expected findings');
    const g = result.report.groups[0];
    if (g?.kind !== 'outliers') throw new Error('expected outliers group');
    // Both at +50%: tie broken by employeeId asc → 'a-hi' before 'b-hi'.
    expect(g.findings.map((f) => f.employeeId)).toEqual(['a-hi', 'b-hi']);
    expect(g.findings.map((f) => f.distancePct)).toEqual(['50.0', '50.0']);
  });

  it('sorts findings of different magnitudes by abs desc regardless of sign', async () => {
    // Median 1_000_000. +30% (1.3m, 300 tenths) and −40% (600k, −400 tenths). |−400| > |300|.
    const pop = population(SWE_L4_IN, SWE_L4_IN_LABELS, [
      candidate('e1', 'A', 1_000_000n),
      candidate('e2', 'B', 1_000_000n),
      candidate('e3', 'C', 1_000_000n),
      candidate('up30', 'Up', 1_300_000n),
      candidate('down40', 'Down', 600_000n),
    ]);

    const result = await getOutlierFindings(fakeDeps({ populations: [pop] }), AS_OF, 20);
    if (result.kind !== 'findings') throw new Error('expected findings');
    const g = result.report.groups[0];
    if (g?.kind !== 'outliers') throw new Error('expected outliers group');
    expect(g.findings.map((f) => f.employeeId)).toEqual(['down40', 'up30']);
    expect(g.findings.map((f) => f.distancePct)).toEqual(['-40.0', '30.0']);
  });

  it('sorts GROUPS by (roleCode, levelCode, countryCode) asc, each in its own currency', async () => {
    const inr = population(
      { roleCode: 'SWE', levelCode: 'L4', countryCode: 'IN' },
      { roleName: 'Software Engineer', levelLabel: 'L4', countryName: 'India' },
      [
        candidate('i1', 'I1', 1_000_000n, { currency: 'INR' }),
        candidate('i2', 'I2', 1_000_000n, { currency: 'INR' }),
        candidate('i3', 'I3', 1_000_000n, { currency: 'INR' }),
        candidate('i4', 'I4', 1_000_000n, { currency: 'INR' }),
        candidate('iHi', 'IHi', 1_500_000n, { currency: 'INR' }),
      ],
      INR_FORMAT,
    );
    const usd = population(
      { roleCode: 'PM', levelCode: 'L5', countryCode: 'US' },
      { roleName: 'Product Manager', levelLabel: 'L5', countryName: 'United States' },
      [
        candidate('u1', 'U1', 2_000_000n, { currency: 'USD' }),
        candidate('u2', 'U2', 2_000_000n, { currency: 'USD' }),
        candidate('u3', 'U3', 2_000_000n, { currency: 'USD' }),
        candidate('u4', 'U4', 2_000_000n, { currency: 'USD' }),
        candidate('uHi', 'UHi', 3_000_000n, { currency: 'USD' }),
      ],
      USD_FORMAT,
    );

    // A second SWE group at a LOWER level — its roleCode TIES with `inr`, so the sort falls through
    // to the level tie-break (exercising the equal-strings arm of the comparator).
    const inrL3 = population(
      { roleCode: 'SWE', levelCode: 'L3', countryCode: 'IN' },
      { roleName: 'Software Engineer', levelLabel: 'L3', countryName: 'India' },
      [
        candidate('j1', 'J1', 1_000_000n, { currency: 'INR' }),
        candidate('j2', 'J2', 1_000_000n, { currency: 'INR' }),
        candidate('j3', 'J3', 1_000_000n, { currency: 'INR' }),
        candidate('j4', 'J4', 1_000_000n, { currency: 'INR' }),
        candidate('jHi', 'JHi', 1_500_000n, { currency: 'INR' }),
      ],
      INR_FORMAT,
    );

    // Supplied out of order, but the sort is total: PM < SWE by roleCode; within SWE, L3 < L4.
    const result = await getOutlierFindings(fakeDeps({ populations: [inr, usd, inrL3] }), AS_OF, 20);
    if (result.kind !== 'findings') throw new Error('expected findings');
    expect(result.report.groups.map((g) => [g.peerGroup.roleCode, g.peerGroup.levelCode])).toEqual([
      ['PM', 'L5'],
      ['SWE', 'L3'],
      ['SWE', 'L4'],
    ]);
    // Each judged in its own currency — no cross-currency comparison (AD-3-currency).
    const currencies = result.report.groups.map((g) => (g.kind === 'outliers' ? g.currency : null));
    expect(currencies).toEqual(['USD', 'INR', 'INR']);
  });

  it('returns byte-identical payloads for the same data, asOf, and threshold', async () => {
    const populations = [probePopulation(1_250_000n)];
    const first = await getOutlierFindings(fakeDeps({ populations }), AS_OF, 20);
    const second = await getOutlierFindings(fakeDeps({ populations }), AS_OF, 20);
    expect(first).toEqual(second);
  });
});

describe('getOutlierFindings — totality (AD-20)', () => {
  it('answers unavailable when findAllPeerGroups throws — the throw does NOT propagate', async () => {
    await expect(getOutlierFindings(fakeDeps({ throws: true }), AS_OF, 20)).resolves.toEqual({
      kind: 'unavailable',
    });
  });

  it('reads the whole population exactly once', async () => {
    const deps = fakeDeps({ populations: [probePopulation(1_250_000n)] });
    await getOutlierFindings(deps, AS_OF, 20);
    expect(deps.calls).toBe(1);
  });
});
