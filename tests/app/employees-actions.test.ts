import { describe, expect, it } from 'vitest';

import type {
  EmployeeRepository,
  NewEmployee,
  UpdateEmployeeOutcome,
} from '@/application/ports/employee-repository';
import type { IdGenerator } from '@/application/ports/id';
import {
  handleCreateEmployee,
  handleUpdateEmployee,
  type EmployeeWriteDeps,
} from '@/app/employees/handle-employee-write';

// Test-first (Law 1 / AD-23): red before `src/app/employees/handle-employee-write.ts` exists.
//
// The bodies of the CAP-2 Server Actions, tested WITHOUT Next, without a database, and without a
// clock — the same split story 2-1 made between `handle-import-request.ts` and `route.ts`.
//
// Two obligations dominate this file:
//
//   1. A `'use server'` export is a live RPC endpoint, and `EmployeeInput`'s `string` types are
//      ERASED at runtime. A caller can send `42`, `null`, or nothing at all, and the answer must be
//      a rejection naming the offending field — never a generic write failure, and never an
//      unhandled TypeError.
//   2. An adapter that throws must become a payload. The write funnel is documented to throw on an
//      invariant violation, so an unguarded call site is a designed-in 500.

const REFERENCES = {
  roleCodes: new Set(['software_engineer']),
  levelCodes: new Set(['L3']),
  countryCurrencies: new Map([['IN', 'INR']]),
};

const VALID_INPUT = {
  name: 'Ada Lovelace',
  roleCode: 'software_engineer',
  levelCode: 'L3',
  countryCode: 'IN',
  gender: 'FEMALE',
  hireDate: '2021-06-01',
};

const VALID_UPDATE = {
  name: 'Ada Lovelace',
  roleCode: 'software_engineer',
  levelCode: 'L3',
  gender: 'FEMALE',
  hireDate: '2021-06-01',
};

type FakeConfig = {
  readonly throws?: boolean;
  readonly updateOutcome?: UpdateEmployeeOutcome;
  /** `revalidatePath` throwing OUTSIDE a request scope — the row is already committed by then. */
  readonly revalidateThrows?: boolean;
};

function fakeDeps(
  config: FakeConfig = {},
): EmployeeWriteDeps & { readonly created: NewEmployee[]; readonly revalidations: string[] } {
  const created: NewEmployee[] = [];
  const revalidations: string[] = [];

  const boom = () => {
    throw new Error('the write funnel refused');
  };

  const repository: EmployeeRepository = {
    loadReferenceData: () => Promise.resolve(REFERENCES),
    createEmployeesWithSalaries: () => Promise.resolve(),
    createEmployee: (employee) => {
      if (config.throws) {
        boom();
      }
      created.push(employee);
      return Promise.resolve();
    },
    updateEmployee: () => {
      if (config.throws) {
        boom();
      }
      return Promise.resolve(config.updateOutcome ?? { kind: 'updated' });
    },
    findEmployeeById: () => Promise.resolve(null),
    listEmployees: () =>
      Promise.resolve({ employees: [], totalCount: 0, limit: 25, offset: 0 }),
    loadFormOptions: () => Promise.resolve({ roles: [], levels: [], countries: [], currencies: [] }),
    // CAP-3's sibling append (story 4-1). Present so this fake still satisfies the port; no CAP-2
    // handler reaches it, and `tests/app/handle-salary-change.test.ts` is where it is exercised.
    appendSalaryRecord: () => Promise.resolve({ kind: 'appended' as const }),
    // CAP-4's salary read (story 5-1). Present so this fake still satisfies the widened port; no
    // CAP-2 handler reaches it.
    findSalaryHistory: () => Promise.resolve(null),
    // CAP-5's peer-population read (story 6-1). Present so this fake still satisfies the widened
    // port; no CAP-2 handler reaches it.
    findPeerPopulation: () => Promise.resolve(null),
    // CAP-6's whole-population read (story 7-1). Present so this fake still satisfies the widened
    // port; no CAP-2 handler reaches it.
    findAllPeerGroups: () => Promise.resolve([]),
    // CAP-7's gender-gap population read (story 8-1). Present so this fake still satisfies the
    // widened port; no CAP-2 handler reaches it.
    findGenderGapPopulation: () => Promise.resolve(null),
    // CAP-8's org-wide gender-distribution read (story 9-1). Present so this fake still satisfies the
    // widened port; no CAP-2 handler reaches it.
    findGenderDistributionPopulation: () => Promise.resolve({ levels: [], candidates: [] }),
  };

  const idGenerator: IdGenerator = { next: () => 'id-1' };

  return {
    repository,
    idGenerator,
    // Injected rather than imported, so the cache invalidation is observable without Next.
    revalidate: (employeeId: string) => {
      if (config.revalidateThrows) {
        throw new Error('revalidatePath was called outside a request scope');
      }
      revalidations.push(employeeId);
    },
    created,
    revalidations,
  };
}

