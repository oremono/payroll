// CAP-4 salary-timeline READ against a REAL disposable PostgreSQL 18 (AD-24) — never a mock.
//
// What is proven here is what a fake repository CANNOT prove:
//
//   1. The real adapter reads the whole append-only series back through ONE nested `findUnique`,
//      and `getSalaryTimeline` orders it newest-first with the ONE domain comparison (AD-8) — the
//      ordering proven against rows the database actually produced, with a real BIGSERIAL `seq`.
//   2. A same-day correction (a SECOND record sharing an `effectiveFrom`, appended second and so
//      carrying a strictly greater `seq`) is the HEAD of the timeline and the current record — the
//      whole substance of AD-8's tie-break, which only a real sequence can demonstrate.
//   3. The as-of date really filters: at a PAST `asOf` the later records vanish and the current
//      record is re-marked to the newest remaining, computed in TypeScript against real rows.
//   4. `not-found` (an unknown employee) is distinct from an empty history, and the read answers it
//      without throwing — the read-null idiom the adapter shares with `findEmployeeById`.
//   5. Money crosses as `BoundaryMoney` (a decimal string) carrying the record's OWN currency, and
//      `seq` never crosses at all.
//
// ORDER-INDEPENDENCE and RE-RUNNABILITY: every test creates and asserts only its own fixtures,
// scoped by a per-run suffix. Nothing here counts rows globally and nothing depends on another test
// having run — which matters more in this family than anywhere else, because `salary_record` rows
// CANNOT BE DELETED. Every run leaves its rows behind by design, and the suite is run twice in a row
// against the same database as a stated criterion.
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
import {
  getSalaryTimeline,
  type SalaryTimelineDeps,
} from '@/application/use-cases/salary-timeline';
import { type PlainDate } from '@/domain/plain-date';

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
const ROLE = `tl-role-${suffix}`;
const LEVEL = `tl-level-${suffix}`;
const COUNTRY = `TL${suffix}`.toUpperCase().slice(0, 10);
const CURRENCY = `XT${suffix}`.toUpperCase().slice(0, 10);

// `level.rank` is UNIQUE, a PostgreSQL `int`, and this suite cannot clean up after itself — so it
// draws from a band no sibling integration file uses. reference-data sits below ~2_003_000_000,
// salary-records holds 2_010_000_000..2_016_000_000, import-employees 2_100_000_000..2_140_000_000,
// and employees 2_141_000_000..2_147_000_000. This band is 2_020_000_000..2_026_000_000: in the
// free gap above salary-records and below import-employees, overlapping none, and its highest
// possible value (2_025_999_999) clears the `int` ceiling of 2_147_483_647 by 121_483_648. The
// full-width draw keeps birthday collisions implausible across accumulated runs.
const RANK_BAND_START = 2_020_000_000;
const RANK_BAND_WIDTH = 6_000_000;
const fixtureRank = RANK_BAND_START + (parseInt(suffix, 16) % RANK_BAND_WIDTH);

const HIRE_DATE = '2021-06-01';
const HIRE_AMOUNT = '2000000';
const RAISE_DATE = '2023-04-01';
const RAISE_AMOUNT = '2400000';
const CORRECTION_AMOUNT = '2500000';

// TODAY comes from the clock port at this boundary and is passed INWARD, exactly as the Server
// Component will (Law 6 / AD-11). Read ONCE for the whole file so a run straddling UTC midnight
// cannot make two assertions disagree about what day it is.
const TODAY: PlainDate = systemClock.todayUtc();

function employeeDeps(): EmployeeUseCaseDeps {
  return { repository: createEmployeeRepository(), idGenerator: createUuidV7Generator() };
}

function salaryDeps(): RecordSalaryChangeDeps {
  return { repository: createEmployeeRepository(), idGenerator: createUuidV7Generator() };
}

function timelineDeps(): SalaryTimelineDeps {
  return { repository: createEmployeeRepository() };
}

/** Create an employee through the real use-case and return the id, failing loudly if rejected. */
async function createFixtureEmployee(name: string): Promise<string> {
  const result = await createEmployee(employeeDeps(), {
    name,
    roleCode: ROLE,
    levelCode: LEVEL,
    countryCode: COUNTRY,
    gender: 'FEMALE',
    hireDate: HIRE_DATE,
  });
  if (result.kind !== 'created') {
    throw new Error(`fixture create was rejected: ${JSON.stringify(result)}`);
  }
  return result.employeeId;
}

/** Append one salary record through the real use-case and return its id, failing loudly. */
async function appendFixtureRecord(
  employeeId: string,
  effectiveFrom: string,
  amountMinor: string,
): Promise<string> {
  const result = await recordSalaryChange(
    salaryDeps(),
    employeeId,
    { effectiveFrom, amountMinor, currency: CURRENCY },
    TODAY,
  );
  if (result.kind !== 'recorded') {
    throw new Error(`fixture append was rejected: ${JSON.stringify(result)}`);
  }
  return result.salaryRecordId;
}

/**
 * One employee with a hire record, a later change, and a SAME-DAY correction (appended after the
 * change, so it carries a strictly greater `seq`). Returns the three record ids in insert order.
 */
