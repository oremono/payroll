// CAP-9 payroll-totals read against a REAL disposable PostgreSQL 18 (AD-24) — never a mock.
//
// What is proven here is what a fake repository CANNOT prove:
//
//   1. `findPayrollTotalsPopulation` returns the ORG-WIDE candidate set UNGROUPED, each employee
//      carrying their `countryCode` and whole salary history with real `Money`; the per-country
//      sums and headcounts are folded in TypeScript (AD-2) — no `SUM`/`GROUP BY`/`COUNT` in SQL.
//   2. It counts PEOPLE, not records: a person with a same-day correction (a SECOND record sharing
//      an `effectiveFrom`, appended second so carrying a strictly greater BIGSERIAL `seq`) contributes
//      ONE amount and counts once — AD-8's tie-break over a real sequence.
//   3. Per-country totals stay in LOCAL currency (never converted), read off the real column (AD-6).
//   4. The as-of date really filters the POPULATION: at a past `asOf` a not-yet-effective member
//      drops out and their country's total and `n` fall — recomputed in TypeScript, never a `COUNT`.
//   5. `findAllFxRates` decomposes the stored `Decimal(18,8)` into an EXACT rational
//      (`rateNumerator`/`rateDenominator = 10^8`) with no float, and the domain converts each country
//      total ONCE and sums — carrying `ratesUsed` + `pinnedOn` (AD-13).
//   6. A currency with no rate to the reporting currency yields a `missing-rate` refusal, while the
//      per-country totals still resolve — a refusal is a value, never an exception (AD-20).
//
// ISOLATION (critical — shared, append-only Postgres). `getPayrollTotals` folds the WHOLE database,
// so its org-wide figure is a function of every suite's rows and cannot be asserted globally. This
// suite therefore:
//   - asserts per-country ONLY on its own suffix-scoped countries (found within the org-wide result);
//   - proves the converted ANSWER + rate decomposition over its OWN rows fed through the domain (real
//     reads, real Decimal, scoped by suffix) — isolated and deterministic;
//   - proves the org-wide `missing-rate` refusal deterministically: ONLY this suite writes `fx_rate`,
//     so a deliberately-UNRATED fixture currency forces the refusal, its rated currencies are proven
//     ABSENT from `missingPairs` (they resolved), and the set's `pinnedOn` is this suite's own date.
// It NEVER truncates/deletes (`salary_record` is append-only) and NEVER mutates the shared `settings`.
import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { systemClock } from '@/adapters/clock';
import { createEmployeeRepository } from '@/adapters/db/employee-repository';
import { createFxRateRepository } from '@/adapters/db/fx-rate-repository';
import { createSettingsRepository } from '@/adapters/db/settings-repository';
import { createUuidV7Generator } from '@/adapters/id';
import {
  createEmployee,
  type EmployeeUseCaseDeps,
} from '@/application/use-cases/employees';
import {
  getPayrollTotals,
  type PayrollTotalsDeps,
} from '@/application/use-cases/payroll-totals';
import {
  recordSalaryChange,
  type RecordSalaryChangeDeps,
} from '@/application/use-cases/record-salary-change';
import { computePayrollTotals } from '@/domain/payroll-totals';
import { plainDateToIso, type PlainDate } from '@/domain/plain-date';

const OWNER_URL = process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL_APP;

if (!OWNER_URL || !APP_URL) {
  throw new Error(
    'DATABASE_URL and DATABASE_URL_APP must be set — point them at a disposable PostgreSQL 18.',
  );
}

const owner = new Pool({ connectionString: OWNER_URL });
const app = new Pool({ connectionString: APP_URL });

// Per-run fixtures — the suite plants its own taxonomy and leans on no seeded reference row (only
// the seeded, shared `settings.reporting_currency`, which it READS and never mutates).
const suffix = randomUUID().slice(0, 8);
const code = (prefix: string): string => `${prefix}${suffix}`.toUpperCase().slice(0, 10);
const ROLE = code('PTROLE');
const LEVEL = code('PTLV');
// `PA…` sorts before `PB…` before `PC…`, so `ratesUsed`/`missingPairs` order is predictable.
const CUR_A = code('PA'); // exp 2, rated -> reporting at 0.5
const CUR_B = code('PB'); // exp 0, rated -> reporting at 2 (exercises exponent scaling)
const CUR_C = code('PC'); // exp 2, DELIBERATELY UNRATED (forces the missing-rate refusal)
const CO_A = code('QA');
const CO_B = code('QB');
const CO_C = code('QC');

