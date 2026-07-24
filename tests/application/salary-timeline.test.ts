import { describe, expect, it } from 'vitest';

import type { EmployeeRepository } from '@/application/ports/employee-repository';
import {
  getSalaryTimeline,
  type SalaryTimelineDeps,
} from '@/application/use-cases/salary-timeline';
import type { PlainDate } from '@/domain/plain-date';
import type { SalaryRecordView } from '@/domain/salary-timeline';

// Test-first (Law 1 / AD-23): red before `src/application/use-cases/salary-timeline.ts` exists.
//
// Against in-memory FAKES, never a database (Law: Testing). No clock is injected and none may be:
// `asOf` is a REQUIRED ARGUMENT threaded in from the delivery boundary (Law 6 / AD-11), and every
// assertion below names the date it is asking about.
//
// The use-case is TOTAL (Law 8 / AD-20): a repository `null` is a `not-found` payload, a repository
// THROW is an `unavailable` payload, and neither ever escapes as an exception — story 5-2 renders
// this and adds nothing to the contract (Law 7).
//
// The load-bearing boundary facts, pinned here so 5-2 can rely on them:
//   - money leaves as `BoundaryMoney` — `amountMinor` a DECIMAL STRING, never a number, never a raw
//     `bigint` (a `bigint` cannot survive RSC→client serialization). This is the first OUTBOUND
//     `toBoundaryMoney` call site (Law 4 / AD-4).
//   - `seq` NEVER crosses the boundary; the current record is marked by `id` only.
//   - dates cross as `PlainDate`, matching the sibling `EmployeeDetail` read on the same page.
//   - `currentSalaryRecordId` is the ONE resolver's pick (AD-8) and equals `records[0]?.id` — the
//     timeline head and the resolver never disagree.

const date = (year: number, month: number, day: number): PlainDate => ({ year, month, day });

const TODAY = date(2026, 7, 19);
const EMPLOYEE_ID = '018f8a1e-0000-7000-8000-000000000001';

const INR = (amountMinor: bigint) => ({ amountMinor, currency: 'INR' });

/** A record as the repository read hands it over — `seq` and domain `Money` intact. */
function view(
  id: string,
  effectiveFrom: PlainDate,
  seq: bigint,
  amountMinor: bigint,
): SalaryRecordView {
  return { id, effectiveFrom, seq, salary: INR(amountMinor) };
}

const HIRE = view('hire', date(2021, 6, 1), 1n, 2_000_000n);
const RAISE_2023 = view('raise-2023', date(2023, 4, 1), 2n, 2_400_000n);
const RAISE_2025 = view('raise-2025', date(2025, 1, 15), 3n, 3_000_000n);

const BOOM = new Error('the database is not answering');

type FakeConfig = {
  /** `undefined` means "return the default three-record history"; `null` means no such employee. */
  readonly history?: readonly SalaryRecordView[] | null;
  readonly throws?: boolean;
};

function fakeDeps(config: FakeConfig = {}): SalaryTimelineDeps & { readonly asked: string[] } {
  const asked: string[] = [];

  const repository = {
    findSalaryHistory: async (employeeId: string) => {
      asked.push(employeeId);
      if (config.throws) {
        throw BOOM;
      }
      return config.history === undefined ? [HIRE, RAISE_2023, RAISE_2025] : config.history;
    },
    // Nothing else is reachable from this read use-case, and a rejecting stub is how that stays true.
    loadReferenceData: () => Promise.reject(new Error('not reachable')),
    createEmployeesWithSalaries: () => Promise.reject(new Error('not reachable')),
    createEmployee: () => Promise.reject(new Error('not reachable')),
    updateEmployee: () => Promise.reject(new Error('not reachable')),
    findEmployeeById: () => Promise.reject(new Error('not reachable')),
    listEmployees: () => Promise.reject(new Error('not reachable')),
    loadFormOptions: () => Promise.reject(new Error('not reachable')),
    appendSalaryRecord: () => Promise.reject(new Error('not reachable')),
    findPeerPopulation: () => Promise.reject(new Error('not reachable')),
    findAllPeerGroups: () => Promise.reject(new Error('not reachable')),
    findGenderGapPopulation: () => Promise.reject(new Error('not reachable')),
    findGenderDistributionPopulation: () => Promise.reject(new Error('not reachable')),
    findPayrollTotalsPopulation: () => Promise.reject(new Error('not reachable')),
  } satisfies EmployeeRepository;

  return { repository, asked };
}