describe('handleCreateEmployee — the happy path', () => {
  it('creates the employee and answers the finalized payload', async () => {
    const deps = fakeDeps();

    const result = await handleCreateEmployee(deps, VALID_INPUT);

    expect(result).toEqual({ kind: 'created', employeeId: 'id-1' });
    expect(deps.created).toHaveLength(1);
  });

  it('revalidates after a successful write, naming the employee that was written', async () => {
    // The ID travels so the DETAIL route can be invalidated too, not just the directory — an edit
    // that refreshed only `/employees` would leave `/employees/{id}` serving the old name.
    const deps = fakeDeps();

    await handleCreateEmployee(deps, VALID_INPUT);

    expect(deps.revalidations).toEqual(['id-1']);
  });

  it('still answers CREATED when revalidation itself throws — the row is already committed', async () => {
    // `revalidatePath` throws outside a request scope, during static generation, and on a bad path.
    // By the time it runs the INSERT has committed, so reporting "the employee could not be saved,
    // so nothing was changed" would be a lie that makes the user resubmit and create a duplicate.
    const deps = fakeDeps({ revalidateThrows: true });

    const result = await handleCreateEmployee(deps, VALID_INPUT);

    expect(result).toEqual({ kind: 'created', employeeId: 'id-1' });
    expect(deps.created).toHaveLength(1);
  });

  it('does NOT revalidate when the input was rejected — nothing changed', async () => {
    const deps = fakeDeps();

    await handleCreateEmployee(deps, { ...VALID_INPUT, name: '' });

    expect(deps.revalidations).toEqual([]);
  });
});

describe('handleCreateEmployee — the boundary does not trust its own types', () => {
  it.each([
    ['name', 'name', 'name'],
    ['roleCode', 'role', 'role'],
    ['levelCode', 'level', 'level'],
    ['countryCode', 'country', 'country'],
    ['gender', 'gender', 'gender'],
    ['hireDate', 'hire_date', 'hire date'],
  ])('rejects a %s that arrived as a number, naming it', async (key, field, label) => {
    const deps = fakeDeps();

    const result = await handleCreateEmployee(deps, { ...VALID_INPUT, [key]: 42 });

    expect(result).toEqual({
      kind: 'rejected',
      reasons: [
        {
          field,
          offendingValue: null,
          // The human LABEL, not the internal column token: `hire_date` is a database column name
          // and has no business in a sentence a user reads.
          sentence: `The ${label} field was not submitted as text.`,
        },
      ],
    });
    expect(deps.created).toEqual([]);
  });

  it.each([[null], [undefined], [{}], [[]], [true]])(
    'rejects a non-string field of any shape (%s)',
    async (value) => {
      const deps = fakeDeps();

      const result = await handleCreateEmployee(deps, { ...VALID_INPUT, roleCode: value });

      expect(result).toEqual(
        expect.objectContaining({
          kind: 'rejected',
          reasons: [expect.objectContaining({ field: 'role' })],
        }),
      );
    },
  );

  it('names EVERY non-string field at once, as the form shows every problem together', async () => {
    const deps = fakeDeps();

    const result = await handleCreateEmployee(deps, {
      ...VALID_INPUT,
      name: 42,
      levelCode: null,
      hireDate: undefined,
    });

    expect(result.kind === 'rejected' && result.reasons.map((r) => r.field)).toEqual([
      'name',
      'level',
      'hire_date',
    ]);
  });

  it('rejects a payload that is not an object at all, rather than throwing', async () => {
    const deps = fakeDeps();

    for (const payload of [null, undefined, 'nope', 42]) {
      const result = await handleCreateEmployee(deps, payload);

      expect(result.kind).toBe('rejected');
      expect(result.kind === 'rejected' && result.reasons.length).toBeGreaterThan(0);
    }
    expect(deps.created).toEqual([]);
  });

  it('never revalidates on a coercion rejection', async () => {
    const deps = fakeDeps();

    await handleCreateEmployee(deps, { ...VALID_INPUT, gender: 7 });

    expect(deps.revalidations).toEqual([]);
  });
});

