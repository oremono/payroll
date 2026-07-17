# Payroll — Salary Management for ACME HR

A Next.js 16 application built on a **functional core / imperative shell** architecture: a pure
`domain`, an `application` layer of use-cases and ports, `adapters` for all I/O, and `app`/`ui`
delivery — with dependencies pointing strictly inward.

This repository is **hand-scaffolded** — not generated from `create-next-app` or any `create-*`
template. See `docs/project-context.md` for the standing engineering Laws and
`docs/planning-artifacts/architecture/` for the architecture spine.

## Prerequisites

- **Node.js 24 LTS** — the pinned runtime. With [nvm](https://github.com/nvm-sh/nvm): `nvm use`
  (reads `.nvmrc`). `package.json` declares `engines.node >=24 <25`.
- **npm** (bundled with Node) — the project uses npm; `package-lock.json` is committed. Do not swap
  in another package manager.

## Install

```bash
npm install
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Next.js dev server at http://localhost:3000 |
| `npm run build` | Production build (`next build`) |
| `npm run start` | Serve the production build (`next start`) |
| `npm run typecheck` | Type-check with `tsc --noEmit` |
| `npm run lint` | Lint with the ESLint CLI (`eslint .`) |
| `npm run test` | Run the Vitest unit suite once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run test:coverage` | Vitest with the coverage floor on `src/domain` + `src/application` |
| `npm run test:mutation` | Stryker mutation testing over `src/domain` (a survivor fails) |
| `npm run test:a11y` | Playwright + axe accessibility pass over the built app |

## Continuous Integration

`.github/workflows/ci.yml` runs on every push (any branch) and every pull request to `master`
(Node 24, `npm ci`). A failing gate blocks merge once the checks are marked **required** in branch
protection.

| Gate | Local command | Enforces |
| --- | --- | --- |
| Lint (import-boundary + purity) | `npm run lint` | Layer import direction; the pure-core ban on the clock (`Date`/`performance`), randomness (`Math.random`/`crypto`), `process.env`, dynamic `import()`, and `fs`/Prisma/Next imports (Law 2, Law 6 / AD-1); the repo-wide `Math.random` ban (AD-14, `src/adapters/prng.ts` exempt) |
| Typecheck | `npm run typecheck` | `tsc --noEmit` |
| Build | `npm run build` | The production build compiles — a named gate, not a side effect of another job |
| Unit + coverage floor | `npm run test:coverage` | Fast deterministic unit suite + per-path coverage floors on `domain` (100) and `application` (90) (AD-23) |
| Mutation testing | `npm run test:mutation` | A surviving mutant over `src/domain` fails the build (AD-23) |
| Accessibility (axe) | `npm run test:a11y` | WCAG 2.2 AA floor over the built app; any violation fails (NFR9) |

**Branch protection:** require these status checks on `master` — **`Lint · Typecheck · Build ·
Unit + Coverage`**, **`Mutation testing (domain)`**, and **`Accessibility (axe)`** (the job names
in `ci.yml`). Configuring branch protection is a repository-admin action in GitHub settings, not
part of the code.

The `test:mutation` and `test:a11y` gates need extra local setup on first run: Stryker downloads
nothing, but the axe gate needs a browser — run `npx playwright install chromium` once.

## Source tree

```
src/
  domain/        # PURE core — no I/O, no clock, no randomness, no Date, no fs
  application/
    ports/       #   repository, clock, prng, id interfaces
    use-cases/   #   one per capability
  adapters/
    db/          #   Prisma client + repositories (from Story 1-3)
    csv/          #   import parse / export render (Epic 2)
    clock.ts     #   the ONLY Date.now() home (seam)
    prng.ts      #   the ONLY randomness home (seam)
  app/           # Next.js App Router surfaces
  ui/            # components; tokens generated from DESIGN.md (Story 1-5)
prisma/          # schema + migrations + seed (Stories 1-3, 12)
tests/           # domain/application unit tests
```

Each `src/*` layer carries a `README.md` stating exactly what it may import. Dependencies point
inward: `domain ← application ← adapters/ui`. This is mechanically enforced in CI by the
`import/no-restricted-paths` zones and the pure-core purity rules in `eslint.config.mjs` (Story
1-2) — a violating import or a stray `Date.now()` in the core fails `npm run lint`.

## Testing

Vitest is the runner. The domain/application suite touches **no database, no clock, and no
network**, and follows TDD (red → green → refactor). Integration tests against a real Postgres
instance are a separate suite introduced when persistence appears (Story 1-3+).
