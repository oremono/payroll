import { describe, expect, it } from 'vitest';

import type { OverduePopulation } from '@/application/ports/employee-repository';
import { getOverdue, type OverdueDeps } from '@/application/use-cases/overdue';
import type { OverdueCandidate, OverduePeriod } from '@/domain/overdue';
import type { PlainDate } from '@/domain/plain-date';
import type { SalaryRecordView } from '@/domain/salary-timeline';

// Test-first (Law 1 / AD-23): red before `src/application/use-cases/overdue.ts` exists.
//
// Against an in-memory FAKE port, never a database (Law: Testing). No clock is injected and none may
// be: `asOf` and `period` are REQUIRED ARGUMENTS threaded in from the delivery boundary (Law 6 /
// AD-22). The use-case orchestrates only — one read, hand it to the ONE pure domain
// (`computeOverdue`), encode every `Money` to `BoundaryMoney`, and attach the `asOf`/`cutoff`/`period`
// receipts. ANY repository throw is caught and answered `unavailable`; no exception crosses the
// boundary. Story 11-2 consumes this payload unmodified (Law 7 / AD-24).

const date = (year: number, month: number, day: number): PlainDate => ({ year, month, day });

const AS_OF = date(2026, 7, 16);
const PERIOD_24: OverduePeriod = { kind: 'months', months: 24 };
const CUTOFF_24 = date(2024, 7, 16);

function record(effectiveFrom: PlainDate, amountMinor: bigint, seq = 1n): SalaryRecordView {
  return { id: `rec-${seq}`, seq, effectiveFrom, salary: { amountMinor, currency: 'USD' } };
}

function candidate(
  employeeId: string,
  name: string,
  salaryHistory: readonly SalaryRecordView[],
): OverdueCandidate {
  return { employeeId, name, salaryHistory };
}

type FakeConfig = {
  readonly population?: OverduePopulation;
  readonly throwOnRead?: boolean;
};

function fakeDeps(config: FakeConfig = {}): OverdueDeps & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    repository: {
      findOverduePopulation: async () => {
        calls.push('population');
        if (config.throwOnRead) {
          throw new Error('overdue population read failed');
        }
        return (
          config.population ?? {
            candidates: [
              candidate('C', 'Old Timer', [record(date(2019, 1, 1), 30_000n)]),
              candidate('A', 'Ana', [record(date(2024, 7, 10), 10_000n)]),
              candidate('B', 'Ben', [record(CUTOFF_24, 20_000n)]), // on cutoff -> excluded
              candidate('D', 'Dee', [record(date(2026, 9, 1), 40_000n)]), // future -> out of population
            ],
          }
        );
      },
    },
    calls,
  };
}

describe('getOverdue — the answer payload (AD-20), boundary-encoded and carrying its receipts', () => {
  it('returns kind:answer with asOf/cutoff/period receipts and rows oldest-first, money encoded', async () => {
    const result = await getOverdue(fakeDeps(), AS_OF, PERIOD_24);

    expect(result).toEqual({
      kind: 'answer',
      report: {
        asOf: AS_OF,
        cutoff: CUTOFF_24,
        period: PERIOD_24,
        rows: [
          {
            employeeId: 'C',
            name: 'Old Timer',
            effectiveFrom: date(2019, 1, 1),
            salary: { amountMinor: '30000', currency: 'USD' },
          },
          {
            employeeId: 'A',
            name: 'Ana',
            effectiveFrom: date(2024, 7, 10),
            salary: { amountMinor: '10000', currency: 'USD' },
          },
        ],
      },
    });
  });

  it('encodes every Money to BoundaryMoney (amountMinor a decimal string, currency present)', async () => {
    const result = await getOverdue(fakeDeps(), AS_OF, PERIOD_24);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') return;
    for (const row of result.report.rows) {
      expect(typeof row.salary.amountMinor).toBe('string');
      expect(row.salary.currency).toBe('USD');
    }
  });

  it('reads the overdue population port exactly once', async () => {
    const deps = fakeDeps();

    await getOverdue(deps, AS_OF, PERIOD_24);

    expect(deps.calls).toEqual(['population']);
  });
});

describe('getOverdue — the cutoff is asOf-derived, and the custom-date period threads through', () => {
  it('echoes a custom-date period and measures its cutoff verbatim', async () => {
    const period: OverduePeriod = { kind: 'date', cutoff: date(2022, 1, 1) };
    const population: OverduePopulation = {
      candidates: [
        candidate('e1', 'One', [record(date(2021, 6, 1), 100n)]), // < 2022 -> overdue
        candidate('e2', 'Two', [record(date(2023, 1, 1), 200n)]), // >= 2022 -> not overdue
      ],
    };

    const result = await getOverdue(fakeDeps({ population }), AS_OF, period);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') return;
    expect(result.report.cutoff).toEqual(date(2022, 1, 1));
    expect(result.report.period).toEqual(period);
    expect(result.report.rows.map((row) => row.employeeId)).toEqual(['e1']);
  });
});

describe('getOverdue — the zero-state is an answer, never unavailable', () => {
  it('answers rows: [] for an empty population', async () => {
    const result = await getOverdue(fakeDeps({ population: { candidates: [] } }), AS_OF, PERIOD_24);

    expect(result).toEqual({
      kind: 'answer',
      report: { asOf: AS_OF, cutoff: CUTOFF_24, period: PERIOD_24, rows: [] },
    });
  });
});

describe('getOverdue — totality (AD-20): the read throwing becomes unavailable', () => {
  it('answers unavailable when the population read throws — no exception crosses the boundary', async () => {
    await expect(getOverdue(fakeDeps({ throwOnRead: true }), AS_OF, PERIOD_24)).resolves.toEqual({
      kind: 'unavailable',
    });
  });
});

describe('getOverdue — determinism (Law 6 / AD-22)', () => {
  it('returns byte-identical payloads for the same data, asOf, and period', async () => {
    const first = await getOverdue(fakeDeps(), AS_OF, PERIOD_24);
    const second = await getOverdue(fakeDeps(), AS_OF, PERIOD_24);

    expect(first).toEqual(second);
  });
});
