// CAP-1 bulk import against a REAL disposable PostgreSQL 18 (AD-24) — never a mock.
//
// Test-first (Law 1 / AD-23): red before `src/adapters/db/employee-repository.ts` exists.
//
// What is proven here is what a fake repository CANNOT prove:
//
//   1. The write funnel really writes — an employee row and one salary record per valid row, with
//      `seq` assigned by the BIGSERIAL that AD-8 orders by.
//   2. `salary_record.currency_code` is the COUNTRY's currency, resolved inside the transaction
//      (AD-6), not whatever the file claimed.
//   3. `UPDATE` on `salary_record` still fails under the restricted `payroll_app` role (Law 5 /
//      AD-18). A port that exposes no update method is a promise; the revoke is the enforcement,
//      and an untested revoke is one `GRANT` away from silently not existing.
//   4. A mixed file lands exactly the valid rows — including the two cases that reverted this
//      story, an unclosed quote and an amount past the PostgreSQL `bigint` maximum.
//
// ORDER-INDEPENDENCE (a stated acceptance criterion, checked with `--shuffle`): every test creates
// and asserts only its own fixtures, scoped by a per-run suffix. Nothing here counts rows globally,
// and nothing depends on another test having run — this suite cannot delete what it creates (the
// append-only trigger and the ON DELETE RESTRICT FKs are that invariant working as designed).
import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseImportCsv } from '@/adapters/csv/parse-import-csv';
import { createEmployeeRepository } from '@/adapters/db/employee-repository';
import { createUuidV7Generator } from '@/adapters/id';
import { importEmployees, type ImportResult } from '@/application/use-cases/import-employees';
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

const TODAY: PlainDate = { year: 2026, month: 7, day: 19 };

// Per-run fixtures. The seeded reference values are real org data shipped by a migration and this
// suite must not lean on them being any particular thing, so it plants its own taxonomy.
const suffix = randomUUID().slice(0, 8);
const ROLE = `role-${suffix}`;
const LEVEL = `level-${suffix}`;
const INACTIVE_ROLE = `inactive-role-${suffix}`;
const COUNTRY_A = `AA${suffix}`.toUpperCase().slice(0, 10);
const COUNTRY_B = `BB${suffix}`.toUpperCase().slice(0, 10);
const CURRENCY_A = `XA${suffix}`.toUpperCase().slice(0, 10);
const CURRENCY_B = `XB${suffix}`.toUpperCase().slice(0, 10);

// A band of its own — schema.test.ts starts at 2_000_000, client.test.ts at 1_000, and
// reference-data.test.ts draws from 3_000_000 upward. `rank` is UNIQUE with no way to clean up,
// and the full 32-bit draw keeps birthday collisions implausible across accumulated runs.
// `rank` is a 32-bit `int`, so the band has to stay under 2_147_483_647 — the first draw here was
// 2_200_000_000-based and PostgreSQL refused it outright. reference-data.test.ts draws up to
// ~2_003_000_000, so 2_100_000_000..2_140_000_000 is this file's own band with room either side.
const fixtureRank = 2_100_000_000 + (parseInt(suffix, 16) % 40_000_000);

const HEADER =
  'name,role_code,level_code,country_code,gender,hire_date,amount_minor,currency,effective_from';

/** A CSV data row. Every cell is a string, exactly as a spreadsheet would export it. */
function row(overrides: Partial<Record<string, string>> = {}): string {
  const cells = {
    name: `Ada ${suffix}`,
    role_code: ROLE,
    level_code: LEVEL,
    country_code: COUNTRY_A,
    gender: 'FEMALE',
    hire_date: '2021-06-01',
    amount_minor: '234000000',
    currency: CURRENCY_A,
    effective_from: '2025-04-01',
    ...overrides,
  };
  return [
    cells.name,
    cells.role_code,
    cells.level_code,
    cells.country_code,
    cells.gender,
    cells.hire_date,
    cells.amount_minor,
    cells.currency,
    cells.effective_from,
  ].join(',');
}

/** The real pipeline: real parser, real repository, real database. Only `today` is injected. */
async function runImport(text: string): Promise<ImportResult> {
  return importEmployees(
    {
      repository: createEmployeeRepository(),
      idGenerator: createUuidV7Generator(),
      parseCsv: parseImportCsv,
    },
    text,
    TODAY,
  );
}

/** The employees this run planted, by the name they were imported under. */
async function employeesNamed(name: string): Promise<
  { id: string; country_code: string; gender: string; hire_date: Date }[]
> {
  const { rows } = await owner.query<{
    id: string;
    country_code: string;
    gender: string;
    hire_date: Date;
  }>('SELECT id, country_code, gender, hire_date FROM employee WHERE name = $1', [name]);
  return rows;
}

