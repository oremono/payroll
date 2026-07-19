// CAP-2 employee CRUD against a REAL disposable PostgreSQL 18 (AD-24) — never a mock.
//
// What is proven here is what a fake repository CANNOT prove:
//
//   1. `createEmployee` really writes ONE employee and ZERO salary records (UX-DR13 / AD-16). A
//      fake can only prove the port was called; only the database can prove nothing else landed.
//   2. `updateEmployee` writes the GRANTED columns, and the database independently refuses a
//      `country_code` update under `payroll_app` (AD-6). The type omitting the field is a promise;
//      the column-level grant is the enforcement, and an untested grant is one GRANT away from
//      silently not existing.
//   3. The AD-16 hire-date trigger's SQLSTATE `AP004` reaches the caller as DATA, not an exception.
//   4. The list really paginates, really searches case-insensitively, and really treats a LIKE
//      metacharacter as ordinary punctuation rather than a wildcard.
//   5. A non-UUID id answers not-found / null instead of raising a Prisma cast error against the
//      `@db.Uuid` column.
//   6. `loadFormOptions` excludes inactive rows and orders levels by `rank`.
//
// ORDER-INDEPENDENCE and RE-RUNNABILITY: every test creates and asserts only its own fixtures,
// scoped by a per-run suffix. Nothing here counts rows globally and nothing depends on another test
// having run — the suite is run twice in a row against the same database as a stated criterion.
import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getDbClient } from '@/adapters/db/client';
import { createEmployeeRepository } from '@/adapters/db/employee-repository';
import { createUuidV7Generator } from '@/adapters/id';
import {
  createEmployee,
  getEmployee,
  listEmployees,
  loadEmployeeFormOptions,
  updateEmployee,
  type EmployeeUseCaseDeps,
} from '@/application/use-cases/employees';

const OWNER_URL = process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL_APP;

if (!OWNER_URL || !APP_URL) {
  throw new Error(
    'DATABASE_URL and DATABASE_URL_APP must be set — point them at a disposable PostgreSQL 18.',
  );
}

const owner = new Pool({ connectionString: OWNER_URL });
const app = new Pool({ connectionString: APP_URL });

// Per-run fixtures. The seeded reference values are real org data shipped by a migration and this
// suite must not lean on them being any particular thing, so it plants its own taxonomy.
const suffix = randomUUID().slice(0, 8);
const ROLE = `role-${suffix}`;
const INACTIVE_ROLE = `inactive-role-${suffix}`;
const LEVEL_LOW = `level-low-${suffix}`;
const LEVEL_MID = `level-mid-${suffix}`;
const LEVEL_HIGH = `level-high-${suffix}`;
const INACTIVE_LEVEL = `inactive-level-${suffix}`;
const COUNTRY = `AA${suffix}`.toUpperCase().slice(0, 10);
const INACTIVE_COUNTRY = `BB${suffix}`.toUpperCase().slice(0, 10);
const CURRENCY = `XA${suffix}`.toUpperCase().slice(0, 10);

// `level.rank` is a PostgreSQL `int`, which caps at 2_147_483_647 — a band above that ceiling is
// refused outright for every value in it, which is what happened to this file's originally assigned
// 2_150_000_000..2_190_000_000 band and to import-employees.test.ts's own first draw. The band used
// here is 2_141_000_000..2_147_000_000: above reference-data.test.ts (~2_003_000_000) and above
// import-employees.test.ts (2_100_000_000..2_140_000_000), overlapping neither, and its highest
// possible value (2_147_000_003 — `fixtureRank + 4` is the largest offset drawn below, on the
// deactivated-level race fixture, so the top of the band plus that offset is the real maximum)
// still sits under the ceiling with 483_644 to spare. `rank` is UNIQUE
// with no way to clean up, so the full-width draw keeps birthday collisions implausible across
// accumulated runs.
const RANK_BAND_START = 2_141_000_000;
const RANK_BAND_WIDTH = 6_000_000;
const fixtureRank = RANK_BAND_START + (parseInt(suffix, 16) % RANK_BAND_WIDTH);

const HIRE_DATE = '2021-06-01';

function deps(): EmployeeUseCaseDeps {
  return { repository: createEmployeeRepository(), idGenerator: createUuidV7Generator() };
}