// `level.rank` is UNIQUE, a PostgreSQL `int`, and this suite cannot clean up after itself — so it
// draws from a band NO sibling integration file uses. gender-distribution holds
// 2_060_000_000..2_065_999_999 and import-employees starts at 2_100_000_000; THIS band is the free
// gap between them, 2_066_000_000..2_069_999_999, whose ceiling clears the `int` max (2_147_483_647).
const RANK_BAND_START = 2_066_000_000;
const RANK_BAND_WIDTH = 4_000_000;
const RANK = RANK_BAND_START + (parseInt(suffix, 16) % RANK_BAND_WIDTH);

// The rate set's date — a FIXED past date every run of this suite shares, so `pinnedOn` is stable
// and the suite is re-runnable (old runs' rows sit at the same date and never change the assertions).
const PINNED_ON: PlainDate = { year: 2024, month: 1, day: 1 };

// TODAY from the clock port at this boundary, passed INWARD (Law 6 / AD-11). Read ONCE so a run
// straddling UTC midnight cannot make two assertions disagree about the day.
const TODAY: PlainDate = systemClock.todayUtc();

const HIRE_DATE = '2021-06-01';
const FUTURE_HIRE = '2025-01-01'; // in force today, NOT at the 2023 rewind as-of

function employeeDeps(): EmployeeUseCaseDeps {
  return { repository: createEmployeeRepository(), idGenerator: createUuidV7Generator() };
}

function salaryDeps(): RecordSalaryChangeDeps {
  return { repository: createEmployeeRepository(), idGenerator: createUuidV7Generator() };
}

function totalsDeps(): PayrollTotalsDeps {
  return {
    repository: createEmployeeRepository(),
    fxRateRepository: createFxRateRepository(),
    settingsRepository: createSettingsRepository(),
  };
}

