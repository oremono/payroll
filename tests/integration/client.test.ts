// Integration coverage for the Prisma client singleton itself (src/adapters/db/client.ts).
//
// This file exists because of a review finding: schema.test.ts proves the DATABASE invariants
// using its own hand-rolled pg pools, so it never exercised the client the application actually
// ships. Both bugs in client.ts survived a fully green gate run for that reason. Every assertion
// here is about the real `getDbClient()`.
import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getDbClient } from '@/adapters/db/client';

const db = getDbClient();

// An OWNER connection, used only to plant the fixture row the mutation assertions need. The
// runtime client cannot create reference data on its own here, and — more to the point — a
// salary_record must EXIST for a FOR EACH ROW trigger to have anything to fire on.
const owner = new Pool({ connectionString: process.env.DATABASE_URL });

const suffix = randomUUID().slice(0, 8);
const CURRENCY = `TC${suffix}`.toUpperCase();
const COUNTRY = `CO${suffix}`.toUpperCase();
const ROLE = `role-${suffix}`;
const LEVEL = `level-${suffix}`;
const employeeId = randomUUID();

beforeAll(async () => {
  // Without this fixture the mutation assertions below matched zero rows, and a row-level
  // BEFORE UPDATE/DELETE trigger does not fire when nothing matches — so on a fresh database
  // (every CI run) they proved only the privilege check, never the trigger. Worse, their meaning
  // depended on whether an earlier file had left rows behind: exactly the order-dependent confound
  // this file was created to eliminate. (Code review 2026-07-18.)
  await owner.query('INSERT INTO currency (code, name, minor_unit_exponent) VALUES ($1, $2, 2)', [
    CURRENCY,
    'Client Test Currency',
  ]);
  await owner.query('INSERT INTO country (code, name, currency_code) VALUES ($1, $2, $3)', [
    COUNTRY,
    'Clientland',
    CURRENCY,
  ]);
  await owner.query('INSERT INTO role (code, name) VALUES ($1, $2)', [ROLE, 'Client Role']);
  await owner.query('INSERT INTO level (code, name, rank) VALUES ($1, $2, $3)', [
    LEVEL,
    'Client Level',
    // `rank` is UNIQUE, and this suite cannot delete its fixtures, so the value must be unique per
    // run AND must not overlap schema.test.ts's band (which starts at 2_000_000).
    (Math.abs(parseInt(suffix, 16)) % 1_000_000) + 1_000,
  ]);
  await owner.query(
    `INSERT INTO employee (id, name, role_code, level_code, country_code, gender, hire_date)
     VALUES ($1, 'Client Probe', $2, $3, $4, 'FEMALE', '2020-01-01')`,
    [employeeId, ROLE, LEVEL, COUNTRY],
  );
  await owner.query(
    `INSERT INTO salary_record (id, employee_id, amount_minor, currency_code, effective_from)
     VALUES ($1, $2, 500000, $3, '2020-01-01')`,
    [randomUUID(), employeeId, CURRENCY],
  );
});

afterAll(async () => {
  await db.$disconnect();
  // Evict the cached instance too. `getDbClient` caches on globalThis and rebuilds only when the
  // slot is empty (`??=`), so disconnecting without clearing leaves a DEAD client for any later
  // file in the same worker — which would fail with a pool-closed error that reads like a database
  // outage. (Code review 2026-07-18.)
  delete (globalThis as { prisma?: unknown }).prisma;
  await owner.end();
});