/** A create input every field of which is valid for this run's taxonomy. */
function validInput(overrides: Partial<Record<string, string>> = {}) {
  return {
    name: `Ada ${suffix}`,
    roleCode: ROLE,
    levelCode: LEVEL_MID,
    countryCode: COUNTRY,
    gender: 'FEMALE',
    hireDate: HIRE_DATE,
    ...overrides,
  };
}

function validUpdate(overrides: Partial<Record<string, string>> = {}) {
  return {
    name: `Ada ${suffix}`,
    roleCode: ROLE,
    levelCode: LEVEL_MID,
    gender: 'FEMALE',
    hireDate: HIRE_DATE,
    ...overrides,
  };
}

/** Create an employee through the real use-case and return the id, failing loudly if rejected. */
async function createFixtureEmployee(name: string): Promise<string> {
  const result = await createEmployee(deps(), validInput({ name }));
  if (result.kind !== 'created') {
    throw new Error(`fixture create was rejected: ${JSON.stringify(result)}`);
  }
  return result.employeeId;
}

beforeAll(async () => {
  await owner.query(
    `INSERT INTO currency (code, name, minor_unit_exponent, symbol, grouping_style)
     VALUES ($1, 'CRUD Test Currency', 2, '¤', 'WESTERN')`,
    [CURRENCY],
  );
  await owner.query(
    `INSERT INTO country (code, name, currency_code) VALUES ($1, 'Crudland', $2),
                                                            ($3, 'Retired Crudland', $2)`,
    [COUNTRY, CURRENCY, INACTIVE_COUNTRY],
  );
  await owner.query('UPDATE country SET is_active = false WHERE code = $1', [INACTIVE_COUNTRY]);
  await owner.query('INSERT INTO role (code, name) VALUES ($1, $2)', [ROLE, 'CRUD Role']);
  await owner.query('INSERT INTO role (code, name, is_active) VALUES ($1, $2, false)', [
    INACTIVE_ROLE,
    'Retired CRUD Role',
  ]);
  // Deliberately inserted OUT of rank order, so an assertion that levels come back by `rank` cannot
  // pass by accident on insertion order.
  await owner.query(
    `INSERT INTO level (code, name, rank) VALUES ($1, 'CRUD High', $2),
                                                 ($3, 'CRUD Low',  $4),
                                                 ($5, 'CRUD Mid',  $6)`,
    [LEVEL_HIGH, fixtureRank + 2, LEVEL_LOW, fixtureRank, LEVEL_MID, fixtureRank + 1],
  );
  await owner.query(
    'INSERT INTO level (code, name, rank, is_active) VALUES ($1, $2, $3, false)',
    [INACTIVE_LEVEL, 'Retired CRUD Level', fixtureRank + 3],
  );
});

afterAll(async () => {
  // No row cleanup, for the reasons the sibling integration files document at length: this suite
  // cannot delete what it creates, and that is the append-only invariant working as designed.
  await Promise.all([owner.end(), app.end()]);
});

