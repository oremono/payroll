# `prisma/`

Empty seam in Story 1-1. The spine names these files but they are **authored in later stories** —
do not create a schema here:

- `schema.prisma` — data model. Story **1-3** (data model & migrations).
- `migrations/` — including the migration that revokes `UPDATE`/`DELETE` on `salary_record`
  (append-only, Law 5 / AD-18). Story **1-3**.
- `seed.ts` — the 10,000-row population drawn from a seeded PRNG (AD-14). Epic **12** (CAP-11).
