// CAP-7 gender-gap read against a REAL disposable PostgreSQL 18 (AD-24) — never a mock.
//
// What is proven here is what a fake repository CANNOT prove:
//
//   1. `findGenderGapPopulation` GROUPS BY THE EXACT TRIPLE in-process (AD-2): an employee sharing
//      the level and country but NOT the role is in a DIFFERENT group and is absent from the
//      population. The `where` is the triple alone; gender is carried but is never part of identity.
//   2. It carries each employee's `gender` off the real column, and resolves labels and the currency
//      format WITHOUT an `is_active` filter (AD-16): a group holding a RETIRED currency still has a
//      nameable group and a computable statistic.
//   3. `getGenderGap` computes the per-gender medians and the AD-17 gap IN TYPESCRIPT (Law 2) over
//      the real current salaries: at `asOf` = today a 5-men/5-women group answers with both medians
//      as `BoundaryMoney` decimal strings and a signed one-decimal gap.
//   4. The as-of date really filters the POPULATION per gender: at a past `asOf` a woman whose only
//      salary is not yet effective drops out, the female count crosses below five, and `getGenderGap`
//      REFUSES with `insufficient-gender` naming BOTH counts — the count recomputed in TypeScript
//      over real rows, never a `COUNT` query.
//
// ORDER-INDEPENDENCE and RE-RUNNABILITY: every test creates and asserts only its own fixtures,
// scoped by a per-run suffix, and finds its own group by its triple. Nothing counts rows globally,
// and `salary_record` rows CANNOT BE DELETED — every run leaves its rows behind by design, and the
// suite is re-runnable against the same database.
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
import { getGenderGap, type GenderGapDeps } from '@/application/use-cases/gender-gap';
import {
  recordSalaryChange,
  type RecordSalaryChangeDeps,
} from '@/application/use-cases/record-salary-change';
import type { Gender } from '@/domain/employee-fields';
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
const ROLE = `gg-role-${suffix}`;
const OTHER_ROLE = `gg-role-other-${suffix}`;
const LEVEL = `gg-level-${suffix}`;
const COUNTRY = `GG${suffix}`.toUpperCase().slice(0, 10);
const CURRENCY = `XG${suffix}`.toUpperCase().slice(0, 10);

// `level.rank` is UNIQUE, a PostgreSQL `int`, and this suite cannot clean up after itself — so it
// draws from a band NO sibling integration file uses. reference-data sits below ~2_003_000_000,
// salary-records holds 2_010_000_000..2_016_000_000, salary-timeline 2_020_000_000..2_026_000_000,
// peer-comparison 2_030_000_000..2_036_000_000, outliers 2_040_000_000..2_045_999_999,
// import-employees 2_100_000_000..2_140_000_000, and employees 2_141_000_000..2_147_000_000. THIS
// band is 2_050_000_000..2_055_999_999: the free gap above outliers and below import-employees,
// overlapping none, and its highest possible value (2_055_999_999) clears the `int` ceiling of
// 2_147_483_647. The full-width draw keeps birthday collisions implausible.
const RANK_BAND_START = 2_050_000_000;
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

function gapDeps(): GenderGapDeps {
  return { repository: createEmployeeRepository() };
}

/** Create an employee through the real use-case and return the id, failing loudly if rejected. */
async function createFixtureEmployee(
  name: string,
  roleCode: string,
  gender: Gender,
  hireDate: string,
): Promise<string> {
  const result = await createEmployee(employeeDeps(), {
    name,
    roleCode,
    levelCode: LEVEL,
    countryCode: COUNTRY,
    gender,
    hireDate,
  });
  if (result.kind !== 'created') {
    throw new Error(`fixture create was rejected: ${JSON.stringify(result)}`);
  }
  return result.employeeId;
}

/** Append one salary record through the real use-case, failing loudly if rejected. */
async function appendFixtureRecord(
  employeeId: string,
  effectiveFrom: string,
  amountMinor: string,
): Promise<void> {
  const result = await recordSalaryChange(
    salaryDeps(),
    employeeId,
    { effectiveFrom, amountMinor, currency: CURRENCY },
    TODAY,
  );
  if (result.kind !== 'recorded') {
    throw new Error(`fixture append was rejected: ${JSON.stringify(result)}`);
  }
}