describe('createEmployee writes one employee and NO salary record (UX-DR13 / AD-16)', () => {
  it('creates the row with every field, and zero salary records beside it', async () => {
    const name = `Grace ${suffix}-create`;

    const employeeId = await createFixtureEmployee(name);

    const { rows } = await owner.query<{
      name: string;
      role_code: string;
      level_code: string;
      country_code: string;
      gender: string;
      hire_date: string;
    }>(
      `SELECT name, role_code, level_code, country_code, gender,
              to_char(hire_date, 'YYYY-MM-DD') AS hire_date
       FROM employee WHERE id = $1`,
      [employeeId],
    );

    expect(rows[0]).toEqual({
      name,
      role_code: ROLE,
      level_code: LEVEL_MID,
      country_code: COUNTRY,
      gender: 'FEMALE',
      // The calendar date exactly, with no timezone shift.
      hire_date: HIRE_DATE,
    });

    const salaries = await owner.query(
      'SELECT id FROM salary_record WHERE employee_id = $1',
      [employeeId],
    );
    // The whole point of the story: such an employee is legitimately outside every as-of
    // population until CAP-3 gives them a salary record.
    expect(salaries.rows).toHaveLength(0);
  });

  it('ACCEPTS a future hire date — out of population, not invalid', async () => {
    const name = `Grace ${suffix}-future`;

    const result = await createEmployee(deps(), validInput({ name, hireDate: '2099-12-31' }));

    expect(result.kind).toBe('created');
  });

  it('rejects an inactive role, level, or country and writes nothing', async () => {
    const name = `Grace ${suffix}-inactive`;

    const results = await Promise.all([
      createEmployee(deps(), validInput({ name, roleCode: INACTIVE_ROLE })),
      createEmployee(deps(), validInput({ name, levelCode: INACTIVE_LEVEL })),
      createEmployee(deps(), validInput({ name, countryCode: INACTIVE_COUNTRY })),
    ]);

    expect(results.map((r) => r.kind)).toEqual(['rejected', 'rejected', 'rejected']);
    const { rows } = await owner.query('SELECT id FROM employee WHERE name = $1', [name]);
    expect(rows).toHaveLength(0);
  });

  it('does not write against a role deactivated AFTER reference data was read', async () => {
    // The race the intra-transaction re-resolution closes: the FKs target `code`, so they check
    // EXISTENCE, not ACTIVITY — nothing in the schema would notice this write.
    const raceRole = `race-role-${suffix}`;
    await owner.query('INSERT INTO role (code, name) VALUES ($1, $2)', [raceRole, 'Race Role']);

    const repository = createEmployeeRepository();
    // Read reference data while the role is still active, exactly as the use-case would.
    const references = await repository.loadReferenceData();
    expect(references.roleCodes.has(raceRole)).toBe(true);

    // ...then it is retired, before the write.
    await owner.query('UPDATE role SET is_active = false WHERE code = $1', [raceRole]);

    const employeeId = createUuidV7Generator().next();
    await expect(
      repository.createEmployee({
        employeeId,
        name: `Grace ${suffix}-race`,
        roleCode: raceRole,
        levelCode: LEVEL_MID,
        countryCode: COUNTRY,
        gender: 'FEMALE',
        hireDate: { year: 2021, month: 6, day: 1 },
      }),
    ).rejects.toThrow();

    const { rows } = await owner.query('SELECT id FROM employee WHERE id = $1', [employeeId]);
    expect(rows).toHaveLength(0);
  });
});

