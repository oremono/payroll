import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Integration suite — the ONE place database access is allowed (AD-24). Deliberately a SEPARATE
// config and script (`npm run test:integration`) from the unit suite, so `npm run test` stays
// fast, deterministic, and DB/clock/network-free, and so DB tests never enter the coverage or
// mutation gates.
//
// Runs against a REAL disposable PostgreSQL 18 (a local container or a Neon branch) — never a
// mock. See README § Database.
const srcDir = fileURLToPath(new URL('./src/', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\/(.*)$/, replacement: `${srcDir}$1` }],
  },
  test: {
    include: ['tests/integration/**/*.{test,spec}.ts'],
    environment: 'node',
    // Vitest does not read .env, and neither does Prisma 7 — load it explicitly so a local run
    // picks up DATABASE_URL / DATABASE_URL_APP. In CI the job `env:` block supplies both and this
    // is a no-op (dotenv never overwrites an already-set variable).
    setupFiles: ['dotenv/config'],
    // These tests mutate shared database state and assert on role privileges; running files in
    // parallel against one database makes failures order-dependent and unreproducible.
    fileParallelism: false,
    // A real database round-trip is slower than a pure unit test, and container cold-start on the
    // first connection can be seconds.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // No coverage here by design: the coverage floor measures the pure core (src/domain +
    // src/application), which this suite does not exercise.
  },
});
