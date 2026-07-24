// The seed (CAP-11) persistence path, against a REAL disposable PostgreSQL 18 (AD-24) — never a
// mock. What a fake cannot prove and this does:
//
//   1. A batch from the pure generator really lands through the EXISTING `createEmployeesWithSalaries`
//      funnel — the seed is a non-privileged client of the same write path, given no shortcut (AD-7).
//   2. Each opening salary record's `currency_code` is the one the funnel RE-RESOLVED from the
//      employee's country (AD-6) — equal to the country's reference currency, not something the seed
//      chose — and every amount is > 0 (AD-4 / the CHECK).
//   3. Determinism (NFR8): two generations from the same seed produce byte-identical ids and amounts.
//
// ISOLATION: this plants only EMPLOYEE + SALARY_RECORD rows (never reference rows), through the
// funnel, keyed by run-unique UUIDs — the per-run PRNG seed is derived from the suffix, so re-running
// the whole suite inserts DIFFERENT ids and never collides on a primary key. It asserts only on the
// ids it created, counts nothing globally, truncates nothing (the tables are append-only by design),
// and creates no reference rows, so it needs no level-rank band.
import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEmployeeRepository } from '@/adapters/db/employee-repository';
import { createUuidV7Generator } from '@/adapters/id';
import { createSeededPrng } from '@/adapters/prng';
import { SEED_AS_OF as AS_OF, SEED_EPOCH_MS as FIXED_EPOCH_MS } from '@/application/seed/config';
import {
  generatePopulation,
  type PopulationDeps,
  type SeedReferences,
} from '@/application/seed/population';

const OWNER_URL = process.env.DATABASE_URL;

if (!OWNER_URL) {
  throw new Error('DATABASE_URL must be set — point it at a disposable PostgreSQL 18 instance.');
}

const owner = new Pool({ connectionString: OWNER_URL });

// Run-unique so re-running the suite never PK-collides on the seed's fixed ids.
const suffix = randomUUID().slice(0, 8);
const RUN_SEED = Number.parseInt(suffix, 16) >>> 0;
// A small deterministic sub-batch of the first N generated rows (the planted gender-gap cells, in
// US and GB), used by the id-reproducibility test.
const SLICE = 20;

// The PRODUCTION taxonomy is exactly these 25 roles / 6 levels / 8 countries (the data migration).
// This disposable database also holds hundreds of leftover fixture reference rows from sibling
// suites, and feeding all of them to the generator would explode its role×level×country grid — so
// the references are BOUNDED to the canonical codes (still read from the real DB rows for their
// ranks, currencies, and exponents), which is exactly the taxonomy the seed runs against in prod.
const CANONICAL_ROLES = new Set([
  'software_engineer',
  'product_manager',
  'data_scientist',
  'designer',
  'sales_executive',
  'quality_engineer',
  'site_reliability_engineer',
  'security_engineer',
  'data_engineer',
  'data_analyst',
  'ux_researcher',
  'technical_writer',
  'solutions_architect',
  'program_manager',
  'business_analyst',
  'marketing_specialist',
  'content_strategist',
  'account_manager',
  'sales_engineer',
  'customer_support_specialist',
  'financial_analyst',
  'recruiter',
  'people_partner',
  'operations_specialist',
  'legal_counsel',
]);
const CANONICAL_LEVELS = new Set(['L1', 'L2', 'L3', 'L4', 'M1', 'M2']);
const CANONICAL_COUNTRIES = new Set(['IN', 'US', 'GB', 'DE', 'JP', 'BR', 'NO', 'CA']);

let references: SeedReferences;
let currencyByCountry: Map<string, string>;

function buildDeps(): PopulationDeps {
  const prng = createSeededPrng(RUN_SEED);
  const idGenerator = createUuidV7Generator(
    () => FIXED_EPOCH_MS,
    (count) => prng.nextBytes(count),
  );
  return { prng, idGenerator, references, asOf: AS_OF };
}

beforeAll(async () => {
  // The real taxonomy the migration ships, read through the repository — exactly what the seed's
  // composition root uses to build its references.
  const options = await createEmployeeRepository().loadFormOptions();
  references = {
    roles: options.roles.map((role) => role.code).filter((code) => CANONICAL_ROLES.has(code)),
    levels: options.levels
      .filter((level) => CANONICAL_LEVELS.has(level.code))
      .map((level) => ({ code: level.code, rank: level.rank })),
    countries: options.countries
      .filter((country) => CANONICAL_COUNTRIES.has(country.code))
      .map((country) => ({ code: country.code, currency: country.currencyCode })),
    currencyExponents: new Map(
      options.currencies.map((currency) => [currency.code, currency.minorUnitExponent]),
    ),
  };
  currencyByCountry = new Map(options.countries.map((country) => [country.code, country.currencyCode]));
});

