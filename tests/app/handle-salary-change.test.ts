import { describe, expect, it } from 'vitest';

import type {
  AppendSalaryRecordOutcome,
  EmployeeDetail,
  EmployeeRepository,
  NewSalaryRecord,
} from '@/application/ports/employee-repository';
import type { Clock } from '@/application/ports/clock';
import type { IdGenerator } from '@/application/ports/id';
import {
  handleRecordSalaryChange,
  type SalaryChangeWriteDeps,
} from '@/app/employees/handle-salary-change';
import type { PlainDate } from '@/domain/plain-date';

// Test-first (Law 1 / AD-23): red before `src/app/employees/handle-salary-change.ts` exists.
//
// The body of the CAP-3 Server Action, tested WITHOUT Next and without a database — the same split
// story 2-1 made between `handle-import-request.ts` and `route.ts`, and story 3-1 between
// `handle-employee-write.ts` and `actions.ts`.
//
// Three obligations dominate this file:
//
//   1. A `'use server'` export is a live RPC endpoint and `SalaryChangeInput`'s `string` types are
//      ERASED at runtime. A caller can send `5` for the amount, `null` for the date, or nothing at
//      all, and the answer must be a rejection naming the offending field — never a generic write
//      failure, and never an unhandled TypeError.
//   2. MONEY CROSSES AS A DECIMAL STRING (Law 4 / AD-4). `amountMinor: 2500000` — a JS number — is
//      not money at this boundary and is refused as such; the value that reaches the funnel is a
//      `bigint` in the country's currency.
//   3. The CLOCK is read HERE and nowhere deeper (Law 6 / AD-11). The date the port sees is the one
//      this boundary supplied, and a fake clock is what proves it.

const date = (year: number, month: number, day: number): PlainDate => ({ year, month, day });

const TODAY = date(2026, 7, 19);

const REFERENCES = {
  roleCodes: new Set(['software_engineer']),
  levelCodes: new Set(['L3']),
  countryCurrencies: new Map([['IN', 'INR']]),
};

const ADA: EmployeeDetail = {
  id: '018f8a1e-0000-7000-8000-000000000001',
  name: 'Ada Lovelace',
  roleCode: 'software_engineer',
  levelCode: 'L3',
  countryCode: 'IN',
  gender: 'FEMALE',
  hireDate: date(2021, 6, 1),
};

const VALID_PAYLOAD = {
  effectiveFrom: '2026-07-19',
  // A DECIMAL STRING, never a JS number and never a raw bigint (Law 4 / AD-4).
  amountMinor: '2500000',
  currency: 'INR',
};

type FakeConfig = {
  readonly employee?: EmployeeDetail | null;
  readonly appendOutcome?: AppendSalaryRecordOutcome;
  readonly throws?: boolean;
  /** `revalidatePath` throwing OUTSIDE a request scope — the row is already committed by then. */
  readonly revalidateThrows?: boolean;
};

function fakeDeps(
  config: FakeConfig = {},
): SalaryChangeWriteDeps & {
  readonly appended: { record: NewSalaryRecord; today: PlainDate }[];
  readonly revalidations: string[];
} {
  const appended: { record: NewSalaryRecord; today: PlainDate }[] = [];
  const revalidations: string[] = [];

  const repository = {
    loadReferenceData: () => Promise.resolve(REFERENCES),
    findEmployeeById: () =>
      Promise.resolve(config.employee === undefined ? ADA : config.employee),
    appendSalaryRecord: (record: NewSalaryRecord, today: PlainDate) => {
      if (config.throws) {
        throw new Error('the write funnel refused');
      }
      appended.push({ record, today });
      return Promise.resolve(config.appendOutcome ?? ({ kind: 'appended' } as const));
    },
    createEmployeesWithSalaries: () => Promise.reject(new Error('not reachable')),
    createEmployee: () => Promise.reject(new Error('not reachable')),
    updateEmployee: () => Promise.reject(new Error('not reachable')),
    listEmployees: () => Promise.reject(new Error('not reachable')),
    loadFormOptions: () => Promise.reject(new Error('not reachable')),
    findSalaryHistory: () => Promise.reject(new Error('not reachable')),
    findPeerPopulation: () => Promise.reject(new Error('not reachable')),
    findAllPeerGroups: () => Promise.reject(new Error('not reachable')),
  } satisfies EmployeeRepository;

  const idGenerator: IdGenerator = { next: () => 'salary-id-1' };

  // A FAKE clock, injected. The real one is the single `Date.now()` in the codebase and lives in
  // an adapter; this suite stays clock-free, which is what makes every date assertion here exact.
  const clock: Clock = { todayUtc: () => TODAY };

  return {
    repository,
    idGenerator,
    clock,
    revalidate: (employeeId: string) => {
      if (config.revalidateThrows) {
        throw new Error('revalidatePath was called outside a request scope');
      }
      revalidations.push(employeeId);
    },
    appended,
    revalidations,
  };
}

