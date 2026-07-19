import 'dotenv/config';

import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

/**
 * The deterministic employee fixture the browser suite reads (story 3-2).
 *
 * `e2e/employees.spec.ts` proves that a directory, a pager, a search, and a modal form render a
 * FIXED payload faithfully. `e2e/import.spec.ts` could stub its one endpoint with `page.route` and
 * stay database-free; a Server Component reading in-process (AD-21) has no endpoint to stub, so
 * this suite needs rows, and rows have to come from somewhere reproducible.
 *
 * ## Why this connects as the OWNER
 *
 * `DATABASE_URL`, not `DATABASE_URL_APP`. It inserts REFERENCE rows (an inactive role and an
 * inactive country the directory needs in order to be interesting), and `payroll_app` holds no
 * INSERT privilege on the reference tables — that restriction is the AD-18 layer-A split working,
 * not an obstacle to route around by widening the grant.
 *
 * The application under test still connects as `payroll_app`. Only the fixture is privileged.
 *
 * ## What it truncates, and what it must NOT
 *
 * `salary_record` and `employee` only. The reference tables (8 currencies, 8 countries, 6 levels,
 * 25 roles, the single `settings` row) arrive through `prisma migrate deploy` as a DATA MIGRATION —
 * `tests/integration/reference-data.test.ts` asserts exactly that. Truncating them would delete
 * data no later step restores: `migrate deploy` will not re-run a migration it has already applied,
 * so the database would be left permanently missing its taxonomy and every later suite would fail
 * for a reason nothing points at.
 *
 * The two rows this fixture DOES add are upserted rather than inserted, so re-running is safe —
 * which is the property `npm run test:browser:db` run twice in a row depends on.
 *
 * TRUNCATE does not fire the `salary_record` append-only trigger: that trigger is
 * `BEFORE UPDATE OR DELETE`, and TRUNCATE is neither. Law 5 is untouched — this is a fixture
 * resetting a disposable database, not a correction path.
 *
 * ## Why this uses `pg` and not the Prisma client
 *
 * Under Prisma 7 the `prisma-client` generator emits TypeScript SOURCE whose internal relative
 * imports carry no file extension (`./enums`, `./models`). That is fine for a bundler and fine for
 * Vitest, and unresolvable by Node's own ESM loader — which is what runs this file, because it is a
 * standalone script rather than a test. `tests/integration/reference-data.test.ts` already reaches
 * the owner connection through a bare `pg` `Pool` for its own reasons; this does the same.
 *
 * The spec asked for a `PrismaPg` adapter here. Recorded as a deviation in its Spec Change Log.
 *
 * ## Why the ids are fixed
 *
 * Determinism (Law 6 / AD-19) and the ORDER the directory promises. `listEmployees` orders by
 * `(name, id)` — the tie-break is not decoration, because offset pagination over a non-total order
 * silently drops and repeats rows between pages. Two employees below deliberately SHARE a name, so
 * the id is what settles their order, and a random id would make the assertion about which comes
 * first flap.
 */

const OWNER_URL = process.env.DATABASE_URL;

if (!OWNER_URL) {
  throw new Error(
    'DATABASE_URL must be set — the fixture connects as the OWNER because it inserts reference ' +
      'rows, which payroll_app may not. Point it at a disposable PostgreSQL 18 instance.',
  );
}

const owner = new Pool({ connectionString: OWNER_URL });

/** An active role and a level/country the seeded reference data already supplies. */
const ACTIVE_ROLE = 'software_engineer';
const SECOND_ROLE = 'product_manager';
const LEVELS = ['L1', 'L2', 'L3'] as const;
const ACTIVE_COUNTRIES = ['IN', 'US'] as const;

/**
 * A role that is RETIRED. `is_active` gates PICKABILITY, never visibility: this code must not
 * appear in the form's selects, and must still render verbatim in the directory for the employee
 * who already holds it. Without such a row that distinction is untested.
 */
const INACTIVE_ROLE = { code: 'retired_role', name: 'Retired Role' };

/** The same, for a country. Its currency is one the migration already seeded. */
const INACTIVE_COUNTRY = { code: 'ZZ', name: 'Nowhere', currencyCode: 'USD' };

/**
 * Thirty employees. Thirty, not twenty-five: the page size is `DEFAULT_LIST_LIMIT = 25`, so this is
 * the smallest population that produces a real second page with a SHORT last page on it.
 *
 * Four names contain `ana` case-insensitively (Ana Silva, Dana Whitmore, Diana Rossi, Hana
 * Watanabe) — a search that matched only the name it was spelled like would prove nothing about
 * substring or case behaviour. `Marco Bianchi` appears twice, which is legitimate data: a name is
 * never an identity. `Zoltan Kovacs` sits on the retired role.
 */
