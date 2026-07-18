// Integration coverage for the Prisma client singleton itself (src/adapters/db/client.ts).
//
// This file exists because of a review finding: schema.test.ts proves the DATABASE invariants
// using its own hand-rolled pg pools, so it never exercised the client the application actually
// ships. Both bugs in client.ts survived a fully green gate run for that reason. Every assertion
// here is about the real `getDbClient()`.
import { afterAll, describe, expect, it } from 'vitest';

import { getDbClient } from '@/adapters/db/client';

const db = getDbClient();

afterAll(async () => {
  await db.$disconnect();
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
    await expect(
      db.$executeRaw`UPDATE salary_record SET amount_minor = 1 WHERE amount_minor > 0`,
    ).rejects.toThrow();

    await expect(db.$executeRaw`DELETE FROM salary_record WHERE amount_minor > 0`).rejects.toThrow();
  });

  it('can read through the generated model API', async () => {
    // Confirms the driver adapter is wired correctly and the runtime role's SELECT grant reaches
    // the models, not just raw SQL.
    await expect(db.salaryRecord.findMany({ take: 1 })).resolves.toBeInstanceOf(Array);
  });
});
