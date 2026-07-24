import { describe, expect, it } from 'vitest';

import type {
  EmployeeDetail,
  EmployeeFormOptions,
  EmployeeListPage,
  EmployeeListQuery,
  EmployeeRepository,
  EmployeeUpdate,
  NewEmployee,
  UpdateEmployeeOutcome,
} from '@/application/ports/employee-repository';
import type { IdGenerator } from '@/application/ports/id';
import {
  createEmployee,
  getEmployee,
  listEmployees,
  loadEmployeeFormOptions,
  updateEmployee,
  type EmployeeUseCaseDeps,
} from '@/application/use-cases/employees';
import type { EmployeeInput, EmployeeUpdateInput } from '@/domain/employee';

// Test-first (Law 1 / AD-23): red before `src/application/use-cases/employees.ts` exists.
//
// Against in-memory FAKES, never a database (Law: Testing). No clock is injected anywhere in this
// file and none is needed — a future hire date is accepted, so no CAP-2 rule is date-relative.
//
// The load-bearing property here, and the reason this story was re-derived: EVERY ONE of the five
// use-cases is TOTAL. The reads do not pass an adapter throw through — a database outage is an
// ANSWER (`{ kind: 'unavailable' }`), not an exception, because story 3-2 renders the directory
// from these reads and a read that throws forces 3-2 to invent error handling the contract never
// gave it (Law 7).

const REFERENCES = {
  roleCodes: new Set(['software_engineer']),
  levelCodes: new Set(['L3']),
  countryCurrencies: new Map([['IN', 'INR']]),
};

const DETAIL: EmployeeDetail = {
  id: 'emp-1',
  name: 'Ada Lovelace',
  roleCode: 'software_engineer',
  levelCode: 'L3',
  countryCode: 'IN',
  gender: 'FEMALE',
  hireDate: { year: 2021, month: 6, day: 1 },
};

const FORM_OPTIONS: EmployeeFormOptions = {
  roles: [{ code: 'software_engineer', name: 'Software Engineer' }],
  levels: [{ code: 'L3', name: 'Level 3', rank: 30 }],
  countries: [{ code: 'IN', name: 'India', currencyCode: 'INR' }],
  // Story 4-2: the form options carry the currency FORMATS too, because a major-unit amount cannot
  // be converted with a code alone. No existing assertion reads this; it is here so the fake is a
  // complete `EmployeeFormOptions`.
  currencies: [{ code: 'INR', symbol: '₹', minorUnitExponent: 2, groupingStyle: 'INDIAN' }],
};

const BOOM = new Error('the database is not answering');

/** What the fake recorded, so a test can assert nothing was written as well as what was. */
type Recorded = {
  created: NewEmployee[];
  updated: { employeeId: string; update: EmployeeUpdate }[];
  listed: EmployeeListQuery[];
};

type FakeConfig = {
  readonly updateOutcome?: UpdateEmployeeOutcome;
  readonly detail?: EmployeeDetail | null;
  readonly page?: EmployeeListPage;
  readonly throwsOn?: keyof EmployeeRepository;
};

