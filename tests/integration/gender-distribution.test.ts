// CAP-8 gender-distribution-by-level read against a REAL disposable PostgreSQL 18 (AD-24) — never a
// mock.
//
// What is proven here is what a fake repository CANNOT prove:
//
//   1. `findGenderDistributionPopulation` returns the ORG-WIDE candidate set UNGROUPED, and the
//      per-level gender counts are folded in TypeScript (AD-2): there is no `GROUP BY` and no
//      `COUNT` in the SQL — the domain groups by `levelCode` and counts people in process.
//   2. It carries each employee's `gender` off the real column, so the slice is real data.
//   3. It counts PEOPLE, not records: a man with a same-day correction (a SECOND record sharing an
//      `effectiveFrom`, appended second and so carrying a strictly greater BIGSERIAL `seq`) is ONE
//      increment in his level's male bucket, never two — AD-8's tie-break over a real sequence.
//   4. The as-of date really filters the POPULATION: at a past `asOf` a woman whose only salary is
//      not yet effective drops out and her level's female count falls — the count recomputed in
//      TypeScript over real rows, never a `COUNT` query.
//   5. The level axis is is_active-INCLUSIVE (AD-16): an INACTIVE level that still holds an
//      in-population employee STILL appears with its real count — is_active never hides existing
//      statistics.
//
// ORDER-INDEPENDENCE and RE-RUNNABILITY: every test creates and asserts ONLY on this run's own
// suffix-scoped `levelCode`s, found within the org-wide result. It NEVER asserts on global `totals`
// (the database is shared and `salary_record` rows CANNOT BE DELETED — every run leaves its rows
// behind by design, and the suite is re-runnable against the same database).
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
  getGenderDistribution,
  type GenderDistributionDeps,
} from '@/application/use-cases/gender-distribution';
import {
  recordSalaryChange,
  type RecordSalaryChangeDeps,
} from '@/application/use-cases/record-salary-change';
import type { Gender } from '@/domain/employee-fields';
import type { GenderLevelCount } from '@/domain/gender-distribution';
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
const ROLE = `gd-role-${suffix}`;
const LEVEL_A = `gd-level-a-${suffix}`; // active, holds 2 men + 1 woman
const LEVEL_B = `gd-level-b-${suffix}`; // active, holds the woman who drops out at a past as-of
const LEVEL_X = `gd-level-x-${suffix}`; // RETIRED after creation, still holds one man
const COUNTRY = `GD${suffix}`.toUpperCase().slice(0, 10);
const CURRENCY = `XD${suffix}`.toUpperCase().slice(0, 10);

// `level.rank` is UNIQUE, a PostgreSQL `int`, and this suite cannot clean up after itself — so it
// draws from a band NO sibling integration file uses. reference-data sits below ~2_003_000_000,
// salary-records holds 2_010_000_000..2_016_000_000, salary-timeline 2_020_000_000..2_026_000_000,
// peer-comparison 2_030_000_000..2_036_000_000, outliers 2_040_000_000..2_045_999_999, gender-gap
// 2_050_000_000..2_055_999_999, import-employees 2_100_000_000..2_140_000_000, and employees
// 2_141_000_000..2_147_000_000. THIS band is 2_060_000_000..2_065_999_999: the free gap above
// gender-gap and below import-employees, overlapping none, and its highest possible value
// (2_065_999_999) clears the `int` ceiling of 2_147_483_647. Three CONSECUTIVE ranks are drawn from a
// full-width base so the trio stays inside the band and birthday collisions stay implausible.
const RANK_BAND_START = 2_060_000_000;
const RANK_BAND_WIDTH = 6_000_000;
const rankBase = RANK_BAND_START + (parseInt(suffix, 16) % (RANK_BAND_WIDTH - 3));
const RANK_A = rankBase;
const RANK_B = rankBase + 1;
const RANK_X = rankBase + 2;

// TODAY comes from the clock port at this boundary and is passed INWARD (Law 6 / AD-11). Read ONCE
// so a run straddling UTC midnight cannot make two assertions disagree about what day it is.
const TODAY: PlainDate = systemClock.todayUtc();

function employeeDeps(): EmployeeUseCaseDeps {
  return { repository: createEmployeeRepository(), idGenerator: createUuidV7Generator() };
}

function salaryDeps(): RecordSalaryChangeDeps {
  return { repository: createEmployeeRepository(), idGenerator: createUuidV7Generator() };
}

function distributionDeps(): GenderDistributionDeps {
  return { repository: createEmployeeRepository() };
}

