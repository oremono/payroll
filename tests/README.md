# `tests/`

Vitest domain/application unit tests + seed-obligation tests. This suite touches **no DB, no clock,
no network** — keep it that way from the first test. (Law: Testing / AD-23)

Integration tests (against a real disposable Postgres 18 — never a mock) are a **separate** suite,
introduced when persistence appears (Story 1-3+). They live outside this suite so this one stays
clock-free and DB-free.

Path aliases (`@/domain/*`, …) resolve here identically to the app via `vitest.config.ts`, which
mirrors `tsconfig.json`.