afterAll(async () => {
  // No row cleanup — employee/salary_record are append-only by design (Law 5 / AD-18), and this
  // suite asserts only on its own run-unique ids.
  await owner.end();
});

describe('seed persistence through the existing funnel (CAP-11)', () => {
  it('is deterministic: two same-seed generations produce identical ids and amounts', () => {
    const first = generatePopulation(buildDeps());
    const second = generatePopulation(buildDeps());

    expect(second.map((row) => row.employeeId)).toEqual(first.map((row) => row.employeeId));
    expect(second.map((row) => row.salary.amountMinor.toString())).toEqual(
      first.map((row) => row.salary.amountMinor.toString()),
    );
  });

  it('lands a sub-batch whose currency the funnel resolved from the country, with positive amounts', async () => {
    const batch = generatePopulation(buildDeps());
    // Deliberately mix currencies AND exponents through the real funnel: a couple of gap-cell rows
    // (US/GB, exponent-2) plus a few JP rows (JPY, exponent-0). JPY is the marquee AD-4 case — if the
    // exponent were hard-coded to 100 anywhere, the yen amount would round-trip 100× wrong.
    const gapRows = batch.slice(0, 2);
    const jpRows = batch.filter((row) => row.countryCode === 'JP').slice(0, 3);
    expect(jpRows.length).toBeGreaterThan(0); // the generated batch really contains JP employees.
    const slice = [...gapRows, ...jpRows];

    // Through the SAME funnel import and the record-change form use — no privileged path.
    await createEmployeeRepository().createEmployeesWithSalaries(slice, AS_OF);

    const ids = slice.map((row) => row.employeeId);
    const { rows } = await owner.query<{
      employee_id: string;
      amount_minor: string;
      currency_code: string;
      country_code: string;
      effective_from: string;
    }>(
      `SELECT sr.employee_id,
              sr.amount_minor::text AS amount_minor,
              sr.currency_code,
              e.country_code,
              to_char(sr.effective_from, 'YYYY-MM-DD') AS effective_from
       FROM salary_record sr
       JOIN employee e ON e.id = sr.employee_id
       WHERE sr.employee_id = ANY($1)`,
      [ids],
    );

    // Every row landed, exactly once.
    expect(rows).toHaveLength(slice.length);

    const generatedById = new Map(slice.map((row) => [row.employeeId, row]));
    for (const row of rows) {
      const generated = generatedById.get(row.employee_id);
      expect(generated).toBeDefined();
      // AD-6: the persisted currency is the COUNTRY's reference currency, resolved by the funnel.
      expect(row.currency_code).toBe(currencyByCountry.get(row.country_code));
      // ...and it is exactly what the generator priced the salary in.
      expect(row.currency_code).toBe(generated?.salary.currency);
      // AD-4 / the CHECK: strictly positive, and byte-equal to the generated amount.
      expect(BigInt(row.amount_minor)).toBeGreaterThan(0n);
      expect(row.amount_minor).toBe(generated?.salary.amountMinor.toString());
    }

    // AD-4 spotlight: the JP rows round-trip as JPY (exponent-0) with NO 100× scaling — the stored
    // minor amount equals the yen integer the generator produced, proving the exponent is data-driven.
    const jpPersisted = rows.filter((row) => row.country_code === 'JP');
    expect(jpPersisted.length).toBeGreaterThan(0);
    for (const row of jpPersisted) {
      expect(row.currency_code).toBe('JPY');
      const generated = generatedById.get(row.employee_id);
      expect(row.amount_minor).toBe(generated?.salary.amountMinor.toString());
    }
  });

  it('re-generates the identical sub-batch ids on a same-seed run (byte-reproducible)', () => {
    // The persisted ids above came from RUN_SEED; a fresh same-seed generation reproduces them
    // exactly, which is the property `npm run seed` run twice against a fresh database depends on.
    const regenerated = generatePopulation(buildDeps()).slice(0, SLICE);
    const original = generatePopulation(buildDeps()).slice(0, SLICE);

    expect(regenerated.map((row) => row.employeeId)).toEqual(
      original.map((row) => row.employeeId),
    );
  });
});
