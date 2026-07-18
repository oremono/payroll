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
 * Build the client. Kept in a function, and called lazily by `getDbClient()`, so that merely
 * importing this module never opens a connection — the `check` and `a11y` CI jobs build and serve
 * the app with NO database, and module-scope instantiation would break both.
 */
function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and point it at a PostgreSQL 18 instance.',
    );
  }

  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/**
 * The process-wide Prisma client. Constructed on first call, then reused — including across dev
 * hot-reloads, via the globalThis cache.
 *
 * Callers are adapters/repositories in this layer, and the composition root in src/app/ (Server
 * Components and Server Actions wiring adapters into use-cases). Never the pure core.
 */
export function getDbClient(): PrismaClient {
  const client = globalForPrisma.prisma ?? createClient();

  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = client;
  }

  return client;
}
