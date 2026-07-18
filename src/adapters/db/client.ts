// The single Prisma client for the application (Story 1-3).
//
// Law 2: Prisma lives ONLY in src/adapters/db/. Nothing in src/domain/** or src/application/**
// may import this module or the generated client — the purity zone's `no-restricted-imports` in
// eslint.config.mjs enforces that mechanically, including the generated path (a Prisma 7 leak
// names the generated path, not `@prisma/client`).
//
// Import is from the GENERATED path, not '@prisma/client': the v7 `prisma-client` generator emits
// TypeScript source to the `output` dir, and the `/client` suffix is load-bearing.
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/client';

// Prisma 7 requires a driver adapter for every database — `new PrismaClient()` with a bare
// connection string no longer connects, and the `datasources` / `datasourceUrl` constructor
// options were removed in 7.0.0.
//
// The client is cached on globalThis so Next.js dev hot-reload does not multiply instances. The
// ADAPTER (and therefore the underlying pg Pool) is constructed INSIDE the guard: Prisma's own
// documented snippet builds it outside, which leaks a pool on every HMR reload.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Sockets one function instance may hold open against Postgres at once (Story 1-7).
 *
 * The PRIMARY fix for serverless connection exhaustion is not this number — it is that
 * DATABASE_URL_APP points at Neon's POOLED endpoint. PgBouncer is the real pool there; it absorbs
 * up to ~10,000 client connections and multiplexes them onto a small server-side set. This bound
 * only caps what a single instance opens toward that pooler, so a burst of concurrency inside one
 * instance cannot fan out without limit.
 *
 * `max: 1` is deliberately REJECTED. It serializes every concurrent query behind any in-flight
 * interactive transaction, converting a connection-limit problem into a latency problem, and it is
 * not current Neon guidance — Neon's own Vercel examples set no `max` at all. 5 leaves real
 * intra-instance concurrency while staying far below any plausible limit.
 *
 * A module constant, not an env var: env holds only connection strings and the deploy target
 * (Conventions / AD-19).
 */
const APP_POOL_MAX = 5;

/**
 * Build the client. Kept in a function, and called lazily by `getDbClient()`, so that merely
 * importing this module never opens a connection — the `check` and `a11y` CI jobs build and serve
 * the app with NO database, and module-scope instantiation would break both.
 */
function createClient(): PrismaClient {
  // DATABASE_URL_APP, deliberately NOT DATABASE_URL. The application connects as the restricted
  // runtime role (payroll_app: SELECT/INSERT on salary_record, no UPDATE/DELETE); DATABASE_URL is
  // the OWNER and belongs to migrations only.
  //
  // This distinction is the whole of AD-18 layer A. PostgreSQL lets a table owner bypass privilege
  // checks entirely, so connecting here with the owner URL would silently reduce
  // `REVOKE UPDATE, DELETE` to a no-op — the invariant would read as enforced while being
  // unenforced. It is required rather than falling back to DATABASE_URL for exactly that reason: a
  // fallback would restore the silent failure the moment the variable is missing.
  const connectionString = process.env.DATABASE_URL_APP;

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL_APP is not set. The application connects as the restricted runtime role, not ' +
        'the owner — copy .env.example to .env and see README § Database for the two-role split.',
    );
  }

  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max: APP_POOL_MAX }) });
}

/**
 * The process-wide Prisma client. Constructed on first call, then reused — including across dev
 * hot-reloads, via the globalThis cache.
 *
 * Callers are adapters/repositories in this layer, and the composition root in src/app/ (Server
 * Components and Server Actions wiring adapters into use-cases). Never the pure core.
 */
export function getDbClient(): PrismaClient {
  // Cached UNCONDITIONALLY, including in production. The common Next.js snippet caches on
  // globalThis only outside production, because there the module-level binding is the real
  // singleton and globalThis merely survives dev hot-reload. This module has no such binding, so
  // making the cache conditional would leave production — the one environment that cannot afford
  // it — constructing a fresh PrismaClient and pg Pool on every call, exhausting connections
  // within a few dozen requests.
  globalForPrisma.prisma ??= createClient();

  return globalForPrisma.prisma;
}
