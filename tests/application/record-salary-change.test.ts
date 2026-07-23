import { describe, expect, it } from 'vitest';

import type {
  AppendSalaryRecordOutcome,
  EmployeeDetail,
  EmployeeRepository,
  NewSalaryRecord,
} from '@/application/ports/employee-repository';
import type { IdGenerator } from '@/application/ports/id';
import {
  recordSalaryChange,
  type RecordSalaryChangeDeps,
} from '@/application/use-cases/record-salary-change';
import type { SalaryChangeInput } from '@/domain/salary-change';
import type { PlainDate } from '@/domain/plain-date';

// Test-first (Law 1 / AD-23): red before `src/application/use-cases/record-salary-change.ts` exists.
//
// Against in-memory FAKES, never a database (Law: Testing). No clock is injected and none may be:
// `today` is a REQUIRED ARGUMENT threaded in from the delivery boundary (Law 6 / AD-11), and this
// file is where that stays honest — every assertion below names the date it is asking about.
//
// The use-case is TOTAL. A validation failure is a payload, a missing employee is a payload, the
// database's AP004 verdict is a payload, and an adapter that THROWS — which the write funnel is
// documented to do on an invariant violation — is caught and answered with a payload too. An
// unguarded call site is a designed-in 500.

const date = (year: number, month: number, day: number): PlainDate => ({ year, month, day });

const TODAY = date(2026, 7, 19);

