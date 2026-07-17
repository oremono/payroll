---
baseline_commit: c2069369287fa34c83478730017794ea83c7da39
---

# Story 1.1: Project Scaffold and Source Tree

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the ACME HR engineering team,
I want a hand-scaffolded Next.js 16 application with the functional-core/imperative-shell source tree and every dependency pinned,
so that every later capability story lands on a real, buildable paradigm — pure `domain`, `application`, `adapters`, `app`/`ui` layers with dependencies pointing inward — instead of a `create-*` template that fights our architecture.

## Context & Scope

This is the **first story of Epic 1 (Foundation & Deployable Skeleton)** and the very first slice of the whole system — the Structural Seed (AD-24). It builds *only* the empty-but-real project skeleton: the source tree, the pinned toolchain, a Vitest runner, and a page that boots and builds. Nothing computes a salary yet.

**This is a hand-scaffold, NOT a `create-next-app` (or any `create-*`) clone.** The architecture (epics.md#Additional-Requirements, spine Stack) explicitly rejects a named starter template. Generate the files deliberately; do not run a scaffolding generator and then delete what you don't want.

### In scope (this story)

- `package.json` with **exact** pinned versions and npm scripts.
- Node version pin (`.nvmrc` + `engines`).
- TypeScript strict config with per-layer path aliases.
- The full `src/` layer tree (`domain`, `application/ports`, `application/use-cases`, `adapters/db`, `adapters/csv`, `adapters/clock.ts`, `adapters/prng.ts` seams), `prisma/`, and `tests/` directories, each carrying a boundary README stating its allowed imports (documentation now; mechanical enforcement is Story 1-2).
- A minimal App Router root layout + placeholder page that renders.
- Tailwind CSS v4 pipeline installed and **compiling** with a placeholder (empty) theme — no hex literals, no hand-authored tokens.
- Vitest installed and configured; **one real test-first pure domain unit** proving the runner, path aliases, and the `domain` layer resolve.
- Baseline ESLint (flat config, `eslint-config-next`) run via the ESLint CLI.
- `.gitignore` extended for a Node/Next project; `README.md` with setup + run instructions.
- Green `npm run build`, `npm run dev` (boots), `npm run typecheck`, `npm run test`.

### Explicitly OUT of scope (owned by sibling stories — do NOT build here)

| Concern | Owner |
| --- | --- |
| GitHub Actions CI workflow, coverage floor, mutation testing, axe gate, **the import-boundary lint RULE** | **1-2** ci-pipeline-and-gates |
| Prisma schema, migrations, reference tables, `salary_record`, UPDATE/DELETE revocation | **1-3** data-model-and-migrations |
| `Money` type, currency reference, the one money formatter | **1-4** money-currency-domain-primitives |
| Generated design tokens from `DESIGN.md`, the token build step | **1-5** design-token-build |
| Sidebar IA, header, global as-of date control, shadcn/ui copy-in | **1-6** app-shell-and-as-of-control |

> Set the seams (empty layer folders, `clock.ts`/`prng.ts` placeholders, a compiling-but-empty Tailwind theme) so the sibling stories have a clean place to land. Do **not** pre-implement their content. If you feel pulled to add a token, a Prisma model, or an ESLint boundary rule here — stop; that is another story's Definition of Done.

## Acceptance Criteria

1. **Hand-scaffolded, not generated.** The repository contains a Next.js 16 App Router project authored by hand. No evidence of a `create-*` generator run (no leftover template boilerplate, demo pages, or starter assets). `package.json` is written deliberately.
2. **Exact version pins.** `package.json` pins the versions below with **no `^`/`~` ranges** on these:

   | Dependency | Version |
   | --- | --- |
   | `next` | `16.2.10` |
   | `react` / `react-dom` | `19.2.7` |
   | `typescript` | `5.9.x` (pin a concrete 5.9 patch; **not** 7.x) |
   | `tailwindcss` | `4.3.2` |
   | `vitest` | `4.1.10` |

   Node is pinned to **24 LTS** via `.nvmrc` (`24`) and `engines.node` (`">=24 <25"` or equivalent). Prisma, Playwright, and shadcn/ui are **not** added in this story (their stories add them).
3. **Source tree exists exactly as the spine defines it** (spine §Structural Seed → Source tree). The following directories exist and are committed:
   ```
   src/domain/
   src/application/ports/
   src/application/use-cases/
   src/adapters/db/
   src/adapters/csv/
   src/adapters/clock.ts        # placeholder seam — the ONLY future Date.now()
   src/adapters/prng.ts         # placeholder seam — the ONLY future randomness
   src/app/
   src/ui/
   prisma/                      # empty seam for 1-3
   tests/
   ```
   Empty layer directories are kept in git via a boundary `README.md` (preferred over `.gitkeep`) that states the layer's allowed-imports rule verbatim from the dependency table.
4. **Dependency direction is documented at each layer.** Each of `src/domain`, `src/application`, `src/adapters`, `src/app`, `src/ui` carries a short README stating what it may import (per the table in Dev Notes). `clock.ts` and `prng.ts` are documented as the sole sanctioned homes for `Date.now()` and randomness respectively.
5. **TypeScript strict + path aliases.** `tsconfig.json` has `"strict": true` and `"noUncheckedIndexedAccess": true`, uses the Next 16 module settings (`"module": "esnext"`, `"moduleResolution": "bundler"`, `"jsx": "preserve"`, `"target": "ES2022"` or later), and defines path aliases: `@/domain/*`, `@/application/*`, `@/adapters/*`, `@/app/*`, `@/ui/*` (and `@/*` → `src/*`). `npm run typecheck` (`tsc --noEmit`) passes.
6. **App boots and builds.** A minimal `src/app/layout.tsx` + `src/app/page.tsx` render a placeholder ("Salary Management for ACME HR" heading is fine). `npm run build` (`next build`) completes with no errors; `npm run dev` (`next dev`) serves the placeholder page at `/`.
7. **Tailwind v4 compiles with no tokens.** The Tailwind v4 pipeline (via `@tailwindcss/postcss` or the Next-integrated path) is wired so the global stylesheet compiles into `next build`. The theme is intentionally empty/placeholder — **no hex color literal appears anywhere in `src/`** (AD-15 forbids it; real tokens are generated in 1-5).
8. **Test runner is real and used test-first.** Vitest is configured (`vitest.config.ts`) resolving the same path aliases as `tsconfig`. There is at least one **pure domain unit written test-first** — a genuinely *behavioral*, total function in `src/domain/` (a small input-guard/normalizer with at least one branch, so the test asserts behavior rather than mirroring a constant) with a test in `tests/` that imports it via the `@/domain/*` alias. The commit sequence shows the test landing before or with the code (red → green). `npm run test` passes and touches no DB, clock, or network.
9. **Scripts exist.** `package.json` scripts include at least: `dev`, `build`, `start`, `lint`, `typecheck`, `test` (and `test:watch` optional). `lint` invokes the **ESLint CLI** (`eslint .`) — **not** `next lint`, which is removed in Next 16 — using `eslint-config-next` in flat config, and runs clean.
10. **Hygiene.** `.gitignore` ignores `node_modules/`, `.next/`, `.env*` (keep `.env.example` if added), coverage output, and OS/editor cruft, **without** removing the existing BMAD entries. `README.md` documents prerequisites (Node 24), install, and the four commands above. `package-lock.json` is committed.

## Tasks / Subtasks

- [x] **Task 1 — Toolchain & manifest** (AC: 1, 2, 9, 10)
  - [x] Author `package.json` by hand with exact pins (next 16.2.10, react/react-dom 19.2.7, typescript 5.9.x, tailwindcss 4.3.2, vitest 4.1.10) and the script set.
  - [x] Add `.nvmrc` (`24`) and `engines.node`.
  - [x] Extend `.gitignore` for Node/Next (preserve existing BMAD entries).
  - [x] `npm install`; commit `package-lock.json`.
- [x] **Task 2 — Source tree & boundary docs** (AC: 3, 4)
  - [x] Create every directory in the spine source tree, plus `prisma/` and `tests/`.
  - [x] Add a boundary `README.md` to each `src/*` layer stating its allowed imports.
  - [x] Create `src/adapters/clock.ts` and `src/adapters/prng.ts` as documented placeholder seams (a typed stub that throws "not implemented in 1-1" or an empty export is fine — they are wired in later stories; keep them import-free of domain rules they don't yet need).
- [x] **Task 3 — TypeScript config** (AC: 5)
  - [x] Write `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `module: esnext`, `moduleResolution: bundler`, `jsx: preserve`, `target: ES2022`+, and the `@/*` path aliases. (See Completion Notes: Next 16 mandatorily rewrites `jsx` to `react-jsx` on build.)
  - [x] Wire `typecheck` script; confirm it passes on the skeleton.
- [x] **Task 4 — App Router skeleton** (AC: 6)
  - [x] `src/app/layout.tsx` (root layout, imports the global stylesheet) and `src/app/page.tsx` (placeholder).
  - [x] `next.config.ts` as needed for `src/app` routing.
  - [x] Verify `next build` and `next dev`.
- [x] **Task 5 — Tailwind v4 pipeline (empty theme)** (AC: 7)
  - [x] Install/wire Tailwind v4 + PostCSS integration for Next 16 (`@tailwindcss/postcss` in `postcss.config.mjs`).
  - [x] Global stylesheet with Tailwind layers, **no hex literals / no token values** — placeholder only.
  - [x] Confirm styles compile into the build.
- [x] **Task 6 — Vitest + first test-first domain unit** (AC: 8)
  - [x] Add `vitest.config.ts` with path-alias resolution mirroring tsconfig.
  - [x] **Write the failing test first** in `tests/` against a not-yet-existing pure, branching `src/domain/` helper; watch it fail for the right reason.
  - [x] Implement the minimal domain function to go green; commit in an order that shows red-before-green.
  - [x] Confirm `npm run test` is green and DB/clock/network-free.
- [x] **Task 7 — ESLint baseline & README** (AC: 9, 10)
  - [x] Baseline ESLint in flat config (`eslint.config.mjs`) using `eslint-config-next`; `lint` script runs `eslint .` clean. Do NOT use `next lint` (removed in Next 16), and do NOT author the import-boundary rule (that's 1-2).
  - [x] Write `README.md` (prereqs, install, dev/build/typecheck/test).
- [x] **Task 8 — Final verification** (AC: 6, 9)
  - [x] Run all four gates locally: `build`, `typecheck`, `lint`, `test` — all green. Record outcomes in the Dev Agent Record.

## Dev Notes

### Standing law (read `docs/project-context.md` first)

`docs/project-context.md` is the law inherited on every session. The Laws most load-bearing for **this** story:

- **Law 2 (Functional core, imperative shell):** dependencies point strictly inward `domain ← application ← adapters/ui`. This story *establishes* those layers; get the direction right in the folder structure and the READMEs even though the CI lint that enforces it is 1-2.
- **Law 1 (TDD):** "no production code without a failing test first" — holds "from the very first story (the scaffold)." Your one domain unit (AC 8) must be genuinely test-first, and the commit sequence must show it (CI can't prove ordering — you honor it in commits).
- **Law 6 (Determinism):** no `Date.now()` / `new Date()` / `Math.random` anywhere except the `clock.ts` / `prng.ts` adapter seams. Set those seams here so nothing else is ever tempted.
- **Conventions:** TS files `kebab-case`, types `PascalCase`; no hex literal in application code (Law under Conventions / AD-15).

If any instruction here conflicts with a Law, **stop and surface it** — do not silently comply.

### Architecture patterns & constraints

- **Paradigm — functional core, imperative shell (hexagonal-lite).** [Source: ARCHITECTURE-SPINE.md#Design-Paradigm, AD-1]. The layer table you must encode:

  | Layer | Namespace | May import |
  | --- | --- | --- |
  | Domain (pure core) | `src/domain/` | **nothing** outside `src/domain/**` — no Prisma, no Next, no `Date`, no `Math.random`, no `fs` |
  | Application | `src/application/` | `domain` only |
  | Adapters (shell) | `src/adapters/` | `application`, `domain` |
  | UI / delivery | `src/app/`, `src/ui/` | `application`, `domain` (**types only**) |

  Adapters reach the domain only through ports declared in `src/application/ports/`. [Source: AD-1]
- **Greenfield, no starter kit.** Next.js 16 App Router as a single full-stack deployable; hand-scaffolded, not a `create-*` clone. [Source: epics.md#Additional-Requirements "Greenfield, no starter kit"; spine Stack]
- **The import-boundary lint rule "must exist before the second feature merges."** [Source: AD-1] — that means it is NOT required by *this* story's DoD; it is Story 1-2's. Build the folders and the docs; leave the enforcing rule to 1-2. Documenting this seam correctly is what lets 1-2 drop in cleanly.
- **This is the first vertical slice (the Structural Seed).** [Source: AD-24] The whole of Epic 1 stands up "the import-boundary lint (AD-1), the token build step (AD-15), and the two route handlers (AD-21)" — spread across stories 1-1..1-6. 1-1 owns the tree and toolchain only.

### Source tree to create (verbatim from spine)

[Source: ARCHITECTURE-SPINE.md#Structural-Seed → Source tree]
```
payroll/
  src/
    domain/          # PURE. no I/O, no clock, no random (AD-1)
    application/
      ports/         #   repository, clock, prng, id interfaces (populated later)
      use-cases/     #   one per capability (populated later)
    adapters/
      db/            #   prisma client + repositories (1-3+)
      csv/           #   import parse, export render (Epic 2)
      clock.ts       #   the only Date.now() in the codebase (seam only here)
      prng.ts        #   AD-14 (seam only here)
    app/             # Next.js App Router surfaces (EXPERIENCE.md IA — 1-6)
    ui/              # components; tokens generated from DESIGN.md (AD-15 — 1-5)
  prisma/
    schema.prisma    # created in 1-3, not here
    migrations/
    seed.ts          # CAP-11, Epic 12
  tests/             # domain unit tests + seed obligation tests
```
> `prisma/schema.prisma` and `seed.ts` are named by the spine but **authored in later stories**. Create the `prisma/` directory as a seam; do not write a schema.

### Stack pins (verified 2026-07-17)

[Source: ARCHITECTURE-SPINE.md#Stack; epics.md "Stack pins"; project-context.md#Technology-Stack]

| Tool | Version | Note |
| --- | --- | --- |
| Node.js | 24 LTS | Active LTS until 2026-10-20 |
| TypeScript | 5.9.x | **Pinned — NOT 7.x.** TS 7.0.2 exists but is deferred on the boring-technology principle (spine §Deferred, confirmed by rk). Do not upgrade. |
| Next.js (App Router) | 16.2.10 | |
| React / react-dom | 19.2.7 | |
| Tailwind CSS | 4.3.2 | v4 config-in-CSS model; theme stays empty here (1-5 fills it) |
| Vitest | 4.1.10 | |
| PostgreSQL / Prisma / shadcn / Playwright | — | **Not in this story.** Added by 1-3 / 1-6 / test-arch stories. |

### Testing standards

[Source: ARCHITECTURE-SPINE.md AD-23; project-context.md#Testing; epics.md NFR5/NFR12]

- **Vitest** is the runner. The domain/application suite touches **no DB, no clock, no network** — keep it that way from the first test.
- TDD is the standard: red → green → refactor. The scaffold's testable piece is your one pure domain unit; write its test first.
- Integration tests (real disposable Postgres 18) are a *separate* suite introduced when persistence appears (1-3+) — do **not** set up a DB test harness here.
- Configure Vitest path-alias resolution to mirror `tsconfig` so `@/domain/*` imports resolve identically in tests and in the app.

### Project structure notes

- **Alignment:** the source tree above is the canonical structure; there is no pre-existing code to reconcile against (greenfield — `existing_patterns_found: 0` in project-context.md). Follow it exactly; deviations become drift every later story inherits.
- **Package manager:** use **npm** — config.yaml/spine reference `npm run seed`, `npm run build`; commit `package-lock.json`.
- **Naming:** TS source files `kebab-case` (`app-version.ts`, not `AppVersion.ts`); exported types `PascalCase`. [Source: spine §Consistency Conventions]
- **`.gitignore`:** the repo's current `.gitignore` only holds BMAD/personal entries — you must ADD Node/Next ignores (`node_modules/`, `.next/`, `.env*`, coverage) and must not delete the existing lines.
- **No `role="alert"`, no notification affordances, no red/green semantics** are relevant yet — but the placeholder page must not introduce patterns UX bans (EXPERIENCE.md UX-DR18). Keep the placeholder trivial.

### Anti-patterns to avoid (this story's traps)

- ❌ Running `create-next-app` and pruning it → hand-author instead (AC 1).
- ❌ Caret/tilde ranges on the pinned deps → exact pins (AC 2).
- ❌ Installing Prisma, shadcn/ui, or Playwright "to save a trip later" → out of scope; wrong story's DoD.
- ❌ Writing the ESLint import-boundary rule here → that's 1-2.
- ❌ Any hex color literal or hand-copied token → AD-15; theme stays empty until 1-5.
- ❌ `Date.now()` / `new Date()` / `Math.random()` anywhere except the `clock.ts`/`prng.ts` seams (and even there, only a stub this story).
- ❌ A test that ratifies code written first → genuinely test-first, shown in commit order.

### References

- [Source: docs/project-context.md#The-Laws] — Laws 1, 2, 6, Conventions.
- [Source: docs/planning-artifacts/architecture/architecture-payroll-2026-07-17/ARCHITECTURE-SPINE.md#Design-Paradigm] — layer dependency table.
- [Source: ...ARCHITECTURE-SPINE.md#AD-1] — dependencies point inward; import-boundary lint timing.
- [Source: ...ARCHITECTURE-SPINE.md#AD-23] — tests-first, Vitest, fast/deterministic.
- [Source: ...ARCHITECTURE-SPINE.md#AD-24] — vertical slices; first slice is the Structural Seed.
- [Source: ...ARCHITECTURE-SPINE.md#Stack] and [#Structural-Seed] — versions and source tree.
- [Source: docs/planning-artifacts/epics.md#Epic-1] — Foundation epic scope; "Greenfield, no starter kit."
- [Source: docs/implementation-artifacts/sprint-status.yaml] — story sequence 1-1..1-6 (this story enables all of CAP-1..CAP-11).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Claude Opus 4.8, 1M context) — dev-story workflow.

### Debug Log References

Four gates, all green on the final run (Node v22.22.0 locally — see Completion Notes):

- `npm run build` → ✓ Compiled successfully (Turbopack); TypeScript checked; 3 static routes (`/`, `/_not-found`). No warnings after pinning `turbopack.root`.
- `npm run typecheck` (`tsc --noEmit`) → exit 0.
- `npm run lint` (`eslint .`) → exit 0, clean.
- `npm run test` (`vitest run`) → 1 file, 4 tests passed; no DB/clock/network.
- `npm run dev` → Ready in ~288ms; `GET /` → 200 serving the "Salary Management for ACME HR" heading.
- Hex-literal scan of `src/` → no matches (AC7 / AD-15).

TDD evidence (AC8): the `blankToNull` spec was committed **before** its implementation and observed failing for the right reason (`Cannot find package '@/domain/text'`), then went green after the minimal implementation landed — see the `test(domain): …` → `feat(domain): …` commit pair.

### Completion Notes List

- **Hand-scaffolded, not generated** (AC1): every file authored deliberately; no `create-*` generator was run, no template boilerplate/demo assets exist.
- **Exact pins** (AC2): `next@16.2.10`, `react`/`react-dom@19.2.7`, `typescript@5.9.3` (concrete 5.9 patch — not 7.x), `tailwindcss@4.3.2`, `vitest@4.1.10`, all with no `^`/`~`. Node pinned via `.nvmrc` (`24`) and `engines.node` (`>=24 <25`). Prisma / Playwright / shadcn deliberately **not** added (sibling stories own them).
- **`jsx: "preserve"` → `"react-jsx"` (framework-mandated deviation from AC5's literal wording).** AC5 lists `"jsx": "preserve"`, but Next 16's `next build` performs a *mandatory* reconfiguration of `tsconfig.json`, rewriting `jsx` to `react-jsx` (Next uses the React automatic runtime). Setting it back to `preserve` is overwritten on every build. All other AC5 settings hold verbatim (`strict`, `noUncheckedIndexedAccess`, `module: esnext`, `moduleResolution: bundler`, `target: ES2022`, the `@/*` aliases) and `typecheck` passes. This is a framework requirement, not a Law conflict — surfaced here per the "stop and surface" rule.
- **ESLint pinned to `9.39.5`, not 10.x.** `eslint-config-next@16.2.10` bundles `typescript-eslint@^8.46` whose ESLint peer is `^8.57 || ^9` — ESLint 10 is not yet supported by those plugins. `lint` uses the ESLint **CLI** (`eslint .`), not `next lint` (removed in Next 16), via native flat config (`eslint.config.mjs`); the import-boundary rule is intentionally **left to Story 1-2**.
- **`eslint .` scoped to application source.** Added ignores for tooling/planning dirs (`.claude/**`, `_bmad/**`, `.bmad-loop/**`, `design-artifacts/**`, `docs/**`) so the lint gate covers the app, not BMAD skill templates (one such template referenced an uninstalled rule).
- **Turbopack root pinned** in `next.config.ts` to silence a multiple-lockfile workspace-root warning (a stray `~/package-lock.json` had been inferred as root).
- **Local Node is v22.22.0, target is 24 LTS.** `npm install` emitted the expected `EBADENGINE` warning and proceeded (npm does not enforce `engines` by default; Next 16 requires Node ≥20.9, so all local gates run clean on 22). CI/deploy will run the pinned Node 24.
- **Seams set, not implemented** (out-of-scope guard): `clock.ts`/`prng.ts` are typed stubs that throw; `prisma/` and the `application`/`adapters`/`ui` layers are empty-but-documented. No tokens, no Prisma model, no boundary lint rule were pre-implemented.

### File List

**Added**
- `.nvmrc`
- `README.md`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `next.config.ts`
- `postcss.config.mjs`
- `vitest.config.ts`
- `eslint.config.mjs`
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/globals.css`
- `src/app/README.md`
- `src/domain/text.ts`
- `src/domain/README.md`
- `src/application/README.md`
- `src/application/ports/README.md`
- `src/application/use-cases/README.md`
- `src/adapters/clock.ts`
- `src/adapters/prng.ts`
- `src/adapters/README.md`
- `src/adapters/db/README.md`
- `src/adapters/csv/README.md`
- `src/ui/README.md`
- `prisma/README.md`
- `tests/README.md`
- `tests/domain/text.test.ts`

**Modified**
- `.gitignore` (added Node/Next/TS/coverage/OS ignores; preserved existing BMAD entries)
- `docs/implementation-artifacts/1-1-project-scaffold-and-source-tree.md` (frontmatter `baseline_commit`, task checkboxes, Dev Agent Record, Status)
- `docs/implementation-artifacts/sprint-status.yaml` (1-1 status; `last_updated`)

## Change Log

| Date | Change |
| --- | --- |
| 2026-07-17 | Story 1-1 implemented: hand-scaffolded Next.js 16 app, functional-core/imperative-shell source tree with boundary READMEs, pinned toolchain, Tailwind v4 (empty theme), Vitest with one test-first pure domain unit (`blankToNull`), ESLint flat-config baseline. All four gates (build/typecheck/lint/test) green. Status → review. |
| 2026-07-17 | Code-review fixes: (1) scoped `tsconfig` `exclude` to tooling dirs (`.claude`, `_bmad`, `.bmad-loop`, `design-artifacts`, `docs`) so the `typecheck` gate mirrors the ESLint ignores and won't compile non-app `.ts`; (2) added an internal-whitespace test for `blankToNull` so a strip-all-whitespace mutant is killed (matters for 1-2 mutation testing). Gates re-run green; domain suite now 5 tests. |