/** Create an employee through the real use-case and return the id, failing loudly if rejected. */
async function createFixtureEmployee(
  name: string,
  levelCode: string,
  gender: Gender,
  hireDate: string,
): Promise<string> {
  const result = await createEmployee(employeeDeps(), {
    name,
    roleCode: ROLE,
    levelCode,
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
const W_FUTURE_HIRE = '2025-01-01';
const TYPO = '9999999'; // if this were current, it would not change the COUNT — people are counted.
const SALARY = '2000000';

let m1Id: string; // LEVEL_A — carries the same-day correction (still ONE person)
let wFutureId: string; // LEVEL_B — her only salary is dated 2025-01-01, dropping out at a 2023 as-of
let mInactiveId: string; // LEVEL_X — a man on a level retired AFTER his creation

beforeAll(async () => {
  await owner.query(
    `INSERT INTO currency (code, name, minor_unit_exponent, symbol, grouping_style)
     VALUES ($1, 'Gender Distribution Test Currency', 2, '¤', 'WESTERN')`,
    [CURRENCY],
  );
  await owner.query(
    "INSERT INTO country (code, name, currency_code) VALUES ($1, 'Distributionland', $2)",
    [COUNTRY, CURRENCY],
  );
  await owner.query("INSERT INTO role (code, name) VALUES ($1, 'Gender Distribution Role')", [ROLE]);
  // All three levels ACTIVE at creation — the create use-case re-checks level activity
  // in-transaction, so LEVEL_X must be active when its employee is created and is retired AFTERWARD.
  await owner.query(
    'INSERT INTO level (code, name, rank) VALUES ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)',
    [
      LEVEL_A,
      'Distribution Level A',
      RANK_A,
      LEVEL_B,
      'Distribution Level B',
      RANK_B,
      LEVEL_X,
      'Distribution Level X (retired)',
      RANK_X,
    ],
  );

  // LEVEL_A: two men (M1 with a same-day correction) + one woman.
  m1Id = await createFixtureEmployee(`M1 ${suffix}`, LEVEL_A, 'MALE', HIRE_DATE);
  // M1's same-day correction: the typo first, then the fix on the SAME date — the fix carries the
  // strictly greater BIGSERIAL seq and is current (AD-8). It is a SECOND record for ONE person, and
  // must NOT make M1 count as two men.
  await appendFixtureRecord(m1Id, HIRE_DATE, TYPO);
  await appendFixtureRecord(m1Id, HIRE_DATE, SALARY);
  const m2Id = await createFixtureEmployee(`M2 ${suffix}`, LEVEL_A, 'MALE', HIRE_DATE);
  await appendFixtureRecord(m2Id, HIRE_DATE, SALARY);
  const wAId = await createFixtureEmployee(`WA ${suffix}`, LEVEL_A, 'FEMALE', HIRE_DATE);
  await appendFixtureRecord(wAId, HIRE_DATE, SALARY);

  // LEVEL_B: one woman whose only salary is dated 2025-01-01 — in force today, but NOT at a 2023
  // as-of, when she drops out and LEVEL_B's female count falls to zero.
  wFutureId = await createFixtureEmployee(`WB ${suffix}`, LEVEL_B, 'FEMALE', W_FUTURE_HIRE);
  await appendFixtureRecord(wFutureId, W_FUTURE_HIRE, SALARY);

  // LEVEL_X: one man, created while the level is active, then the level is RETIRED. He must still
  // appear in the distribution — is_active gates pickability for new writes, never existing
  // statistics (AD-16).
  mInactiveId = await createFixtureEmployee(`MX ${suffix}`, LEVEL_X, 'MALE', HIRE_DATE);
  await appendFixtureRecord(mInactiveId, HIRE_DATE, SALARY);

  await owner.query('UPDATE level SET is_active = false WHERE code = $1', [LEVEL_X]);
});

afterAll(async () => {
  // No row cleanup, and there CANNOT be any: `salary_record` admits no DELETE. Every fixture is
  // run-scoped, and the suite is re-runnable.
  await Promise.all([owner.end(), app.end()]);
});

/** This run's row for one of its own level codes, or `undefined` if the level was filtered out. */
function rowFor(
  levels: readonly GenderLevelCount[],
  levelCode: string,
): GenderLevelCount | undefined {
  return levels.find((row) => row.levelCode === levelCode);
}

describe('findGenderDistributionPopulation returns the org-wide set UNGROUPED, gender + level carried', () => {
  it('carries each fixture employee with their gender and levelCode, and the is_active-inclusive axis', async () => {
    const population = await createEmployeeRepository().findGenderDistributionPopulation();

    // The candidate set is UNGROUPED — individual employees, gender and level off the real columns.
    // The grouping and counting happen in the domain, not in SQL (AD-2): there is no GROUP BY here.
    const mine = population.candidates.filter(
      (candidate) =>
        candidate.levelCode === LEVEL_A ||
        candidate.levelCode === LEVEL_B ||
        candidate.levelCode === LEVEL_X,
    );
    // Five distinct PEOPLE across my levels — M1 (2 records), M2, WA, WB, MX = 5 people. M1 carries
    // two salary records but is ONE candidate: proof the read returns people, not records.
    const m1 = mine.filter((candidate) => candidate.levelCode === LEVEL_A && candidate.gender === 'MALE');
    expect(mine).toHaveLength(5);
    expect(m1).toHaveLength(2); // M1 + M2, each one candidate — M1's two records do not split him.
    const m1WithTwoRecords = m1.find((candidate) => candidate.salaryRecords.length === 2);
    expect(m1WithTwoRecords).toBeDefined();

    // The level axis is is_active-INCLUSIVE: the RETIRED LEVEL_X is present in the axis (AD-16).
    const axisCodes = population.levels.map((level) => level.levelCode);
    expect(axisCodes).toContain(LEVEL_A);
    expect(axisCodes).toContain(LEVEL_B);
    expect(axisCodes).toContain(LEVEL_X);
    const levelX = population.levels.find((level) => level.levelCode === LEVEL_X);
    expect(levelX?.isActive).toBe(false);
    // The axis is rank-ordered: my three levels appear in rank order relative to one another.
    const myAxis = axisCodes.filter((code) => code === LEVEL_A || code === LEVEL_B || code === LEVEL_X);
    expect(myAxis).toEqual([LEVEL_A, LEVEL_B, LEVEL_X]);
  });
});

describe('getGenderDistribution over real rows, at asOf = today (grouping + counts in TS, Law 2)', () => {
  it('counts PEOPLE not records, carries gender, and shows the RETIRED level with its real count', async () => {
    const result = await getGenderDistribution(distributionDeps(), TODAY);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') {
      throw new Error(`expected an answer, got ${JSON.stringify(result)}`);
    }
    const { levels } = result.distribution;

    // LEVEL_A: 2 men (M1's same-day correction does NOT double-count him) + 1 woman.
    expect(rowFor(levels, LEVEL_A)).toEqual({
      levelCode: LEVEL_A,
      levelLabel: 'Distribution Level A',
      maleN: 2,
      femaleN: 1,
      total: 3,
    });

    // LEVEL_B: the one woman is in force today.
    expect(rowFor(levels, LEVEL_B)).toEqual({
      levelCode: LEVEL_B,
      levelLabel: 'Distribution Level B',
      maleN: 0,
      femaleN: 1,
      total: 1,
    });

    // LEVEL_X is RETIRED but still holds an in-population man — it MUST appear with its real count
    // (is_active never hides existing statistics, AD-16).
    expect(rowFor(levels, LEVEL_X)).toEqual({
      levelCode: LEVEL_X,
      levelLabel: 'Distribution Level X (retired)',
      maleN: 1,
      femaleN: 0,
      total: 1,
    });
  });
});

describe('the as-of date filters the population against real rows (AD-16)', () => {
  it('drops the not-yet-effective woman at a 2023 asOf, lowering LEVEL_B female count to zero', async () => {
    // WB's only salary is dated 2025-01-01, so at 2023-01-01 she is outside the population. LEVEL_B
    // is ACTIVE, so it still appears — now at 0/0, its female count recomputed lower in TypeScript.
    const pastAsOf: PlainDate = { year: 2023, month: 1, day: 1 };

    const result = await getGenderDistribution(distributionDeps(), pastAsOf);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') {
      throw new Error(`expected an answer, got ${JSON.stringify(result)}`);
    }
    const { levels } = result.distribution;

    expect(rowFor(levels, LEVEL_B)).toEqual({
      levelCode: LEVEL_B,
      levelLabel: 'Distribution Level B',
      maleN: 0,
      femaleN: 0,
      total: 0,
    });

    // LEVEL_A's men were hired in 2021, so they remain in-population at the 2023 as-of — proof the
    // rewind drops only the not-yet-effective member, not the whole level.
    expect(rowFor(levels, LEVEL_A)?.maleN).toBe(2);
  });
});