const REFERENCES = {
  roleCodes: new Set(['software_engineer']),
  levelCodes: new Set(['L3']),
  countryCurrencies: new Map([
    ['IN', 'INR'],
    ['US', 'USD'],
  ]),
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

const VALID: SalaryChangeInput = {
  effectiveFrom: '2026-07-19',
  amountMinor: '2500000',
  currency: 'INR',
};

const BOOM = new Error('the database is not answering');

type FakeConfig = {
  readonly employee?: EmployeeDetail | null;
  readonly appendOutcome?: AppendSalaryRecordOutcome;
  readonly throwsOn?: keyof EmployeeRepository;
};

function fakeDeps(
  config: FakeConfig = {},
): RecordSalaryChangeDeps & {
  readonly appended: { record: NewSalaryRecord; today: PlainDate }[];
} {
  const appended: { record: NewSalaryRecord; today: PlainDate }[] = [];

  async function guard<T>(method: keyof EmployeeRepository, value: T): Promise<T> {
    if (config.throwsOn === method) {
      throw BOOM;
    }
    return value;
  }

  const repository = {
    loadReferenceData: async () => guard('loadReferenceData', REFERENCES),
    findEmployeeById: async () =>
      guard('findEmployeeById', config.employee === undefined ? ADA : config.employee),
    appendSalaryRecord: async (record: NewSalaryRecord, today: PlainDate) => {
      await guard('appendSalaryRecord', undefined);
      appended.push({ record, today });
      return config.appendOutcome ?? ({ kind: 'appended' } as const);
    },
    // Nothing else is reachable from this use-case, and a rejecting stub is how that stays true.
    createEmployeesWithSalaries: () => Promise.reject(new Error('not reachable')),
    createEmployee: () => Promise.reject(new Error('not reachable')),
    updateEmployee: () => Promise.reject(new Error('not reachable')),
    listEmployees: () => Promise.reject(new Error('not reachable')),
    loadFormOptions: () => Promise.reject(new Error('not reachable')),
    findSalaryHistory: () => Promise.reject(new Error('not reachable')),
  } satisfies EmployeeRepository;

  // Deterministic ids — no randomness in the fast suite (AD-14 / Law 6).
  const idGenerator: IdGenerator = { next: () => 'salary-id-1' };

  return { repository, idGenerator, appended };
}

describe('recordSalaryChange — the happy path', () => {
  it('appends the record and answers the finalized payload', async () => {
    const deps = fakeDeps();

    const result = await recordSalaryChange(deps, ADA.id, VALID, TODAY);

    expect(result).toEqual({ kind: 'recorded', salaryRecordId: 'salary-id-1' });
  });

  it('hands the funnel Money in the COUNTRY\'s currency, plus the parsed date and TODAY', async () => {
    const deps = fakeDeps();

    await recordSalaryChange(deps, ADA.id, VALID, TODAY);

    expect(deps.appended).toEqual([
      {
        record: {
          salaryRecordId: 'salary-id-1',
          employeeId: ADA.id,
          // AD-4: never bare, never a number, never a float. Integer minor units + ISO-4217.
          salary: { amountMinor: 2_500_000n, currency: 'INR' },
          effectiveFrom: date(2026, 7, 19),
        },
        // Law 6 / AD-11: the funnel re-checks the future-date rule, and it is told what today is.
        today: TODAY,
      },
    ]);
  });

  it('accepts a BACKDATED change within history', async () => {
    const deps = fakeDeps();

    const result = await recordSalaryChange(
      deps,
      ADA.id,
      { ...VALID, effectiveFrom: '2023-04-01' },
      TODAY,
    );

    expect(result.kind).toBe('recorded');
    expect(deps.appended[0]?.record.effectiveFrom).toEqual(date(2023, 4, 1));
  });

  it('burns no id when the input is rejected', async () => {
    // The id comes from the port (AD-10) and is generated only AFTER the input is judged.
    const deps = fakeDeps();

    await recordSalaryChange(deps, ADA.id, { ...VALID, amountMinor: '0' }, TODAY);

    expect(deps.appended).toEqual([]);
  });
});

describe('the employee', () => {
  it('answers not-found for an id that matches no row, and writes nothing', async () => {
    const deps = fakeDeps({ employee: null });

    const result = await recordSalaryChange(deps, 'no-such-id', VALID, TODAY);

    expect(result).toEqual({ kind: 'not-found', employeeId: 'no-such-id' });
    expect(deps.appended).toEqual([]);
  });

  it('judges the effective date against THAT employee\'s hire date', async () => {
    const deps = fakeDeps({ employee: { ...ADA, hireDate: date(2024, 1, 1) } });

    const result = await recordSalaryChange(
      deps,
      ADA.id,
      { ...VALID, effectiveFrom: '2023-04-01' },
      TODAY,
    );

    expect(result).toEqual({
      kind: 'rejected',
      reasons: [
        {
          field: 'effective_from',
          offendingValue: '2023-04-01',
          sentence: 'effective_from 2023-04-01 is earlier than the hire date, 2024-01-01.',
        },
      ],
    });
    expect(deps.appended).toEqual([]);
  });

  it('resolves the expected currency from THAT employee\'s country (AD-6)', async () => {
    // The employee is in the US, so INR is the wrong currency for them even though it is a
    // perfectly real currency in the reference table.
    const deps = fakeDeps({ employee: { ...ADA, countryCode: 'US' } });

    const result = await recordSalaryChange(deps, ADA.id, VALID, TODAY);

    expect(result).toEqual({
      kind: 'rejected',
      reasons: [
        {
          field: 'currency',
          offendingValue: 'INR',
          sentence: 'Currency "INR" is not "USD", the currency of country "US".',
        },
      ],
    });
    expect(deps.appended).toEqual([]);
  });

  it('rejects, blaming no field, when the country no longer resolves to a currency', async () => {
    // `employee.country` is immutable (AD-6) and its reference row can be deactivated afterwards.
    // No input of the form caused that.
    const deps = fakeDeps({ employee: { ...ADA, countryCode: 'ZZ' } });

    const result = await recordSalaryChange(deps, ADA.id, VALID, TODAY);

    expect(result).toEqual({
      kind: 'rejected',
      reasons: [
        {
          field: null,
          offendingValue: 'ZZ',
          sentence: 'Country code "ZZ" is not in the country reference table.',
        },
      ],
    });
    expect(deps.appended).toEqual([]);
  });
});

describe('rejections reach the caller as data, never as an exception (Law 8)', () => {
  it('rejects a FUTURE effective date without touching the funnel', async () => {
    const deps = fakeDeps();

    const result = await recordSalaryChange(
      deps,
      ADA.id,
      { ...VALID, effectiveFrom: '2026-07-20' },
      TODAY,
    );

    expect(result).toEqual({
      kind: 'rejected',
      reasons: [
        {
          field: 'effective_from',
          offendingValue: '2026-07-20',
          sentence: 'effective_from 2026-07-20 is later than today, 2026-07-19.',
        },
      ],
    });
    expect(deps.appended).toEqual([]);
  });

  it('reports every failing field at once', async () => {
    const deps = fakeDeps();

    const result = await recordSalaryChange(
      deps,
      ADA.id,
      { effectiveFrom: '2026-07-20', amountMinor: 'abc', currency: 'USD' },
      TODAY,
    );

    expect(result.kind).toBe('rejected');
    if (result.kind !== 'rejected') return;
    expect(result.reasons.map((reason) => reason.field)).toEqual([
      'effective_from',
      'amount_minor',
      'currency',
    ]);
  });

  it('turns the funnel\'s AP004 outcome into an effective-date rejection quoting the DATABASE\'s hire date', async () => {
    // This arm ONLY EVER FIRES when the hire date moved between the read and the write: the domain
    // already judged the same rule against the date it READ and let this input through, so the
    // trigger firing PROVES the database holds a different date. A sentence composed from the
    // stale one therefore quotes a hire date the effective date is provably NOT earlier than —
    // wrong in one hundred percent of the cases it appears. The adapter carries the enforced date
    // back on the outcome, and that is the date the reader must be shown.
    //
    // ADA was read with hireDate 2021-06-01; the database enforced against 2027-01-04.
    const deps = fakeDeps({
      appendOutcome: { kind: 'effective-before-hire', hireDate: date(2027, 1, 4) },
    });

    const result = await recordSalaryChange(deps, ADA.id, VALID, TODAY);

    expect(result).toEqual({
      kind: 'rejected',
      reasons: [
        {
          field: 'effective_from',
          offendingValue: '2026-07-19',
          sentence: 'effective_from 2026-07-19 is earlier than the hire date, 2027-01-04.',
        },
      ],
    });
  });

  it('turns the funnel\'s not-found outcome into a not-found payload', async () => {
    // The row can be deleted between the read and the write.
    const deps = fakeDeps({ appendOutcome: { kind: 'not-found' } });

    const result = await recordSalaryChange(deps, ADA.id, VALID, TODAY);

    expect(result).toEqual({ kind: 'not-found', employeeId: ADA.id });
  });
});

describe('an adapter that THROWS becomes a payload, never a 500', () => {
  const throwing: readonly (keyof EmployeeRepository)[] = [
    'findEmployeeById',
    'loadReferenceData',
    'appendSalaryRecord',
  ];

  for (const method of throwing) {
    it(`answers a write-failure rejection when ${method} throws`, async () => {
      const deps = fakeDeps({ throwsOn: method });

      await expect(recordSalaryChange(deps, ADA.id, VALID, TODAY)).resolves.toEqual({
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
  }
});

describe('recordSalaryChange — total against an outcome the switch does not know', () => {
  it('answers a write failure for an unknown append outcome, never `undefined`', () => {
    // Mirrors the identical guard in `updateEmployee` (tests/application/employees.test.ts), which
    // `record-salary-change.ts` names explicitly in its own default arm — the pattern was already
    // established there and is followed here rather than left to coverage's mercy.
    //
    // The switch over `AppendSalaryRecordOutcome` is total only by TYPESCRIPT's grace. At runtime
    // the adapter is ordinary JavaScript behind a port: a widened union, a stale build, or a second
    // implementation can hand back a kind this module has never heard of. Without the guard the
    // switch falls through and the function resolves to `undefined` — in a module whose header
    // promises every function is total — and `undefined` reaching story 4-2 is a blank screen with
    // no sentence on it.
    const deps = fakeDeps({
      appendOutcome: { kind: 'no-such-outcome' } as unknown as AppendSalaryRecordOutcome,
    });

    return expect(recordSalaryChange(deps, ADA.id, VALID, TODAY)).resolves.toEqual(
      expect.objectContaining({ kind: 'rejected' }),
    );
  });
});