describe('updateEmployee writes the granted columns', () => {
  it('changes name, role, level, gender, and hire date, leaving country untouched', async () => {
    const employeeId = await createFixtureEmployee(`Grace ${suffix}-update`);

    const result = await updateEmployee(
      deps(),
      employeeId,
      validUpdate({
        name: `Grace ${suffix}-updated`,
        levelCode: LEVEL_HIGH,
        gender: 'MALE',
        hireDate: '2022-01-15',
      }),
    );

    expect(result).toEqual({ kind: 'updated', employeeId });

    const { rows } = await owner.query<{
      name: string;
      level_code: string;
      gender: string;
      hire_date: string;
      country_code: string;
    }>(
      `SELECT name, level_code, gender, country_code,
              to_char(hire_date, 'YYYY-MM-DD') AS hire_date
       FROM employee WHERE id = $1`,
      [employeeId],
    );

    expect(rows[0]).toEqual({
      name: `Grace ${suffix}-updated`,
      level_code: LEVEL_HIGH,
      gender: 'MALE',
      hire_date: '2022-01-15',
      // AD-6: immutable, and no update path exists that could have changed it.
      country_code: COUNTRY,
    });
  });

  it('answers not-found for an id that matches no row', async () => {
    const missingId = createUuidV7Generator().next();

    await expect(updateEmployee(deps(), missingId, validUpdate())).resolves.toEqual({
      kind: 'not-found',
      employeeId: missingId,
    });
  });

  it('does not assign a role deactivated AFTER reference data was read', async () => {
    // The same race `createEmployee` closes, on the edit path. The FKs target `code`, so they check
    // EXISTENCE, not ACTIVITY: without an intra-transaction re-resolution this edit lands an
    // employee on a retired role and nothing in the schema notices.
    const employeeId = await createFixtureEmployee(`Grace ${suffix}-update-race`);
    const raceRole = `race-update-role-${suffix}`;
    await owner.query('INSERT INTO role (code, name) VALUES ($1, $2)', [
      raceRole,
      'Race Update Role',
    ]);

    const repository = createEmployeeRepository();
    const references = await repository.loadReferenceData();
    expect(references.roleCodes.has(raceRole)).toBe(true);

    // ...retired between judgement and write.
    await owner.query('UPDATE role SET is_active = false WHERE code = $1', [raceRole]);

    await expect(
      repository.updateEmployee(employeeId, {
        name: `Grace ${suffix}-update-race`,
        roleCode: raceRole,
        levelCode: LEVEL_MID,
        gender: 'FEMALE',
        hireDate: { year: 2021, month: 6, day: 1 },
      }),
    ).rejects.toThrow();

    const { rows } = await owner.query<{ role_code: string }>(
      'SELECT role_code FROM employee WHERE id = $1',
      [employeeId],
    );
    expect(rows[0]?.role_code).toBe(ROLE);
  });

  it('does not assign a LEVEL deactivated after reference data was read either', async () => {
    const employeeId = await createFixtureEmployee(`Grace ${suffix}-update-race-level`);
    const raceLevel = `race-update-level-${suffix}`;
    await owner.query('INSERT INTO level (code, name, rank) VALUES ($1, $2, $3)', [
      raceLevel,
      'Race Update Level',
      fixtureRank + 4,
    ]);

    const repository = createEmployeeRepository();
    // The PRECONDITION its role-race twin asserts and this one was missing: without it the test
    // passes even if the fixture level had never been pickable, which would prove the refusal came
    // from the level being unknown rather than from it being RETIRED — a different code path
    // reaching the same rejection.
    const references = await repository.loadReferenceData();
    expect(references.levelCodes.has(raceLevel)).toBe(true);

    // ...retired between judgement and write.
    await owner.query('UPDATE level SET is_active = false WHERE code = $1', [raceLevel]);

    await expect(
      repository.updateEmployee(employeeId, {
        name: `Grace ${suffix}-update-race-level`,
        roleCode: ROLE,
        levelCode: raceLevel,
        gender: 'FEMALE',
        hireDate: { year: 2021, month: 6, day: 1 },
      }),
    ).rejects.toThrow();

    const { rows } = await owner.query<{ level_code: string }>(
      'SELECT level_code FROM employee WHERE id = $1',
      [employeeId],
    );
    expect(rows[0]?.level_code).toBe(LEVEL_MID);
  });

  it('answers not-found for an id that is not a UUID at all, without throwing', async () => {
    // `employee.id` is `@db.Uuid`, so Prisma raises a CAST error before any row is examined. An id
    // arrives from a URL segment a user can hand-edit; that is ordinary input.
    await expect(updateEmployee(deps(), 'not-a-uuid', validUpdate())).resolves.toEqual({
      kind: 'not-found',
      employeeId: 'not-a-uuid',
    });
  });
});

describe('country_code is immutable at the DATABASE, not merely in the types (AD-6)', () => {
  it('refuses a country_code UPDATE under the payroll_app role', async () => {
    const employeeId = await createFixtureEmployee(`Grace ${suffix}-country`);

    // As the RESTRICTED role. Connecting as the owner would prove nothing: PostgreSQL lets a table
    // owner bypass privilege checks entirely.
    await expect(
      app.query('UPDATE employee SET country_code = $1 WHERE id = $2', [
        INACTIVE_COUNTRY,
        employeeId,
      ]),
    ).rejects.toThrow(/permission denied/i);
  });

  it('still permits an UPDATE of the granted columns under the same role', async () => {
    // The counterpart assertion: the revoke is column-level and narrow, not a blanket refusal that
    // would happen to make the test above pass for the wrong reason.
    const employeeId = await createFixtureEmployee(`Grace ${suffix}-granted`);

    // Run-scoped like every other fixture in this file: the suite has no cleanup path, so an
    // unsuffixed name is a row this run leaves in a shared database for every later run to trip
    // over — and the header of this file claims every fixture is scoped.
    // `toBeDefined()` was the assertion here, and it discharged nothing: a `query` that matched
    // ZERO rows resolves to a perfectly defined result, so the test passed whether or not the
    // privilege existed — the exact "passing for the wrong reason" it was written to rule out. The
    // row count proves the statement reached a row, and reading the name back proves it CHANGED it.
    const updated = await app.query('UPDATE employee SET name = $1 WHERE id = $2', [
      `Renamed ${suffix}`,
      employeeId,
    ]);
    expect(updated.rowCount).toBe(1);

    const { rows } = await owner.query<{ name: string }>(
      'SELECT name FROM employee WHERE id = $1',
      [employeeId],
    );
    expect(rows[0]?.name).toBe(`Renamed ${suffix}`);
  });

  it('exposes NO delete over employee and no update or delete over salary_record', async () => {
    // Deliberately a claim about the PORT, not about a privilege. `payroll_app` does hold DELETE on
    // `employee` (granted in 20260718163326, and unlike `salary_record` never revoked), so the
    // enforcement here is that no method exists to reach it — the story's constraint is on the
    // surface this repository offers, and asserting a revoke that does not exist would be a test
    // passing for a reason the database does not actually guarantee.
    const repository = createEmployeeRepository();

    const methods = Object.keys(repository);
    expect(methods.filter((method) => /delete|remove|destroy/i.test(method))).toEqual([]);
    expect(methods.filter((method) => /salar/i.test(method)).sort()).toEqual([
      // Both salary-touching methods APPEND: the batch funnel CAP-1 writes through, and CAP-3's
      // single-record sibling (story 4-1). No update, no delete, and no second write path.
      'appendSalaryRecord',
      'createEmployeesWithSalaries',
    ]);
  });
});