describe('handleRecordSalaryChange — the happy path', () => {
  it('records the change and answers the finalized payload', async () => {
    const deps = fakeDeps();

    const result = await handleRecordSalaryChange(deps, ADA.id, VALID_PAYLOAD);

    expect(result).toEqual({ kind: 'recorded', salaryRecordId: 'salary-id-1' });
  });

  it('reads TODAY from the clock port and passes it inward', async () => {
    // Law 6 / AD-11: this boundary is the only place that asks what day it is. Nothing downstream
    // reads a clock; it is told.
    const deps = fakeDeps();

    await handleRecordSalaryChange(deps, ADA.id, VALID_PAYLOAD);

    expect(deps.appended[0]?.today).toEqual(TODAY);
  });

  it('turns the decimal string into a bigint in the COUNTRY\'s currency', async () => {
    const deps = fakeDeps();

    await handleRecordSalaryChange(deps, ADA.id, VALID_PAYLOAD);

    expect(deps.appended[0]?.record.salary).toEqual({
      amountMinor: 2_500_000n,
      currency: 'INR',
    });
  });

  it('revalidates after a successful write, naming the employee that was written', async () => {
    // Story 4-2 renders the timeline from a read; without this, its first recorded change would
    // leave a stale page on screen and it would have to add cache invalidation the finalized
    // contract never mentioned (Law 7).
    const deps = fakeDeps();

    await handleRecordSalaryChange(deps, ADA.id, VALID_PAYLOAD);

    expect(deps.revalidations).toEqual([ADA.id]);
  });

  it('does NOT revalidate after a rejection', async () => {
    const deps = fakeDeps();

    await handleRecordSalaryChange(deps, ADA.id, { ...VALID_PAYLOAD, amountMinor: '0' });

    expect(deps.revalidations).toEqual([]);
  });

  it('answers `recorded` even when revalidation throws — the row is already committed', async () => {
    // Reporting a cache failure as a write failure would tell the user nothing was recorded when
    // something was. They would resubmit, and the employee would hold two records.
    const deps = fakeDeps({ revalidateThrows: true });

    await expect(handleRecordSalaryChange(deps, ADA.id, VALID_PAYLOAD)).resolves.toEqual({
      kind: 'recorded',
      salaryRecordId: 'salary-id-1',
    });
  });
});