async function seedTimelineEmployee(name: string): Promise<{
  employeeId: string;
  hireId: string;
  raiseId: string;
  correctionId: string;
}> {
  const employeeId = await createFixtureEmployee(name);
  const hireId = await appendFixtureRecord(employeeId, HIRE_DATE, HIRE_AMOUNT);
  const raiseId = await appendFixtureRecord(employeeId, RAISE_DATE, RAISE_AMOUNT);
  // Same effective date as the raise, appended SECOND — a same-day correction. Its BIGSERIAL `seq`
  // is strictly greater, and that is the only key that says which of the two came second (AD-8).
  const correctionId = await appendFixtureRecord(employeeId, RAISE_DATE, CORRECTION_AMOUNT);
  return { employeeId, hireId, raiseId, correctionId };
}

beforeAll(async () => {
  await owner.query(
    `INSERT INTO currency (code, name, minor_unit_exponent, symbol, grouping_style)
     VALUES ($1, 'Timeline Test Currency', 2, '¤', 'WESTERN')`,
    [CURRENCY],
  );
  await owner.query(
    "INSERT INTO country (code, name, currency_code) VALUES ($1, 'Timelineland', $2)",
    [COUNTRY, CURRENCY],
  );
  await owner.query('INSERT INTO role (code, name) VALUES ($1, $2)', [ROLE, 'Timeline Role']);
  await owner.query('INSERT INTO level (code, name, rank) VALUES ($1, $2, $3)', [
    LEVEL,
    'Timeline Level',
    fixtureRank,
  ]);
});

afterAll(async () => {
  // No row cleanup, and there CANNOT be any: `salary_record` admits no DELETE. That is the
  // append-only invariant working as designed, and it is why every fixture above is run-scoped.
  await Promise.all([owner.end(), app.end()]);
});

describe('getSalaryTimeline at asOf = today', () => {
  it('returns every record newest-first with the same-day correction at the head and current', async () => {
    const { employeeId, hireId, raiseId, correctionId } =
      await seedTimelineEmployee(`Ada ${suffix}-today`);

    const result = await getSalaryTimeline(timelineDeps(), employeeId, TODAY);

    expect(result.kind).toBe('timeline');
    if (result.kind !== 'timeline') return;

    // Newest-first, with the greater-`seq` correction ahead of the raise it shares a date with.
    expect(result.timeline.records.map((row) => row.id)).toEqual([correctionId, raiseId, hireId]);
    // The current record is the ONE resolver's pick (AD-8) and the head of the list.
    expect(result.timeline.currentSalaryRecordId).toBe(correctionId);
    expect(result.timeline.currentSalaryRecordId).toBe(result.timeline.records[0]?.id);
    expect(result.timeline.asOf).toEqual(TODAY);
  });

  it('carries money as a BoundaryMoney decimal string with the record\'s own currency, and no seq', async () => {
    const { employeeId, correctionId } = await seedTimelineEmployee(`Ada ${suffix}-money`);

    const result = await getSalaryTimeline(timelineDeps(), employeeId, TODAY);

    expect(result.kind).toBe('timeline');
    if (result.kind !== 'timeline') return;

    const head = result.timeline.records[0];
    expect(head?.id).toBe(correctionId);
    // A decimal STRING, never a number or a bigint, carrying the record's own currency (AD-4/AD-6).
    expect(head?.salary).toEqual({ amountMinor: CORRECTION_AMOUNT, currency: CURRENCY });
    expect(typeof head?.salary.amountMinor).toBe('string');
    // `seq` never crosses the boundary.
    for (const row of result.timeline.records) {
      expect(row).not.toHaveProperty('seq');
    }
  });
});

describe('the as-of date filters the timeline against real rows', () => {
  it('hides the later records at a PAST asOf and re-marks the current record', async () => {
    const { employeeId, hireId } = await seedTimelineEmployee(`Ada ${suffix}-past`);

    // Before the raise/correction date (2023-04-01) but after the hire (2021-06-01).
    const pastAsOf: PlainDate = { year: 2022, month: 1, day: 1 };
    const result = await getSalaryTimeline(timelineDeps(), employeeId, pastAsOf);

    expect(result.kind).toBe('timeline');
    if (result.kind !== 'timeline') return;

    // Only the hire record remains, and it is the current one at this as-of.
    expect(result.timeline.records.map((row) => row.id)).toEqual([hireId]);
    expect(result.timeline.currentSalaryRecordId).toBe(hireId);
    expect(result.timeline.asOf).toEqual(pastAsOf);
  });

  it('returns no rows and a null current record when asOf precedes the hire', async () => {
    const { employeeId } = await seedTimelineEmployee(`Ada ${suffix}-before-hire`);

    const result = await getSalaryTimeline(timelineDeps(), employeeId, {
      year: 2020,
      month: 1,
      day: 1,
    });

    expect(result.kind).toBe('timeline');
    if (result.kind !== 'timeline') return;
    expect(result.timeline.records).toEqual([]);
    expect(result.timeline.currentSalaryRecordId).toBeNull();
  });
});

describe('an unknown or malformed employee id is not-found, never a throw', () => {
  it('answers not-found for a random UUID with no employee row', async () => {
    const missingId = createUuidV7Generator().next();

    await expect(getSalaryTimeline(timelineDeps(), missingId, TODAY)).resolves.toEqual({
      kind: 'not-found',
    });
  });

  it('answers not-found for a non-UUID id, via the isUuid guard', async () => {
    // `employee.id` is `@db.Uuid`, so a hand-edited URL segment that is not a UUID must answer
    // not-found rather than provoking a cast error.
    await expect(getSalaryTimeline(timelineDeps(), 'not-a-uuid', TODAY)).resolves.toEqual({
      kind: 'not-found',
    });
  });
});