export const NAMES = [
  'Aaron Fields',
  'Ana Silva',
  'Beatriz Gomez',
  'Carlos Mendez',
  'Dana Whitmore',
  'Diana Rossi',
  'Elena Rossi',
  'Farid Haddad',
  'Gita Nair',
  'Hana Watanabe',
  'Ibrahim Diallo',
  'Jonas Berg',
  'Kavya Menon',
  'Liam Murphy',
  'Marco Bianchi',
  'Marco Bianchi',
  'Nadia Farouk',
  'Oscar Lindqvist',
  'Priya Raman',
  'Quentin Dubois',
  'Rina Sato',
  'Sofia Alvarez',
  'Tomas Novak',
  'Ulrich Bauer',
  'Vera Petrova',
  'Wanda Kaminski',
  'Xavier Leclerc',
  'Yusuf Demir',
  'Zara Whitfield',
  'Zoltan Kovacs',
] as const;

/** `00000000-0000-4000-8000-0000000000NN` — a valid v4-shaped UUID, ordered, and obviously fake. */
export function fixtureId(index: number): string {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

/**
 * A calendar date as the canonical `YYYY-MM-DD` text a `DATE` column takes.
 *
 * Text rather than a JS `Date`: `new Date(...)` round-trips through a timezone on the way into the
 * driver, and the whole reason `hire_date` is a `DATE` and the as-of date is a `PlainDate` is that
 * a calendar day must not shift under a reader (Law 6 / AD-19). A fixture that seeded the day
 * before the intended one on a machine west of Greenwich would be a flaky test with no visible
 * cause.
 */
function hireDate(index: number): string {
  const year = 2015 + (index % 10);
  const month = (index % 12) + 1;
  const day = (index % 28) + 1;
  return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Which role an employee at `index` holds. Exactly one holds the retired one. */
function roleFor(name: string, index: number): string {
  if (name === 'Zoltan Kovacs') {
    return INACTIVE_ROLE.code;
  }
  return index % 2 === 0 ? ACTIVE_ROLE : SECOND_ROLE;
}

/**
 * Exactly ONE employee sits on the retired country, so the "no currency line for an inactive
 * country" branch is reachable while every other detail page shows one.
 */
export function countryFor(name: string, index: number): string {
  if (name === 'Beatriz Gomez') {
    return INACTIVE_COUNTRY.code;
  }
  return ACTIVE_COUNTRIES[index % ACTIVE_COUNTRIES.length] ?? 'IN';
}

export async function seedEmployees(): Promise<void> {
  // Reference rows first: the employees below carry FKs to them. Upserted, so a second run is a
  // no-op rather than a unique-constraint failure — `test:browser:db` is run twice in a row on
  // purpose.
  await owner.query(
    `INSERT INTO "role" ("code", "name", "is_active") VALUES ($1, $2, false)
     ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "is_active" = false`,
    [INACTIVE_ROLE.code, INACTIVE_ROLE.name],
  );
  await owner.query(
    `INSERT INTO "country" ("code", "name", "currency_code", "is_active") VALUES ($1, $2, $3, false)
     ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "is_active" = false`,
    [INACTIVE_COUNTRY.code, INACTIVE_COUNTRY.name, INACTIVE_COUNTRY.currencyCode],
  );

  // `salary_record` first — it carries the FK to `employee`. One statement so the two can never be
  // half-cleared. CASCADE is deliberately absent: nothing else may be swept away by this.
  await owner.query('TRUNCATE TABLE "salary_record", "employee"');

  const values: unknown[] = [];
  const rows = NAMES.map((name, index) => {
    const at = index * 6;
    values.push(
      fixtureId(index),
      name,
      roleFor(name, index),
      LEVELS[index % LEVELS.length] ?? 'L1',
      countryFor(name, index),
      index % 2 === 0 ? 'FEMALE' : 'MALE',
    );
    // `hire_date` is interpolated as its own cast so the driver never sees a JS Date.
    return `($${String(at + 1)}::uuid, $${String(at + 2)}, $${String(at + 3)}, $${String(at + 4)}, $${String(at + 5)}, $${String(at + 6)}::gender, DATE '${hireDate(index)}')`;
  });

  await owner.query(
    `INSERT INTO "employee" ("id", "name", "role_code", "level_code", "country_code", "gender", "hire_date")
     VALUES ${rows.join(', ')}`,
    values,
  );

  // NO salary records, deliberately. An employee may exist without one (UX-DR13 / AD-16), CAP-3
  // owns the first salary, and this story's payloads carry identity fields only — a fixture that
  // planted salaries would be seeding a capability that does not exist yet.
}

/**
 * Run as a script (`npm run e2e:seed`), this seeds and exits. IMPORTED (by `e2e/employees.spec.ts`,
 * which re-seeds before every test so each one starts from the same thirty rows), it exports the
 * function and opens nothing until it is called.
 *
 * The guard is the entry-point comparison rather than `import.meta.main`, which is Node 24+ and
 * this repo's floor is only pinned by `.nvmrc`.
 */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await seedEmployees();
  await owner.end();
  process.stdout.write(`Seeded ${String(NAMES.length)} employees and 0 salary records.\n`);
}
