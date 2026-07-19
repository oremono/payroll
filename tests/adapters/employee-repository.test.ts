import { describe, expect, it, vi } from 'vitest';

import {
  clampListLimit,
  createEmployeeRepository,
  clampListOffset,
  DEFAULT_LIST_LIMIT,
  escapeLikePattern,
  fromDbDate,
  hasErrorCode,
  isUuid,
  MAX_LIST_LIMIT,
  MAX_LIST_OFFSET,
  MIN_LIST_LIMIT,
  normalizeSearchTerm,
  toCurrencyFormats,
  MAX_SEARCH_LENGTH,
} from '@/adapters/db/employee-repository';

// The pure helpers of the employee repository, unit-tested (story 3-1).
//
// These are the subtlest functions in the story and integration cannot economically reach them: to
// exercise the `hasErrorCode` walk against a real driver you would have to provoke each wrapping
// shape from Postgres, and to exercise `fromDbDate`'s timezone discipline you would have to run the
// suite in a second timezone. The coverage and mutation gates do NOT reach `src/adapters/**`, so
// this file is the only thing standing between a bug here and a silent defect:
//
//   - `hasErrorCode` misreading a wrap depth turns a rejection the user must SEE into a 500.
//   - Misreading a NON-AP004 SQLSTATE as the hire-date verdict is worse: it would tell a user their
//     hire date is invalid when the real fault was a deadlock, and swallow the real error.
//   - `fromDbDate` reading local getters instead of UTC ones shifts every date by a day for every
//     reader west of Greenwich — and would pass on a UTC CI box, which is why the test below sets
//     TZ explicitly rather than trusting the ambient one.
//   - An unclamped `limit` is a denial of service on a 10,000-row table.
//   - An unescaped LIKE metacharacter makes a search for `%` match every employee.

describe('hasErrorCode — the walk over cause and meta', () => {
  it('finds a code on the error itself', () => {
    expect(hasErrorCode({ code: 'AP004' }, 'AP004')).toBe(true);
  });

  it('finds a code the driver hung off `cause`', () => {
    // The realistic shape: Prisma's own error is outermost and the pg error carrying the SQLSTATE
    // hangs off `cause`. Reading only the top-level `code` would see Prisma's P2010 and conclude
    // the trigger never fired.
    expect(hasErrorCode({ code: 'P2010', cause: { code: 'AP004' } }, 'AP004')).toBe(true);
  });

  it('finds a code the driver hung off `meta`', () => {
    expect(hasErrorCode({ code: 'P2010', meta: { code: 'AP004' } }, 'AP004')).toBe(true);
  });

  it('finds a code nested several wrappers deep', () => {
    const nested = { cause: { cause: { meta: { code: 'AP004' } } } };

    expect(hasErrorCode(nested, 'AP004')).toBe(true);
  });

  it('answers false for a DIFFERENT code — a non-AP004 SQLSTATE is not the hire-date verdict', () => {
    // The single most dangerous mistake this helper could make. `40P01` is a deadlock: reporting it
    // as `hire-date-after-salary` would blame the user's hire date for a database problem.
    expect(hasErrorCode({ code: '40P01' }, 'AP004')).toBe(false);
    expect(hasErrorCode({ code: 'P2010', cause: { code: '23505' } }, 'AP004')).toBe(false);
  });

  it('stops at a bounded depth rather than walking forever', () => {
    // Deeper than the bound, so a code that IS present past it is deliberately not found. This
    // pins the bound as a real limit rather than an unenforced comment.
    const deep = { cause: { cause: { cause: { cause: { cause: { cause: { code: 'AP004' } } } } } } };

    expect(hasErrorCode(deep, 'AP004')).toBe(false);
  });

  it('terminates on a self-referential cause instead of spinning', () => {
    const cyclic: { code: string; cause?: unknown } = { code: 'P2010' };
    cyclic.cause = cyclic;

    expect(hasErrorCode(cyclic, 'AP004')).toBe(false);
  });

  it('is total for values that are not errors at all', () => {
    expect(hasErrorCode(null, 'AP004')).toBe(false);
    expect(hasErrorCode(undefined, 'AP004')).toBe(false);
    expect(hasErrorCode('AP004', 'AP004')).toBe(false);
    expect(hasErrorCode(42, 'AP004')).toBe(false);
  });

  it('matches the code exactly, never as a prefix or substring', () => {
    expect(hasErrorCode({ code: 'AP0041' }, 'AP004')).toBe(false);
    expect(hasErrorCode({ code: 'XAP004' }, 'AP004')).toBe(false);
  });
});