describe('handleCreateEmployee — the throwing-repository guard', () => {
  it('answers a rejection payload rather than propagating, and does not revalidate', async () => {
    const deps = fakeDeps({ throws: true });

    const result = await handleCreateEmployee(deps, VALID_INPUT);

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
    expect(deps.revalidations).toEqual([]);
  });
});

describe('handleUpdateEmployee', () => {
  it('updates and answers the finalized payload, then revalidates naming the employee', async () => {
    const deps = fakeDeps();

    const result = await handleUpdateEmployee(deps, 'emp-1', VALID_UPDATE);

    expect(result).toEqual({ kind: 'updated', employeeId: 'emp-1' });
    // The id, so the DETAIL route is invalidated as well as the directory. Without it
    // `/employees/emp-1` keeps serving the pre-edit name after a successful save.
    expect(deps.revalidations).toEqual(['emp-1']);
  });

  it('still answers UPDATED when revalidation itself throws — the row is already committed', async () => {
    const deps = fakeDeps({ revalidateThrows: true });

    const result = await handleUpdateEmployee(deps, 'emp-1', VALID_UPDATE);

    expect(result).toEqual({ kind: 'updated', employeeId: 'emp-1' });
  });

  it('does not revalidate when the row was not found — nothing changed', async () => {
    const deps = fakeDeps({ updateOutcome: { kind: 'not-found' } });

    const result = await handleUpdateEmployee(deps, 'emp-1', VALID_UPDATE);

    expect(result).toEqual({ kind: 'not-found', employeeId: 'emp-1' });
    expect(deps.revalidations).toEqual([]);
  });

  it.each([
    ['name', 'name'],
    ['roleCode', 'role'],
    ['levelCode', 'level'],
    ['gender', 'gender'],
    ['hireDate', 'hire_date'],
  ])('rejects a %s that did not arrive as text, naming it', async (key, field) => {
    const deps = fakeDeps();

    const result = await handleUpdateEmployee(deps, 'emp-1', { ...VALID_UPDATE, [key]: 42 });

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'rejected',
        reasons: [expect.objectContaining({ field })],
      }),
    );
  });

  it('IGNORES a countryCode a hostile caller smuggles in — it is not an update field (AD-6)', async () => {
    // The type omits it, so this cannot be written in TypeScript — but a `'use server'` endpoint
    // takes whatever the wire carries. The coercion reads only the five update keys, so the extra
    // one cannot reach the repository, and the request is not refused over it either.
    const deps = fakeDeps();

    const result = await handleUpdateEmployee(deps, 'emp-1', {
      ...VALID_UPDATE,
      countryCode: 'JP',
    });

    expect(result).toEqual({ kind: 'updated', employeeId: 'emp-1' });
  });

  it('rejects a non-object payload rather than throwing', async () => {
    const deps = fakeDeps();

    const result = await handleUpdateEmployee(deps, 'emp-1', null);

    expect(result.kind).toBe('rejected');
  });

  it.each([[42], [null], [undefined], [{}], [true]])(
    'answers NOT-FOUND for an employeeId that did not arrive as text (%s)',
    async (badId) => {
      // The same wire and the same cause as `'not-a-uuid'`, which the adapter answers `not-found`
      // — so it gets the same answer. Reporting "the employee could not be saved" would describe a
      // save failure that never happened: no write was ever attempted, because no id identified a
      // row to write to. There is no id to echo back, so the field is empty rather than invented.
      const deps = fakeDeps();

      const result = await handleUpdateEmployee(deps, badId, VALID_UPDATE);

      expect(result).toEqual({ kind: 'not-found', employeeId: '' });
      expect(deps.revalidations).toEqual([]);
    },
  );

  it('answers a rejection payload when the repository throws', async () => {
    const deps = fakeDeps({ throws: true });

    const result = await handleUpdateEmployee(deps, 'emp-1', VALID_UPDATE);

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'rejected',
        reasons: [expect.objectContaining({ field: null })],
      }),
    );
    expect(deps.revalidations).toEqual([]);
  });
});
