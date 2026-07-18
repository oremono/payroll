// Adapter integration suite (AD-24) — runs against a REAL disposable PostgreSQL 18, never a mock.
//
// This is the one place in the repo where database access is allowed. It proves the invariants
// that the DATABASE enforces, not the ones application code promises:
//
//   * an employee + appended salary records round-trip and read back ordered by
//     (effective_from, seq) — the AD-8 ordering contract;
//   * UPDATE and DELETE on salary_record are rejected as the RUNTIME APPLICATION ROLE (layer A,
//     the AD-18 privilege revoke) AND as the OWNER (layer B, the trigger) — see Decision 2. The
//     owner assertions matter most: an owner bypasses privilege checks entirely, so without them
//     a green suite would not tell us whether the trigger exists at all;
//   * INSERT still succeeds as the runtime role, confirming the trigger does not fire on append;
//   * amount_minor = 0 and negative amounts are rejected by the CHECK (AD-4);
//   * settings admits at most one row (AD-19).
//
// The suite creates its OWN reference fixtures — this story seeds nothing (Decision 1: all
// reference-data values, and the settings default row, are Story 1-4's).
import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const OWNER_URL = process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL_APP;

if (!OWNER_URL) {
  throw new Error('DATABASE_URL must be set — point it at a disposable PostgreSQL 18 instance.');
}
if (!APP_URL) {
  throw new Error(
    'DATABASE_URL_APP must be set — the restricted runtime role (see prisma/sql/bootstrap-roles.sql).',
  );
}

// Two connections, because the whole point is that the two roles behave differently: the owner
// runs migrations and creates fixtures; the app role is what the application connects as at
// runtime, and is the role AD-18's revoke names.
const owner = new Pool({ connectionString: OWNER_URL });
const app = new Pool({ connectionString: APP_URL });

// Unique per run. This suite cannot delete what it creates — the append-only trigger blocks
// DELETE on salary_record for every role, and the reference FKs are ON DELETE RESTRICT — so rows
// accumulate on a persistent local container and fixture codes must not collide across runs.
//
// The FULL suffix is used for every code, including currency and country. An earlier version took
// only 2 hex characters for those two (256 possible values), which by the birthday bound would
// start failing `beforeAll` with a duplicate-key error after roughly twenty local runs. The `code`
// columns are TEXT with no length constraint, so over-long test codes are harmless; real
// ISO-4217 currency and country values arrive with Story 1-4.
const suffix = randomUUID().slice(0, 8);
const CURRENCY = `TC${suffix}`.toUpperCase();
const ROLE = `role-${suffix}`;
const LEVEL = `level-${suffix}`;
const COUNTRY = `CO${suffix}`.toUpperCase();

const employeeId = randomUUID();

beforeAll(async () => {
  // Fixtures are inserted as raw SQL (not through the Prisma client) because the role-switching
  // assertions below connect outside Prisma and must see the same rows.
  //
  // `updated_at` is NOT NULL. Prisma's `@updatedAt` is set by the CLIENT, not the database — so a
  // raw INSERT omitting it would fail outright. This story resolves that by declaring
  // `@default(now()) @updatedAt`, which emits a real DB-level DEFAULT CURRENT_TIMESTAMP while
  // keeping the client-side update behaviour, so raw inserts may omit the column safely. (The
  // alternative was to name updated_at in every raw insert forever; recorded in Completion Notes.)
  await owner.query('INSERT INTO currency (code, name, minor_unit_exponent) VALUES ($1, $2, $3)', [
    CURRENCY,
    'Test Currency',
    2,
  ]);
  await owner.query('INSERT INTO country (code, name, currency_code) VALUES ($1, $2, $3)', [
    COUNTRY,
    'Testland',
    CURRENCY,
  ]);
  await owner.query('INSERT INTO role (code, name) VALUES ($1, $2)', [ROLE, 'Test Role']);
  await owner.query('INSERT INTO level (code, name, rank) VALUES ($1, $2, $3)', [
    LEVEL,
    'Test Level',
    3,
  ]);

  // employee.id has NO database default — the id port generates the UUID in the shell (AD-10), so
  // the caller must supply it. That is exactly what this insert models.
  await owner.query(
    `INSERT INTO employee (id, name, role_code, level_code, country_code, gender, hire_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [employeeId, 'Ada Lovelace', ROLE, LEVEL, COUNTRY, 'MALE', '2020-01-15'],
  );
});

afterAll(async () => {
  // There is deliberately NO row cleanup here, and that is the invariant working rather than a
  // gap: the append-only trigger blocks DELETE on salary_record for EVERY role including the
  // owner (Decision 2, layer B), so this suite cannot remove the records it appended — and the
  // employee/reference rows cannot go either, since salary_record's FKs are ON DELETE RESTRICT.
  //
  // The only clean-up path would be to disable the trigger, which would be a documented recipe
  // for bypassing Law 5. So instead: AD-24 specifies a DISPOSABLE database (a fresh container or
  // Neon branch per run), and every fixture code above is uniquely suffixed so that repeated runs
  // against a persistent local instance accumulate harmlessly instead of colliding.
  //
  // (The `settings` test cleans up after itself because settings is NOT append-only and its
  // single-row CHECK would otherwise break a later migration.)
  await owner.end();
  await app.end();
});

/** Append a salary record as the runtime application role. */
async function appendSalary(amountMinor: number, effectiveFrom: string): Promise<string> {
  const id = randomUUID();
  await app.query(
    `INSERT INTO salary_record (id, employee_id, amount_minor, currency_code, effective_from)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, employeeId, amountMinor, CURRENCY, effectiveFrom],
  );
  return id;
}

