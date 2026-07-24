// CAP-10 overdue-for-review read against a REAL disposable PostgreSQL 18 (AD-24) — never a mock.
//
// What is proven here is what a fake repository CANNOT prove:
//
//   1. `findOverduePopulation` returns the ORG-WIDE candidate set UNGROUPED and as-of-UNFILTERED,
//      each employee carrying their id, name, and whole salary history with real `Money`; the cutoff,
//      membership, the strictly-earlier judgement, and the ordering are computed in TypeScript by the
//      domain (AD-22 / AD-16 / AD-8) — no `WHERE`/`ORDER BY`/`COUNT` in the SQL.
//   2. A HIRE-ONLY employee whose hire predates the cutoff surfaces as OVERDUE (a hire record is a
//      salary record, AD-22) — the finding CAP-10 exists to surface.
//   3. An employee whose CURRENT record is EXACTLY on the cutoff is NOT overdue (strictly-earlier
//      only), even against a real same-day-appended (greater-`seq`) record.
//   4. A recently-changed employee whose current record post-dates the cutoff is NOT overdue —
//      overdue is judged on the current record (greatest `(effective_from, seq) ≤ asOf`), not the
//      oldest hire on file.
//   5. The overdue list is ordered oldest record first — proof the ordering is the domain's, since the
//      SQL returns rows in no guaranteed order.
//   6. Each row's salary crosses as `BoundaryMoney` (decimal-string minor units + its own currency).
//
// ISOLATION (critical — shared, append-only Postgres). `getOverdue` folds the WHOLE database, so its
// list is a function of every suite's rows and cannot be asserted globally. This suite therefore
// filters the org-wide result down to its OWN suffix-scoped employee ids for every membership /
// ordering assertion, and asserts the `cutoff` (a pure function of `asOf` + period, global-safe)
// directly. It NEVER truncates/deletes (`salary_record` is append-only) and NEVER mutates `settings`.
import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEmployeeRepository } from '@/adapters/db/employee-repository';
import { createUuidV7Generator } from '@/adapters/id';
import {
  createEmployee,
  type EmployeeUseCaseDeps,
} from '@/application/use-cases/employees';
import { getOverdue, type OverdueDeps } from '@/application/use-cases/overdue';
import {
  recordSalaryChange,
  type RecordSalaryChangeDeps,
} from '@/application/use-cases/record-salary-change';
import type { OverduePeriod } from '@/domain/overdue';
import type { PlainDate } from '@/domain/plain-date';

const OWNER_URL = process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL_APP;

if (!OWNER_URL || !APP_URL) {
  throw new Error(
    'DATABASE_URL and DATABASE_URL_APP must be set — point them at a disposable PostgreSQL 18.',
  );
}

const owner = new Pool({ connectionString: OWNER_URL });
const app = new Pool({ connectionString: APP_URL });

// Per-run fixtures — the suite plants its own taxonomy and leans on no seeded reference row.
const suffix = randomUUID().slice(0, 8);
const code = (prefix: string): string => `${prefix}${suffix}`.toUpperCase().slice(0, 10);
const ROLE = code('OVROLE');
const LEVEL = code('OVLV');
const CUR = code('OV');
const COUNTRY = code('OVCO');

// `level.rank` is UNIQUE and this suite cannot clean up after itself, so it draws from a band NO
// sibling integration file uses — the free gap between payroll-totals (…2_069_999_999) and
// import-employees (2_100_000_000), whose ceiling clears the `int` max (2_147_483_647).
const RANK_BAND_START = 2_070_000_000;
const RANK_BAND_WIDTH = 6_000_000;
const RANK = RANK_BAND_START + (parseInt(suffix, 16) % RANK_BAND_WIDTH);

// A FIXED past as-of every run shares, so the derived cutoff is stable and the suite is re-runnable.
// period 24 months ⇒ cutoff = 16 Jul 2024. Every fixture date below is in the PAST relative to a real
// today, so the append funnel (which rejects future-dating) accepts them all.
const AS_OF: PlainDate = { year: 2026, month: 7, day: 16 };
const PERIOD: OverduePeriod = { kind: 'months', months: 24 };
const CUTOFF: PlainDate = { year: 2024, month: 7, day: 16 };

// TODAY passed inward as the write funnel's `today` (Law 6 / AD-11). Read ONCE so a run straddling
// UTC midnight cannot make two assertions disagree. A fixed calendar day past every fixture date.
const TODAY: PlainDate = { year: 2026, month: 7, day: 24 };

function employeeDeps(): EmployeeUseCaseDeps {
  return { repository: createEmployeeRepository(), idGenerator: createUuidV7Generator() };
}

function salaryDeps(): RecordSalaryChangeDeps {
  return { repository: createEmployeeRepository(), idGenerator: createUuidV7Generator() };
}

function overdueDeps(): OverdueDeps {
  return { repository: createEmployeeRepository() };
}

async function createFixtureEmployee(name: string, hireDate: string): Promise<string> {
  const result = await createEmployee(employeeDeps(), {
    name,
    roleCode: ROLE,
    levelCode: LEVEL,
    countryCode: COUNTRY,
    gender: 'MALE',
    hireDate,
  });
  if (result.kind !== 'created') {
    throw new Error(`fixture create was rejected: ${JSON.stringify(result)}`);
  }
  return result.employeeId;
}

async function appendFixtureRecord(
  employeeId: string,
  effectiveFrom: string,
  amountMinor: string,
): Promise<void> {
  const result = await recordSalaryChange(
    salaryDeps(),
    employeeId,
    { effectiveFrom, amountMinor, currency: CUR },
    TODAY,
  );
  if (result.kind !== 'recorded') {
    throw new Error(`fixture append was rejected: ${JSON.stringify(result)}`);
  }
}