describe('the shipped Prisma client', () => {
  it('connects as the RESTRICTED runtime role, never the owner', async () => {
    // The assertion the append-only proof actually rests on. PostgreSQL lets a table owner bypass
    // privilege checks entirely, so if the application connects as the owner then AD-18 layer A
    // (REVOKE UPDATE, DELETE) is a silent no-op — enforced in appearance only. schema.test.ts
    // asserts that payroll_app cannot UPDATE, but that is worth nothing unless payroll_app is the
    // role the application genuinely uses. This is what closes that gap.
    const [row] = await db.$queryRaw<{ current_user: string }[]>`SELECT current_user`;

    expect(row?.current_user).toBe('payroll_app');
  });

  it('is a singleton — repeated calls return the same instance', async () => {
    // Regression guard for a caching bug that only manifested in production: the globalThis cache
    // was populated only outside production, and no module-level binding backed it, so every call
    // built a new PrismaClient and a new pg Pool. Asserting identity here catches any future
    // reintroduction regardless of NODE_ENV.
    expect(getDbClient()).toBe(db);
    expect(getDbClient()).toBe(getDbClient());
  });

  it('cannot UPDATE or DELETE a salary_record through the client the app actually uses', async () => {
    // The end-to-end statement of Law 5: not "some restricted role is blocked" but "the shipped
    // client is blocked". Uses a raw statement because the Prisma model API deliberately exposes
    // no update path once the repository port lands.
    //
    // Scoped to this file's own fixture row (guaranteed to exist by beforeAll) so the statement
    // genuinely matches something, and matched against the specific error rather than "it threw".
    await expect(
      db.$executeRaw`UPDATE salary_record SET amount_minor = 1 WHERE employee_id = ${employeeId}::uuid`,
    ).rejects.toThrow(/permission denied/i);

    await expect(
      db.$executeRaw`DELETE FROM salary_record WHERE employee_id = ${employeeId}::uuid`,
    ).rejects.toThrow(/permission denied/i);
  });

  it('is blocked by the trigger too, not only by the privilege revoke', async () => {
    // Layer B, proven through the shipped client's own connection rather than a hand-rolled pool.
    // The owner bypasses the privilege check entirely, so anything it hits is the trigger — and
    // the custom SQLSTATE AP001 makes that machine-identifiable rather than a string match on
    // English prose (which is what the repository port will rely on in CAP-2/CAP-3).
    await expect(
      owner.query('UPDATE salary_record SET amount_minor = 1 WHERE employee_id = $1', [employeeId]),
    ).rejects.toMatchObject({ code: 'AP001' });

    await expect(
      owner.query('DELETE FROM salary_record WHERE employee_id = $1', [employeeId]),
    ).rejects.toMatchObject({ code: 'AP001' });
  });

  it('can read through the generated model API', async () => {
    // Confirms the driver adapter is wired correctly and the runtime role's SELECT grant reaches
    // the models, not just raw SQL.
    await expect(db.salaryRecord.findMany({ take: 1 })).resolves.toBeInstanceOf(Array);
  });

  it('bounds its connection pool — concurrency beyond the bound queues into a second wave', async () => {
    // Story 1-7 AC 4/5. Asserts the pool bound BEHAVIOURALLY, by timing, because every direct
    // route to the number is either tautological or wrong here:
    //
    //   - Reading the constant back (or `pool.options.max`) asserts that a literal equals itself.
    //     It would still pass if the adapter never handed the value to pg at all.
    //   - `pg_stat_activity` is worse than useless on the pooled endpoint AC 3 puts this suite on:
    //     behind PgBouncer in transaction mode it reports the POOLER's server-side backends, which
    //     are shared across clients and bear no 1:1 relation to this process's sockets. It is also
    //     partly NULL for a non-superuser, and neondb_owner is not a superuser.
    //
    // Timing is the one signal that means the same thing on a direct endpoint, a pooled endpoint,
    // and the local container — a query that cannot get a socket waits, and waiting is observable.
    //
    // EXPECTED_MAX mirrors APP_POOL_MAX in src/adapters/db/client.ts deliberately rather than
    // importing it, so that changing the production constant is not silently self-ratifying.
    //
    // Precisely what the two assertions below pin (corrected after code review 2026-07-19 — an
    // earlier version of this comment claimed a change "in either direction" fails, which is
    // false). Waves are ceil(queries / max), each ~1 s:
    //
    //   max ≤ 4  baseline (5 sleepers) needs 2 waves  -> baseline assertion fails    ✓ caught
    //   max 5-7  baseline 1 wave, over-commit 2 waves -> both assertions hold        → PASSES
    //   max ≥ 8  over-commit (8 sleepers) fits 1 wave -> bound assertion fails       ✓ caught
    //
    // So this pins APP_POOL_MAX to the RANGE [5,7], not to exactly 5. That is deliberate and
    // sufficient: it catches the two failure modes that matter — a pool small enough to serialize
    // (the `max: 1` mistake AC 4 rejects) and one loose enough not to bound anything. Pinning an
    // exact value by timing would need wave sizes that differ by one connection, which is far
    // inside the noise of a cross-region round trip.
    const EXPECTED_MAX = 5;
    const SLEEP_SECONDS = 1;
    // One wave is ~1s. 1.9s sits clear of both — above any plausible round-trip overhead on a
    // single wave, below the ~2s floor of two.
    const ONE_WAVE_CEILING_MS = 1_900;
    const TWO_WAVE_CEILING_MS = 6_000;

    const sleepConcurrently = async (count: number): Promise<number> => {
      const startedAt = performance.now();

      await Promise.all(
        Array.from(
          { length: count },
          // pg_sleep in FROM, not in the select list: it returns `void`, and Prisma's deserializer
          // rejects a void COLUMN outright ("Failed to deserialize column of type 'void'").
          () => db.$queryRaw`SELECT 1 AS slept FROM pg_sleep(${SLEEP_SECONDS}::double precision)`,
        ),
      );

      return performance.now() - startedAt;
    };

    // Warm the pool first. A cold socket to Neon pays TLS + startup before the sleep begins, and
    // that cost lands entirely inside the baseline measurement — the one measurement with no
    // headroom to absorb it.
    await Promise.all(
      Array.from({ length: EXPECTED_MAX + 3 }, () => db.$queryRaw`SELECT 1`),
    );

    // Baseline. Without it, a pool that serialized EVERY query would satisfy the bound assertion
    // below for entirely the wrong reason — the failure mode `max: 1` actually produces, and the
    // reason AC 4 rejects it.
    const baselineMs = await sleepConcurrently(EXPECTED_MAX);

    expect(baselineMs).toBeLessThan(ONE_WAVE_CEILING_MS);

    // The bound itself: EXPECTED_MAX + 3 sleepers cannot all hold a socket at once, so three of
    // them queue and the whole set takes two waves.
    const overCommittedMs = await sleepConcurrently(EXPECTED_MAX + 3);

    expect(overCommittedMs).toBeGreaterThanOrEqual(ONE_WAVE_CEILING_MS);
    expect(overCommittedMs).toBeLessThan(TWO_WAVE_CEILING_MS);
  });
});
