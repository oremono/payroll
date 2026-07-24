import 'dotenv/config';

import { createEmployeeRepository } from '@/adapters/db/employee-repository';
import { createUuidV7Generator } from '@/adapters/id';
import { createSeededPrng } from '@/adapters/prng';
import { SEED, SEED_AS_OF, SEED_EPOCH_MS } from '@/application/seed/config';
import { generatePopulation, type SeedReferences } from '@/application/seed/population';

/**
 * The seed COMPOSITION ROOT (CAP-11) — the one explicit `npm run seed` command, never a deploy side
 * effect (epic constraint). It wires three fixed, committed constants (the PRNG seed, the UUIDv7
 * epoch, the as-of date) to the pure generator and writes the result through the EXISTING
 * `createEmployeesWithSalaries` funnel unchanged — the seed is a non-privileged client of the same
 * write path import and the record-change form use (AD-7 / AD-6 / AD-18).
 *
 * ## Why byte-reproducible
 *
 * Every id, amount, and date derives from `SEED` and the two fixed constants below — no wall clock,
 * no `Math.random`, no `crypto` (NFR1 / NFR8). Running this twice against a fresh database yields
 * identical ids and amounts. `createUuidV7Generator` is fed a FIXED epoch and the seeded PRNG's
 * bytes, so even the UUIDv7 ids reproduce.
 *
 * ## Reference data
 *
 * `loadFormOptions` (not `loadReferenceData`) supplies the taxonomy, because the generator needs the
 * level RANKS and the currency EXPONENTS — the JPY-0 exponent comes from the currency reference row,
 * never a hard-coded 100 (AD-4) — and only `loadFormOptions` carries both. It is still a read through
 * the same repository; the seed invents no taxonomy value.
 *
 * ## Runtime
 *
 * The whole `src/` graph is written against the tsconfig `@/*` alias and extensionless imports, which
 * a bundler (Next) and Vitest resolve but plain Node does not. `prisma/seed.register.mjs` teaches
 * Node's ESM loader those two conventions so this composition root runs as an ordinary script; TS is
 * handled by Node's built-in type stripping. See the `seed` script in package.json.
 *
 * The three fixed constants (`SEED`, `SEED_EPOCH_MS`, `SEED_AS_OF`) live in
 * `@/application/seed/config` so the composition root and every test share the same values.
 */

async function seed(): Promise<void> {
  const repository = createEmployeeRepository();

  // The real taxonomy, read through the repository — the generator draws only from it (AD-7).
  const options = await repository.loadFormOptions();
  const references: SeedReferences = {
    roles: options.roles.map((role) => role.code),
    levels: options.levels.map((level) => ({ code: level.code, rank: level.rank })),
    countries: options.countries.map((country) => ({
      code: country.code,
      currency: country.currencyCode,
    })),
    currencyExponents: new Map(
      options.currencies.map((currency) => [currency.code, currency.minorUnitExponent]),
    ),
  };

  const prng = createSeededPrng(SEED);
  const idGenerator = createUuidV7Generator(
    () => SEED_EPOCH_MS,
    (count) => prng.nextBytes(count),
  );

  const batch = generatePopulation({ prng, idGenerator, references, asOf: SEED_AS_OF });

  // The EXISTING funnel, unchanged — it re-resolves each currency from the country inside the
  // transaction (AD-6) and rejects any future-dated record (AD-18). The seed passes the same
  // validation every other write passes.
  await repository.createEmployeesWithSalaries(batch, SEED_AS_OF);

  console.log(`Seeded ${batch.length} employees, each with an opening salary record.`);
}

seed()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