beforeAll(async () => {
  await owner.query(
    `INSERT INTO currency (code, name, minor_unit_exponent, symbol, grouping_style)
     VALUES ($1, 'Import Test Currency A', 2, '¤', 'WESTERN'),
            ($2, 'Import Test Currency B', 2, '¤', 'WESTERN')`,
    [CURRENCY_A, CURRENCY_B],
  );
  await owner.query(
    `INSERT INTO country (code, name, currency_code) VALUES ($1, 'Importland A', $2), ($3, 'Importland B', $4)`,
    [COUNTRY_A, CURRENCY_A, COUNTRY_B, CURRENCY_B],
  );
  await owner.query('INSERT INTO role (code, name) VALUES ($1, $2)', [ROLE, 'Import Role']);
  // is_active gates PICKABILITY for new writes — an inactive role must be rejected on import.
  await owner.query('INSERT INTO role (code, name, is_active) VALUES ($1, $2, false)', [
    INACTIVE_ROLE,
    'Retired Import Role',
  ]);
  await owner.query('INSERT INTO level (code, name, rank) VALUES ($1, $2, $3)', [
    LEVEL,
    'Import Level',
    fixtureRank,
  ]);
});

afterAll(async () => {
  // No row cleanup, for the reasons the sibling integration files document at length: this suite
  // cannot delete what it creates, and that is the append-only invariant working.
  await Promise.all([owner.end(), app.end()]);
});

describe('the write funnel lands valid rows', () => {
  it('creates one employee and one salary record per valid row, with seq assigned', async () => {
    const name = `Grace ${suffix}-landing`;
    const result = await runImport(
      [HEADER, row({ name }), row({ name, effective_from: '2025-05-01' })].join('\n'),
    );

    expect(result).toEqual(
      expect.objectContaining({ kind: 'imported', importedCount: 2, rejectedCount: 0 }),
    );

    const employees = await employeesNamed(name);
    expect(employees).toHaveLength(2);

    const { rows } = await owner.query<{
      seq: string;
      amount_minor: string;
      currency_code: string;
      effective_from: Date;
    }>(
      `SELECT s.seq::text, s.amount_minor::text, s.currency_code, s.effective_from
       FROM salary_record s JOIN employee e ON e.id = s.employee_id
       WHERE e.name = $1 ORDER BY s.seq`,
      [name],
    );

    expect(rows).toHaveLength(2);
    // AD-8's ordering key, assigned by the BIGSERIAL. Monotonic, deliberately not gapless.
    expect(BigInt(rows[1]?.seq ?? '0') > BigInt(rows[0]?.seq ?? '0')).toBe(true);
    expect(rows.map((r) => r.amount_minor)).toEqual(['234000000', '234000000']);
  });

  it('stores the calendar dates exactly, with no timezone shift', async () => {
    const name = `Grace ${suffix}-dates`;
    await runImport([HEADER, row({ name, hire_date: '2021-06-01' })].join('\n'));

    const { rows } = await owner.query<{ hire_date: string; effective_from: string }>(
      `SELECT to_char(e.hire_date, 'YYYY-MM-DD') AS hire_date,
              to_char(s.effective_from, 'YYYY-MM-DD') AS effective_from
       FROM employee e JOIN salary_record s ON s.employee_id = e.id
       WHERE e.name = $1`,
      [name],
    );

    expect(rows[0]).toEqual({ hire_date: '2021-06-01', effective_from: '2025-04-01' });
  });

  it('is CREATE-ONLY: the same file imported twice creates two distinct sets (AD-7)', async () => {
    const name = `Grace ${suffix}-twice`;
    const file = [HEADER, row({ name })].join('\n');

    await runImport(file);
    await runImport(file);

    const employees = await employeesNamed(name);
    expect(employees).toHaveLength(2);
    expect(new Set(employees.map((e) => e.id)).size).toBe(2);
  });

  it('writes a bounded number of round-trips for a large batch', async () => {
    const name = `Grace ${suffix}-bulk`;
    const rows = Array.from({ length: 1_200 }, () => row({ name }));

    const result = await runImport([HEADER, ...rows].join('\n'));

    expect(result).toEqual(expect.objectContaining({ importedCount: 1_200 }));
    expect(await employeesNamed(name)).toHaveLength(1_200);
  });
});

describe('currency is derived from the country, inside the transaction (AD-6)', () => {
  it("writes the country's currency onto the salary record", async () => {
    const name = `Grace ${suffix}-currency`;
    await runImport(
      [HEADER, row({ name, country_code: COUNTRY_B, currency: CURRENCY_B })].join('\n'),
    );

    const { rows } = await owner.query<{ currency_code: string }>(
      `SELECT s.currency_code FROM salary_record s JOIN employee e ON e.id = s.employee_id
       WHERE e.name = $1`,
      [name],
    );

    expect(rows[0]?.currency_code).toBe(CURRENCY_B);
  });

  it('rejects a row whose currency cell disagrees with its country, and lands the others', async () => {
    const name = `Grace ${suffix}-mismatch`;
    const result = await runImport(
      [
        HEADER,
        row({ name }),
        row({ name, currency: CURRENCY_B }),
        row({ name }),
      ].join('\n'),
    );

    expect(result).toEqual(
      expect.objectContaining({ kind: 'imported', importedCount: 2, rejectedCount: 1 }),
    );
    expect(await employeesNamed(name)).toHaveLength(2);
  });
});