async function createFixtureEmployee(
  name: string,
  countryCode: string,
  hireDate: string,
): Promise<string> {
  const result = await createEmployee(employeeDeps(), {
    name,
    roleCode: ROLE,
    levelCode: LEVEL,
    countryCode,
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
  currency: string,
): Promise<void> {
  const result = await recordSalaryChange(
    salaryDeps(),
    employeeId,
    { effectiveFrom, amountMinor, currency },
    TODAY,
  );
  if (result.kind !== 'recorded') {
    throw new Error(`fixture append was rejected: ${JSON.stringify(result)}`);
  }
}

let eaCorrectedId: string; // CO_A — same-day correction (still ONE person)

beforeAll(async () => {
  await owner.query(
    `INSERT INTO currency (code, name, minor_unit_exponent, symbol, grouping_style) VALUES
       ($1, 'Payroll Test Currency A', 2, '¤', 'WESTERN'),
       ($2, 'Payroll Test Currency B', 0, '¤', 'WESTERN'),
       ($3, 'Payroll Test Currency C', 2, '¤', 'WESTERN')`,
    [CUR_A, CUR_B, CUR_C],
  );
  await owner.query(
    `INSERT INTO country (code, name, currency_code) VALUES
       ($1, 'Aland', $4), ($2, 'Bland', $5), ($3, 'Cland', $6)`,
    [CO_A, CO_B, CO_C, CUR_A, CUR_B, CUR_C],
  );
  await owner.query("INSERT INTO role (code, name) VALUES ($1, 'Payroll Test Role')", [ROLE]);
  await owner.query('INSERT INTO level (code, name, rank) VALUES ($1, $2, $3)', [
    LEVEL,
    'Payroll Test Level',
    RANK,
  ]);

  // CO_A: EA1 with a same-day correction (typo then fix, the fix greater-seq and current), EA2, and
  // EA_FUTURE whose salary is not effective until 2025 (in force today, out at the 2023 rewind).
  eaCorrectedId = await createFixtureEmployee(`EA1 ${suffix}`, CO_A, HIRE_DATE);
  await appendFixtureRecord(eaCorrectedId, HIRE_DATE, '55555', CUR_A); // typo first
  await appendFixtureRecord(eaCorrectedId, HIRE_DATE, '100000', CUR_A); // fix, current (=1000.00 A)
  const ea2Id = await createFixtureEmployee(`EA2 ${suffix}`, CO_A, HIRE_DATE);
  await appendFixtureRecord(ea2Id, HIRE_DATE, '50000', CUR_A); // 500.00 A
  const eaFutureId = await createFixtureEmployee(`EAF ${suffix}`, CO_A, FUTURE_HIRE);
  await appendFixtureRecord(eaFutureId, FUTURE_HIRE, '25000', CUR_A); // 250.00 A, effective 2025

  // CO_B: one employee, currency exp 0.
  const eb1Id = await createFixtureEmployee(`EB1 ${suffix}`, CO_B, HIRE_DATE);
  await appendFixtureRecord(eb1Id, HIRE_DATE, '300', CUR_B); // 300 B (exp 0)

  // CO_C: one employee in the UNRATED currency.
  const ec1Id = await createFixtureEmployee(`EC1 ${suffix}`, CO_C, HIRE_DATE);
  await appendFixtureRecord(ec1Id, HIRE_DATE, '10000', CUR_C); // 100.00 C

  // Rate sets — the ONLY fx_rate rows any suite writes. CUR_A and CUR_B convert to the reporting
  // currency at PINNED_ON; CUR_C is left UNRATED on purpose.
  const { reportingCurrency } = await createSettingsRepository().readSettings();
  if (reportingCurrency === CUR_A || reportingCurrency === CUR_B || reportingCurrency === CUR_C) {
    throw new Error('a fixture currency collided with the reporting currency — impossible by suffix');
  }
  await owner.query(
    `INSERT INTO fx_rate (from_currency, to_currency, rate, pinned_on) VALUES
       ($1, $3, 0.50000000, $4),
       ($2, $3, 2.00000000, $4)`,
    [CUR_A, CUR_B, reportingCurrency, plainDateToIso(PINNED_ON)],
  );
});

afterAll(async () => {
  // No row cleanup, and there CANNOT be any: `salary_record` admits no DELETE. Every fixture is
  // run-scoped, and the suite is re-runnable.
  await Promise.all([owner.end(), app.end()]);
});

describe('findPayrollTotalsPopulation returns the org-wide set UNGROUPED, money + country carried', () => {
  it('carries each fixture employee with their countryCode and real Money, people not records', async () => {
    const population = await createEmployeeRepository().findPayrollTotalsPopulation();

    const mine = population.candidates.filter(
      (candidate) =>
        candidate.countryCode === CO_A ||
        candidate.countryCode === CO_B ||
        candidate.countryCode === CO_C,
    );
    // Five distinct PEOPLE across my countries — EA1 (2 records), EA2, EAF, EB1, EC1. EA1 carries two
    // salary records but is ONE candidate: proof the read returns people, not records.
    expect(mine).toHaveLength(5);
    const corrected = mine.find((candidate) => candidate.salaryRecords.length === 2);
    expect(corrected).toBeDefined();
    // The currency rides on the record's own Money (AD-6), read straight off the column.
    const anA = mine.find((candidate) => candidate.countryCode === CO_A);
    expect(anA?.salaryRecords[0]?.salary.currency).toBe(CUR_A);

    // My currencies are in the reference, is_active-inclusive; CUR_C is present too.
    const currencyCodes = population.currencies.map((currency) => currency.code);
    expect(currencyCodes).toEqual(expect.arrayContaining([CUR_A, CUR_B, CUR_C]));
    const curB = population.currencies.find((currency) => currency.code === CUR_B);
    expect(curB?.minorUnitExponent).toBe(0); // exp 0 read off the real column, never hard-coded 100
    const countryCodes = population.countries.map((countryRef) => countryRef.countryCode);
    expect(countryCodes).toEqual(expect.arrayContaining([CO_A, CO_B, CO_C]));
  });
});

describe('findAllFxRates decomposes the stored Decimal(18,8) into an exact rational (no float)', () => {
  it('carries rateNumerator/rateDenominator = 10^8 and a clean rate string', async () => {
    const rows = await createFxRateRepository().findAllFxRates();

    const a = rows.find((row) => row.fromCurrency === CUR_A);
    expect(a).toMatchObject({
      toCurrency: expect.any(String),
      rate: '0.5',
      rateNumerator: 50_000_000n,
      rateDenominator: 100_000_000n,
      pinnedOn: PINNED_ON,
    });
    const b = rows.find((row) => row.fromCurrency === CUR_B);
    expect(b).toMatchObject({ rate: '2', rateNumerator: 200_000_000n, rateDenominator: 100_000_000n });
  });
});

describe('getPayrollTotals over real rows: per-country totals in LOCAL currency (Law 2 / AD-13)', () => {
  it('sums each of my countries in its own currency, counting people once', async () => {
    const result = await getPayrollTotals(totalsDeps(), TODAY);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') {
      throw new Error(`expected an answer, got ${JSON.stringify(result)}`);
    }
    const rowFor = (countryCode: string) =>
      result.totals.perCountry.find((row) => row.countryCode === countryCode);

    // CO_A: EA1 (100000, correction NOT double-counted) + EA2 (50000) + EAF (25000) = 175000 A, n=3.
    expect(rowFor(CO_A)).toEqual({
      countryCode: CO_A,
      countryName: 'Aland',
      currency: CUR_A,
      n: 3,
      total: { amountMinor: '175000', currency: CUR_A },
    });
    // CO_B: one person, 300 B (exp 0) — never converted.
    expect(rowFor(CO_B)).toEqual({
      countryCode: CO_B,
      countryName: 'Bland',
      currency: CUR_B,
      n: 1,
      total: { amountMinor: '300', currency: CUR_B },
    });
    // CO_C: one person, 100.00 C — present in LOCAL currency even though it has no rate.
    expect(rowFor(CO_C)).toEqual({
      countryCode: CO_C,
      countryName: 'Cland',
      currency: CUR_C,
      n: 1,
      total: { amountMinor: '10000', currency: CUR_C },
    });
  });

  it('drops the not-yet-effective member at a 2023 asOf, lowering CO_A total and n', async () => {
    const pastAsOf: PlainDate = { year: 2023, month: 1, day: 1 };

    const result = await getPayrollTotals(totalsDeps(), pastAsOf);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') {
      throw new Error(`expected an answer, got ${JSON.stringify(result)}`);
    }
    const coA = result.totals.perCountry.find((row) => row.countryCode === CO_A);
    // EAF's salary is dated 2025, so at 2023 he is outside the population: n 3 -> 2, total -25000.
    expect(coA).toEqual({
      countryCode: CO_A,
      countryName: 'Aland',
      currency: CUR_A,
      n: 2,
      total: { amountMinor: '150000', currency: CUR_A },
    });
  });
});