describe('the list query clamp', () => {
  it('holds an ordinary limit unchanged', () => {
    expect(clampListLimit(25)).toBe(25);
  });

  it('clamps a hostile limit down to the ceiling', () => {
    // An unbounded `take` is a denial of service on a 10,000-row table.
    expect(clampListLimit(1_000_000)).toBe(MAX_LIST_LIMIT);
    expect(clampListLimit(201)).toBe(MAX_LIST_LIMIT);
  });

  it('clamps a zero or negative limit up to the floor', () => {
    expect(clampListLimit(0)).toBe(MIN_LIST_LIMIT);
    expect(clampListLimit(-10)).toBe(MIN_LIST_LIMIT);
  });

  it('holds the boundaries themselves', () => {
    expect(clampListLimit(MIN_LIST_LIMIT)).toBe(MIN_LIST_LIMIT);
    expect(clampListLimit(MAX_LIST_LIMIT)).toBe(MAX_LIST_LIMIT);
  });

  it('truncates a fractional limit to an integer', () => {
    // Prisma's `take` must be an integer; a float is a raw driver throw.
    expect(clampListLimit(25.9)).toBe(25);
  });

  it('answers the DEFAULT for a limit that is not a number at all, never the ceiling', () => {
    // `?limit=abc` parses to NaN. Answering MAX_LIST_LIMIT would hand the single most expensive
    // page the system serves to the one caller who asked for nothing coherent — the clamp exists
    // to bound cost, and its non-numeric branch must not be the cheapest way to reach the ceiling.
    expect(clampListLimit(Number.NaN)).toBe(DEFAULT_LIST_LIMIT);
    expect(clampListLimit(Number.POSITIVE_INFINITY)).toBe(DEFAULT_LIST_LIMIT);
    expect(clampListLimit(Number.NEGATIVE_INFINITY)).toBe(DEFAULT_LIST_LIMIT);
  });

  it('has a default that is itself inside the bounds', () => {
    expect(DEFAULT_LIST_LIMIT).toBeGreaterThanOrEqual(MIN_LIST_LIMIT);
    expect(DEFAULT_LIST_LIMIT).toBeLessThanOrEqual(MAX_LIST_LIMIT);
    expect(DEFAULT_LIST_LIMIT).toBeLessThan(MAX_LIST_LIMIT);
  });

  it('holds an ordinary offset unchanged and floors a negative one at zero', () => {
    // A negative `skip` is a raw Prisma throw, not an empty page.
    expect(clampListOffset(50)).toBe(50);
    expect(clampListOffset(0)).toBe(0);
    expect(clampListOffset(-5)).toBe(0);
  });

  it('truncates a fractional offset and zeroes a non-numeric one', () => {
    expect(clampListOffset(50.9)).toBe(50);
    expect(clampListOffset(Number.NaN)).toBe(0);
    expect(clampListOffset(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('clamps a hostile OFFSET down to a ceiling too', () => {
    // The same denial-of-service class the limit clamp closes: an unbounded `skip` makes the
    // database walk and discard every row before it, so `?offset=999999999` is an expensive scan
    // that returns nothing. A page that far past a 10,000-row table is empty either way.
    expect(clampListOffset(999_999_999)).toBe(MAX_LIST_OFFSET);
    expect(clampListOffset(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampListOffset(MAX_LIST_OFFSET)).toBe(MAX_LIST_OFFSET);
    expect(clampListOffset(MAX_LIST_OFFSET - 1)).toBe(MAX_LIST_OFFSET - 1);
  });
});

describe('escapeLikePattern', () => {
  it('leaves ordinary text alone', () => {
    expect(escapeLikePattern('ana')).toBe('ana');
  });

  it('escapes the percent wildcard, which would otherwise match every employee', () => {
    expect(escapeLikePattern('%')).toBe(String.raw`\%`);
  });

  it('escapes the underscore wildcard, which would otherwise match any character', () => {
    expect(escapeLikePattern('_')).toBe(String.raw`\_`);
  });

  it('escapes the escape character ITSELF, and does so first', () => {
    // If the backslash were escaped last, `\%` would become `\\%` -> a literal backslash followed
    // by a live wildcard, which is the bug the escape exists to prevent.
    expect(escapeLikePattern('\\')).toBe('\\\\');
    expect(escapeLikePattern('\\%')).toBe(String.raw`\\\%`);
  });

  it('escapes every occurrence, not merely the first', () => {
    expect(escapeLikePattern('a%b%c')).toBe(String.raw`a\%b\%c`);
  });

  it('escapes metacharacters embedded in a real name', () => {
    expect(escapeLikePattern('100%_pure')).toBe(String.raw`100\%\_pure`);
  });
});

describe('normalizeSearchTerm — a blank search is no search at all', () => {
  it('passes an ordinary term through', () => {
    expect(normalizeSearchTerm('ana')).toBe('ana');
  });

  it('answers null for a null search — there was no search box value at all', () => {
    expect(normalizeSearchTerm(null)).toBeNull();
  });

  it('answers null for an EMPTY term, which is what an empty search box sends', () => {
    // Story 3-2's search input sends `''` when the reader clears it. `contains: ''` matches every
    // row, so it happens to behave like no filter — but only by accident of LIKE semantics, and
    // the port documents `null` and `''` as different things. Resolving it here means the two
    // genuinely take the same path rather than coinciding.
    expect(normalizeSearchTerm('')).toBeNull();
  });

  it('answers null for a whitespace-only term', () => {
    // `contains: '   '` is a real filter that matches almost nothing — a reader who fat-fingered
    // the space bar would be shown an empty directory and no explanation.
    expect(normalizeSearchTerm('   ')).toBeNull();
    expect(normalizeSearchTerm('\t\n ')).toBeNull();
  });

  it('trims a term that carries surrounding whitespace rather than searching for it', () => {
    expect(normalizeSearchTerm('  ana  ')).toBe('ana');
  });

  it('answers no-filter for anything that is not a string at all', () => {
    // The port names `search` hostile input beside `limit` and `offset`, and this was the one of
    // the three with no guard. `string | null` is erased at runtime: the caller is a Server
    // Component reading `searchParams`, where an absent parameter is `undefined` and a REPEATED one
    // (`?q=a&q=b`) is an array. Either reaches `.trim()` as a `TypeError`, which the read use-case
    // catches and reports as `{ kind: 'unavailable' }` — an outage screen for a duplicated query
    // parameter.
    const hostile: unknown[] = [undefined, ['ana', 'bob'], 42, {}, true];
    for (const value of hostile) {
      expect(normalizeSearchTerm(value as string | null)).toBeNull();
    }
  });

  it('truncates an oversized term rather than sending it to the database', () => {
    // `contains` compiles to an unindexable `ILIKE '%…%'` run TWICE per page inside a REPEATABLE
    // READ transaction holding a pooled connection — the same denial-of-service class the limit
    // clamp closes, on the one field that is free text.
    const term = normalizeSearchTerm('a'.repeat(10_000));

    expect(term).toHaveLength(MAX_SEARCH_LENGTH);
  });

  it('leaves a term at exactly the limit intact', () => {
    const exact = 'a'.repeat(MAX_SEARCH_LENGTH);

    expect(normalizeSearchTerm(exact)).toBe(exact);
  });
});

describe('isUuid', () => {
  it('accepts a canonical UUID in either case', () => {
    expect(isUuid('0192f3a4-5b6c-7d8e-9f01-23456789abcd')).toBe(true);
    expect(isUuid('0192F3A4-5B6C-7D8E-9F01-23456789ABCD')).toBe(true);
  });

  it('rejects an id that is not a UUID — a URL segment a user can hand-edit', () => {
    // `employee.id` is `@db.Uuid`, so Prisma raises a CAST error before any row is examined. That
    // is ordinary input, not an invariant breach, and must answer not-found rather than throwing.
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid('0192f3a4-5b6c-7d8e-9f01-23456789abc')).toBe(false);
    expect(isUuid('0192f3a4-5b6c-7d8e-9f01-23456789abcde')).toBe(false);
    expect(isUuid('0192f3a45b6c7d8e9f0123456789abcd')).toBe(false);
    expect(isUuid('0192f3a4-5b6c-7d8e-9f01-23456789abcg')).toBe(false);
  });

  it('is anchored at both ends — no leading or trailing junk', () => {
    expect(isUuid(' 0192f3a4-5b6c-7d8e-9f01-23456789abcd')).toBe(false);
    expect(isUuid('0192f3a4-5b6c-7d8e-9f01-23456789abcd ')).toBe(false);
    expect(isUuid('x0192f3a4-5b6c-7d8e-9f01-23456789abcd')).toBe(false);
  });
});

describe('updateEmployee — the CATCH BLOCK itself, not merely the predicate under it', () => {
  // `hasErrorCode` is tested above in isolation and the AP004 path is covered by integration, which
  // leaves the WIRING between them untested: which codes are converted to an outcome, which are
  // rethrown, and whether the rethrow is the original error. The spec makes that an explicit
  // acceptance criterion — "given an error carrying a SQLSTATE that is not AP004, when
  // updateEmployee encounters it, then it throws rather than reporting hire-date-after-salary" —
  // and a predicate test cannot discharge it: the predicate could be perfect and the `if` inverted.
  //
  // A stub client rather than a real one: provoking a deadlock or a unique violation on demand
  // against a live database is far more machinery than the wiring is worth.
  type StubClient = Parameters<typeof createEmployeeRepository>[0];

  const EMPLOYEE_ID = '0192f3a4-5b6c-7d8e-9f01-23456789abcd';
  const UPDATE = {
    name: 'Ada Lovelace',
    roleCode: 'software_engineer',
    levelCode: 'L3',
    gender: 'FEMALE' as const,
    hireDate: { year: 2021, month: 6, day: 1 },
  };

  /** A client whose employee UPDATE rejects with `error`, and whose reference rows are active. */
  function clientRejectingWith(error: unknown): { client: StubClient; updates: number } {
    const counters = { updates: 0 };
    const delegates = {
      role: { findFirst: () => Promise.resolve({ code: UPDATE.roleCode }) },
      level: { findFirst: () => Promise.resolve({ code: UPDATE.levelCode }) },
      employee: {
        update: () => {
          counters.updates += 1;
          return Promise.reject(error);
        },
      },
    };
    const client = {
      ...delegates,
      $transaction: (body: (tx: typeof delegates) => Promise<unknown>) => body(delegates),
    } as unknown as StubClient;
    return {
      client,
      get updates() {
        return counters.updates;
      },
    };
  }

  it('converts SQLSTATE AP004 — and ONLY that — into the hire-date outcome', async () => {
    const { client } = clientRejectingWith({ code: 'P2010', cause: { code: 'AP004' } });

    await expect(
      createEmployeeRepository(client).updateEmployee(EMPLOYEE_ID, UPDATE),
    ).resolves.toEqual({ kind: 'hire-date-after-salary' });
  });

  it('THROWS on a SQLSTATE that is not AP004, rather than blaming the hire date', async () => {
    // `40P01` is a deadlock. Reporting it as `hire-date-after-salary` would tell the user their
    // hire date is invalid when the real fault was a transient database problem, and would swallow
    // the real error on the way — the single most dangerous mistake this catch block could make.
    const deadlock = { code: 'P2010', cause: { code: '40P01' } };
    const { client } = clientRejectingWith(deadlock);

    await expect(
      createEmployeeRepository(client).updateEmployee(EMPLOYEE_ID, UPDATE),
    ).rejects.toBe(deadlock);
  });

  it('rethrows the ORIGINAL error, unwrapped and unreplaced', async () => {
    const original = new Error('connection terminated unexpectedly');
    const { client } = clientRejectingWith(original);

    await expect(
      createEmployeeRepository(client).updateEmployee(EMPLOYEE_ID, UPDATE),
    ).rejects.toBe(original);
  });

  it('answers not-found for Prisma P2025 — a stale id is ordinary input', async () => {
    const { client } = clientRejectingWith({ code: 'P2025' });

    await expect(
      createEmployeeRepository(client).updateEmployee(EMPLOYEE_ID, UPDATE),
    ).resolves.toEqual({ kind: 'not-found' });
  });

  it('answers not-found for a non-UUID id without going near the client', async () => {
    const probe = clientRejectingWith(new Error('the client must not be reached'));

    await expect(
      createEmployeeRepository(probe.client).updateEmployee('not-a-uuid', UPDATE),
    ).resolves.toEqual({ kind: 'not-found' });
    expect(probe.updates).toBe(0);
  });
});

describe('updateEmployee re-resolves is_active inside its transaction', () => {
  type StubClient = Parameters<typeof createEmployeeRepository>[0];

  const EMPLOYEE_ID = '0192f3a4-5b6c-7d8e-9f01-23456789abcd';
  const UPDATE = {
    name: 'Ada Lovelace',
    roleCode: 'software_engineer',
    levelCode: 'L3',
    gender: 'FEMALE' as const,
    hireDate: { year: 2021, month: 6, day: 1 },
  };

  /** A client on which the named reference kinds resolve as INACTIVE (findFirst answers null). */
  function clientWithInactive(inactive: readonly ('role' | 'level')[]) {
    const counters = { updates: 0 };
    const answer = (kind: 'role' | 'level') => ({
      findFirst: () => Promise.resolve(inactive.includes(kind) ? null : { code: 'x' }),
    });
    const delegates = {
      role: answer('role'),
      level: answer('level'),
      employee: {
        update: () => {
          counters.updates += 1;
          return Promise.resolve({});
        },
      },
    };
    const client = {
      ...delegates,
      $transaction: (body: (tx: typeof delegates) => Promise<unknown>) => body(delegates),
    } as unknown as StubClient;
    return {
      client,
      get updates() {
        return counters.updates;
      },
    };
  }

  it.each([[['role'] as const], [['level'] as const], [['role', 'level'] as const]])(
    'refuses the write when %s was deactivated between judgement and write',
    async (inactive) => {
      // The same window `createEmployee` closes, on the path that had it open: reference data is
      // read OUTSIDE the transaction, and the FKs target `code` — they check EXISTENCE, not
      // ACTIVITY, so nothing in the schema would notice an edit assigning a retired role. A funnel
      // whose create half closes this and whose edit half does not disagrees with itself.
      const probe = clientWithInactive(inactive);

      await expect(
        createEmployeeRepository(probe.client).updateEmployee(EMPLOYEE_ID, UPDATE),
      ).rejects.toThrow(/active/i);
      expect(probe.updates).toBe(0);
    },
  );

  it('writes when both are still active', async () => {
    const probe = clientWithInactive([]);

    await expect(
      createEmployeeRepository(probe.client).updateEmployee(EMPLOYEE_ID, UPDATE),
    ).resolves.toEqual({ kind: 'updated' });
    expect(probe.updates).toBe(1);
  });

  it('does not report the refusal as the hire-date verdict', async () => {
    // The refusal carries no SQLSTATE, so it must fall through the AP004 arm and throw. Were it
    // mapped, a deactivated role would tell the user their HIRE DATE was the problem.
    const probe = clientWithInactive(['role']);

    const outcome = await createEmployeeRepository(probe.client)
      .updateEmployee(EMPLOYEE_ID, UPDATE)
      .then(
        (value) => value,
        () => ({ kind: 'threw' as const }),
      );

    expect(outcome).toEqual({ kind: 'threw' });
  });
});

describe('the write paths re-resolve and write INSIDE one transaction', () => {
  // `listEmployees` got a probe that pins the transaction FORM, and the two write paths — where a
  // transaction is what makes the re-resolution and the write atomic at all — got none. Every other
  // stub in this file is `$transaction: (body) => body(delegates)`, which runs the body inline and
  // asserts nothing: delete `client.$transaction(...)` from either write method, call the delegates
  // directly, and all nine tests above still pass. So does the integration pair, which only
  // exercises the re-read that happens before the write on the same code path.
  //
  // These record that a transaction was OPENED and that the write landed inside it, which is the
  // claim the long comments in the adapter rest on.
  type StubClient = Parameters<typeof createEmployeeRepository>[0];

  const EMPLOYEE_ID = '0192f3a4-5b6c-7d8e-9f01-23456789abcd';

  /** Records whether the write happened while a transaction was open, and on which form. */
  function writeProbe() {
    const state = { depth: 0, forms: [] as ('array' | 'interactive')[], writesInside: 0 };
    const reference = { findFirst: () => Promise.resolve({ code: 'x' }) };
    const write = () => {
      if (state.depth > 0) {
        state.writesInside += 1;
      }
      return Promise.resolve({});
    };
    const delegates = {
      role: reference,
      level: reference,
      country: reference,
      employee: { create: write, update: write },
    };
    const client = {
      ...delegates,
      $transaction: async (body: unknown) => {
        if (typeof body !== 'function') {
          state.forms.push('array');
          return Promise.all(body as Promise<unknown>[]);
        }
        state.forms.push('interactive');
        state.depth += 1;
        try {
          return await (body as (tx: typeof delegates) => Promise<unknown>)(delegates);
        } finally {
          state.depth -= 1;
        }
      },
    } as unknown as StubClient;
    return { client, state };
  }

  it('createEmployee opens an interactive transaction and creates inside it', async () => {
    const probe = writeProbe();

    await createEmployeeRepository(probe.client).createEmployee({
      employeeId: EMPLOYEE_ID,
      name: 'Ada Lovelace',
      roleCode: 'software_engineer',
      levelCode: 'L3',
      countryCode: 'IN',
      gender: 'FEMALE',
      hireDate: { year: 2021, month: 6, day: 1 },
    });

    expect(probe.state.forms).toEqual(['interactive']);
    expect(probe.state.writesInside).toBe(1);
  });

  it('updateEmployee opens an interactive transaction and updates inside it', async () => {
    const probe = writeProbe();

    await expect(
      createEmployeeRepository(probe.client).updateEmployee(EMPLOYEE_ID, {
        name: 'Ada Lovelace',
        roleCode: 'software_engineer',
        levelCode: 'L3',
        gender: 'FEMALE',
        hireDate: { year: 2021, month: 6, day: 1 },
      }),
    ).resolves.toEqual({ kind: 'updated' });

    expect(probe.state.forms).toEqual(['interactive']);
    expect(probe.state.writesInside).toBe(1);
  });
});

describe('listEmployees reads the page and its total under ONE snapshot', () => {
  type StubClient = Parameters<typeof createEmployeeRepository>[0];

  /** Records HOW `$transaction` was called, which is the whole point — see the tests below. */
  function transactionProbe() {
    const calls: { form: 'array' | 'interactive'; options: unknown }[] = [];
    const delegates = {
      employee: {
        findMany: () => Promise.resolve([]),
        count: () => Promise.resolve(0),
      },
    };
    const client = {
      ...delegates,
      $transaction: (body: unknown, options?: unknown) => {
        if (typeof body === 'function') {
          calls.push({ form: 'interactive', options });
          return (body as (tx: typeof delegates) => Promise<unknown>)(delegates);
        }
        calls.push({ form: 'array', options });
        return Promise.all(body as Promise<unknown>[]);
      },
    } as unknown as StubClient;
    return { client, calls };
  }

  it('asks for REPEATABLE READ, on the transaction form that actually applies it', async () => {
    // Wrapping `findMany` and `count` in a transaction does NOT by itself make them agree:
    // PostgreSQL's default READ COMMITTED takes a fresh snapshot PER STATEMENT, so the page and
    // the total can still straddle a concurrent write and the pager can still say "1-25 of 24".
    // Only REPEATABLE READ pins one snapshot across both.
    //
    // And the FORM matters as much as the option. Verified against the real database
    // (tests/integration/employees.test.ts pins it): Prisma's ARRAY form silently DISCARDS
    // `isolationLevel` — the transaction runs at read committed and nothing complains — while the
    // interactive form applies it. A test that only asserted the option was passed would certify a
    // guarantee the database is not giving.
    const probe = transactionProbe();

    await createEmployeeRepository(probe.client).listEmployees({
      search: null,
      limit: 10,
      offset: 0,
    });

    expect(probe.calls).toEqual([
      { form: 'interactive', options: { isolationLevel: 'RepeatableRead' } },
    ]);
  });

  it('reads BOTH the rows and the count inside that one transaction', async () => {
    const probe = transactionProbe();

    const page = await createEmployeeRepository(probe.client).listEmployees({
      search: null,
      limit: 10,
      offset: 0,
    });

    expect(probe.calls).toHaveLength(1);
    expect(page).toEqual({ employees: [], totalCount: 0, limit: 10, offset: 0 });
  });
});

describe('fromDbDate — the calendar day, read back without a timezone shift', () => {
  const ORIGINAL_TZ = process.env.TZ;

  /** The instant every sentinel below is measured at: midnight UTC, as a `@db.Date` comes back. */
  const REFERENCE_INSTANT = '2021-06-01T00:00:00.000Z';

  /**
   * Run `body` with the process pinned to `tz`, then restore.
   *
   * `expectedOffsetMinutes` is a SENTINEL, and it is the reason this helper is not merely a
   * `process.env.TZ` assignment. Mutating `TZ` mid-run only works if the runtime honours a LATE
   * change — cached ICU data, a worker pool, or a platform that reads `TZ` once at startup would
   * all leave the process in UTC while the assignment appears to succeed. Every assertion inside
   * would then run under UTC and PASS while protecting nothing, and the regression this whole
   * describe block exists to catch (`getUTC*` -> local) is invisible on a UTC CI box by definition.
   * So the shift is proved before the body runs: if the requested zone is not actually in effect,
   * the test FAILS instead of silently certifying nothing.
   */
  function withTimeZone(tz: string, expectedOffsetMinutes: number, body: () => void): void {
    // A zone at UTC could not prove anything even if it did take effect.
    expect(expectedOffsetMinutes).not.toBe(0);

    process.env.TZ = tz;
    try {
      expect(new Date(REFERENCE_INSTANT).getTimezoneOffset()).toBe(expectedOffsetMinutes);
      body();
    } finally {
      // Assigning `undefined` to a `process.env` key sets the literal string "undefined", which is
      // not a timezone at all — the key has to be deleted when there was none to begin with.
      if (ORIGINAL_TZ === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = ORIGINAL_TZ;
      }
    }
  }

  it('reads the stored calendar day in UTC', () => {
    expect(fromDbDate(new Date(REFERENCE_INSTANT))).toEqual({
      year: 2021,
      month: 6,
      day: 1,
    });
  });

  it('reads the SAME day west of Greenwich, where a local getter reports the day before', () => {
    // A `@db.Date` column comes back pinned to midnight UTC. In UTC-4, `getDate()` on that value is
    // the PREVIOUS day — so a `getUTC*` -> local regression shifts every hire date in the product
    // by one day for every such reader. This test is the only thing that catches it.
    withTimeZone('America/New_York', 240, () => {
      const value = new Date(REFERENCE_INSTANT);
      // The second sentinel, and the sharper one: the local getters really do disagree here. If
      // this ever reads 1, the zone did not take hold and the assertion below proves nothing.
      expect(value.getDate()).toBe(31);
      expect(value.getMonth()).toBe(4);

      expect(fromDbDate(value)).toEqual({ year: 2021, month: 6, day: 1 });
    });
  });

  it('reads the same day under UTC-12, the furthest a calendar day can slip', () => {
    // `Etc/GMT+12` is UTC-12 (the sign convention is inverted in POSIX zone names). A fixed-offset
    // zone with no DST, so the sentinel below is a constant rather than a date-dependent one.
    withTimeZone('Etc/GMT+12', 720, () => {
      const value = new Date(REFERENCE_INSTANT);
      expect(value.getDate()).not.toBe(1);

      expect(fromDbDate(value)).toEqual({ year: 2021, month: 6, day: 1 });
    });
  });

  it('reads the same day east of Greenwich too', () => {
    // A negative offset: `getTimezoneOffset()` is minutes WEST of UTC, so UTC+5:30 answers -330.
    withTimeZone('Asia/Kolkata', -330, () => {
      expect(fromDbDate(new Date(REFERENCE_INSTANT))).toEqual({
        year: 2021,
        month: 6,
        day: 1,
      });
    });
  });

  it('holds across a year boundary, the worst case for an off-by-one-day shift', () => {
    withTimeZone('America/New_York', 240, () => {
      const value = new Date('2022-01-01T00:00:00.000Z');
      // Standard time in January, hence 300 rather than the helper's June 240 — and the local
      // getters land in the PREVIOUS YEAR, which is what makes this the worst case.
      expect(value.getTimezoneOffset()).toBe(300);
      expect(value.getFullYear()).toBe(2021);

      expect(fromDbDate(value)).toEqual({ year: 2022, month: 1, day: 1 });
    });
  });

  it('returns a 1-based month, matching PlainDate rather than the JS getter', () => {
    expect(fromDbDate(new Date('2021-01-15T00:00:00.000Z')).month).toBe(1);
    expect(fromDbDate(new Date('2021-12-15T00:00:00.000Z')).month).toBe(12);
  });
});

// ── the currency reference rows the form options carry (story 4-2) ─────────────────────────────
//
// Test-first (Law 1 / AD-23): red before `toCurrencyFormats` exists.
//
// `EmployeeFormOptions` grows a `currencies` list this story, because a form that takes an amount in
// MAJOR units cannot convert it without the currency's own minor-unit exponent, and nothing crossed
// the port with that number before.
//
// The subtlety is `groupingStyle`. Prisma generates its OWN enum type for the column; `GroupingStyle`
// in `src/domain/money.ts` is a separate union that the domain owns and that the formatter switches
// on. The two happen to have the same members today. Casting one to the other would compile forever
// and would let a value that is neither `WESTERN` nor `INDIAN` — a member added to the database enum
// by a later migration, a row read through a raw query — reach the formatter as a `GroupingStyle`
// that is not one. So the boundary VALIDATES, and a row it cannot read is dropped rather than
// mistranslated: the currency then resolves to nothing, and the form withholds itself instead of
// rendering an amount grouped by a rule nobody wrote.
describe('toCurrencyFormats — validating the grouping style rather than casting it', () => {
  it('maps a row with every field the formatter needs', () => {
    expect(
      toCurrencyFormats([
        { code: 'INR', symbol: '₹', minorUnitExponent: 2, groupingStyle: 'INDIAN' },
      ]),
    ).toEqual([{ code: 'INR', symbol: '₹', minorUnitExponent: 2, groupingStyle: 'INDIAN' }]);
  });

  it('keeps a zero-exponent currency — the exponent is data, never a hard-coded 100', () => {
    expect(
      toCurrencyFormats([
        { code: 'JPY', symbol: '¥', minorUnitExponent: 0, groupingStyle: 'WESTERN' },
      ]),
    ).toEqual([{ code: 'JPY', symbol: '¥', minorUnitExponent: 0, groupingStyle: 'WESTERN' }]);
  });

  it('drops a row whose grouping style is not one the domain formatter knows', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      toCurrencyFormats([
        { code: 'INR', symbol: '₹', minorUnitExponent: 2, groupingStyle: 'INDIAN' },
        { code: 'XX', symbol: '¤', minorUnitExponent: 2, groupingStyle: 'ARABIC' },
      ]).map((format) => format.code),
    ).toEqual(['INR']);

    // Dropping is right for the reader; SILENTLY dropping is not. The consequence — an employee who
    // cannot record a salary change, told their currency could not be determined — is otherwise
    // undiagnosable, so the offending row is identified. Same precedent as the swallowed
    // `revalidatePath` failure in `handle-employee-write.ts`.
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0]?.[1]).toMatchObject({
      dropped: [{ code: 'XX', groupingStyle: 'ARABIC' }],
    });

    logged.mockRestore();
  });

  // The OTHER half of the same validation. `CurrencyFormat` promises a format the domain formatter
  // can actually use, and the formatter needs BOTH fields: `formatMoney` and `parseMajorAmount` each
  // guard `isSupportedExponent` and answer nothing for a row outside it. Validating only the
  // grouping style let a row the domain calls unusable cross the port anyway, leaving every consumer
  // to re-check independently — which is precisely the trap `salaryChangeAvailability` had to add a
  // boundary check to escape. A row is either usable by the domain or it is dropped; there is no
  // third state at this boundary.
  it('drops a row whose minor-unit exponent the domain formatter cannot use', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      toCurrencyFormats([
        { code: 'INR', symbol: '₹', minorUnitExponent: 2, groupingStyle: 'INDIAN' },
        { code: 'XX', symbol: '¤', minorUnitExponent: 9, groupingStyle: 'WESTERN' },
        { code: 'YY', symbol: '¤', minorUnitExponent: -1, groupingStyle: 'WESTERN' },
      ]).map((format) => format.code),
    ).toEqual(['INR']);

    // Named with the reason, so the two causes are told apart in the diagnostic even though the
    // reader sees the same withheld statement for both.
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0]?.[1]).toMatchObject({
      dropped: [
        { code: 'XX', reason: 'exponent' },
        { code: 'YY', reason: 'exponent' },
      ],
    });

    logged.mockRestore();
  });

  // Exponent 0 is JPY and is entirely legitimate — the currency simply has no minor unit. A drop
  // rule written as a truthiness check rather than a range check would silently take it out.
  it('keeps a zero exponent, which is a real currency and not a missing value', () => {
    expect(
      toCurrencyFormats([
        { code: 'JPY', symbol: '¥', minorUnitExponent: 0, groupingStyle: 'WESTERN' },
      ]).map((format) => format.code),
    ).toEqual(['JPY']);
  });

  // A bad grouping style is a PERSISTENT data condition, not a transient failure: it is re-read on
  // every employee page render. One line per bad row per request would emit the same lines forever,
  // at a volume that trains an operator to filter out the one message that explains the outage. So
  // the rows are collected and reported together — the diagnostic names every offender, once.
  it('reports every dropped row in a single line, however many rows are bad', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      toCurrencyFormats([
        { code: 'XX', symbol: '¤', minorUnitExponent: 2, groupingStyle: 'ARABIC' },
        { code: 'YY', symbol: '¤', minorUnitExponent: 2, groupingStyle: 'THAI' },
        { code: 'ZZ', symbol: '¤', minorUnitExponent: 2, groupingStyle: 'ARABIC' },
      ]),
    ).toEqual([]);

    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0]?.[1]).toMatchObject({
      dropped: [
        { code: 'XX', groupingStyle: 'ARABIC' },
        { code: 'YY', groupingStyle: 'THAI' },
        { code: 'ZZ', groupingStyle: 'ARABIC' },
      ],
    });

    logged.mockRestore();
  });

  it('logs nothing when every row is readable', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    toCurrencyFormats([{ code: 'INR', symbol: '₹', minorUnitExponent: 2, groupingStyle: 'INDIAN' }]);

    expect(logged).not.toHaveBeenCalled();

    logged.mockRestore();
  });

  it('answers an empty list for no rows at all', () => {
    expect(toCurrencyFormats([])).toEqual([]);
  });
});
