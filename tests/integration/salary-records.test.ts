// CAP-3 salary-record append against a REAL disposable PostgreSQL 18 (AD-24) — never a mock.
//
// What is proven here is what a fake repository CANNOT prove:
//
//   1. An append really lands ONE row, readable, carrying the country's currency and the exact
//      calendar date with no timezone shift — and leaves every prior row byte-identical.
//   2. A second append on the SAME DAY receives a strictly greater `seq`. That is CAP-3's only
//      correction mechanism and the whole substance of AD-8's tie-break; only a real BIGSERIAL can
//      demonstrate it.
//   3. The one resolver (`resolveCurrentSalary`) reads the real rows back and picks the correction,
//      not the typo — the ordering proven against data the database actually produced.
//   4. `UPDATE` and `DELETE` on `salary_record` are refused by BOTH enforcement layers, each proven
//      by its own SQLSTATE: the privilege revoke (`42501`, as `payroll_app`) and the append-only
//      trigger behind it (`AP001`, as the owner, whose privileges the revoke cannot restrain). The
//      port omitting the methods is a promise; these two are the enforcement, and an untested
//      enforcement is one migration away from silently not existing.
//   5. The AD-16 hire-date trigger's SQLSTATE `AP004` reaches the caller as a typed OUTCOME rather
//      than an exception, on the append path as well as the edit path.
//   6. The funnel re-resolves the currency from the ACTIVE country inside its own transaction, so a
//      country deactivated between judgement and write is refused and nothing lands.
//
// ORDER-INDEPENDENCE and RE-RUNNABILITY: every test creates and asserts only its own fixtures,
// scoped by a per-run suffix. Nothing here counts rows globally and nothing depends on another test
// having run — which matters more in this file than anywhere else, because `salary_record` rows
// CANNOT BE DELETED. Every run of this suite leaves its rows behind by design, and the suite is run
// twice in a row against the same database as a stated criterion.
import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { systemClock } from '@/adapters/clock';
import { createEmployeeRepository } from '@/adapters/db/employee-repository';
import { createUuidV7Generator } from '@/adapters/id';
import {
  createEmployee,
  type EmployeeUseCaseDeps,
} from '@/application/use-cases/employees';
import {
  recordSalaryChange,
  type RecordSalaryChangeDeps,
} from '@/application/use-cases/record-salary-change';
import { plainDateToIso, type PlainDate } from '@/domain/plain-date';
import { resolveCurrentSalary, type SalaryRecordView } from '@/domain/salary-timeline';

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
const ROLE = `sal-role-${suffix}`;
const LEVEL = `sal-level-${suffix}`;
const COUNTRY = `CA${suffix}`.toUpperCase().slice(0, 10);
const CURRENCY = `XC${suffix}`.toUpperCase().slice(0, 10);
// A real, resolvable currency that is NOT `COUNTRY`'s — so a mismatch test rejects for the reason
// it names (AD-6) and never because the code was simply unknown. It is deliberately attached to no
// country: nothing here needs one, and an unused fixture row is a claim about the world that no
// assertion is holding up.
const OTHER_CURRENCY = `XD${suffix}`.toUpperCase().slice(0, 10);

// `level.rank` is UNIQUE, a PostgreSQL `int`, and this suite cannot clean up after itself — so it
// draws from a band no sibling integration file uses. reference-data sits near 2_003_000_000,
// import-employees holds 2_100_000_000..2_140_000_000 and employees holds
// 2_141_000_000..2_147_000_000. This band is 2_010_000_000..2_016_000_000: above the first, below
// the second, overlapping neither, and its highest possible value (2_015_999_999) clears the `int`
// ceiling of 2_147_483_647 by 131_483_648. The full-width draw keeps birthday collisions
// implausible across accumulated runs.
const RANK_BAND_START = 2_010_000_000;
const RANK_BAND_WIDTH = 6_000_000;
const fixtureRank = RANK_BAND_START + (parseInt(suffix, 16) % RANK_BAND_WIDTH);