function fakeDeps(config: FakeConfig = {}): EmployeeUseCaseDeps & { recorded: Recorded } {
  const recorded: Recorded = { created: [], updated: [], listed: [] };

  /** Every fake method routes through here, so `throwsOn` can target any one of them. */
  async function guard<T>(method: keyof EmployeeRepository, value: T): Promise<T> {
    if (config.throwsOn === method) {
      throw BOOM;
    }
    return value;
  }

  const repository: EmployeeRepository = {
    loadReferenceData: async () => guard('loadReferenceData', REFERENCES),
    createEmployeesWithSalaries: async () => guard('createEmployeesWithSalaries', undefined),
    createEmployee: async (employee) => {
      await guard('createEmployee', undefined);
      recorded.created.push(employee);
    },
    updateEmployee: async (employeeId, update) => {
      await guard('updateEmployee', undefined);
      recorded.updated.push({ employeeId, update });
      return config.updateOutcome ?? { kind: 'updated' };
    },
    findEmployeeById: async () => guard('findEmployeeById', config.detail ?? null),
    listEmployees: async (query) => {
      await guard('listEmployees', undefined);
      recorded.listed.push(query);
      return (
        config.page ?? { employees: [DETAIL], totalCount: 1, limit: query.limit, offset: query.offset }
      );
    },
    loadFormOptions: async () => guard('loadFormOptions', FORM_OPTIONS),
    // CAP-3's sibling append (story 4-1). Present so this fake still satisfies the port; no CAP-2
    // use-case reaches it, and `tests/application/record-salary-change.test.ts` is where it is
    // actually exercised.
    appendSalaryRecord: async () => guard('appendSalaryRecord', { kind: 'appended' as const }),
    // CAP-4's salary read (story 5-1). Present so this fake still satisfies the widened port; no
    // CAP-2 use-case reaches it, and `tests/application/salary-timeline.test.ts` is where it is
    // actually exercised.
    findSalaryHistory: async () => guard('findSalaryHistory', null),
    // CAP-5's peer-population read (story 6-1). Present so this fake still satisfies the widened
    // port; no CAP-2 use-case reaches it, and `tests/application/peer-comparison.test.ts` is where
    // it is actually exercised.
    findPeerPopulation: async () => guard('findPeerPopulation', null),
    // CAP-6's whole-population read (story 7-1). Present so this fake still satisfies the widened
    // port; no CAP-2 use-case reaches it, and `tests/application/outliers.test.ts` is where it is
    // actually exercised.
    findAllPeerGroups: async () => guard('findAllPeerGroups', []),
    // CAP-7's gender-gap population read (story 8-1). Present so this fake still satisfies the
    // widened port; no CAP-2 use-case reaches it, and `tests/application/gender-gap.test.ts` is
    // where it is actually exercised.
    findGenderGapPopulation: async () => guard('findGenderGapPopulation', null),
    // CAP-8's org-wide gender-distribution read (story 9-1). Present so this fake still satisfies the
    // widened port; no CAP-2 use-case reaches it, and `tests/application/gender-distribution.test.ts`
    // is where it is actually exercised.
    findGenderDistributionPopulation: async () =>
      guard('findGenderDistributionPopulation', { levels: [], candidates: [] }),
    // CAP-9's org-wide payroll-totals read (story 10-1). Present so this fake still satisfies the
    // widened port; no CAP-2 use-case reaches it, and `tests/application/payroll-totals.test.ts` is
    // where it is actually exercised.
    findPayrollTotalsPopulation: async () =>
      guard('findPayrollTotalsPopulation', { candidates: [], countries: [], currencies: [] }),
    // CAP-10's org-wide overdue read (story 11-1). Present so this fake still satisfies the widened
    // port; no CAP-2 use-case reaches it, and `tests/application/overdue.test.ts` is where it is
    // actually exercised.
    findOverduePopulation: async () => guard('findOverduePopulation', { candidates: [] }),
  };

  // Deterministic ids — no randomness in the fast suite (AD-14 / Law 6).
  let counter = 0;
  const idGenerator: IdGenerator = {
    next: () => {
      counter += 1;
      return `id-${String(counter)}`;
    },
  };

  return { repository, idGenerator, recorded };
}

function validInput(overrides: Partial<EmployeeInput> = {}): EmployeeInput {
  return {
    name: 'Ada Lovelace',
    roleCode: 'software_engineer',
    levelCode: 'L3',
    countryCode: 'IN',
    gender: 'FEMALE',
    hireDate: '2021-06-01',
    ...overrides,
  };
}

function validUpdate(overrides: Partial<EmployeeUpdateInput> = {}): EmployeeUpdateInput {
  return {
    name: 'Ada Lovelace',
    roleCode: 'software_engineer',
    levelCode: 'L3',
    gender: 'FEMALE',
    hireDate: '2021-06-01',
    ...overrides,
  };
}