describe('reference data gates new writes by is_active', () => {
  it('rejects a row naming an inactive role, and lands the rest', async () => {
    const name = `Grace ${suffix}-inactive`;
    const result = await runImport(
      [HEADER, row({ name }), row({ name, role_code: INACTIVE_ROLE })].join('\n'),
    );

    expect(result).toEqual(
      expect.objectContaining({ kind: 'imported', importedCount: 1, rejectedCount: 1 }),
    );
    expect(await employeesNamed(name)).toHaveLength(1);
  });
});

describe('one bad row never blocks a good one', () => {
  it('imports fifty rows past an unclosed quote', async () => {
    // Reverted defect (a): a single unbalanced quote used to swallow every record after it, so a
    // 51-record file parsed to 1 and fifty employees vanished with no rejection and no signal.
    const name = `Grace ${suffix}-quote`;
    const broken = `"${row({ name })}`;
    const valid = Array.from({ length: 50 }, () => row({ name }));

    const result = await runImport([HEADER, broken, ...valid].join('\n'));

    expect(result).toEqual(
      expect.objectContaining({ kind: 'imported', importedCount: 50, rejectedCount: 1 }),
    );
    expect(await employeesNamed(name)).toHaveLength(50);
  });

  it('rejects an amount past the bigint maximum without aborting the batch', async () => {
    // Reverted defect (b): the value reached the INSERT, overflowed the `bigint` column, aborted
    // the whole transaction, and answered the request with a 500 carrying no report at all.
    const name = `Grace ${suffix}-overflow`;
    const result = await runImport(
      [
        HEADER,
        row({ name }),
        row({ name, amount_minor: '9223372036854775808' }),
        row({ name }),
      ].join('\n'),
    );

    expect(result).toEqual(
      expect.objectContaining({ kind: 'imported', importedCount: 2, rejectedCount: 1 }),
    );
    expect(await employeesNamed(name)).toHaveLength(2);
  });

  it('reports a mixed file exactly, and writes nothing when every row is invalid', async () => {
    const name = `Grace ${suffix}-allbad`;
    const result = await runImport(
      [
        HEADER,
        row({ name, role_code: 'no-such-role' }),
        row({ name, level_code: 'no-such-level' }),
        row({ name, country_code: 'ZZ' }),
        row({ name, gender: 'f' }),
        row({ name, effective_from: '2026-07-20' }),
        row({ name, effective_from: '2020-01-01' }),
        row({ name, amount_minor: '0' }),
      ].join('\n'),
    );

    // An all-rejected file is a REPORT, not a refusal.
    expect(result).toEqual(
      expect.objectContaining({ kind: 'imported', importedCount: 0, rejectedCount: 7 }),
    );
    expect(await employeesNamed(name)).toHaveLength(0);
  });
});

describe('salary_record stays append-only under the runtime role (Law 5 / AD-18)', () => {
  it('refuses an UPDATE on salary_record as payroll_app', async () => {
    const name = `Grace ${suffix}-appendonly`;
    await runImport([HEADER, row({ name })].join('\n'));

    const { rows } = await owner.query<{ id: string }>(
      `SELECT s.id FROM salary_record s JOIN employee e ON e.id = s.employee_id WHERE e.name = $1`,
      [name],
    );
    const recordId = rows[0]?.id;
    expect(recordId).toBeDefined();

    // The application connects as the RESTRICTED role. Connecting as the owner here would prove
    // nothing: PostgreSQL lets a table owner bypass privilege checks entirely.
    await expect(
      app.query('UPDATE salary_record SET amount_minor = 1 WHERE id = $1', [recordId]),
    ).rejects.toThrow();
  });

  it('refuses a DELETE on salary_record as payroll_app', async () => {
    const name = `Grace ${suffix}-nodelete`;
    await runImport([HEADER, row({ name })].join('\n'));

    const { rows } = await owner.query<{ id: string }>(
      `SELECT s.id FROM salary_record s JOIN employee e ON e.id = s.employee_id WHERE e.name = $1`,
      [name],
    );

    await expect(
      app.query('DELETE FROM salary_record WHERE id = $1', [rows[0]?.id]),
    ).rejects.toThrow();
  });
});

describe('loadReferenceData', () => {
  it('returns the active codes this run planted and excludes the inactive one', async () => {
    const references = await createEmployeeRepository().loadReferenceData();

    expect(references.roleCodes.has(ROLE)).toBe(true);
    expect(references.roleCodes.has(INACTIVE_ROLE)).toBe(false);
    expect(references.levelCodes.has(LEVEL)).toBe(true);
    expect(references.countryCurrencies.get(COUNTRY_A)).toBe(CURRENCY_A);
    expect(references.countryCurrencies.get(COUNTRY_B)).toBe(CURRENCY_B);
  });
});