const HIRE_DATE = '2021-06-01';

// TODAY comes from the clock port at this boundary and is passed INWARD, exactly as the Server
// Action does (Law 6 / AD-11). Read ONCE for the whole file so a run straddling UTC midnight cannot
// make two assertions disagree about what day it is.
const TODAY: PlainDate = systemClock.todayUtc();
const TODAY_ISO = plainDateToIso(TODAY);

function employeeDeps(): EmployeeUseCaseDeps {
  return { repository: createEmployeeRepository(), idGenerator: createUuidV7Generator() };
}

function salaryDeps(): RecordSalaryChangeDeps {
  return { repository: createEmployeeRepository(), idGenerator: createUuidV7Generator() };
}

/** Create an employee through the real use-case and return the id, failing loudly if rejected. */
async function createFixtureEmployee(
  name: string,
  overrides: Partial<Record<string, string>> = {},
): Promise<string> {
  const result = await createEmployee(employeeDeps(), {
    name,
    roleCode: ROLE,
    levelCode: LEVEL,
    countryCode: COUNTRY,
    gender: 'FEMALE',
    hireDate: HIRE_DATE,
    ...overrides,
  });
  if (result.kind !== 'created') {
    throw new Error(`fixture create was rejected: ${JSON.stringify(result)}`);
  }
  return result.employeeId;
}

type SalaryRow = {
  id: string;
  seq: string;
  amount_minor: string;
  currency_code: string;
  effective_from: string;
};

/** Every salary row for one employee, oldest `seq` first, as the database actually holds it. */
async function readSalaryRows(employeeId: string): Promise<SalaryRow[]> {
  const { rows } = await owner.query<SalaryRow>(
    `SELECT id, seq::text AS seq, amount_minor::text AS amount_minor, currency_code,
            to_char(effective_from, 'YYYY-MM-DD') AS effective_from
       FROM salary_record WHERE employee_id = $1 ORDER BY seq`,
    [employeeId],
  );
  return rows;
}

/**
 * Run a statement expected to FAIL and answer the SQLSTATE it failed with.
 *
 * The code, never the message: a SQLSTATE is the contract a migration pins and a message is English
 * that a locale or a reword can change underneath an assertion. `'no error'` rather than a throw so
 * a statement that unexpectedly SUCCEEDS fails the assertion that named the code it wanted, instead
 * of a bare rejection nobody can read.
 */
async function sqlstateOf(pool: Pool, sql: string, ...params: unknown[]): Promise<string> {
  try {
    await pool.query(sql, params);
    return 'no error';
  } catch (error) {
    return (error as { code?: string }).code ?? 'no sqlstate';
  }
}

/** The same rows, in the shape the ONE resolver reads (AD-8). */
function asRecordViews(rows: readonly SalaryRow[]): SalaryRecordView[] {
  return rows.map((row) => ({
    id: row.id,
    seq: BigInt(row.seq),
    salary: { amountMinor: BigInt(row.amount_minor), currency: row.currency_code },
    effectiveFrom: {
      year: Number(row.effective_from.slice(0, 4)),
      month: Number(row.effective_from.slice(5, 7)),
      day: Number(row.effective_from.slice(8, 10)),
    },
  }));
}

beforeAll(async () => {
  await owner.query(
    `INSERT INTO currency (code, name, minor_unit_exponent, symbol, grouping_style)
     VALUES ($1, 'Salary Test Currency', 2, '¤', 'WESTERN'),
            ($2, 'Other Salary Currency', 2, '¤', 'WESTERN')`,
    [CURRENCY, OTHER_CURRENCY],
  );
  await owner.query(
    "INSERT INTO country (code, name, currency_code) VALUES ($1, 'Salaryland', $2)",
    [COUNTRY, CURRENCY],
  );
  await owner.query('INSERT INTO role (code, name) VALUES ($1, $2)', [ROLE, 'Salary Role']);
  await owner.query('INSERT INTO level (code, name, rank) VALUES ($1, $2, $3)', [
    LEVEL,
    'Salary Level',
    fixtureRank,
  ]);
});

