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

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Env holds ONLY connection strings and the deploy target (Conventions / AD-19). The outlier
    // threshold is persisted data in the single-row `settings` table, never an env var.
    url: process.env.DATABASE_URL ?? '',
  },
});
