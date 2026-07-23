// CAP-5 peer-comparison READ against a REAL disposable PostgreSQL 18 (AD-24) — never a mock.
//
// What is proven here is what a fake repository CANNOT prove:
//
//   1. `findPeerPopulation` GROUPS BY THE EXACT TRIPLE: an employee sharing the level and country
//      but NOT the role is absent from the population — the `@@index([roleCode, levelCode,
//      countryCode])` predicate against rows the database actually stored.
//   2. It resolves labels and the currency format WITHOUT an `is_active` filter (AD-16): a subject
//      holding a RETIRED currency still has a nameable group and a computable statistic. If the read
//      filtered `is_active`, the answer would collapse to `unavailable`; it does not.
//   3. The as-of date really filters the POPULATION: at a past `asOf` a peer whose only salary is
//      not yet effective drops out, the group crosses below five, and the comparison refuses — the
//      count recomputed in TypeScript over real rows, never a `COUNT` query.
//   4. A same-day correction (a SECOND record sharing an `effectiveFrom`, appended second and so
//      carrying a strictly greater BIGSERIAL `seq`) is the current salary that enters the statistic —
//      the whole substance of AD-8's tie-break, which only a real sequence can demonstrate.
//   5. The median, spread, and distance are computed IN TYPESCRIPT (Law 2) over the real current
//      salaries, and the money crosses as `BoundaryMoney` decimal strings in the group's currency.
//
// ORDER-INDEPENDENCE and RE-RUNNABILITY: every test creates and asserts only its own fixtures,
// scoped by a per-run suffix. Nothing counts rows globally, and `salary_record` rows CANNOT BE
// DELETED — every run leaves its rows behind by design, and the suite is re-runnable against the
// same database.
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
  getPeerComparison,
  type PeerComparisonDeps,
} from '@/application/use-cases/peer-comparison';
import {
  recordSalaryChange,
  type RecordSalaryChangeDeps,
} from '@/application/use-cases/record-salary-change';
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

// Per-run fixtures. The suite plants its own taxonomy and must not lean on any seeded reference row.
const suffix = randomUUID().slice(0, 8);
const ROLE = `pc-role-${suffix}`;
const OTHER_ROLE = `pc-role-other-${suffix}`;
const LEVEL = `pc-level-${suffix}`;
const COUNTRY = `PC${suffix}`.toUpperCase().slice(0, 10);
const CURRENCY = `XP${suffix}`.toUpperCase().slice(0, 10);

// `level.rank` is UNIQUE, a PostgreSQL `int`, and this suite cannot clean up after itself — so it
// draws from a band no sibling integration file uses. reference-data sits below ~2_003_000_000,
// salary-records holds 2_010_000_000..2_016_000_000, salary-timeline 2_020_000_000..2_026_000_000,
// import-employees 2_100_000_000..2_140_000_000, and employees 2_141_000_000..2_147_000_000. This
// band is 2_030_000_000..2_036_000_000: in the free gap above salary-timeline and below
// import-employees, overlapping none, and its highest possible value (2_035_999_999) clears the
// `int` ceiling of 2_147_483_647. The full-width draw keeps birthday collisions implausible.
const RANK_BAND_START = 2_030_000_000;
const RANK_BAND_WIDTH = 6_000_000;
const fixtureRank = RANK_BAND_START + (parseInt(suffix, 16) % RANK_BAND_WIDTH);

// TODAY comes from the clock port at this boundary and is passed INWARD (Law 6 / AD-11). Read ONCE
// so a run straddling UTC midnight cannot make two assertions disagree about what day it is.
const TODAY: PlainDate = systemClock.todayUtc();

function employeeDeps(): EmployeeUseCaseDeps {
  return { repository: createEmployeeRepository(), idGenerator: createUuidV7Generator() };
}

function salaryDeps(): RecordSalaryChangeDeps {
  return { repository: createEmployeeRepository(), idGenerator: createUuidV7Generator() };
}

function comparisonDeps(): PeerComparisonDeps {
  return { repository: createEmployeeRepository() };
}