describe('the org-wide converted ANSWER over real decomposed rates (AD-13), scoped to this run', () => {
  it('converts each country total once and carries ratesUsed + pinnedOn', async () => {
    // Read the REAL population and REAL fx rows, then scope to this run's own rated rows and fold
    // through the ONE domain — an isolated, deterministic proof of conversion against real data.
    const [population, fxRates, settings] = await Promise.all([
      createEmployeeRepository().findPayrollTotalsPopulation(),
      createFxRateRepository().findAllFxRates(),
      createSettingsRepository().readSettings(),
    ]);
    const reporting = settings.reportingCurrency;

    const result = computePayrollTotals({
      candidates: population.candidates.filter(
        (candidate) => candidate.countryCode === CO_A || candidate.countryCode === CO_B,
      ),
      countries: population.countries.filter(
        (countryRef) => countryRef.countryCode === CO_A || countryRef.countryCode === CO_B,
      ),
      currencies: population.currencies.filter(
        (currency) => currency.code === CUR_A || currency.code === CUR_B || currency.code === reporting,
      ),
      reportingCurrency: reporting,
      fxRates: fxRates.filter((row) => row.fromCurrency === CUR_A || row.fromCurrency === CUR_B),
      asOf: TODAY,
    });

    // CO_A 175000 A x 0.5 = 87500; CO_B 300 B (exp 0) x 2 -> 60000 (exp 2 scaling) => 147500 reporting.
    expect(result.orgWide).toEqual({
      kind: 'answer',
      reportingCurrency: reporting,
      total: { amountMinor: 147_500n, currency: reporting },
      ratesUsed: [
        { fromCurrency: CUR_A, toCurrency: reporting, rate: '0.5', pinnedOn: PINNED_ON },
        { fromCurrency: CUR_B, toCurrency: reporting, rate: '2', pinnedOn: PINNED_ON },
      ],
      pinnedOn: PINNED_ON,
    });
  });
});

describe('the org-wide refusal on a missing rate, with per-country totals still present (AD-13/AD-20)', () => {
  it('refuses missing-rate for the unrated fixture currency; the rated ones resolve at pinnedOn', async () => {
    const result = await getPayrollTotals(totalsDeps(), TODAY);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') {
      throw new Error(`expected an answer, got ${JSON.stringify(result)}`);
    }
    const { orgWide } = result.totals;
    // The whole-DB org-wide refuses because at least one in-population currency lacks a rate — and my
    // deliberately-unrated CUR_C guarantees it, deterministically.
    expect(orgWide.kind).toBe('refusal');
    if (orgWide.kind !== 'refusal') {
      throw new Error(`expected a refusal, got ${JSON.stringify(orgWide)}`);
    }
    expect(orgWide.reason).toBe('missing-rate');
    // The set resolves at THIS suite's pinnedOn (only this suite writes fx_rate).
    expect(orgWide.pinnedOn).toEqual(PINNED_ON);

    const missingFrom = orgWide.missingPairs.map((pair) => pair.fromCurrency);
    // My unrated currency IS missing; my rated ones resolved and are NOT.
    expect(missingFrom).toContain(CUR_C);
    expect(missingFrom).not.toContain(CUR_A);
    expect(missingFrom).not.toContain(CUR_B);

    // Per-country totals are STILL fully present in local currency — only the org-wide figure refuses.
    const coA = result.totals.perCountry.find((row) => row.countryCode === CO_A);
    expect(coA?.total).toEqual({ amountMinor: '175000', currency: CUR_A });
  });
});
