// Reference data + value constraints (Story 1-4), against a REAL disposable PostgreSQL 18 (AD-24).
//
// Two things are proven here, and they are separate claims:
//
//   1. THE VALUES. The 8 currencies, 8 countries, 6 levels, 25 roles, and the single `settings`
//      row arrive through `prisma migrate deploy`, not through an operator command. They are FK
//      targets — no employee, import, or seed can be written without them — so every environment
//      (local, CI, preview, production) must get them from the one mechanism that already reaches
//      all four. Re-applying the data migration must therefore also be a NO-OP, because
//      `migrate deploy` runs at every Vercel build.
//
//   2. THE CONSTRAINTS. The five value constraints deferred from Story 1-3 to this story, each
//      asserted by its violating input being REJECTED. A constraint nobody has watched refuse
//      something is a constraint nobody knows exists.
//
// On counting: the sibling integration files plant uniquely-suffixed fixture rows in these same
// tables and CANNOT remove them (the append-only trigger and the ON DELETE RESTRICT FKs are the
// invariant working, see schema.test.ts). A bare `SELECT count(*) FROM currency` would therefore
// assert this suite's own run history rather than the migration's output. Every count below is
// scoped to the seeded values instead — which is the stronger claim anyway: it fails if a row is
// missing, duplicated, or wrong, and no fixture can mask that.
import { readdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const OWNER_URL = process.env.DATABASE_URL;

if (!OWNER_URL) {
  throw new Error('DATABASE_URL must be set — point it at a disposable PostgreSQL 18 instance.');
}

const owner = new Pool({ connectionString: OWNER_URL });

const CURRENCY_CODES = ['BRL', 'CAD', 'EUR', 'GBP', 'INR', 'JPY', 'NOK', 'USD'];
const COUNTRY_CODES = ['BR', 'CA', 'DE', 'GB', 'IN', 'JP', 'NO', 'US'];
const LEVEL_CODES = ['L1', 'L2', 'L3', 'L4', 'M1', 'M2'];
// The five the Settings mock enumerates, plus twenty more spanning the remaining job families.
// No level or seniority word appears in any of them — the ladder is `level`, never `role`.
const ROLE_CODES = [
  'account_manager',
  'business_analyst',
  'content_strategist',
  'customer_support_specialist',
  'data_analyst',
  'data_engineer',
  'data_scientist',
  'designer',
  'financial_analyst',
  'legal_counsel',
  'marketing_specialist',
  'operations_specialist',
  'people_partner',
  'product_manager',
  'program_manager',
  'quality_engineer',
  'recruiter',
  'sales_engineer',
  'sales_executive',
  'security_engineer',
  'site_reliability_engineer',
  'software_engineer',
  'solutions_architect',
  'technical_writer',
  'ux_researcher',
];

// Fixtures for the constraint assertions. Uniquely suffixed for the same reason every other
// integration fixture is: this suite cannot delete what it creates.
const suffix = randomUUID().slice(0, 8);
const FIXTURE_CURRENCY = `TR${suffix}`.toUpperCase();
const FIXTURE_COUNTRY = `CR${suffix}`.toUpperCase();
const FIXTURE_ROLE = `role-${suffix}`;
const FIXTURE_LEVEL = `level-${suffix}`;
const fixtureEmployeeId = randomUUID();
const HIRE_DATE = '2021-06-01';

// A band of its own: schema.test.ts starts at 2_000_000 and client.test.ts at 1_000, and `rank` is
// UNIQUE with no way to clean up. The seeded levels occupy 1–6.
//
// Drawn from the FULL 32 bits of the suffix rather than folded into a 1,000,000-wide window. Ranks
// accumulate forever, and a birthday collision over a million slots becomes likely after only a
// few thousand runs — at which point `beforeAll` throws a unique violation and every test in the
// file errors at once, pointing at nothing. `rank` is a 32-bit `int`, so the largest safe base is
// 2^31 - 1 minus the widest draw and the two offsets the constraint tests add below.
const fixtureRank = 3_000_000 + (parseInt(suffix, 16) % 2_000_000_000);

/**
 * Run a statement that MUST be rejected, inside a transaction that is ALWAYS rolled back.
 *
 * Every constraint assertion below goes through this, and the reason is the failure mode when the
 * constraint REGRESSES rather than when it holds. An unwrapped `INSERT` that was supposed to be
 * refused would, on regression, COMMIT — and this suite cannot delete what it creates (the
 * append-only trigger and the ON DELETE RESTRICT FKs, working as designed). A rejected-case row
 * like `'usd'` would become a permanent, valid FK target sitting beside `'USD'`: precisely the
 * split-peer-group harm the index exists to prevent. Worse, the next run would then fail on a
 * plain unique violation, hiding the regression that caused it.
 *
 * The rollback makes the failure mode "red", never "red and corrupted" — the same reasoning the
 * `settings` assertions already use, applied to every table.
 */
async function expectRejected(sql: string, params: unknown[], matcher: RegExp): Promise<void> {
  const client = await owner.connect();
  try {
    await client.query('BEGIN');
    await expect(client.query(sql, params)).rejects.toThrow(matcher);
  } finally {
    // ROLLBACK can itself reject (dead connection, aborted pool client). Without this nesting
    // `release()` is skipped, the pooled client leaks, and `owner.end()` in afterAll hangs to the
    // hook timeout — replacing the real assertion failure with a timeout that names nothing.
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }
}

/**
 * Run a statement that must be ACCEPTED, then roll it back.
 *
 * Proving a constraint admits a legitimate value does not require keeping the row. Leaving it
 * behind grows a reference table permanently, on every run, forever — and these are the very
 * tables whose exact row counts this suite wants to assert.
 */
async function expectAcceptedThenRolledBack(sql: string, params: unknown[]): Promise<void> {
  const client = await owner.connect();
  try {
    await client.query('BEGIN');
    // `rowCount`, not `.resolves.toBeDefined()`: a pg result object is ALWAYS defined, so the
    // old assertion could not tell acceptance apart from a statement that touched nothing.
    expect((await client.query(sql, params)).rowCount).toBe(1);
  } finally {
    // ROLLBACK can itself reject (dead connection, aborted pool client). Without this nesting
    // `release()` is skipped, the pooled client leaks, and `owner.end()` in afterAll hangs to the
    // hook timeout — replacing the real assertion failure with a timeout that names nothing.
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }
}

/** The reference-data migration's SQL, located by suffix so its timestamp is not hard-coded. */
function readReferenceDataMigration(): string {
  const migrationsDir = join(process.cwd(), 'prisma', 'migrations');
  const dir = readdirSync(migrationsDir).find((name) => name.endsWith('_reference_data'));
  if (!dir) {
    throw new Error('No `*_reference_data` migration directory found under prisma/migrations.');
  }
  return readFileSync(join(migrationsDir, dir, 'migration.sql'), 'utf8');
}

beforeAll(async () => {
  await owner.query(
    'INSERT INTO currency (code, name, minor_unit_exponent, symbol, grouping_style) VALUES ($1, $2, 2, $3, $4)',
    [FIXTURE_CURRENCY, 'Reference Test Currency', '¤', 'WESTERN'],
  );
  await owner.query('INSERT INTO country (code, name, currency_code) VALUES ($1, $2, $3)', [
    FIXTURE_COUNTRY,
    'Referenceland',
    FIXTURE_CURRENCY,
  ]);
  await owner.query('INSERT INTO role (code, name) VALUES ($1, $2)', [
    FIXTURE_ROLE,
    'Reference Role',
  ]);
  await owner.query('INSERT INTO level (code, name, rank) VALUES ($1, $2, $3)', [
    FIXTURE_LEVEL,
    'Reference Level',
    fixtureRank,
  ]);
  await owner.query(
    `INSERT INTO employee (id, name, role_code, level_code, country_code, gender, hire_date)
     VALUES ($1, 'Grace Hopper', $2, $3, $4, 'FEMALE', $5)`,
    [fixtureEmployeeId, FIXTURE_ROLE, FIXTURE_LEVEL, FIXTURE_COUNTRY, HIRE_DATE],
  );

  // A COMMITTED salary record for the fixture employee, planted here rather than left to a
  // sibling test (story 2-1). The hire_date UPDATE assertions below need an existing record to
  // conflict with, and they used to get one only because the two "accepts a record dated …" tests
  // happened to run first — which held under file order and broke under `--shuffle`, where
  // "rejects moving hire_date later" could run before anything had been inserted and the UPDATE
  // then succeeded. Order-independence is a stated acceptance criterion, so the dependency is made
  // explicit instead of implicit. The "accepts" tests still insert their own rows and still assert
  // their own claim.
  await owner.query(
    `INSERT INTO salary_record (id, employee_id, amount_minor, currency_code, effective_from)
     VALUES ($1, $2, 500000, $3, $4)`,
    [randomUUID(), fixtureEmployeeId, FIXTURE_CURRENCY, HIRE_DATE],
  );
});

afterAll(async () => {
  // No row cleanup, for the reasons schema.test.ts documents at length. Note especially that this
  // suite must NEVER delete from `settings`: that row is now real org configuration shipped by a
  // migration, not a fixture.
  await owner.end();
});

describe('currency reference values', () => {
  it('seeds exactly the eight ISO-4217 currencies, with symbol, exponent, and grouping style', async () => {
    const { rows } = await owner.query<{
      code: string;
      name: string;
      minor_unit_exponent: number;
      symbol: string;
      grouping_style: string;
      is_active: boolean;
    }>(
      `SELECT code, name, minor_unit_exponent, symbol, grouping_style, is_active
       FROM currency WHERE code = ANY($1) ORDER BY code`,
      [CURRENCY_CODES],
    );

    expect(
      rows.map((r) => [r.code, r.minor_unit_exponent, r.symbol, r.grouping_style]),
    ).toEqual([
      ['BRL', 2, 'R$', 'WESTERN'],
      ['CAD', 2, '$', 'WESTERN'],
      ['EUR', 2, '€', 'WESTERN'],
      ['GBP', 2, '£', 'WESTERN'],
      // INR is the only INDIAN grouping in the set — ₹21,50,000, not ₹2,150,000.
      ['INR', 2, '₹', 'INDIAN'],
      // The deliberate anti-hard-coded-100 case (Law 4 / AD-4): JPY has no minor unit.
      ['JPY', 0, '¥', 'WESTERN'],
      ['NOK', 2, 'kr', 'WESTERN'],
      ['USD', 2, '$', 'WESTERN'],
    ]);
    expect(rows.every((r) => r.is_active)).toBe(true);
    expect(rows.every((r) => r.name.trim().length > 0)).toBe(true);
  });
});

describe('country reference values', () => {
  it('seeds eight countries, each pointing at a seeded currency', async () => {
    const { rows } = await owner.query<{ code: string; name: string; currency_code: string }>(
      'SELECT code, name, currency_code FROM country WHERE code = ANY($1) ORDER BY code',
      [COUNTRY_CODES],
    );

    expect(rows.map((r) => [r.code, r.name, r.currency_code])).toEqual([
      ['BR', 'Brazil', 'BRL'],
      ['CA', 'Canada', 'CAD'],
      ['DE', 'Germany', 'EUR'],
      ['GB', 'United Kingdom', 'GBP'],
      ['IN', 'India', 'INR'],
      ['JP', 'Japan', 'JPY'],
      ['NO', 'Norway', 'NOK'],
      ['US', 'United States', 'USD'],
    ]);
  });

  it('resolves every seeded country currency through the FK, not by convention', async () => {
    // The FK would already have refused a bad insert; this proves the join actually lands, which
    // is the property AD-6 depends on when it writes salary_record.currency_code from the country.
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM country c
       JOIN currency cu ON cu.code = c.currency_code
       WHERE c.code = ANY($1)`,
      [COUNTRY_CODES],
    );
    expect(rows[0]?.n).toBe('8');
  });
});

describe('level reference values', () => {
  it('seeds six levels with distinct sequential ranks starting at 1', async () => {
    // Scoped by rank rather than by code: the seeded ladder owns ranks 1–6 outright, and every
    // test fixture rank in the repo is >= 1_000, so this IS the exact global set.
    const { rows } = await owner.query<{ code: string; name: string; rank: number }>(
      'SELECT code, name, rank FROM level WHERE rank <= 6 ORDER BY rank',
    );

    expect(rows).toEqual([
      { code: 'L1', name: 'Associate', rank: 1 },
      { code: 'L2', name: 'Mid', rank: 2 },
      { code: 'L3', name: 'Senior', rank: 3 },
      { code: 'L4', name: 'Staff', rank: 4 },
      { code: 'M1', name: 'Manager', rank: 5 },
      { code: 'M2', name: 'Director', rank: 6 },
    ]);
    expect(rows.map((r) => r.code)).toEqual(LEVEL_CODES);
  });
});

describe('role reference values', () => {
  it('seeds exactly twenty-five roles, including the five the Settings mock enumerates', async () => {
    const { rows } = await owner.query<{ code: string; name: string }>(
      'SELECT code, name FROM role WHERE code = ANY($1) ORDER BY code',
      [ROLE_CODES],
    );

    expect(rows).toHaveLength(25);
    expect(rows.map((r) => r.code)).toEqual(ROLE_CODES);
    expect(rows.map((r) => r.code)).toEqual(expect.arrayContaining([
      'software_engineer',
      'product_manager',
      'data_scientist',
      'designer',
      'sales_executive',
    ]));
    expect(rows.every((r) => r.name.trim().length > 0)).toBe(true);
  });
});

describe('settings default row (AD-19)', () => {
  it('seeds exactly one settings row with threshold 20 and USD as the reporting currency', async () => {
    // Global count, deliberately: `settings` is single-row by CHECK, so this is a true invariant
    // and no fixture can add to it.
    const { rows } = await owner.query<{
      id: number;
      outlier_threshold_pct: number;
      reporting_currency: string;
    }>('SELECT id, outlier_threshold_pct, reporting_currency FROM settings');

    expect(rows).toEqual([{ id: 1, outlier_threshold_pct: 20, reporting_currency: 'USD' }]);
  });
});

describe('reference-data migration idempotency', () => {
  it('re-applies without error and creates no duplicate rows', async () => {
    // `prisma migrate deploy` runs at every Vercel build. If a re-applied data migration could
    // fail or duplicate, a redeploy would break the build — so the file is written with
    // ON CONFLICT DO NOTHING and this test executes it a SECOND time to prove it.
    const sql = readReferenceDataMigration();

    const before = await owner.query<{ n: string }>(
      `SELECT (SELECT count(*) FROM currency)::text || '/' ||
              (SELECT count(*) FROM country)::text  || '/' ||
              (SELECT count(*) FROM level)::text    || '/' ||
              (SELECT count(*) FROM role)::text     || '/' ||
              (SELECT count(*) FROM settings)::text AS n`,
    );

    await expect(owner.query(sql)).resolves.toBeDefined();

    const after = await owner.query<{ n: string }>(
      `SELECT (SELECT count(*) FROM currency)::text || '/' ||
              (SELECT count(*) FROM country)::text  || '/' ||
              (SELECT count(*) FROM level)::text    || '/' ||
              (SELECT count(*) FROM role)::text     || '/' ||
              (SELECT count(*) FROM settings)::text AS n`,
    );

    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });
});

describe('currency.minor_unit_exponent range CHECK', () => {
  it('rejects a negative exponent, which would render every salary 100x wrong', async () => {
    await expectRejected(
      'INSERT INTO currency (code, name, minor_unit_exponent, symbol, grouping_style) VALUES ($1, $2, -1, $3, $4)',
      [`XA${suffix}`.toUpperCase(), 'Bad Exponent', '¤', 'WESTERN'],
      /currency_minor_unit_exponent_range/,
    );
  });

  it('accepts zero, because JPY has no minor unit', async () => {
    await expectAcceptedThenRolledBack(
      'INSERT INTO currency (code, name, minor_unit_exponent, symbol, grouping_style) VALUES ($1, $2, 0, $3, $4)',
      [`XB${suffix}`.toUpperCase(), 'Zero Exponent', '¤', 'WESTERN'],
    );
  });

  it('rejects an implausibly large exponent', async () => {
    await expectRejected(
      'INSERT INTO currency (code, name, minor_unit_exponent, symbol, grouping_style) VALUES ($1, $2, 5, $3, $4)',
      [`XC${suffix}`.toUpperCase(), 'Huge Exponent', '¤', 'WESTERN'],
      /currency_minor_unit_exponent_range/,
    );
  });
});

describe('settings.outlier_threshold_pct range CHECK', () => {
  // Asserted by UPDATE rather than INSERT: the single-row CHECK means a second row can never be
  // inserted, so an INSERT-based assertion would pass for the wrong reason (PK conflict).
  //
  // Every attempt runs inside a transaction that is ALWAYS rolled back. `settings` is real org
  // configuration, not a fixture — if one of these CHECKs ever regresses, an unwrapped UPDATE
  // would succeed, the assertion would fail, and the environment would be left with (say) a zero
  // threshold that makes every employee an outlier. The rollback makes the test's failure mode
  // "red", never "red and corrupted".
  async function expectThresholdRejected(value: number): Promise<void> {
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      await expect(
        client.query(`UPDATE settings SET outlier_threshold_pct = ${value} WHERE id = 1`),
      ).rejects.toThrow(/settings_outlier_threshold_pct_range/);
    } finally {
      // ROLLBACK can itself reject (dead connection, aborted pool client). Without this nesting
      // `release()` is skipped, the pooled client leaks, and `owner.end()` in afterAll hangs to the
      // hook timeout — replacing the real assertion failure with a timeout that names nothing.
      try {
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    }

    // Re-read on a SEPARATE connection, inside the helper rather than as a trailing test. As its
    // own `it`, this assertion is only meaningful because the rejection cases happen to run before
    // it in file order — run with `.only`, or skip those, and it passes vacuously while claiming
    // to prove the rollbacks worked. Folded in here, every single attempt carries its own proof.
    const { rows } = await owner.query<{ outlier_threshold_pct: number }>(
      'SELECT outlier_threshold_pct FROM settings WHERE id = 1',
    );
    expect(rows[0]?.outlier_threshold_pct).toBe(20);
  }

  it('rejects a zero threshold, which would make every employee an outlier', async () => {
    await expectThresholdRejected(0);
  });

  it('rejects a negative threshold', async () => {
    await expectThresholdRejected(-5);
  });

  it('rejects a threshold above 100 percent', async () => {
    await expectThresholdRejected(101);
  });

});

describe('currency.symbol non-blank CHECK', () => {
  // NOT NULL does not exclude ''. A blank symbol renders a salary with no currency symbol, which
  // DESIGN forbids outright — and the formatter cannot detect it, because '' is a valid string.
  it('rejects an empty currency symbol', async () => {
    await expectRejected(
      `INSERT INTO currency (code, name, symbol, grouping_style, minor_unit_exponent)
       VALUES ($1, 'Blank Symbol', '', 'WESTERN', 2)`,
      [`XSA${suffix}`.toUpperCase().slice(0, 10)],
      /currency_symbol_not_blank/,
    );
  });

  it('rejects a whitespace-only currency symbol', async () => {
    await expectRejected(
      `INSERT INTO currency (code, name, symbol, grouping_style, minor_unit_exponent)
       VALUES ($1, 'Blank Symbol', '  ', 'WESTERN', 2)`,
      [`XSB${suffix}`.toUpperCase().slice(0, 10)],
      /currency_symbol_not_blank/,
    );
  });
});

describe('non-blank CHECKs', () => {
  it('rejects a whitespace-only role code', async () => {
    await expectRejected(
      'INSERT INTO role (code, name) VALUES ($1, $2)',
      ['   ', 'Blank'],
      /role_code_not_blank/,
    );
  });

  it('rejects an empty level code', async () => {
    await expectRejected(
      'INSERT INTO level (code, name, rank) VALUES ($1, $2, $3)',
      ['', 'Blank', fixtureRank + 1],
      /level_code_not_blank/,
    );
  });

  it('rejects a whitespace-only country code', async () => {
    await expectRejected(
      'INSERT INTO country (code, name, currency_code) VALUES ($1, $2, $3)',
      ['  ', 'Blank', FIXTURE_CURRENCY],
      /country_code_not_blank/,
    );
  });

  it('rejects a whitespace-only currency code', async () => {
    await expectRejected(
      'INSERT INTO currency (code, name, minor_unit_exponent, symbol, grouping_style) VALUES ($1, $2, 2, $3, $4)',
      [' ', 'Blank', '¤', 'WESTERN'],
      /currency_code_not_blank/,
    );
  });

  it('rejects a whitespace-only employee name', async () => {
    await expectRejected(
      `INSERT INTO employee (id, name, role_code, level_code, country_code, gender, hire_date)
       VALUES ($1, '   ', $2, $3, $4, 'MALE', $5)`,
      [randomUUID(), FIXTURE_ROLE, FIXTURE_LEVEL, FIXTURE_COUNTRY, HIRE_DATE],
      /employee_name_not_blank/,
    );
  });
});

describe('case-insensitive uniqueness on reference codes', () => {
  it('rejects a currency whose code differs from a seeded one only in case', async () => {
    await expectRejected(
      'INSERT INTO currency (code, name, minor_unit_exponent, symbol, grouping_style) VALUES ($1, $2, 2, $3, $4)',
      ['usd', 'Lowercase Dollar', '$', 'WESTERN'],
      /currency_code_lower_key/,
    );
  });

  it('rejects a country whose code differs from a seeded one only in case', async () => {
    await expectRejected(
      'INSERT INTO country (code, name, currency_code) VALUES ($1, $2, $3)',
      ['in', 'Lowercase India', 'INR'],
      /country_code_lower_key/,
    );
  });

  it('rejects a role whose code differs from a seeded one only in case', async () => {
    await expectRejected(
      'INSERT INTO role (code, name) VALUES ($1, $2)',
      ['Software_Engineer', 'Mixed Case'],
      /role_code_lower_key/,
    );
  });

  it('rejects a level whose code differs from a seeded one only in case', async () => {
    await expectRejected(
      'INSERT INTO level (code, name, rank) VALUES ($1, $2, $3)',
      ['l1', 'Lowercase Associate', fixtureRank + 2],
      /level_code_lower_key/,
    );
  });
});

describe('salary_record.effective_from is never before the employee hire_date', () => {
  // A cross-TABLE date rule cannot be a CHECK — a CHECK sees only its own row — so this is a
  // BEFORE INSERT trigger. It fires for every role including the owner, exactly like the
  // append-only trigger (Law 5 / AD-18, layer B).
  it('rejects a record dated before the hire date, with SQLSTATE AP004', async () => {
    // Asserted on the SQLSTATE, not the message. The whole reason the trigger raises AP004 is so a
    // future repository port can map it onto a typed refusal without string-matching English — a
    // regex on /effective_from/ would still pass if the USING ERRCODE clause were dropped, and
    // would also match an unrelated NOT NULL or FK error that happens to name the column.
    await expect(
      owner.query(
        `INSERT INTO salary_record (id, employee_id, amount_minor, currency_code, effective_from)
         VALUES ($1, $2, 500000, $3, '2021-05-31')`,
        [randomUUID(), fixtureEmployeeId, FIXTURE_CURRENCY],
      ),
    ).rejects.toMatchObject({ code: 'AP004' });
  });

  // These two COMMIT, deliberately: the hire_date UPDATE tests below need a committed
  // salary_record to have something to conflict with. `rowCount`, not `.resolves.toBeDefined()` —
  // a pg result object is always defined, so the old form proved only that no error was thrown.
  it('accepts a record dated exactly on the hire date — the boundary is inclusive', async () => {
    const result = await owner.query(
      `INSERT INTO salary_record (id, employee_id, amount_minor, currency_code, effective_from)
         VALUES ($1, $2, 500000, $3, $4)`,
      [randomUUID(), fixtureEmployeeId, FIXTURE_CURRENCY, HIRE_DATE],
    );

    expect(result.rowCount).toBe(1);
  });

  it('accepts a record dated after the hire date', async () => {
    const result = await owner.query(
      `INSERT INTO salary_record (id, employee_id, amount_minor, currency_code, effective_from)
         VALUES ($1, $2, 650000, $3, '2023-01-01')`,
      [randomUUID(), fixtureEmployeeId, FIXTURE_CURRENCY],
    );

    expect(result.rowCount).toBe(1);
  });

  // The other direction. salary_record is append-only, but employee.hire_date is UPDATE-able by
  // the runtime role, so the invariant can also be broken by moving the hire date forward under
  // records that already exist. Enforcing only the INSERT side left it half-closed.
  it('rejects moving hire_date later than an existing record, with SQLSTATE AP004', async () => {
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      await expect(
        client.query('UPDATE employee SET hire_date = $1 WHERE id = $2', [
          '2024-01-01',
          fixtureEmployeeId,
        ]),
      ).rejects.toMatchObject({ code: 'AP004' });
    } finally {
      // ROLLBACK can itself reject (dead connection, aborted pool client). Without this nesting
      // `release()` is skipped, the pooled client leaks, and `owner.end()` in afterAll hangs to the
      // hook timeout — replacing the real assertion failure with a timeout that names nothing.
      try {
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    }
  });

  it('allows moving hire_date earlier, which cannot break the invariant', async () => {
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      // `rowCount`, not `.resolves.toBeDefined()`: this UPDATE is matched by id, and the old form
      // passed identically when the WHERE matched zero rows — a broken fixture id or a rolled-back
      // beforeAll would have looked like a green "allowed" case.
      expect(
        (
          await client.query('UPDATE employee SET hire_date = $1 WHERE id = $2', [
            '2020-01-01',
            fixtureEmployeeId,
          ])
        ).rowCount,
      ).toBe(1);
    } finally {
      // ROLLBACK can itself reject (dead connection, aborted pool client). Without this nesting
      // `release()` is skipped, the pooled client leaks, and `owner.end()` in afterAll hangs to the
      // hook timeout — replacing the real assertion failure with a timeout that names nothing.
      try {
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    }
  });

  it('leaves an employee update that does not touch hire_date unaffected', async () => {
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      expect(
        (
          await client.query('UPDATE employee SET name = $1 WHERE id = $2', [
            'Renamed',
            fixtureEmployeeId,
          ])
        ).rowCount,
      ).toBe(1);
    } finally {
      // ROLLBACK can itself reject (dead connection, aborted pool client). Without this nesting
      // `release()` is skipped, the pooled client leaks, and `owner.end()` in afterAll hangs to the
      // hook timeout — replacing the real assertion failure with a timeout that names nothing.
      try {
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    }
  });

  // BOTH DIRECTIONS GUARDED IS STILL NOT THE INVARIANT HELD. Each trigger reads the OTHER table,
  // and at READ COMMITTED neither can see the other transaction's uncommitted row:
  //
  //   T1: INSERT salary_record effective_from = hire_date   -- reads hire_date, passes, uncommitted
  //   T2: UPDATE employee SET hire_date = later             -- MIN(effective_from) cannot see T1
  //   both COMMIT  -->  effective_from < hire_date, with both guards having fired correctly
  //
  // That is textbook write skew, and it lands the database in exactly the state AD-16 cannot
  // tolerate. The insert-side trigger must therefore LOCK the employee row it validates against
  // (`FOR SHARE`), so a concurrent hire_date UPDATE blocks until the insert resolves rather than
  // reading a stale value beside it.
  //
  // Asserted as a LOCK CONFLICT rather than by racing two transactions: a `lock_timeout` makes the
  // proof deterministic. Without `FOR SHARE` the UPDATE sails through and the test fails; with it,
  // the UPDATE waits on T1 and trips the timeout (SQLSTATE 55P03).
  it('locks the employee row while validating an insert, so a concurrent hire_date move cannot skew', async () => {
    const inserting = await owner.connect();
    const updating = await owner.connect();
    try {
      await inserting.query('BEGIN');
      await inserting.query(
        `INSERT INTO salary_record (id, employee_id, amount_minor, currency_code, effective_from)
         VALUES ($1, $2, 700000, $3, $4)`,
        [randomUUID(), fixtureEmployeeId, FIXTURE_CURRENCY, HIRE_DATE],
      );

      await updating.query('BEGIN');
      await updating.query("SET LOCAL lock_timeout = '750ms'");
      await expect(
        updating.query('UPDATE employee SET hire_date = $1 WHERE id = $2', [
          '2024-01-01',
          fixtureEmployeeId,
        ]),
      ).rejects.toMatchObject({ code: '55P03' });
    } finally {
      // Roll the insert back too: it is a lock probe, not a fixture, and salary_record admits no
      // DELETE path to undo it after the fact.
      //
      // Each rollback is nested so that a failing ROLLBACK cannot skip the releases that follow it.
      // Sequentially awaited without this, a rejection on `updating` leaks BOTH pooled clients.
      try {
        await updating.query('ROLLBACK');
      } finally {
        try {
          await inserting.query('ROLLBACK');
        } finally {
          updating.release();
          inserting.release();
        }
      }
    }
  });
});