describe('createEmployee', () => {
  it('writes one employee, with an id from the port, and answers `created`', async () => {
    const deps = fakeDeps();

    const result = await createEmployee(deps, validInput());

    expect(result).toEqual({ kind: 'created', employeeId: 'id-1' });
    expect(deps.recorded.created).toEqual([
      {
        employeeId: 'id-1',
        name: 'Ada Lovelace',
        roleCode: 'software_engineer',
        levelCode: 'L3',
        countryCode: 'IN',
        gender: 'FEMALE',
        hireDate: { year: 2021, month: 6, day: 1 },
      },
    ]);
  });

  it('writes NO salary record — there is no salary in the payload at all (UX-DR13/AD-16)', async () => {
    const deps = fakeDeps();

    await createEmployee(deps, validInput());

    expect(deps.recorded.created[0]).not.toHaveProperty('salary');
    expect(deps.recorded.created[0]).not.toHaveProperty('effectiveFrom');
  });

  it('rejects an invalid input, naming every failing field, and writes nothing', async () => {
    const deps = fakeDeps();

    const result = await createEmployee(deps, validInput({ name: '', levelCode: 'L9' }));

    expect(result.kind).toBe('rejected');
    expect(result.kind === 'rejected' && result.reasons.map((r) => r.field)).toEqual([
      'name',
      'level',
    ]);
    expect(deps.recorded.created).toEqual([]);
  });

  it('burns no id on a rejected input — the generator is not reached', async () => {
    const deps = fakeDeps();

    await createEmployee(deps, validInput({ name: '' }));
    const result = await createEmployee(deps, validInput());

    expect(result).toEqual({ kind: 'created', employeeId: 'id-1' });
  });

  it('answers a rejection when the repository THROWS — never an unhandled write failure', async () => {
    const deps = fakeDeps({ throwsOn: 'createEmployee' });

    const result = await createEmployee(deps, validInput());

    expect(result).toEqual({
      kind: 'rejected',
      reasons: [
        {
          field: null,
          offendingValue: null,
          sentence: 'The employee could not be saved, so nothing was changed.',
        },
      ],
    });
  });

  it('answers a rejection when reference data cannot be loaded', async () => {
    const deps = fakeDeps({ throwsOn: 'loadReferenceData' });

    await expect(createEmployee(deps, validInput())).resolves.toEqual(
      expect.objectContaining({ kind: 'rejected' }),
    );
  });
});

describe('updateEmployee', () => {
  it('writes the granted columns and answers `updated`', async () => {
    const deps = fakeDeps();

    const result = await updateEmployee(deps, 'emp-1', validUpdate({ name: 'Ada King' }));

    expect(result).toEqual({ kind: 'updated', employeeId: 'emp-1' });
    expect(deps.recorded.updated).toEqual([
      {
        employeeId: 'emp-1',
        update: {
          name: 'Ada King',
          roleCode: 'software_engineer',
          levelCode: 'L3',
          gender: 'FEMALE',
          hireDate: { year: 2021, month: 6, day: 1 },
        },
      },
    ]);
  });

  it('never sends a countryCode — the field does not exist on the update (AD-6)', async () => {
    const deps = fakeDeps();

    await updateEmployee(deps, 'emp-1', validUpdate());

    expect(deps.recorded.updated[0]?.update).not.toHaveProperty('countryCode');
  });

  it('rejects an invalid update and writes nothing', async () => {
    const deps = fakeDeps();

    const result = await updateEmployee(deps, 'emp-1', validUpdate({ gender: 'f' }));

    expect(result.kind).toBe('rejected');
    expect(deps.recorded.updated).toEqual([]);
  });

  it('answers `not-found` for an id that matches no row — not an exception', async () => {
    const deps = fakeDeps({ updateOutcome: { kind: 'not-found' } });

    const result = await updateEmployee(deps, 'no-such-id', validUpdate());

    expect(result).toEqual({ kind: 'not-found', employeeId: 'no-such-id' });
  });

  it("turns the database's AP004 verdict into a hire_date field rejection", async () => {
    const deps = fakeDeps({ updateOutcome: { kind: 'hire-date-after-salary' } });

    const result = await updateEmployee(deps, 'emp-1', validUpdate({ hireDate: '2024-03-09' }));

    expect(result).toEqual({
      kind: 'rejected',
      reasons: [
        {
          field: 'hire_date',
          offendingValue: '2024-03-09',
          sentence:
            'The hire date 2024-03-09 is later than an existing salary record for this ' +
            'employee. A salary cannot take effect before the person was hired.',
        },
      ],
    });
  });

  it('answers a rejection when the repository throws', async () => {
    const deps = fakeDeps({ throwsOn: 'updateEmployee' });

    const result = await updateEmployee(deps, 'emp-1', validUpdate());

    expect(result).toEqual(expect.objectContaining({ kind: 'rejected' }));
  });

  it('answers a write failure for an outcome the switch does not know, never `undefined`', async () => {
    // The switch over `UpdateEmployeeOutcome` is total only by TYPESCRIPT's grace. At runtime the
    // adapter is ordinary JavaScript behind a port: a widened union, a stale build, or a second
    // implementation of the port can hand back a kind this module has never heard of, and without a
    // guard the switch falls through and the function resolves to `undefined` — in a module whose
    // header promises every function is total. `undefined` reaching story 3-2 is a blank screen
    // with no sentence on it.
    const deps = fakeDeps({
      updateOutcome: { kind: 'reference-data-changed' } as unknown as UpdateEmployeeOutcome,
    });

    const result = await updateEmployee(deps, 'emp-1', validUpdate());

    expect(result).toEqual(expect.objectContaining({ kind: 'rejected' }));
    expect(result).toBeDefined();
  });
});

