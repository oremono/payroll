// Prisma 7 configuration (Story 1-3).
//
// Prisma 7.0.0 removed `url` from the `datasource` block in schema.prisma — connection URLs live
// here instead, and this file is the SINGLE source of them for every CLI invocation
// (`migrate dev`, `migrate deploy`, `generate`, `validate`) and every CI job. Note `prisma migrate
// deploy` has no `--url` flag in v7, so CI supplies DATABASE_URL through the job `env:` block and
// it is resolved here.
//
// `import "dotenv/config"` is mandatory: Prisma 7 does NOT auto-load `.env`, and the whole
// `PRISMA_*` escape-hatch family was removed in 7.0.0 (it now silently no-ops).
import 'dotenv/config';

import { defineConfig } from 'prisma/config';

// Env holds ONLY connection strings and the deploy target (Conventions / AD-19). The outlier
// threshold is persisted data in the single-row `settings` table, never an env var.
//
// This is the OWNER url — migrations and `prisma generate` only. The application connects at
// runtime as the restricted role via DATABASE_URL_APP (see src/adapters/db/client.ts).
const url = process.env.DATABASE_URL;

// Deliberately a warning rather than a throw. `prisma generate` and `prisma validate` do not touch
// a database and MUST keep working without one — `postinstall` runs `generate` on every install,
// including the CI jobs that build the app with no database at all. So an empty url is passed
// through for their sake, and the commands that genuinely need it (migrate dev/deploy, db push)
// would otherwise fail with an opaque connection-string parse error naming no variable. This
// names it.
if (!url) {
  console.warn(
    '[prisma.config] DATABASE_URL is not set. `generate` and `validate` will still work; any ' +
      'migrate command will fail. Copy .env.example to .env — see README § Database.',
  );
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: url ?? '',
  },
});
