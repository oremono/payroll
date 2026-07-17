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

The four gates that must stay green: **`build`**, **`typecheck`**, **`lint`**, **`test`**.

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
inward: `domain ← application ← adapters/ui`. The ESLint rule that mechanically enforces this lands
in Story 1-2; until then the layer READMEs are the contract.

## Testing

Vitest is the runner. The domain/application suite touches **no database, no clock, and no
network**, and follows TDD (red → green → refactor). Integration tests against a real Postgres
instance are a separate suite introduced when persistence appears (Story 1-3+).