const HIRE_DATE = '2021-06-01';
const W5_HIRE_DATE = '2025-01-01';

const MALE_SALARY = '2000000'; // 5 men → male median 2_000_000
const FEMALE_SALARY = '1840000'; // 5 women → female median 1_840_000; gap = 8.0%

// A 5-men/5-women peer group in the (ROLE, LEVEL, COUNTRY) triple, plus an outsider in OTHER_ROLE.
// W5's only salary is dated 2025-01-01, so a 2023 as-of drops her and the female count falls to four.
let subjectId: string; // M1 — the entry-point employee (group selector only)
let w5Id: string; // the woman who drops out at a past as-of
let outsiderId: string; // different role → different triple

beforeAll(async () => {
  await owner.query(
    `INSERT INTO currency (code, name, minor_unit_exponent, symbol, grouping_style)
     VALUES ($1, 'Gender Gap Test Currency', 2, '¤', 'WESTERN')`,
    [CURRENCY],
  );
  await owner.query(
    "INSERT INTO country (code, name, currency_code) VALUES ($1, 'Gapland', $2)",
    [COUNTRY, CURRENCY],
  );
  await owner.query('INSERT INTO role (code, name) VALUES ($1, $2), ($3, $4)', [
    ROLE,
    'Gender Gap Role',
    OTHER_ROLE,
    'Other Gender Gap Role',
  ]);
  await owner.query('INSERT INTO level (code, name, rank) VALUES ($1, $2, $3)', [
    LEVEL,
    'Gender Gap Level',
    fixtureRank,
  ]);

  // Five men on the male salary. All reference rows are ACTIVE at creation (the create use-case
  // re-checks activity in-transaction); the currency + country are retired AFTERWARD below.
  subjectId = await createFixtureEmployee(`M1 ${suffix}`, ROLE, 'MALE', HIRE_DATE);
  await appendFixtureRecord(subjectId, HIRE_DATE, MALE_SALARY);
  for (let index = 2; index <= 5; index += 1) {
    const manId = await createFixtureEmployee(`M${String(index)} ${suffix}`, ROLE, 'MALE', HIRE_DATE);
    await appendFixtureRecord(manId, HIRE_DATE, MALE_SALARY);
  }

  // Four women in force since 2021, plus W5 whose only salary is dated 2025-01-01 — in force today
  // (making five women), but NOT at a 2023 as-of, when she drops out and the group falls to four.
  for (let index = 1; index <= 4; index += 1) {
    const womanId = await createFixtureEmployee(`W${String(index)} ${suffix}`, ROLE, 'FEMALE', HIRE_DATE);
    await appendFixtureRecord(womanId, HIRE_DATE, FEMALE_SALARY);
  }
  w5Id = await createFixtureEmployee(`W5 ${suffix}`, ROLE, 'FEMALE', W5_HIRE_DATE);
  await appendFixtureRecord(w5Id, W5_HIRE_DATE, FEMALE_SALARY);

  // The outsider shares the LEVEL and COUNTRY but NOT the role — a different triple, so it must be
  // absent from the group's population.
  outsiderId = await createFixtureEmployee(`Outsider ${suffix}`, OTHER_ROLE, 'MALE', HIRE_DATE);
  await appendFixtureRecord(outsiderId, HIRE_DATE, MALE_SALARY);

  // Retire the currency AND its country AFTER every write. `is_active` gates pickability for NEW
  // writes; it must not hide the statistics or labels of employees who already hold them (AD-16),
  // which the reads below prove. The country is retired ALONGSIDE the currency so the product
  // invariant "an active country resolves to an active currency" is never left violated.
  await owner.query('UPDATE currency SET is_active = false WHERE code = $1', [CURRENCY]);
  await owner.query('UPDATE country SET is_active = false WHERE code = $1', [COUNTRY]);
});

afterAll(async () => {
  // No row cleanup, and there CANNOT be any: `salary_record` admits no DELETE. Every fixture is
  // run-scoped, and the suite is re-runnable.
  await Promise.all([owner.end(), app.end()]);
});