/** Create an employee through the real use-case and return the id, failing loudly if rejected. */
async function createFixtureEmployee(
  name: string,
  roleCode: string,
  hireDate: string,
): Promise<string> {
  const result = await createEmployee(employeeDeps(), {
    name,
    roleCode,
    levelCode: LEVEL,
    countryCode: COUNTRY,
    gender: 'FEMALE',
    hireDate,
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

const HIRE_DATE = '2021-06-01';
const E5_HIRE_DATE = '2025-01-01';

// One five-person peer group in the (ROLE, LEVEL, COUNTRY) triple, plus an outsider in OTHER_ROLE.
// E1 carries a same-day correction; E5's only salary is dated 2025-01-01 so a 2023 as-of drops it.
let subjectId: string; // E1 — carries the same-day correction
let outsiderId: string; // different role → different triple

const E1_TYPO = '9999999';
const E1_FIX = '2000000';
const E2_AMOUNT = '2200000';
const E3_AMOUNT = '2400000';
const E4_AMOUNT = '2600000';
const E5_AMOUNT = '2800000';

beforeAll(async () => {
  await owner.query(
    `INSERT INTO currency (code, name, minor_unit_exponent, symbol, grouping_style)
     VALUES ($1, 'Peer Test Currency', 2, '¤', 'WESTERN')`,
    [CURRENCY],
  );
  await owner.query(
    "INSERT INTO country (code, name, currency_code) VALUES ($1, 'Peerland', $2)",
    [COUNTRY, CURRENCY],
  );
  await owner.query('INSERT INTO role (code, name) VALUES ($1, $2), ($3, $4)', [
    ROLE,
    'Peer Role',
    OTHER_ROLE,
    'Other Peer Role',
  ]);
  await owner.query('INSERT INTO level (code, name, rank) VALUES ($1, $2, $3)', [
    LEVEL,
    'Peer Level',
    fixtureRank,
  ]);

  // Five in-triple employees. All reference rows are ACTIVE at creation (the create use-case
  // re-checks activity in-transaction), and the currency is retired AFTERWARD below.
  subjectId = await createFixtureEmployee(`E1 ${suffix}`, ROLE, HIRE_DATE);
  // E1's same-day correction: the typo first, then the fix on the SAME date — the fix carries the
  // strictly greater BIGSERIAL seq and is the current salary (AD-8).
  await appendFixtureRecord(subjectId, HIRE_DATE, E1_TYPO);
  await appendFixtureRecord(subjectId, HIRE_DATE, E1_FIX);

  const e2 = await createFixtureEmployee(`E2 ${suffix}`, ROLE, HIRE_DATE);
  await appendFixtureRecord(e2, HIRE_DATE, E2_AMOUNT);
  const e3 = await createFixtureEmployee(`E3 ${suffix}`, ROLE, HIRE_DATE);
  await appendFixtureRecord(e3, HIRE_DATE, E3_AMOUNT);
  const e4 = await createFixtureEmployee(`E4 ${suffix}`, ROLE, HIRE_DATE);
  await appendFixtureRecord(e4, HIRE_DATE, E4_AMOUNT);
  // E5's only salary is dated 2025-01-01 — in force today, but NOT at a 2023 as-of.
  const e5 = await createFixtureEmployee(`E5 ${suffix}`, ROLE, E5_HIRE_DATE);
  await appendFixtureRecord(e5, E5_HIRE_DATE, E5_AMOUNT);

  // The outsider shares the LEVEL and COUNTRY but NOT the role — a different triple, so it must be
  // absent from E1's peer population.
  outsiderId = await createFixtureEmployee(`Outsider ${suffix}`, OTHER_ROLE, HIRE_DATE);
  await appendFixtureRecord(outsiderId, HIRE_DATE, '3000000');

  // Retire the currency AND its country AFTER every write. `is_active` gates pickability for NEW
  // writes; it must not hide the statistics or labels of employees who already hold them (AD-16),
  // which the reads below prove. The country is retired ALONGSIDE the currency so the product
  // invariant "an active country resolves to an active currency" (asserted by the form-options
  // integration suite over global state) is never left violated by these run-scoped, undeletable
  // fixtures — a country on a retired currency is itself retired.
  await owner.query('UPDATE currency SET is_active = false WHERE code = $1', [CURRENCY]);
  await owner.query('UPDATE country SET is_active = false WHERE code = $1', [COUNTRY]);
});

afterAll(async () => {
  // No row cleanup, and there CANNOT be any: `salary_record` admits no DELETE. Every fixture is
  // run-scoped, and the suite is re-runnable.
  await Promise.all([owner.end(), app.end()]);
});

describe('findPeerPopulation groups by the exact triple, is_active-inclusive', () => {
  it('returns exactly the five in-triple employees, excluding the different-role outsider', async () => {
    const population = await createEmployeeRepository().findPeerPopulation({
      roleCode: ROLE,
      levelCode: LEVEL,
      countryCode: COUNTRY,
    });

    expect(population).not.toBeNull();
    if (population === null) return;

    // Grouped by the EXACT triple: the outsider (OTHER_ROLE) is not here.
    const ids = population.candidates.map((candidate) => candidate.employeeId).sort();
    expect(ids).toContain(subjectId);
    expect(ids).not.toContain(outsiderId);
    expect(population.candidates).toHaveLength(5);

    // Labels resolve, and the currency format resolves DESPITE the currency being retired (AD-16).
    expect(population.roleName).toBe('Peer Role');
    expect(population.levelLabel).toBe('Peer Level');
    expect(population.countryName).toBe('Peerland');
    expect(population.currencyFormat.code).toBe(CURRENCY);
    expect(population.currencyFormat.minorUnitExponent).toBe(2);
  });
});

describe('getPeerComparison over real rows, at asOf = today', () => {
  it('answers with n=5, the median/spread computed in TS, and the same-day correction as the subject salary', async () => {
    const result = await getPeerComparison(comparisonDeps(), subjectId, TODAY);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') return;

    // The outsider is excluded — the group is the five in-triple employees.
    expect(result.comparison.n).toBe(5);
    expect(result.comparison.currency).toBe(CURRENCY);
    expect(result.comparison.peerGroup).toEqual({
      roleCode: ROLE,
      levelCode: LEVEL,
      countryCode: COUNTRY,
    });

    // The subject's CURRENT salary is the same-day correction (E1_FIX = 2_000_000), NOT the typo —
    // proven against a real BIGSERIAL seq. Money crosses as a decimal string in the group currency.
    expect(result.comparison.subjectSalary).toEqual({ amountMinor: E1_FIX, currency: CURRENCY });
    expect(typeof result.comparison.subjectSalary.amountMinor).toBe('string');

    // Currents [2_000_000, 2_200_000, 2_400_000, 2_600_000, 2_800_000] → median 2_400_000 (E3),
    // spread 2_000_000–2_800_000. Computed in TypeScript over the rows the database returned.
    expect(result.comparison.peerMedian).toEqual({ amountMinor: E3_AMOUNT, currency: CURRENCY });
    expect(result.comparison.spread).toEqual({
      min: { amountMinor: E1_FIX, currency: CURRENCY },
      max: { amountMinor: E5_AMOUNT, currency: CURRENCY },
    });

    // The subject 2_000_000 is below the 2_400_000 median — a negative signed distance and the ONE
    // verdict sentence, present on the answer.
    expect(result.comparison.distancePct.startsWith('-')).toBe(true);
    expect(typeof result.comparison.verdict).toBe('string');
    expect(result.comparison.verdict.length).toBeGreaterThan(0);
  });
});

describe('the as-of date filters the population against real rows', () => {
  it('drops the not-yet-effective peer at a 2023 asOf, crossing below five into a thin refusal', async () => {
    // E5's only salary is dated 2025-01-01, so at 2023-01-01 it is outside the population — the
    // group is four, and the comparison refuses out loud, naming the recomputed count.
    const pastAsOf: PlainDate = { year: 2023, month: 1, day: 1 };

    const result = await getPeerComparison(comparisonDeps(), subjectId, pastAsOf);

    expect(result.kind).toBe('refusal');
    if (result.kind !== 'refusal') return;
    expect(result.refusal.reason).toBe('thin-peer-group');
    if (result.refusal.reason !== 'thin-peer-group') return;
    expect(result.refusal.counts.n).toBe(4);
    expect(result.refusal.asOf).toEqual(pastAsOf);
  });
});

describe('an unknown employee id is not-found, never a throw', () => {
  it('answers not-found for a random UUID with no employee row', async () => {
    const missingId = createUuidV7Generator().next();

    await expect(getPeerComparison(comparisonDeps(), missingId, TODAY)).resolves.toEqual({
      kind: 'not-found',
    });
  });
});