describe('the hire-date invariant is the DATABASE\'s verdict, reaching the caller as data', () => {
  it('turns SQLSTATE AP004 into a hire_date rejection rather than an exception', async () => {
    const employeeId = await createFixtureEmployee(`Grace ${suffix}-ap004`);

    // Give them a salary record, as an import would have. Owner connection: salary_record is
    // append-only under payroll_app and this is fixture setup, not the behaviour under test.
    await owner.query(
      `INSERT INTO salary_record (id, employee_id, amount_minor, currency_code, effective_from)
       VALUES ($1, $2, 234000000, $3, $4)`,
      [randomUUID(), employeeId, CURRENCY, '2022-03-01'],
    );

    // Moving the hire date LATER than that record walks the data into the state AD-16 cannot
    // tolerate, and the trigger raises AP004.
    const result = await updateEmployee(
      deps(),
      employeeId,
      validUpdate({ hireDate: '2023-01-01' }),
    );

    expect(result).toEqual({
      kind: 'rejected',
      reasons: [
        {
          field: 'hire_date',
          offendingValue: '2023-01-01',
          sentence:
            'The hire date 2023-01-01 is later than an existing salary record for this ' +
            'employee. A salary cannot take effect before the person was hired.',
        },
      ],
    });

    // And nothing moved.
    const { rows } = await owner.query<{ hire_date: string }>(
      "SELECT to_char(hire_date, 'YYYY-MM-DD') AS hire_date FROM employee WHERE id = $1",
      [employeeId],
    );
    expect(rows[0]?.hire_date).toBe(HIRE_DATE);
  });

  it('permits a hire date moved EARLIER than the salary record — that breaks nothing', async () => {
    const employeeId = await createFixtureEmployee(`Grace ${suffix}-earlier`);
    await owner.query(
      `INSERT INTO salary_record (id, employee_id, amount_minor, currency_code, effective_from)
       VALUES ($1, $2, 234000000, $3, $4)`,
      [randomUUID(), employeeId, CURRENCY, '2022-03-01'],
    );

    const result = await updateEmployee(
      deps(),
      employeeId,
      validUpdate({ hireDate: '2020-01-01' }),
    );

    expect(result.kind).toBe('updated');
  });
});

describe('getEmployee', () => {
  it('reads back every identity field, and no salary', async () => {
    const name = `Grace ${suffix}-detail`;
    const employeeId = await createFixtureEmployee(name);

    const result = await getEmployee(deps(), employeeId);

    expect(result).toEqual({
      kind: 'employee',
      employee: {
        id: employeeId,
        name,
        roleCode: ROLE,
        levelCode: LEVEL_MID,
        countryCode: COUNTRY,
        gender: 'FEMALE',
        hireDate: { year: 2021, month: 6, day: 1 },
      },
    });
  });

  it('answers not-found for an unknown id and for a non-UUID id alike, never throwing', async () => {
    const missingId = createUuidV7Generator().next();

    await expect(getEmployee(deps(), missingId)).resolves.toEqual({ kind: 'not-found' });
    await expect(getEmployee(deps(), 'not-a-uuid')).resolves.toEqual({ kind: 'not-found' });
  });
});