describe('findGenderGapPopulation groups by the exact triple, carries gender, is_active-inclusive', () => {
  it('returns exactly the ten in-triple employees with their gender, excluding the different-role outsider', async () => {
    const population = await createEmployeeRepository().findGenderGapPopulation({
      roleCode: ROLE,
      levelCode: LEVEL,
      countryCode: COUNTRY,
    });

    expect(population).not.toBeNull();
    if (population === null) return;

    // Grouped by the EXACT triple: the outsider (OTHER_ROLE) is not in this population.
    const ids = population.candidates.map((candidate) => candidate.employeeId);
    expect(population.candidates).toHaveLength(10);
    expect(ids).toContain(subjectId);
    expect(ids).not.toContain(outsiderId);

    // Gender is carried off the real column, per candidate.
    const genders = new Map(population.candidates.map((candidate) => [candidate.employeeId, candidate.gender]));
    expect(genders.get(subjectId)).toBe('MALE');
    expect(genders.get(w5Id)).toBe('FEMALE');
    const maleCount = [...genders.values()].filter((gender) => gender === 'MALE').length;
    const femaleCount = [...genders.values()].filter((gender) => gender === 'FEMALE').length;
    expect(maleCount).toBe(5);
    expect(femaleCount).toBe(5);

    // Labels resolve, and the currency format resolves DESPITE the currency being retired (AD-16).
    expect(population.roleName).toBe('Gender Gap Role');
    expect(population.levelLabel).toBe('Gender Gap Level');
    expect(population.countryName).toBe('Gapland');
    expect(population.currencyFormat.code).toBe(CURRENCY);
    expect(population.currencyFormat.minorUnitExponent).toBe(2);
  });
});

describe('getGenderGap over real rows, at asOf = today (median/gap in TS, Law 2)', () => {
  it('answers a 5-men/5-women group with both TS-computed medians and the signed 8.0% gap', async () => {
    const result = await getGenderGap(gapDeps(), subjectId, TODAY);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') {
      throw new Error(`expected an answer, got ${JSON.stringify(result)}`);
    }

    expect(result.gap.maleN).toBe(5);
    expect(result.gap.femaleN).toBe(5);
    expect(result.gap.currency).toBe(CURRENCY);
    // Medians computed in TypeScript over the real current salaries, crossing as decimal strings.
    expect(result.gap.maleMedian).toEqual({ amountMinor: MALE_SALARY, currency: CURRENCY });
    expect(result.gap.femaleMedian).toEqual({ amountMinor: FEMALE_SALARY, currency: CURRENCY });
    expect(typeof result.gap.maleMedian.amountMinor).toBe('string');
    // (2_000_000 - 1_840_000) / 2_000_000 × 100 = 8.0%, male median the denominator, men higher.
    expect(result.gap.gapPct).toBe('8.0');
    expect(result.gap.peerGroup.roleCode).toBe(ROLE);
    expect(result.gap.peerGroup.countryName).toBe('Gapland');
  });
});

describe('the as-of date filters the population per gender against real rows', () => {
  it('drops the not-yet-effective W5 at a 2023 asOf, crossing the female count below five into a refusal', async () => {
    // W5's only salary is dated 2025-01-01, so at 2023-01-01 she is outside the population — the
    // female count is four, and the read refuses with insufficient-gender naming BOTH counts.
    const pastAsOf: PlainDate = { year: 2023, month: 1, day: 1 };

    const result = await getGenderGap(gapDeps(), subjectId, pastAsOf);

    expect(result.kind).toBe('refusal');
    if (result.kind !== 'refusal') {
      throw new Error(`expected a refusal, got ${JSON.stringify(result)}`);
    }
    expect(result.refusal.reason).toBe('insufficient-gender');
    expect(result.refusal.counts).toEqual({ male: 5, female: 4 });
    expect(result.refusal.shortGender).toBe('FEMALE');
    // The refusal names both counts and the short gender in its ONE verdict sentence.
    expect(result.refusal.verdict).toContain('5 men and 4 women');
    expect(result.refusal.verdict).toContain('Too few women.');
  });
});