describe('the boundary does not trust its own types', () => {
  it('rejects a NUMBER amount — money crosses as a decimal string, never a JS number', async () => {
    // The Law 4 boundary rule, enforced at the one place it can be: a JS number cannot hold
    // ₹1,23,45,678.90 exactly, so an `amountMinor` that arrives as one is not money.
    const deps = fakeDeps();

    const result = await handleRecordSalaryChange(deps, ADA.id, {
      ...VALID_PAYLOAD,
      amountMinor: 2_500_000,
    });

    expect(result).toEqual({
      kind: 'rejected',
      reasons: [
        {
          field: 'amount_minor',
          offendingValue: null,
          sentence: 'The amount field was not submitted as text.',
        },
      ],
    });
    expect(deps.appended).toEqual([]);
  });

  it('rejects a raw bigint amount for the same reason', async () => {
    // `JSON.stringify` refuses a bigint outright, so one arriving here is a caller bypassing the
    // serialization contract rather than honouring it.
    const deps = fakeDeps();

    const result = await handleRecordSalaryChange(deps, ADA.id, {
      ...VALID_PAYLOAD,
      amountMinor: 2_500_000n,
    });

    expect(result.kind).toBe('rejected');
    expect(deps.appended).toEqual([]);
  });

  it('names EVERY field that did not arrive as text, in the form\'s order', async () => {
    const deps = fakeDeps();

    const result = await handleRecordSalaryChange(deps, ADA.id, {
      effectiveFrom: null,
      amountMinor: 5,
      currency: { code: 'INR' },
    });

    expect(result.kind).toBe('rejected');
    if (result.kind !== 'rejected') return;
    expect(result.reasons.map((reason) => reason.field)).toEqual([
      'effective_from',
      'amount_minor',
      'currency',
    ]);
  });

  it('fails every field when the payload is not an object at all', async () => {
    // None of them arrived, which is the honest answer.
    for (const payload of [null, undefined, 'a string', 42, []]) {
      const result = await handleRecordSalaryChange(fakeDeps(), ADA.id, payload);

      expect(result.kind).toBe('rejected');
      if (result.kind !== 'rejected') continue;
      expect(result.reasons).toHaveLength(3);
    }
  });

  it('ignores extra keys a hostile caller smuggles in', async () => {
    // Only the three fields are read. A `countryCode` or a `seq` is neither written nor grounds
    // for refusal — it simply is not a field of this form.
    const deps = fakeDeps();

    const result = await handleRecordSalaryChange(deps, ADA.id, {
      ...VALID_PAYLOAD,
      countryCode: 'US',
      seq: '9999',
      employeeId: 'someone-else',
    });

    expect(result).toEqual({ kind: 'recorded', salaryRecordId: 'salary-id-1' });
    expect(deps.appended[0]?.record.employeeId).toBe(ADA.id);
  });

  it('answers not-found when the employee id is not a string', async () => {
    // The same answer `'not-a-uuid'` gets from the adapter — same wire, same cause. A write failure
    // would report something that never happened: nothing was attempted, because nothing
    // identified a row to attempt it against.
    const deps = fakeDeps();

    await expect(handleRecordSalaryChange(deps, 42, VALID_PAYLOAD)).resolves.toEqual({
      kind: 'not-found',
      employeeId: '',
    });
    expect(deps.appended).toEqual([]);
  });
});

describe('the boundary never propagates an exception', () => {
  it('answers a write-failure rejection when the funnel throws', async () => {
    // A Server Action is the outermost frame of a request: anything escaping it becomes a framework
    // error page rather than a form the user can correct.
    const deps = fakeDeps({ throws: true });

    await expect(handleRecordSalaryChange(deps, ADA.id, VALID_PAYLOAD)).resolves.toEqual({
      kind: 'rejected',
      reasons: [
        {
          field: null,
          offendingValue: null,
          sentence: 'The salary change could not be saved, so nothing was recorded.',
        },
      ],
    });
  });

  it('answers a write-failure rejection when the CLOCK throws', async () => {
    // The use-case wraps its whole body, so a throwing funnel never reaches the boundary's own
    // catch — the test above passes on the use-case's payload. The clock is read at the boundary,
    // OUTSIDE the use-case, so this is one of the only two inputs that proves the second net exists.
    const deps: SalaryChangeWriteDeps = {
      ...fakeDeps(),
      clock: {
        todayUtc: () => {
          throw new Error('the clock is unavailable');
        },
      },
    };

    await expect(handleRecordSalaryChange(deps, ADA.id, VALID_PAYLOAD)).resolves.toEqual({
      kind: 'rejected',
      reasons: [
        {
          field: null,
          offendingValue: null,
          sentence: 'The salary change could not be saved, so nothing was recorded.',
        },
      ],
    });
  });

  it('answers a write-failure rejection when READING a payload field throws', async () => {
    // The payload crossed `'use server'` from an untrusted caller. A getter that throws is a plain
    // object as far as the coercion's `typeof` check is concerned; the throw happens on access.
    const hostile = {
      effectiveFrom: VALID_PAYLOAD.effectiveFrom,
      amountMinor: VALID_PAYLOAD.amountMinor,
      get currency(): string {
        throw new Error('hostile getter');
      },
    };

    await expect(handleRecordSalaryChange(fakeDeps(), ADA.id, hostile)).resolves.toEqual({
      kind: 'rejected',
      reasons: [
        {
          field: null,
          offendingValue: null,
          sentence: 'The salary change could not be saved, so nothing was recorded.',
        },
      ],
    });
  });

  it('passes a not-found employee straight through', async () => {
    const deps = fakeDeps({ employee: null });

    await expect(handleRecordSalaryChange(deps, ADA.id, VALID_PAYLOAD)).resolves.toEqual({
      kind: 'not-found',
      employeeId: ADA.id,
    });
    expect(deps.revalidations).toEqual([]);
  });
});