describe('salary_record round-trip', () => {
  it('appends two records for an employee and reads them back ordered by (effective_from, seq)', async () => {
    await appendSalary(5_000_00, '2020-01-15');
    await appendSalary(6_500_00, '2022-04-01');

    const { rows } = await app.query<{ amount_minor: string; effective_from: Date; seq: string }>(
      `SELECT amount_minor, effective_from, seq FROM salary_record
       WHERE employee_id = $1
       ORDER BY effective_from ASC, seq ASC`,
      [employeeId],
    );

    expect(rows).toHaveLength(2);
    // amount_minor is BIGINT — pg returns it as a STRING, never a JS number. Money is integer
    // minor units end to end (Law 4 / AD-4); a float would already be a bug here.
    expect(rows.map((r) => r.amount_minor)).toEqual(['500000', '650000']);

    // seq is monotonic (AD-8) — the tie-break that makes "current salary" deterministic. It is
    // gap-prone (BIGSERIAL, not IDENTITY), so assert ordering, never contiguity.
    const [first, second] = rows;
    expect(BigInt(second!.seq)).toBeGreaterThan(BigInt(first!.seq));
  });
});

describe('append-only enforcement (Law 5 / AD-18)', () => {
  it('rejects UPDATE as the runtime application role', async () => {
    const id = await appendSalary(7_000_00, '2023-01-01');

    await expect(
      app.query('UPDATE salary_record SET amount_minor = 1 WHERE id = $1', [id]),
    ).rejects.toThrow();
  });

  it('rejects DELETE as the runtime application role', async () => {
    const id = await appendSalary(7_100_00, '2023-02-01');

    await expect(app.query('DELETE FROM salary_record WHERE id = $1', [id])).rejects.toThrow();
  });

  // The two assertions that actually earn their keep. A table OWNER bypasses privilege checks
  // entirely, so the REVOKE (layer A) is a silent no-op for an owner connection — easy to hit
  // accidentally on Neon, where the default role owns everything. These prove the trigger
  // (layer B) independently, rather than letting layer A mask whether it exists.
  it('rejects UPDATE as the OWNER, proving the trigger independently of the revoke', async () => {
    const id = await appendSalary(7_200_00, '2023-03-01');

    await expect(
      owner.query('UPDATE salary_record SET amount_minor = 1 WHERE id = $1', [id]),
    ).rejects.toThrow(/append-only/i);
  });

  it('rejects DELETE as the OWNER, proving the trigger independently of the revoke', async () => {
    const id = await appendSalary(7_300_00, '2023-04-01');

    await expect(owner.query('DELETE FROM salary_record WHERE id = $1', [id])).rejects.toThrow(
      /append-only/i,
    );
  });

  it('still allows INSERT as the runtime role — the trigger does not fire on append', async () => {
    await expect(appendSalary(7_400_00, '2023-05-01')).resolves.toBeTruthy();
  });
});

describe('positive-amount CHECK (AD-4)', () => {
  it('rejects amount_minor = 0', async () => {
    await expect(appendSalary(0, '2024-01-01')).rejects.toThrow();
  });

  it('rejects a negative amount_minor', async () => {
    await expect(appendSalary(-1, '2024-02-01')).rejects.toThrow();
  });
});

describe('settings is single-row (AD-19)', () => {
  it('rejects a second settings row', async () => {
    // The table ships EMPTY — the default row is Story 1-4's (Decision 1). This test owns its own
    // row and removes it, so it leaves the table as it found it.
    await owner.query(
      'INSERT INTO settings (id, outlier_threshold_pct, reporting_currency) VALUES (1, 20, $1)',
      [CURRENCY],
    );

    try {
      await expect(
        owner.query(
          'INSERT INTO settings (id, outlier_threshold_pct, reporting_currency) VALUES (2, 25, $1)',
          [CURRENCY],
        ),
      ).rejects.toThrow();
    } finally {
      // MUST be in `finally`. If the single-row guard ever regresses, the insert above succeeds,
      // the assertion throws, and a cleanup placed after it would be skipped — leaving two rows
      // that make the next `ADD CONSTRAINT ... CHECK (id = 1)` fail with "violated by some row",
      // i.e. a clear test failure turned into a confusing migration failure elsewhere. That
      // exact sequence happened once during development.
      await owner.query('DELETE FROM settings');
    }
  });
});
