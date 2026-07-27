# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Salary management for one HR manager running pay for ~10,000 employees across eight countries.
Hand-scaffolded Next.js 16 App Router app (no `create-next-app`), functional core / imperative shell,
PostgreSQL 18 via Prisma.

## The standing rules come from `docs/project-context.md`

That file is the law every session inherits — eight numbered Laws, plus the domain rules agents
routinely get wrong, each tracing to an architecture decision (`AD-n`). **Read it before writing
code.** If a story instruction or a request contradicts a Law, stop and surface it rather than
quietly comply.

`README.md` explains what the product does and why; `docs/ENGINEERING.md` is the operational manual
(setup, database, CI, deployment). Per-story specs live in `docs/implementation-artifacts/`, and
`docs/implementation-artifacts/deferred-work.md` records known-but-unfixed issues — check it before
diagnosing a flaky test as new.

## Commands

```bash
npm run dev              # dev server on :3000
npm run build            # production build
npm run lint             # eslint . — also the import-boundary + purity gate
npm run typecheck        # tsc --noEmit
npm run test             # Vitest unit suite (~5s, no DB/clock/network)
npm run test:coverage    # unit suite + coverage floors
npm run test:mutation    # Stryker over src/domain — a surviving mutant fails
npm run test:integration # separate config, real Postgres 18
npm run seed             # 10,000 employees (~4s), deterministic
npm run tokens:build     # regenerate tokens from DESIGN.md
npm run tokens:check     # fail on token drift (CI gate)
```

Running one test:

```bash
npx vitest run tests/domain/money.test.ts          # one unit file
npx vitest run -t "<name substring>"               # by test name
npx playwright test e2e/shell.spec.ts              # one browser spec
npx playwright test e2e/shell.spec.ts -g "aria-current"
```

`prisma generate` emits TypeScript **source** into `src/adapters/db/generated/`, so it must run
before `typecheck`/`build`. `postinstall` handles it.

## Test topology

Five layers, each buying something different — see README §6.

- **`tests/`** mirrors the source layers (`domain/`, `application/`, `adapters/`, `app/`, `ui/`,
  `tokens/`, plus `integration/`). Tests are never colocated with source: the coverage `include`
  only reads `src/**`, and a colocated test would count as uncovered source.
- **No jsdom and no @testing-library anywhere.** Pure logic is unit-tested in the node suite;
  rendered behaviour is tested in Playwright. The two never overlap. A `.tsx` that decides nothing
  (all judgement pushed into a pure `*-vm.ts` builder) needs no unit test of its own — that split is
  deliberate and load-bearing for the coverage gate.
- **Coverage floors:** 100% on `src/domain`, 90% on `src/application`, 90% global. Stryker breaks at
  100% on `src/domain`.
- **`tests/integration/`** has its own Vitest config and script — it is the one place DB access is
  allowed, runs against a real disposable Postgres 18 (never a mock), and is excluded from the unit
  suite and both gates.
- **Playwright serves the production build on port 3100** (not 3000, so a stray `next dev` cannot be
  judged instead). Set `PLAYWRIGHT_BASE_URL` to point the smoke spec at a deployed URL.
  `npm run test:browser` is the DB-free set (accessibility, tokens, shell, import);
  `npm run test:browser:db` needs rows — run `npm run e2e:seed` first.
- The browser suite retries twice **in CI only**, scoped cover for a diagnosed upstream App Router
  soft-navigation stall (vercel/next.js#57565). A test that fails locally in a full parallel run but
  passes in isolation is usually that, not your change — confirm by stashing and re-running.

## Architecture

Four layers, dependencies strictly inward, mechanically enforced by `import/no-restricted-paths` in
`eslint.config.mjs`:

```
src/domain/       pure — imports nothing outside itself; no Date, Math.random, env, fs, Prisma, Next
src/application/  use-cases + the port interfaces they depend on; may import domain
  ports/          repository, clock, prng, id
  use-cases/      one per capability
src/adapters/     all I/O — Prisma, CSV, clock.ts (the only Date.now()), prng.ts (the only randomness)
src/app/          App Router routes; ALSO the composition root — the only layer that may construct
                  an adapter and inject it into a use-case
src/ui/           presentational components; application + domain types only
```

Each layer has its own `README.md` stating its allowed imports — read the one for the layer you are
editing. `src/domain/README.md` additionally documents `money.ts`, whose four constraints are
load-bearing and easy to get wrong.

**Delivery boundary (AD-21).** Reads are Server Components calling use-cases in-process — never
`fetch` to our own origin. Mutations are Server Actions. Only four Route Handlers exist: the CAP-1
multipart upload and three CSV exports. Nothing else gets one.

**Answers carry their receipts (AD-20).** Every computed answer leaves the application layer as a
discriminated union — `{ kind: 'answer', … } | { kind: 'refusal', reason, counts }` |
`{ kind: 'unavailable' }` — carrying value *and* provenance (group definition, `n`, as-of date,
currency, threshold, FX rates with `pinned_on`). A refusal is a return value, never an exception.
Frontends consume the payload **unmodified** and add nothing to the contract.

**The `*-vm.ts` pattern.** Every UI surface splits into a pure `src/ui/<thing>-vm.ts` builder that
makes all the decisions (unit-tested, framework-free) and a `<thing>.tsx` that renders the view-model
and decides nothing. When adding a surface, follow it — it is what keeps `.tsx` out of the coverage
gate honestly.

**Design tokens are generated, never hand-authored.** `src/app/tokens.generated.css` is emitted from
`DESIGN.md`'s frontmatter by `npm run tokens:build`; `npm run tokens:check` fails CI on drift. To
change a color, type style, radius, or spacing step, edit `DESIGN.md` and rebuild. No color literal
is permitted anywhere in `src/` in any notation (hex, `rgb()`, `oklch()`, …), and **no `dark:`
variant** — every color is emitted once under its light name and re-declared under
`prefers-color-scheme: dark`, so `bg-surface-card` is already both. Read `src/ui/README.md` before
styling anything.

## Database

Two roles, deliberately different, and the distinction is the append-only guarantee:

| Variable | Role | Used by |
| --- | --- | --- |
| `DATABASE_URL` | owner | migrations, `prisma generate`, integration + e2e fixtures |
| `DATABASE_URL_APP` | `payroll_app`, restricted | the app at runtime |

`salary_record` is append-only in two layers — `UPDATE`/`DELETE` revoked from `payroll_app`, plus a
`BEFORE UPDATE OR DELETE` trigger that raises for every role including the owner. Appending a record
is the only correction mechanism. Prisma 7 removed `url` from the `datasource` block: connection URLs
live only in `prisma.config.ts`. Role creation is in `prisma/sql/bootstrap-roles.sql`, not a
migration (roles are cluster-wide and break `migrate dev`'s shadow database).

Local setup — container, bootstrap roles, `db:deploy`, `seed` — is in `docs/ENGINEERING.md`
§ Database. The order matters: migrations grant to `payroll_app` and fail if the role does not exist.

## Workflow

- Branch off `master` before committing; merge back with `--no-ff` and a `Merge <branch>: <summary>`
  message. Conventional commit prefixes (`feat`, `fix`, `test`, `docs`, `ci`, `chore`), small and
  incremental — the commit history is part of what is being assessed.
- TDD is Law 1: the failing test is committed red, the next commit greens it. Backend story lands
  fully before the frontend story that consumes it starts.
- Comments in this codebase explain **why**, at length, and frequently record what was tried and
  rejected. Match that register — a change that removes a documented decision should say why in the
  comment it replaces, not silently drop it.