afterAll(async () => {
  // No row cleanup, and there CANNOT be any: `salary_record` admits no DELETE. That is the
  // append-only invariant working as designed, and it is why every fixture above is run-scoped.
  await Promise.all([owner.end(), app.end()]);
});

describe('appending a salary change', () => {
  it('lands one row, readable, carrying the COUNTRY\'s currency and the exact calendar date', async () => {
    const employeeId = await createFixtureEmployee(`Ada ${suffix}-append`);

    const result = await recordSalaryChange(
      salaryDeps(),
      employeeId,
      { effectiveFrom: TODAY_ISO, amountMinor: '2500000', currency: CURRENCY },
      TODAY,
    );

    expect(result.kind).toBe('recorded');
    if (result.kind !== 'recorded') return;

    const rows = await readSalaryRows(employeeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: result.salaryRecordId,
      amount_minor: '2500000',
      currency_code: CURRENCY,
      // The calendar date exactly, with no timezone shift.
      effective_from: TODAY_ISO,
    });
  });

  it('APPENDS: the prior row\'s every column is unchanged and the new row is an ADDITIONAL row', async () => {
    const employeeId = await createFixtureEmployee(`Ada ${suffix}-prior`);

    await recordSalaryChange(
      salaryDeps(),
      employeeId,
      { effectiveFrom: '2023-04-01', amountMinor: '2000000', currency: CURRENCY },
      TODAY,
    );
    const before = await readSalaryRows(employeeId);
    expect(before).toHaveLength(1);

    await recordSalaryChange(
      salaryDeps(),
      employeeId,
      { effectiveFrom: TODAY_ISO, amountMinor: '3000000', currency: CURRENCY },
      TODAY,
    );

    const after = await readSalaryRows(employeeId);
    expect(after).toHaveLength(2);
    // Byte-identical, every column. `salary_record` has no UPDATE path and this is the proof.
    expect(after[0]).toEqual(before[0]);
  });

  it('gives a SAME-DAY correction a strictly greater seq, and the resolver returns it', async () => {
    // CAP-3's only correction mechanism: a typo is fixed by appending a corrected record dated the
    // same day, never by editing the wrong one. Two records then share an `effectiveFrom`, and
    // `seq` is the only key that says which came second.
    const employeeId = await createFixtureEmployee(`Ada ${suffix}-correction`);

    const typo = await recordSalaryChange(
      salaryDeps(),
      employeeId,
      { effectiveFrom: TODAY_ISO, amountMinor: '99999999', currency: CURRENCY },
      TODAY,
    );
    const correction = await recordSalaryChange(
      salaryDeps(),
      employeeId,
      { effectiveFrom: TODAY_ISO, amountMinor: '2500000', currency: CURRENCY },
      TODAY,
    );

    expect(typo.kind).toBe('recorded');
    expect(correction.kind).toBe('recorded');
    if (typo.kind !== 'recorded' || correction.kind !== 'recorded') return;

    const rows = await readSalaryRows(employeeId);
    expect(rows).toHaveLength(2);
    // A BIGSERIAL is monotonic but gap-prone, so this asserts ORDER and never contiguity.
    expect(BigInt(rows[1]?.seq ?? '0')).toBeGreaterThan(BigInt(rows[0]?.seq ?? '0'));
    expect(rows[1]?.id).toBe(correction.salaryRecordId);

    // The ONE resolver (AD-8), reading rows the database actually produced. The typo is handed to
    // it FIRST and carries the larger amount — anything reading list position or magnitude picks
    // the wrong record.
    const current = resolveCurrentSalary(asRecordViews(rows), TODAY);
    expect(current?.id).toBe(correction.salaryRecordId);
    expect(current?.salary).toEqual({ amountMinor: 2_500_000n, currency: CURRENCY });
  });

  it('accepts a BACKDATED record and the resolver still answers the greatest (effectiveFrom, seq)', async () => {
    const employeeId = await createFixtureEmployee(`Ada ${suffix}-backdated`);

    await recordSalaryChange(
      salaryDeps(),
      employeeId,
      { effectiveFrom: TODAY_ISO, amountMinor: '3000000', currency: CURRENCY },
      TODAY,
    );
    // Appended LAST, so it holds the greatest `seq` in this employee's history — and must still
    // lose, because its effective date is earlier. `seq` is a tie-break, not the primary key.
    const backdated = await recordSalaryChange(
      salaryDeps(),
      employeeId,
      { effectiveFrom: '2022-01-01', amountMinor: '1000000', currency: CURRENCY },
      TODAY,
    );

    expect(backdated.kind).toBe('recorded');

    const rows = await readSalaryRows(employeeId);
    expect(rows).toHaveLength(2);
    const current = resolveCurrentSalary(asRecordViews(rows), TODAY);
    expect(current?.salary.amountMinor).toBe(3_000_000n);
  });
});