describe('getEmployee — a read is total too', () => {
  it('answers `employee` with the detail when the id resolves', async () => {
    const deps = fakeDeps({ detail: DETAIL });

    await expect(getEmployee(deps, 'emp-1')).resolves.toEqual({
      kind: 'employee',
      employee: DETAIL,
    });
  });

  it('answers `not-found` for an unknown id', async () => {
    const deps = fakeDeps({ detail: null });

    await expect(getEmployee(deps, 'nope')).resolves.toEqual({ kind: 'not-found' });
  });

  it('answers `unavailable` when the repository throws — it does NOT propagate', async () => {
    const deps = fakeDeps({ throwsOn: 'findEmployeeById' });

    await expect(getEmployee(deps, 'emp-1')).resolves.toEqual({ kind: 'unavailable' });
  });
});

describe('listEmployees — a read is total too', () => {
  it('answers `page` carrying the rows, the total, and the EFFECTIVE limit/offset', async () => {
    // The limit/offset echoed back are the effective (clamped) values the adapter used, not what
    // was asked for — a pager that renders the requested value after a clamp lies.
    const deps = fakeDeps({
      page: { employees: [DETAIL], totalCount: 137, limit: 200, offset: 0 },
    });

    const result = await listEmployees(deps, { search: null, limit: 1_000_000, offset: -5 });

    expect(result).toEqual({
      kind: 'page',
      employees: [DETAIL],
      totalCount: 137,
      limit: 200,
      offset: 0,
    });
  });

  it('passes the search term through to the repository untouched', async () => {
    const deps = fakeDeps();

    await listEmployees(deps, { search: 'ana', limit: 25, offset: 50 });

    expect(deps.recorded.listed).toEqual([{ search: 'ana', limit: 25, offset: 50 }]);
  });

  it('answers `unavailable` when the repository throws — it does NOT propagate', async () => {
    const deps = fakeDeps({ throwsOn: 'listEmployees' });

    await expect(
      listEmployees(deps, { search: null, limit: 25, offset: 0 }),
    ).resolves.toEqual({ kind: 'unavailable' });
  });
});

describe('loadEmployeeFormOptions — a read is total too', () => {
  it('answers `options` with the pickable reference values', async () => {
    const deps = fakeDeps();

    await expect(loadEmployeeFormOptions(deps)).resolves.toEqual({
      kind: 'options',
      options: FORM_OPTIONS,
    });
  });

  it('answers `unavailable` when the repository throws — it does NOT propagate', async () => {
    const deps = fakeDeps({ throwsOn: 'loadFormOptions' });

    await expect(loadEmployeeFormOptions(deps)).resolves.toEqual({ kind: 'unavailable' });
  });
});

describe('no use-case in this module ever throws', () => {
  it('resolves every one of the five against a repository whose every method rejects', async () => {
    // The acceptance criterion, as one test: no test in the suite may observe a read use-case
    // throwing, and the writes were already total. A `Promise.all` of all five is the cheapest
    // possible statement of "none of these escapes".
    const outcomes = await Promise.all([
      createEmployee(fakeDeps({ throwsOn: 'loadReferenceData' }), validInput()),
      updateEmployee(fakeDeps({ throwsOn: 'loadReferenceData' }), 'emp-1', validUpdate()),
      getEmployee(fakeDeps({ throwsOn: 'findEmployeeById' }), 'emp-1'),
      listEmployees(fakeDeps({ throwsOn: 'listEmployees' }), {
        search: null,
        limit: 25,
        offset: 0,
      }),
      loadEmployeeFormOptions(fakeDeps({ throwsOn: 'loadFormOptions' })),
    ]);

    expect(outcomes.map((outcome) => outcome.kind)).toEqual([
      'rejected',
      'rejected',
      'unavailable',
      'unavailable',
      'unavailable',
    ]);
  });
});