describe('getSalaryTimeline — the finalized CAP-4 read payload', () => {
  it('returns every record newest-first with the current record marked by id', async () => {
    const deps = fakeDeps();

    const result = await getSalaryTimeline(deps, EMPLOYEE_ID, TODAY);

    expect(result).toEqual({
      kind: 'timeline',
      timeline: {
        employeeId: EMPLOYEE_ID,
        asOf: TODAY,
        records: [
          { id: 'raise-2025', effectiveFrom: date(2025, 1, 15), salary: { amountMinor: '3000000', currency: 'INR' } },
          { id: 'raise-2023', effectiveFrom: date(2023, 4, 1), salary: { amountMinor: '2400000', currency: 'INR' } },
          { id: 'hire', effectiveFrom: date(2021, 6, 1), salary: { amountMinor: '2000000', currency: 'INR' } },
        ],
        currentSalaryRecordId: 'raise-2025',
      },
    });
  });

  it('reads the history for exactly the employee it was asked about', async () => {
    const deps = fakeDeps();

    await getSalaryTimeline(deps, EMPLOYEE_ID, TODAY);

    expect(deps.asked).toEqual([EMPLOYEE_ID]);
  });

  it('marks the current record with the ONE resolver, and it equals records[0].id (AD-8)', async () => {
    const deps = fakeDeps();

    const result = await getSalaryTimeline(deps, EMPLOYEE_ID, TODAY);

    expect(result.kind).toBe('timeline');
    if (result.kind !== 'timeline') return;
    // The invariant the epic requires "must agree": the head IS the current record.
    expect(result.timeline.currentSalaryRecordId).toBe(result.timeline.records[0]?.id);
  });

  it('encodes money as BoundaryMoney — a DECIMAL STRING, never a number or a bigint (Law 4)', async () => {
    const deps = fakeDeps();

    const result = await getSalaryTimeline(deps, EMPLOYEE_ID, TODAY);

    expect(result.kind).toBe('timeline');
    if (result.kind !== 'timeline') return;
    for (const row of result.timeline.records) {
      expect(typeof row.salary.amountMinor).toBe('string');
      expect(row.salary.currency).toBe('INR');
    }
  });

  it('never lets seq cross the boundary — the current record is marked by id alone', async () => {
    const deps = fakeDeps();

    const result = await getSalaryTimeline(deps, EMPLOYEE_ID, TODAY);

    expect(result.kind).toBe('timeline');
    if (result.kind !== 'timeline') return;
    for (const row of result.timeline.records) {
      expect(row).not.toHaveProperty('seq');
    }
  });

  it('crosses dates as PlainDate, matching the sibling employee read', async () => {
    const deps = fakeDeps();

    const result = await getSalaryTimeline(deps, EMPLOYEE_ID, TODAY);

    expect(result.kind).toBe('timeline');
    if (result.kind !== 'timeline') return;
    expect(result.timeline.records[0]?.effectiveFrom).toEqual(date(2025, 1, 15));
    expect(result.timeline.asOf).toEqual(TODAY);
  });
});

describe('getSalaryTimeline — the as-of date filters and re-marks the current record', () => {
  it('hides records effective after asOf and re-marks the newest remaining as current', async () => {
    const deps = fakeDeps();

    // Between the two raises: RAISE_2025 is not yet in effect.
    const result = await getSalaryTimeline(deps, EMPLOYEE_ID, date(2024, 1, 1));

    expect(result.kind).toBe('timeline');
    if (result.kind !== 'timeline') return;
    expect(result.timeline.records.map((row) => row.id)).toEqual(['raise-2023', 'hire']);
    expect(result.timeline.currentSalaryRecordId).toBe('raise-2023');
  });

  it('returns no rows and a null current record when asOf precedes every record', async () => {
    const deps = fakeDeps();

    const result = await getSalaryTimeline(deps, EMPLOYEE_ID, date(2020, 1, 1));

    expect(result).toEqual({
      kind: 'timeline',
      timeline: {
        employeeId: EMPLOYEE_ID,
        asOf: date(2020, 1, 1),
        records: [],
        currentSalaryRecordId: null,
      },
    });
  });

  it('puts the greater-seq same-day correction at the head and marks it current', async () => {
    // A same-day correction shares an effectiveFrom with the typo it fixes; the later INSERT
    // (greater seq) is both the head of the timeline and the current record (AD-8).
    const typo = view('typo', date(2026, 3, 1), 10n, 9_999_999n);
    const correction = view('correction', date(2026, 3, 1), 11n, 2_500_000n);
    const deps = fakeDeps({ history: [HIRE, typo, correction] });

    const result = await getSalaryTimeline(deps, EMPLOYEE_ID, date(2026, 3, 1));

    expect(result.kind).toBe('timeline');
    if (result.kind !== 'timeline') return;
    expect(result.timeline.records.map((row) => row.id)).toEqual(['correction', 'typo', 'hire']);
    expect(result.timeline.currentSalaryRecordId).toBe('correction');
  });
});

describe('getSalaryTimeline — not-found, empty history, and unavailable are different answers', () => {
  it('answers not-found when the repository returns null (no such employee)', async () => {
    const deps = fakeDeps({ history: null });

    await expect(getSalaryTimeline(deps, 'no-such-id', TODAY)).resolves.toEqual({
      kind: 'not-found',
    });
  });

  it('answers a timeline with no rows when the employee exists but has no salary records', async () => {
    // A present employee with an empty history is NOT not-found — the distinction the port's
    // read-null idiom preserves (CAP-2 creates an employee with no salary record).
    const deps = fakeDeps({ history: [] });

    const result = await getSalaryTimeline(deps, EMPLOYEE_ID, TODAY);

    expect(result).toEqual({
      kind: 'timeline',
      timeline: {
        employeeId: EMPLOYEE_ID,
        asOf: TODAY,
        records: [],
        currentSalaryRecordId: null,
      },
    });
  });

  it('answers unavailable when the repository throws — it does NOT propagate', async () => {
    const deps = fakeDeps({ throws: true });

    await expect(getSalaryTimeline(deps, EMPLOYEE_ID, TODAY)).resolves.toEqual({
      kind: 'unavailable',
    });
  });
});