describe('what the append refuses, without writing anything', () => {
  it('refuses a FUTURE-dated record (Law 5 / AD-18)', async () => {
    const employeeId = await createFixtureEmployee(`Ada ${suffix}-future`);

    const result = await recordSalaryChange(
      salaryDeps(),
      employeeId,
      { effectiveFrom: '2099-12-31', amountMinor: '2500000', currency: CURRENCY },
      TODAY,
    );

    expect(result.kind).toBe('rejected');
    expect(await readSalaryRows(employeeId)).toEqual([]);
  });

  it('refuses a future-dated record at the FUNNEL too, past the domain validator', async () => {
    // The funnel re-checks the rule because it is what every later write path inherits, including
    // callers that never ran the domain validator. Reaching it directly is the only way to prove
    // the second net exists.
    const employeeId = await createFixtureEmployee(`Ada ${suffix}-funnel-future`);
    const repository = createEmployeeRepository();

    await expect(
      repository.appendSalaryRecord(
        {
          salaryRecordId: createUuidV7Generator().next(),
          employeeId,
          salary: { amountMinor: 2_500_000n, currency: CURRENCY },
          effectiveFrom: { year: 2099, month: 12, day: 31 },
        },
        TODAY,
      ),
      // The SPECIFIC guard, not merely "something threw": a bare `.toThrow()` passes just as well
      // when the currency arm fires, or when the whole guard is replaced by an unconditional throw.
    ).rejects.toThrow(/is later than today/);

    expect(await readSalaryRows(employeeId)).toEqual([]);
  });

  it('refuses a currency that is not the country\'s (AD-6)', async () => {
    const employeeId = await createFixtureEmployee(`Ada ${suffix}-currency`);

    const result = await recordSalaryChange(
      salaryDeps(),
      employeeId,
      { effectiveFrom: TODAY_ISO, amountMinor: '2500000', currency: OTHER_CURRENCY },
      TODAY,
    );

    expect(result.kind).toBe('rejected');
    expect(await readSalaryRows(employeeId)).toEqual([]);
  });

  it('refuses a currency mismatch at the FUNNEL too, past the domain validator', async () => {
    const employeeId = await createFixtureEmployee(`Ada ${suffix}-funnel-currency`);
    const repository = createEmployeeRepository();

    await expect(
      repository.appendSalaryRecord(
        {
          salaryRecordId: createUuidV7Generator().next(),
          employeeId,
          salary: { amountMinor: 2_500_000n, currency: OTHER_CURRENCY },
          effectiveFrom: TODAY,
        },
        TODAY,
      ),
    ).rejects.toThrow(/Currency mismatch/);

    expect(await readSalaryRows(employeeId)).toEqual([]);
  });

  it('refuses a write against a country deactivated AFTER reference data was read', async () => {
    // The race the intra-transaction re-resolution closes: the FK targets `code`, so it checks
    // EXISTENCE, not ACTIVITY — nothing in the schema would notice this write.
    const raceCountry = `CC${suffix}`.toUpperCase().slice(0, 10);
    await owner.query('INSERT INTO country (code, name, currency_code) VALUES ($1, $2, $3)', [
      raceCountry,
      'Race Salaryland',
      CURRENCY,
    ]);
    const employeeId = await createFixtureEmployee(`Ada ${suffix}-race`, {
      countryCode: raceCountry,
    });

    const repository = createEmployeeRepository();
    const references = await repository.loadReferenceData();
    expect(references.countryCurrencies.has(raceCountry)).toBe(true);

    // ...retired between judgement and write.
    await owner.query('UPDATE country SET is_active = false WHERE code = $1', [raceCountry]);

    await expect(
      repository.appendSalaryRecord(
        {
          salaryRecordId: createUuidV7Generator().next(),
          employeeId,
          salary: { amountMinor: 2_500_000n, currency: CURRENCY },
          effectiveFrom: TODAY,
        },
        TODAY,
      ),
      // The INACTIVE-country arm specifically. This test's whole claim is that the re-resolution
      // inside the transaction is what notices; a currency-mismatch throw would satisfy a bare
      // `.toThrow()` while proving the opposite.
    ).rejects.toThrow(/is not an active country/);

    expect(await readSalaryRows(employeeId)).toEqual([]);
  });

  it('answers not-found for an unknown id and for a non-UUID id alike, never throwing', async () => {
    const missingId = createUuidV7Generator().next();
    const input = { effectiveFrom: TODAY_ISO, amountMinor: '2500000', currency: CURRENCY };

    await expect(recordSalaryChange(salaryDeps(), missingId, input, TODAY)).resolves.toEqual({
      kind: 'not-found',
      employeeId: missingId,
    });
    // `employee.id` is `@db.Uuid`, so Prisma raises a CAST error before any row is examined. An id
    // arrives from a URL segment a user can hand-edit; that is ordinary input.
    await expect(recordSalaryChange(salaryDeps(), 'not-a-uuid', input, TODAY)).resolves.toEqual({
      kind: 'not-found',
      employeeId: 'not-a-uuid',
    });
  });
});