let veteranId: string; // hire 2015, no later change -> OVERDUE, oldest
let hireOnlyId: string; // hire 2019, no later change -> OVERDUE
let recentId: string; // hire 2019 but raised 2025 -> current record after cutoff -> NOT overdue
let onCutoffId: string; // current record EXACTLY on the cutoff -> NOT overdue (strictly-earlier)

beforeAll(async () => {
  await owner.query(
    "INSERT INTO currency (code, name, minor_unit_exponent, symbol, grouping_style) VALUES ($1, 'Overdue Test Currency', 2, '¤', 'WESTERN')",
    [CUR],
  );
  await owner.query('INSERT INTO country (code, name, currency_code) VALUES ($1, $2, $3)', [
    COUNTRY,
    'Overdueland',
    CUR,
  ]);
  await owner.query("INSERT INTO role (code, name) VALUES ($1, 'Overdue Test Role')", [ROLE]);
  await owner.query('INSERT INTO level (code, name, rank) VALUES ($1, $2, $3)', [
    LEVEL,
    'Overdue Test Level',
    RANK,
  ]);

  // Veteran: hire-only, 2015 — the oldest overdue record, must sort FIRST among this suite's rows.
  veteranId = await createFixtureEmployee(`VET ${suffix}`, '2015-03-01');
  await appendFixtureRecord(veteranId, '2015-03-01', '40000');

  // Hire-only: 2019, no later change — a hire record IS a salary record, so OVERDUE (AD-22).
  hireOnlyId = await createFixtureEmployee(`HIRE ${suffix}`, '2019-06-01');
  await appendFixtureRecord(hireOnlyId, '2019-06-01', '50000');

  // Recently changed: hired 2019 but RAISED 2025-06-01 (after the cutoff) — current record clears
  // them off the list even though their hire long predates it.
  recentId = await createFixtureEmployee(`RECENT ${suffix}`, '2019-06-01');
  await appendFixtureRecord(recentId, '2019-06-01', '50000');
  await appendFixtureRecord(recentId, '2025-06-01', '70000');

  // On cutoff: hired 2020, with a same-day-corrected current record dated EXACTLY on the cutoff
  // (16 Jul 2024). Strictly-earlier only, so this employee is NOT overdue — proven against a REAL
  // greater-`seq` same-day append.
  onCutoffId = await createFixtureEmployee(`ONCUT ${suffix}`, '2020-01-01');
  await appendFixtureRecord(onCutoffId, '2020-01-01', '30000');
  await appendFixtureRecord(onCutoffId, '2024-07-16', '35000'); // typo
  await appendFixtureRecord(onCutoffId, '2024-07-16', '36000'); // correction, greater seq, current
});

afterAll(async () => {
  // No row cleanup, and there CANNOT be any: `salary_record` admits no DELETE. Every fixture is
  // run-scoped, and the suite is re-runnable.
  await Promise.all([owner.end(), app.end()]);
});

describe('getOverdue over real rows: hire-only surfaces, on-cutoff and recently-changed do not', () => {
  it('lists this suite’s hire-only employees as overdue, oldest first, with boundary money', async () => {
    const result = await getOverdue(overdueDeps(), AS_OF, PERIOD);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') {
      throw new Error(`expected an answer, got ${JSON.stringify(result)}`);
    }

    // The cutoff is a pure function of asOf + period — global-safe to assert directly.
    expect(result.report.cutoff).toEqual(CUTOFF);
    expect(result.report.period).toEqual(PERIOD);
    expect(result.report.asOf).toEqual(AS_OF);

    // Scope to THIS suite's employees — the org-wide list also carries every other suite's rows.
    const mineIds = new Set([veteranId, hireOnlyId, recentId, onCutoffId]);
    const mine = result.report.rows.filter((row) => mineIds.has(row.employeeId));

    // Only the two hire-only employees are overdue, and they are ordered OLDEST record first
    // (2015 before 2019) — the ordering is the domain's, since the SQL returns rows unordered.
    expect(mine.map((row) => row.employeeId)).toEqual([veteranId, hireOnlyId]);

    const veteranRow = mine[0];
    expect(veteranRow).toEqual({
      employeeId: veteranId,
      name: `VET ${suffix}`,
      effectiveFrom: { year: 2015, month: 3, day: 1 },
      // BoundaryMoney: decimal-string minor units + the record's own currency (AD-4).
      salary: { amountMinor: '40000', currency: CUR },
    });

    // The recently-changed and on-cutoff employees are ABSENT — judged on the current record, and
    // on-cutoff is not strictly earlier.
    const mineIdList = mine.map((row) => row.employeeId);
    expect(mineIdList).not.toContain(recentId);
    expect(mineIdList).not.toContain(onCutoffId);
  });

  it('winds asOf back to before every hire: this suite contributes no overdue rows', async () => {
    // At 1 Jan 2014 nobody in this suite has a record in force yet — all four drop out of the
    // as-of population (AD-16), so none appears. Membership is recomputed from the passed asOf.
    const pastAsOf: PlainDate = { year: 2014, month: 1, day: 1 };

    const result = await getOverdue(overdueDeps(), pastAsOf, PERIOD);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') {
      throw new Error(`expected an answer, got ${JSON.stringify(result)}`);
    }
    const mineIds = new Set([veteranId, hireOnlyId, recentId, onCutoffId]);
    const mine = result.report.rows.filter((row) => mineIds.has(row.employeeId));
    expect(mine).toEqual([]);
    // The cutoff still derives from the passed asOf (2014 − 2y = 2012), never the wall clock.
    expect(result.report.cutoff).toEqual({ year: 2012, month: 1, day: 1 });
  });
});