describe('listEmployees paginates and searches', () => {
  // One cohort, planted once, asserted by several tests. The names are deliberately chosen so that
  // a case-insensitive substring search for `ana` matches some and not others.
  // The cohort token sits in the MIDDLE of each name, not at the front. That is what makes a
  // scoped search term like `ana ${cohort}` able to match MID-WORD (inside "Banana", "Diana") as
  // well as at position 0 — with the token as a prefix, every scoped search would necessarily
  // match at position 0 and the substring behaviour would go untested.
  const cohort = `cohort-${suffix}`;
  const NAMES = [
    `Ana ${cohort} Diaz`,
    `Banana ${cohort} Smith`,
    `Carol ${cohort} Jones`,
    `Diana ${cohort} Prince`,
    `Edward ${cohort} Blake`,
  ];
  const TWIN = `Twin ${cohort} Pair`;

  beforeAll(async () => {
    for (const name of NAMES) {
      await createFixtureEmployee(name);
    }
    // Two people who genuinely share a name — the tie the (name, id) order exists to break.
    await createFixtureEmployee(TWIN);
    await createFixtureEmployee(TWIN);
  });

  it('returns a page in (name, id) order with the total, and echoes the effective window', async () => {
    const result = await listEmployees(deps(), { search: cohort, limit: 3, offset: 0 });

    expect(result.kind).toBe('page');
    if (result.kind !== 'page') return;

    expect(result.totalCount).toBe(7);
    expect(result.limit).toBe(3);
    expect(result.offset).toBe(0);
    expect(result.employees.map((e) => e.name)).toEqual([
      `Ana ${cohort} Diaz`,
      `Banana ${cohort} Smith`,
      `Carol ${cohort} Jones`,
    ]);
  });

  it('pages through the whole cohort without dropping or repeating a row', async () => {
    const seen: string[] = [];
    for (let offset = 0; offset < 8; offset += 3) {
      const page = await listEmployees(deps(), { search: cohort, limit: 3, offset });
      if (page.kind !== 'page') throw new Error('expected a page');
      seen.push(...page.employees.map((e) => e.id));
    }

    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it('gives duplicate names a stable, distinct order across repeated reads', async () => {
    const read = async () => {
      const page = await listEmployees(deps(), { search: TWIN, limit: 10, offset: 0 });
      if (page.kind !== 'page') throw new Error('expected a page');
      return page.employees.map((e) => e.id);
    };

    const first = await read();
    expect(first).toHaveLength(2);
    expect(new Set(first).size).toBe(2);
    // Offset pagination over a non-total order silently drops and repeats rows between pages; the
    // id tie-break is what makes the order total.
    expect(await read()).toEqual(first);
  });

  it('searches the name case-insensitively, as a substring', async () => {
    const result = await listEmployees(deps(), { search: `ana ${cohort}`, limit: 50, offset: 0 });

    if (result.kind !== 'page') throw new Error('expected a page');
    // Three matches, and each one proves something different: `Ana …` matches at position 0 with
    // DIFFERENT CASE (`A` vs the searched `a`); `Banana …` and `Diana …` match MID-WORD. A prefix
    // match or a case-sensitive one would return fewer than three.
    expect(result.employees.map((e) => e.name)).toEqual([
      `Ana ${cohort} Diaz`,
      `Banana ${cohort} Smith`,
      `Diana ${cohort} Prince`,
    ]);
  });

  it('searches the NAME only — a role or country code is not a search key', async () => {
    const result = await listEmployees(deps(), { search: ROLE, limit: 10, offset: 0 });

    if (result.kind !== 'page') throw new Error('expected a page');
    expect(result.totalCount).toBe(0);
  });

  it('answers an empty page with the correct total when the offset is past the end', async () => {
    const result = await listEmployees(deps(), { search: cohort, limit: 10, offset: 500 });

    if (result.kind !== 'page') throw new Error('expected a page');
    expect(result.employees).toEqual([]);
    expect(result.totalCount).toBe(7);
  });

  it('treats a LIKE metacharacter as ordinary punctuation, not a wildcard', async () => {
    // Unescaped, `%` matches every employee in the table and `_` matches any single character.
    for (const search of ['%', '_', `${cohort}%`, `Ana_${cohort}`]) {
      const result = await listEmployees(deps(), { search, limit: 10, offset: 0 });
      if (result.kind !== 'page') throw new Error('expected a page');
      expect(result.employees).toEqual([]);
      expect(result.totalCount).toBe(0);
    }
  });

  it('clamps a hostile limit and a negative offset, and echoes the CLAMPED values', async () => {
    const huge = await listEmployees(deps(), { search: cohort, limit: 1_000_000, offset: -5 });
    if (huge.kind !== 'page') throw new Error('expected a page');
    expect(huge.limit).toBe(200);
    expect(huge.offset).toBe(0);
    expect(huge.employees).toHaveLength(7);

    const tiny = await listEmployees(deps(), { search: cohort, limit: 0, offset: 0 });
    if (tiny.kind !== 'page') throw new Error('expected a page');
    expect(tiny.limit).toBe(1);
    expect(tiny.employees).toHaveLength(1);
  });

  it('a null search is no filter at all, and finds this cohort among everyone else', async () => {
    const result = await listEmployees(deps(), { search: null, limit: 200, offset: 0 });

    if (result.kind !== 'page') throw new Error('expected a page');
    // Deliberately not an equality assertion on the total: other suites share this database.
    expect(result.totalCount).toBeGreaterThanOrEqual(7);
  });

  it('an EMPTY or whitespace-only search is no filter either, matching the null case exactly', async () => {
    // Story 3-2's search box sends `''` the moment a reader clears it, and `'   '` the moment they
    // hit the space bar. Both mean "I am not searching", and they must reach the same page a null
    // search reaches — not a filter that matches by accident, and not one that matches nothing.
    const none = await listEmployees(deps(), { search: null, limit: 200, offset: 0 });
    const empty = await listEmployees(deps(), { search: '', limit: 200, offset: 0 });
    const blank = await listEmployees(deps(), { search: '   ', limit: 200, offset: 0 });

    if (none.kind !== 'page' || empty.kind !== 'page' || blank.kind !== 'page') {
      throw new Error('expected pages');
    }
    expect(empty.totalCount).toBe(none.totalCount);
    expect(blank.totalCount).toBe(none.totalCount);
    expect(empty.employees.map((e) => e.id)).toEqual(none.employees.map((e) => e.id));
    expect(blank.employees.map((e) => e.id)).toEqual(none.employees.map((e) => e.id));
  });

  it('trims a search term rather than searching for the spaces around it', async () => {
    const result = await listEmployees(deps(), {
      search: `  ana ${cohort}  `,
      limit: 50,
      offset: 0,
    });

    if (result.kind !== 'page') throw new Error('expected a page');
    expect(result.employees.map((e) => e.name)).toEqual([
      `Ana ${cohort} Diaz`,
      `Banana ${cohort} Smith`,
      `Diana ${cohort} Prince`,
    ]);
  });
});

describe('a name containing a literal backslash — the one case the escape doubling carries', () => {
  // Deliberately OUTSIDE the cohort above, whose totals are asserted exactly.
  const token = `esc-${suffix}`;
  const WITH_BACKSLASH = String.raw`Back\slash ${token}`;
  const WITHOUT_BACKSLASH = `Backslash ${token}`;

  beforeAll(async () => {
    await createFixtureEmployee(WITH_BACKSLASH);
    await createFixtureEmployee(WITHOUT_BACKSLASH);
  });

  it('finds the employee whose name really contains a backslash', async () => {
    // The whole reason `escapeLikePattern` doubles the backslash. Undoubled, this term reaches
    // PostgreSQL as LIKE '%Back\slash …%', where `\s` is an ESCAPED s — the pattern silently
    // becomes "Backslash …", so this search would return the OTHER employee and miss the one it
    // named. Both rows exist here precisely so that failure is visible rather than merely empty.
    const result = await listEmployees(deps(), { search: WITH_BACKSLASH, limit: 10, offset: 0 });

    if (result.kind !== 'page') throw new Error('expected a page');
    expect(result.employees.map((e) => e.name)).toEqual([WITH_BACKSLASH]);
  });

  it('does not match the backslash-free twin, and is not matched BY it', async () => {
    const result = await listEmployees(deps(), {
      search: WITHOUT_BACKSLASH,
      limit: 10,
      offset: 0,
    });

    if (result.kind !== 'page') throw new Error('expected a page');
    expect(result.employees.map((e) => e.name)).toEqual([WITHOUT_BACKSLASH]);
  });

  it('treats a term BEGINNING with a backslash as ordinary text, not a dangling escape', async () => {
    // An unescaped trailing `\` is a malformed LIKE pattern and PostgreSQL raises rather than
    // answering, so this asserts the search stays a search instead of becoming an outage. Scoped by
    // the run token because previous runs of this very suite left their own backslashed rows behind.
    const result = await listEmployees(deps(), {
      search: String.raw`\slash ${token}`,
      limit: 10,
      offset: 0,
    });

    if (result.kind !== 'page') throw new Error('expected a page');
    expect(result.employees.map((e) => e.name)).toEqual([WITH_BACKSLASH]);
  });
});

describe('the isolation level the list query depends on is really applied', () => {
  // `listEmployees` claims its page and its total cannot disagree. That claim rests entirely on
  // REPEATABLE READ: under PostgreSQL's default READ COMMITTED each statement takes its OWN
  // snapshot, so a transaction around the two closes nothing.
  //
  // This is pinned against the real database rather than assumed because the assumption was FALSE
  // once already: Prisma's ARRAY form of `$transaction` accepts `isolationLevel` and silently
  // discards it — the transaction runs at read committed, no error, no warning. The adapter uses
  // the INTERACTIVE form for that reason, and this test fails if a Prisma upgrade ever takes the
  // behaviour away, rather than letting the comment above the code quietly become a lie again.
  it('reports repeatable read inside an interactive transaction that asked for it', async () => {
    const client = getDbClient();

    const rows = await client.$transaction(
      async (tx) => tx.$queryRaw<{ level: string }[]>`
        SELECT current_setting('transaction_isolation') AS level`,
      { isolationLevel: 'RepeatableRead' },
    );

    expect(rows[0]?.level).toBe('repeatable read');
  });

  it('defaults to read committed without it, so the option is doing real work', async () => {
    const client = getDbClient();

    const rows = await client.$transaction(
      async (tx) => tx.$queryRaw<{ level: string }[]>`
        SELECT current_setting('transaction_isolation') AS level`,
    );

    expect(rows[0]?.level).toBe('read committed');
  });
});

describe('loadEmployeeFormOptions offers only pickable values', () => {
  it('excludes inactive rows and orders levels by rank', async () => {
    const result = await loadEmployeeFormOptions(deps());

    expect(result.kind).toBe('options');
    if (result.kind !== 'options') return;

    const roleCodes = result.options.roles.map((r) => r.code);
    expect(roleCodes).toContain(ROLE);
    expect(roleCodes).not.toContain(INACTIVE_ROLE);

    const countryCodes = result.options.countries.map((c) => c.code);
    expect(countryCodes).toContain(COUNTRY);
    expect(countryCodes).not.toContain(INACTIVE_COUNTRY);

    const levelCodes = result.options.levels.map((l) => l.code);
    expect(levelCodes).not.toContain(INACTIVE_LEVEL);
    // Inserted out of order above, so this cannot pass on insertion order.
    const ours = result.options.levels.filter((l) => l.code.endsWith(suffix));
    expect(ours.map((l) => l.code)).toEqual([LEVEL_LOW, LEVEL_MID, LEVEL_HIGH]);
    expect(ours.map((l) => l.rank)).toEqual([fixtureRank, fixtureRank + 1, fixtureRank + 2]);
  });

  it('carries each country its currency — currency FOLLOWS from country, never chosen (AD-6)', async () => {
    const result = await loadEmployeeFormOptions(deps());

    if (result.kind !== 'options') throw new Error('expected options');
    expect(result.options.countries.find((c) => c.code === COUNTRY)?.currencyCode).toBe(CURRENCY);
  });

  it('orders roles and countries totally, so repeated reads agree', async () => {
    const first = await loadEmployeeFormOptions(deps());
    const second = await loadEmployeeFormOptions(deps());

    expect(first).toEqual(second);
  });
});