describe('the hire-date invariant is the DATABASE\'s verdict, reaching the caller as data', () => {
  it('turns SQLSTATE AP004 into an effective-before-hire OUTCOME rather than an exception', async () => {
    // Reached past the domain validator on purpose: the validator judges the hire date it READ, and
    // the trigger is the backstop for one that moved in between. Only the repository can be made to
    // demonstrate that arm.
    const employeeId = await createFixtureEmployee(`Ada ${suffix}-ap004`);
    const repository = createEmployeeRepository();

    const outcome = await repository.appendSalaryRecord(
      {
        salaryRecordId: createUuidV7Generator().next(),
        employeeId,
        salary: { amountMinor: 2_500_000n, currency: CURRENCY },
        // One day before the hire date.
        effectiveFrom: { year: 2021, month: 5, day: 31 },
      },
      TODAY,
    );

    expect(outcome).toEqual({
      kind: 'effective-before-hire',
      hireDate: { year: 2021, month: 6, day: 1 },
    });
    expect(await readSalaryRows(employeeId)).toEqual([]);
  });

  it('carries back the hire date the DATABASE enforced, not the one that was read', async () => {
    // Staged deterministically rather than raced: the employee is created at HIRE_DATE, the hire
    // date is then MOVED FORWARD out from under a reader, and the append is attempted against a
    // date that was legal before the move and is not after it. That is precisely the situation the
    // AP004 backstop exists for — and the only situation in which this arm can fire at all, since
    // the domain validator passes anything it judges against the date it read.
    //
    // The employee holds no salary record yet, so moving the hire date forward is itself legal
    // (`employee_hire_date_not_after_salary` has nothing to object to).
    const employeeId = await createFixtureEmployee(`Ada ${suffix}-ap004-moved`);
    await owner.query('UPDATE employee SET hire_date = $1::date WHERE id = $2', [
      '2024-01-01',
      employeeId,
    ]);

    const outcome = await createEmployeeRepository().appendSalaryRecord(
      {
        salaryRecordId: createUuidV7Generator().next(),
        employeeId,
        salary: { amountMinor: 2_500_000n, currency: CURRENCY },
        // After the hire date that was READ (2021-06-01), before the one the database now holds.
        effectiveFrom: { year: 2023, month: 4, day: 1 },
      },
      TODAY,
    );

    expect(outcome).toEqual({
      kind: 'effective-before-hire',
      hireDate: { year: 2024, month: 1, day: 1 },
    });
    expect(await readSalaryRows(employeeId)).toEqual([]);
  });

  it('accepts a record dated exactly ON the hire date — a day-one salary is legitimate', async () => {
    const employeeId = await createFixtureEmployee(`Ada ${suffix}-day-one`);

    const result = await recordSalaryChange(
      salaryDeps(),
      employeeId,
      { effectiveFrom: HIRE_DATE, amountMinor: '2000000', currency: CURRENCY },
      TODAY,
    );

    expect(result.kind).toBe('recorded');
    expect(await readSalaryRows(employeeId)).toHaveLength(1);
  });
});

describe('salary_record is append-only at the DATABASE, not merely in the types (Law 5 / AD-18)', () => {
  it('refuses UPDATE and DELETE at BOTH layers: the revoke (42501) and the AP001 trigger', async () => {
    // TWO INDEPENDENT LAYERS, and the whole point is that each is proven separately.
    //
    // Layer A is the privilege REVOKE: as `payroll_app` the statement never reaches the trigger at
    // all — it dies at the privilege check with SQLSTATE `42501`. So a test that only ran as that
    // role and only asserted "it threw" could not detect the trigger being dropped by a migration,
    // which is precisely the enforcement it claims to cover.
    //
    // Layer B is the trigger. Reaching it needs a role that HOLDS the grant, and the table owner is
    // exactly that: PostgreSQL lets an owner bypass privilege checks entirely, so the same
    // statement gets past layer A and is refused by `salary_record_append_only` with `AP001`. That
    // bypass is the reason layer B exists — the revoke alone protects the application role and
    // nothing else.
    const employeeId = await createFixtureEmployee(`Ada ${suffix}-ap001`);
    const result = await recordSalaryChange(
      salaryDeps(),
      employeeId,
      { effectiveFrom: TODAY_ISO, amountMinor: '2500000', currency: CURRENCY },
      TODAY,
    );
    expect(result.kind).toBe('recorded');

    const update = 'UPDATE salary_record SET amount_minor = 1 WHERE employee_id = $1';
    const remove = 'DELETE FROM salary_record WHERE employee_id = $1';

    // Layer A — the REVOKE, under the restricted runtime role. `42501` is insufficient_privilege.
    expect(await sqlstateOf(app, update, employeeId)).toBe('42501');
    expect(await sqlstateOf(app, remove, employeeId)).toBe('42501');

    // Layer B — the TRIGGER, under the owner, whose privileges layer A cannot restrain.
    expect(await sqlstateOf(owner, update, employeeId)).toBe('AP001');
    expect(await sqlstateOf(owner, remove, employeeId)).toBe('AP001');

    // And after four refused statements the row is still exactly what was appended.
    const rows = await readSalaryRows(employeeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount_minor).toBe('2500000');
  });

  it('exposes NO update or delete over salary_record on the port', async () => {
    const repository = createEmployeeRepository();

    const methods = Object.keys(repository);
    expect(methods.filter((method) => /delete|remove|destroy/i.test(method))).toEqual([]);
    // Two salary-touching methods, and both of them APPEND: the batch funnel CAP-1 writes through
    // and CAP-3's single-record sibling. No update, no delete, no second write path.
    expect(methods.filter((method) => /salar/i.test(method)).sort()).toEqual([
      'appendSalaryRecord',
      'createEmployeesWithSalaries',
    ]);
  });
});
