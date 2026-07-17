---
baseline_commit: 0892bc2537ceaf4f892269822e2c0833f1fe466c
---

# Story 1.2: CI Pipeline and Gates

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the ACME HR engineering team,
I want a GitHub Actions CI pipeline that mechanically enforces every standing rail — lint, typecheck, unit tests, the import-boundary / domain-purity rule, a coverage floor on `src/domain` + `src/application`, mutation testing over `src/domain`, and an accessibility (axe) pass,
so that from the second feature onward a failing gate blocks merge and no impure, untested, or inaccessible code can reach `master` by discipline alone.

## Context & Scope

This is the **second story of Epic 1 (Foundation & Deployable Skeleton)**. Story 1-1 hand-scaffolded the app and its four local commands (`build`, `typecheck`, `lint`, `test`) but left every rail **documented, not enforced**: the layer READMEs describe the dependency direction, the `clock.ts`/`prng.ts` seams exist, and one test-first domain unit proves the runner — but nothing in CI stops a regression.

This story turns those documented rules into **mechanical CI gates** (AD-1, AD-23). It is the story the architecture names when it says the import-boundary lint "must exist before the second feature merges" and that CI enforces "a coverage floor on `src/domain` + `src/application`, and mutation testing over `src/domain`."

**After this story:** every push and every PR to `master` runs the full gate set; a failing gate blocks merge; Story 1-3 (data model) and every capability epic thereafter lands on standing rails instead of good intentions.

### In scope (this story)

- **GitHub Actions workflow** (`.github/workflows/ci.yml`) running on push and PR to `master`, on **Node 24** (the pinned runtime), installing with `npm ci` against the committed lockfile.
- **Import-boundary / domain-purity lint rule** — the mechanical enforcement of Law 2 / AD-1:
  - Layer import direction: `domain` imports nothing outside `domain`; `application` imports only `domain`; `adapters` imports `application`+`domain`; `app`/`ui` import `application`+`domain` (types).
  - Ban in `src/domain/**` **and** `src/application/**`: `new Date()`, `Date.now()`, `Math.random()`, and imports of `fs`/`node:fs`, `@prisma/client`/Prisma, and `next` (Law 6 forbids the clock in both layers; Law 2 forbids the rest in domain).
  - The rule runs inside the existing `npm run lint` (`eslint .`) — no new script needed to invoke it, though a dedicated wiring is fine.
- **Coverage floor** — `@vitest/coverage-v8` configured with per-path thresholds on `src/domain/**` and `src/application/**`; a `test:coverage` (or `--coverage`) path the workflow runs; falling below the floor fails the gate.
- **Mutation testing** — Stryker configured to mutate `src/domain/**` using the Vitest runner; a **surviving mutant fails the build**; a `test:mutation` script and a `stryker.config.json`.
- **Accessibility (axe) gate** — an automated axe pass against the built app's placeholder page (`/`), wired as a CI job; **any violation fails the gate**. This proves the rail end-to-end so Story 1-6's real app shell inherits a working gate rather than standing one up from scratch. (See **Decision 1** in Dev Notes — confirm before deferring.)
- **Branch protection intent documented** — the workflow's job/gate names are stable so `master` branch protection can require them; document in `README.md` which checks must be required. (Configuring GitHub branch protection itself is a repo-admin action outside the code, so document it; do not fail the story if the setting can't be applied from code.)
- Update `README.md` with the CI gate list and how to run each gate locally.

### Explicitly OUT of scope (owned by sibling stories — do NOT build here)

| Concern | Owner |
| --- | --- |
| Prisma schema, migrations, reference tables, UPDATE/DELETE revocation, **the adapter integration-test harness against real Postgres 18** | **1-3** data-model-and-migrations |
| `Money` type, currency reference, the one money formatter | **1-4** money-currency-domain-primitives |
| Generated design tokens from `DESIGN.md`, the token build step | **1-5** design-token-build |
| Sidebar IA, header, global as-of date control, shadcn/ui copy-in, **the real app-shell surface the axe gate ultimately guards** | **1-6** app-shell-and-as-of-control |
| Vercel/Neon deploy wiring, `prisma migrate deploy` at build, preview branches | Deployment (later; not an Epic-1 story yet — do not add here) |

> Do **not** add a Postgres integration-test job here — there is no schema to test against until 1-3. This story gates the **pure** suite (domain/application, no DB/clock/network) plus lint, coverage, mutation, and axe. The integration-test gate arrives with 1-3 when persistence appears (AD-24). If you feel pulled to install Prisma or spin up a database in CI — stop; that is 1-3's Definition of Done.

## Acceptance Criteria

1. **CI workflow exists and triggers correctly.** `.github/workflows/ci.yml` runs on `push` and `pull_request` targeting `master`. It uses `actions/setup-node` pinned to **Node 24** (matching `.nvmrc`/`engines`), installs via `npm ci` (not `npm install`), and caches npm. A green run is required for the gates below; a failing gate causes a non-zero workflow conclusion (i.e., blocks merge when the check is required).

2. **Import-boundary layer rule enforced in lint.** `npm run lint` fails when an import violates the layer direction:
   - a file in `src/domain/**` imports anything outside `src/domain/**`;
   - a file in `src/application/**` imports from `src/adapters/**`, `src/app/**`, or `src/ui/**` (it may import `src/domain/**`);
   - a file in `src/adapters/**` imports from `src/app/**`/`src/ui/**`.

   Prove it with a **temporary** violating fixture that makes lint red, then remove it (record the red run in the Dev Agent Record — do not commit the violating fixture to `master`).

3. **Domain/application purity rule enforced in lint.** `npm run lint` fails when a file in `src/domain/**` **or** `src/application/**` contains `new Date(`, `Date.now(`, or `Math.random(`, or imports `fs`/`node:fs`, `@prisma/client`, or `next`. (`clock.ts`/`prng.ts` live in `src/adapters/**` and are unaffected.) The existing `src/domain/text.ts` and its test still pass lint. Prove the ban with a temporary violating snippet that goes red, then remove it.

4. **Coverage floor configured and enforced.** `@vitest/coverage-v8` is installed (pinned to `4.1.10`, matching Vitest) and configured so a coverage run reports **only** `src/domain/**` and `src/application/**`. Per-path thresholds are set (branches, functions, lines, statements). The floor is set to a value the current tree passes and that will bite as code lands (see Dev Notes → Coverage floor). The CI runs coverage and fails below threshold. `src/domain/text.ts` is covered at 100%. The `application` layer currently has no source files — its threshold is satisfied vacuously today and starts biting when 1-3+ adds use-cases; document this, don't special-case it away.

5. **Mutation testing configured and enforced.** Stryker (`@stryker-mutator/core` + `@stryker-mutator/vitest-runner`, pinned `9.6.1`) is configured via `stryker.config.json` to mutate `src/domain/**` and run the Vitest suite. A `test:mutation` npm script exists. The CI runs it and **a surviving mutant fails the gate** (mutation-score threshold `break` set so any survivor is a failure over the current domain surface). `src/domain/text.ts` survives at the required score (the 1-1 internal-whitespace test was added precisely to kill its mutants — verify it still does; if a mutant survives, that is a missing test, not a reason to lower the bar).

6. **Accessibility (axe) gate configured and enforced.** An automated axe pass runs against the built placeholder page (`/`) — Playwright (`@playwright/test`) + `@axe-core/playwright`, or an equivalent real-browser axe harness — and the CI job installs the needed browser, builds/serves the app, and **fails on any axe violation**. The placeholder page (`src/app/layout.tsx`/`page.tsx`) is made axe-clean if it is not already (e.g., `<html lang>`, a `main` landmark, page title, sufficient contrast — no hex literals; use plain semantic HTML, tokens are 1-5). A `test:a11y` (or similarly named) script runs it locally. (If Decision 1 defers axe to 1-6, this AC moves with it — see Dev Notes.)

7. **All gates run in CI and are individually legible.** The workflow surfaces each gate as a distinguishable step or job (lint, typecheck, unit+coverage, mutation, a11y) so a failure names which rail broke and branch protection can require the specific checks. Running the same gates locally is documented.

8. **Green end-to-end on the current tree.** With no product code changed beyond what AC 6 needs for axe-cleanliness (and any minimal refactors to satisfy the new lint rules), the full pipeline passes on the current codebase: lint (incl. boundary + purity), typecheck, unit tests + coverage floor, mutation testing, and axe. Record each gate's outcome in the Dev Agent Record.

9. **Pins and hygiene.** New devDependencies are added with **exact** versions (no `^`/`~`): `@vitest/coverage-v8@4.1.10`, `@stryker-mutator/core@9.6.1`, `@stryker-mutator/vitest-runner@9.6.1`, and the axe/Playwright and ESLint-boundary packages at the versions in Dev Notes (or newer-verified-compatible, recorded with rationale). `package-lock.json` is updated and committed. `.gitignore` covers new outputs (`coverage/`, `reports/` or `.stryker-tmp/`, Playwright artifacts). No pinned version from Story 1-1 is upgraded without a recorded decision.

10. **TDD honored where testable.** The gates that are themselves testable are built test-first per Law 1: the boundary/purity rules are proven by red fixtures before being declared done (AC 2, 3), and the mutation/coverage floors are demonstrated to actually fail when the bar is not met (show the red, then green). CI cannot prove ordering — honor it in the commit sequence and record the evidence.

## Tasks / Subtasks

- [x] **Task 1 — CI workflow skeleton** (AC: 1, 7)
  - [x] Create `.github/workflows/ci.yml`: triggers on `push` + `pull_request` to `master`; `actions/setup-node` at Node 24 with npm cache; `npm ci`.
  - [x] Wire the existing gates first (lint, typecheck, `vitest run`) as named steps/jobs and confirm the workflow is valid before adding new gates.
- [x] **Task 2 — Import-boundary + purity lint rule** (AC: 2, 3, 10)
  - [x] Add the layer-boundary enforcement to `eslint.config.mjs`. **Used the documented fallback `import/no-restricted-paths` (via `eslint-plugin-import`), not `eslint-plugin-boundaries`** — see Completion Notes for why. Defines the allowed-import matrix as zones with alias-resolved paths.
  - [x] Add domain+application purity rules: `no-restricted-syntax` banning `new Date`, `Date.now`, `Math.random`; `no-restricted-imports` banning `fs`/`node:fs`, `@prisma/client`, `next` — scoped by `files: ['src/domain/**', 'src/application/**']`.
  - [x] **Prove red first:** temporary violating fixtures (`Date.now()`/`new Date()`/`Math.random()`, `node:fs` import, domain→adapters, application→adapters) all fired for the right reason; full matrix verified (see Debug Log), fixtures deleted.
  - [x] Confirm `eslint .` is clean on the real tree afterward.
- [x] **Task 3 — Coverage floor** (AC: 4, 10)
  - [x] Install `@vitest/coverage-v8@4.1.10`. Configure `vitest.config.ts` coverage: provider `v8`, `include: ['src/domain/**/*.ts','src/application/**/*.ts']` (scoped to `.ts` — the layer READMEs are not coverable code), and `thresholds` (global 90 floor + `src/domain/**` at 100). **`all` was removed in Vitest 4 — files in `include` are reported by default.**
  - [x] Add a `test:coverage` script; confirmed `src/domain/text.ts` reports 100% and the gate fails (exit 1) when an uncovered domain branch is introduced.
- [x] **Task 4 — Mutation testing (Stryker)** (AC: 5, 9, 10)
  - [x] Install `@stryker-mutator/core@9.6.1` + `@stryker-mutator/vitest-runner@9.6.1`. Add `stryker.config.json`: `testRunner: 'vitest'`, `mutate: ['src/domain/**/*.ts', '!…*.test.ts']`, `thresholds.break: 100`, and `ignorePatterns` scoping the sandbox to app source.
  - [x] Add `test:mutation` script. Ran it; `text.ts` has **no** surviving mutants (5 killed, score 100). Verified a deliberately-untested mutant drops the score to 71.43 and fails the build (exit 1).
- [x] **Task 4b — Wire coverage + mutation into CI** (AC: 1, 7)
  - [x] Coverage runs in the `check` job (`test:coverage`); mutation runs in its own `mutation` job.
- [x] **Task 5 — Accessibility (axe) gate** (AC: 6, 7, 9) — *Decision 1: kept axe in 1-2 (honors the 1-1 hand-off)*
  - [x] Install `@playwright/test@1.61.1` + `@axe-core/playwright@4.12.1`. Added `playwright.config.ts` with a `webServer` that builds+serves the production app (`npm run build && npm run start`).
  - [x] Wrote an axe test (`e2e/accessibility.spec.ts`) hitting `/` asserting zero WCAG 2.2 AA violations. The 1-1 placeholder page was already axe-clean (`<html lang>`, `<main>`, title, default-contrast text, no hex literals) — no change needed. Verified the gate fails on an injected `image-alt` violation.
  - [x] Added `test:a11y` script and the `a11y` CI job that installs the browser (`npx playwright install --with-deps chromium`) and runs it.
- [x] **Task 6 — Hygiene, docs, branch-protection note** (AC: 7, 9)
  - [x] `.gitignore`: added Stryker outputs (`reports/`, `.stryker-tmp/`) and Playwright artifacts (`test-results/`, `playwright-report/`, `.playwright/`); `coverage/` was already present from 1-1.
  - [x] `README.md`: added a Continuous Integration section listing every gate, its local command, and the three required status checks for `master` branch protection.
- [x] **Task 7 — Final verification** (AC: 8)
  - [x] Ran every gate locally green: `lint`, `typecheck`, `test:coverage`, `test:mutation`, `test:a11y`, `build`. Outcomes recorded in the Debug Log. (The GitHub Actions run itself triggers on push — the branch is ready to push and open a PR; the remote run has not yet been observed from this session.)

### Review Findings

- [x] [Review][Decision] Layer matrix gaps frozen into a merge-blocking gate — **RESOLVED (user): add `app → adapters` now.** The app zone gained the composition-root edge and the `app → ui` edge was recorded; `src/app/README.md` documents both as recorded extensions of the base matrix. `ui → adapters` verified still blocked.
- [x] [Review][Decision] Commit sequence has a broken intermediate commit — **RESOLVED (user): rewrite history.** Branch soft-reset and re-committed in self-consistent increments (deps → lint gates → coverage → mutation → a11y → docs); each commit's workflow references only gates that exist at that commit.
- [x] [Review][Patch] Extension hole in every gate: lint boundary+purity globs cover only `{ts,tsx}` while `allowJs: true` compiles `.js`/`.jsx`/`.mts`/`.cts` — fixed: all gates now glob `{js,jsx,ts,tsx,mjs,cjs,mts,cts}` (lint), `{ts,tsx,js,jsx,mts,cts}` (coverage), `{ts,tsx}` (Stryker); the `.js` probe now errors [eslint.config.mjs; vitest.config.ts; stryker.config.json]
- [x] [Review][Patch] Purity ban escapes — fixed with new selectors: bare `Date()`, `Date.now` as member ref, `globalThis|window|self.Date`, `Math.random` as member ref, `crypto.randomUUID/getRandomValues`, `performance.now`, `process.env`, all dynamic `import()`; plus import bans on `crypto`/`child_process`/`perf_hooks`. All 9 probes re-verified as caught [eslint.config.mjs]
- [x] [Review][Patch] `Math.random` ban made repo-wide per AD-14 — a global config block (placed before the purity block so flat-config rule replacement keeps the pure layers' fuller array) bans it everywhere; `src/adapters/prng.ts` is the single exemption (verified) [eslint.config.mjs]
- [x] [Review][Patch] Standalone build gate added as a named `Build` step in the `check` job; README gate table regained the build row [ci.yml; README.md]
- [x] [Review][Patch] `cancel-in-progress` now conditional: `${{ github.ref != 'refs/heads/master' }}` — master runs always complete [ci.yml]
- [x] [Review][Patch] Coverage: per-path `src/application/**` threshold (90) added alongside domain (100); `exclude: ['**/*.{test,spec}.*']` guards against colocated test files; verified the vacuous glob doesn't error today [vitest.config.ts]
- [x] [Review][Patch] `push` trigger widened to `branches: ['**']` — story branches get CI before any PR exists [ci.yml]
- [x] [Review][Patch] Stryker: negation now `*.{test,spec}.{ts,tsx}`, mutate covers `.tsx`, sandbox ignores `.next` and `e2e` [stryker.config.json]
- [x] [Review][Patch] Playwright: dedicated port 3100 (`next start -- --port 3100`) so a local `next dev` on 3000 is never silently audited; `trace: 'retain-on-failure'` (retries=0 made the old value dead); `timeout-minutes` 10/10/15 on the three CI jobs [playwright.config.ts; ci.yml]
- [x] [Review][Patch] `.gitignore` outputs root-anchored (`/reports/`, `/test-results/`, `/playwright-report/`, `/.stryker-tmp/`, `/.playwright/`) so a future `src/app/reports/` stays tracked [.gitignore]
- [x] [Review][Patch] Deviations recorded in Completion Notes: resolver `3.10.1` rationale; `Math.random` story-vs-law scope (now moot — repo-wide ban implemented) [this file]
- [x] [Review][Defer] `ui → application` "types only" is stated in the zone message but not mechanically enforced (value imports pass) — deferred: the `ui` layer is empty until Story 1-6; enforce a type-only carve-out when the first component lands [eslint.config.mjs] (tracked in deferred-work.md)

## Dev Notes

### Standing law (read `docs/project-context.md` first)

`docs/project-context.md` is the law inherited every session. The Laws most load-bearing for **this** story:

- **Law 1 (TDD):** the pipeline's testable pieces are built test-first — prove each new gate *fails* before it passes (red boundary fixtures; a demonstrated coverage/mutation failure). CI can't prove ordering; the commit sequence must show it.
- **Law 2 (Functional core, imperative shell):** this story is the *mechanical enforcement* of the dependency direction the 1-1 READMEs only documented. Get the allowed-import matrix exactly right.
- **Law 6 (Determinism):** "No code in `src/domain/**` or `src/application/**` calls `Date.now()`, `new Date()`, or reads a timezone." The purity lint rule must cover **both** layers, not just domain — the clock port (an adapter) is the only sanctioned "now".
- **Conventions:** TS files `kebab-case`; no hex literal in application code (relevant if you touch the placeholder page for axe — use semantic HTML only, real tokens are 1-5).

If any instruction here conflicts with a Law, **stop and surface it** — do not silently comply.

### Decision 1 — Is the axe gate in 1-2 or deferred to 1-6? (confirm)

Story 1-1's out-of-scope table explicitly hands the **"axe gate"** to **1-2**, and both `epics.md` (Epic 1 NFR9) and the spine (Consistency Conventions → Accessibility) list axe as a CI gate *established in Epic 1*. So the default here is: **wire axe now against the placeholder page**, proving the rail end-to-end so 1-6 inherits a working gate. The cost is pulling Playwright + a browser download into CI a little early, and making the placeholder page axe-clean.

The alternative is to **defer only the axe wiring to 1-6** (when the real app shell exists and the gate has real content to guard), and ship 1-2 as the code-gates story (lint/boundary/purity, coverage, mutation) alone. If you take this path, move AC 6 and Task 5 to 1-6, note it in both story files and the sprint change log, and keep the CI job structure ready for it.

**Recommended: keep axe in 1-2** (honors the 1-1 hand-off; establishes the standing rail). Surface this to the user if you disagree before deferring.

### Architecture patterns & constraints

- **AD-1 — dependencies point inward, mechanically enforced.** "Enforced in CI by an import-boundary lint rule, which must exist before the second feature merges. CI runs lint, typecheck, and unit tests on every push; a failing gate blocks merge." [Source: ARCHITECTURE-SPINE.md#AD-1]. **This story is that rule.** The allowed-import matrix (from project-context.md#Source-Tree and the 1-1 READMEs):

  | Layer | May import |
  | --- | --- |
  | `src/domain/**` | **nothing** outside `src/domain/**` |
  | `src/application/**` | `domain` only |
  | `src/adapters/**` | `application`, `domain` |
  | `src/app/**`, `src/ui/**` | `application`, `domain` (types only) |

- **AD-23 — tests are written first; CI enforces coverage + mutation.** "What CI *does* enforce mechanically: a **coverage floor** on `src/domain/**` and `src/application/**`, and **mutation testing** over `src/domain/**` — a surviving mutant … fails the gate alongside lint, typecheck, and the unit suite." [Source: ARCHITECTURE-SPINE.md#AD-23]. Coverage floor spans **domain + application**; mutation testing is **domain only**.
- **Accessibility gate.** "WCAG 2.2 AA is the floor on every surface … gated in CI by an automated axe pass alongside lint and typecheck." [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions → Accessibility; epics.md NFR9]. "Automated gates do not discharge the manual keyboard and screen-reader checks the floor names" — so the axe job is a floor, not the whole accessibility story.
- **The pure core is what makes coverage/mutation cheap.** No DB, no clock, no network in the domain/application suite (AD-11) — keep the coverage/mutation runs on that fast suite. Do **not** add a Postgres or integration harness here (that's 1-3, AD-24).
- **Delivery is standing rails first.** "The first slice is the foundational app shell (the Structural Seed) — the import-boundary lint (AD-1), the token build step (AD-15), and the two route handlers (AD-21) — so every capability slice afterward lands on standing rails." [Source: ARCHITECTURE-SPINE.md#AD-24]. 1-2 owns the import-boundary lint slice of that.

### Files being modified (current state — read before changing)

- `eslint.config.mjs` — currently `...eslint-config-next/core-web-vitals` + an `ignores` block; **it explicitly says the import-boundary rule is 1-2's job** ("Do not add it here"). This story removes that caveat and adds the rules. Preserve the existing ignores (`.claude/**`, `_bmad/**`, `docs/**`, etc.) — the lint gate must stay scoped to app source, not BMAD templates.
- `vitest.config.ts` — currently resolves `@/*` aliases and includes `tests/**`. Add a `coverage` block; **do not** change `include` (the suite stays `tests/**`, domain/application-only). Coverage `include` is a separate list pointing at `src/domain/**` + `src/application/**`.
- `package.json` — scripts `dev/build/start/lint/typecheck/test/test:watch`. Add `test:coverage`, `test:mutation`, and (if Decision 1 keeps axe) `test:a11y`. Add the new devDependencies with exact pins.
- `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css` — the placeholder surface the axe gate scans. Read them; the h1 "Salary Management for ACME HR" is fine, but ensure `<html lang="en">`, a `<main>` landmark, a `<title>`, and adequate contrast so axe passes. No hex literals (AD-15).
- `.gitignore` — has Node/Next/coverage/BMAD entries; add Stryker + Playwright outputs.
- `README.md` — add the CI section.

### Latest tool versions (verified 2026-07-17 via npm registry)

| Package | Version | Why / peer notes |
| --- | --- | --- |
| `@vitest/coverage-v8` | `4.1.10` | Must match Vitest exactly (peer `vitest: 4.1.10`). |
| `@stryker-mutator/core` | `9.6.1` | Latest; no restrictive peers. |
| `@stryker-mutator/vitest-runner` | `9.6.1` | Peer `vitest: >=2.0.0` → Vitest 4 OK; peer `@stryker-mutator/core: 9.6.1`. |
| `@playwright/test` | `1.61.1` | Spine lists Playwright as an *assumption* ("1.5x"); `1.61.1` is current — record the pin. Only for the axe job. |
| `@axe-core/playwright` | `4.12.1` | Peer `playwright-core >= 1.0.0`. |
| `eslint-plugin-boundaries` | `7.0.2` | Purpose-built layer-boundary plugin; flat-config capable; peer `eslint >=6`. **Fallback:** `import/no-restricted-paths` via the already-present `eslint-plugin-import` (no new dep) if boundaries' flat config gives trouble. |
| `eslint-import-resolver-typescript` | `4.4.5` | Already present transitively; ensures TS path aliases resolve for import rules. |

> Pin exactly (AC 9). If a newer version is required for ESLint 9 / flat-config compatibility, record the substitution and why in Completion Notes. Do **not** upgrade any Story-1-1 pin (Next/React/TS/Tailwind/Vitest/ESLint) — ESLint stays `9.39.5` (10.x is unsupported by the bundled `typescript-eslint`, per 1-1 notes).

### Purity rule — note the two mechanisms

The domain-purity ban is **not** only an import rule. `fs`, `@prisma/client`, `next` are caught by `no-restricted-imports`, but `new Date()`, `Date.now()`, and `Math.random()` are **global/member expressions, not imports** — catch them with `no-restricted-globals` (for the `Date` global) and/or `no-restricted-syntax` selectors, e.g.:
- `NewExpression[callee.name='Date']`
- `CallExpression[callee.object.name='Date'][callee.property.name='now']`
- `CallExpression[callee.object.name='Math'][callee.property.name='random']`

Apply these to `files: ['src/domain/**/*.ts','src/application/**/*.ts']`. The outward-import ban (domain → non-domain) is the boundaries/`no-restricted-paths` mechanism.

### Coverage floor — concrete guidance

- Report scope is the code, not the tests: `coverage.include = ['src/domain/**','src/application/**']`, `all: true` so uncovered files count.
- Set the floor high but honest. Recommended start: **`branches`/`functions`/`lines`/`statements` ≥ 90** globally over the include set, with the expectation the domain trends to 100 (the pure core is trivially coverable; mutation testing is the real teeth). If you prefer per-path thresholds, set `src/domain/**` at 100 and `src/application/**` at a floor that is vacuously green today.
- **Empty `application` layer:** it has only READMEs right now, so it contributes no coverable lines. Confirm the coverage run doesn't error on the empty include and that thresholds are satisfied (vacuously) today; the gate begins biting when 1-3+ adds use-cases. Note this behavior rather than excluding the path.

### Mutation testing — concrete guidance

- `stryker.config.json`: `{"testRunner":"vitest","mutate":["src/domain/**/*.ts","!src/domain/**/*.test.ts"],"reporters":["clear-text","progress"],"thresholds":{"break":100}}` (adjust `break` to the level that fails on any survivor over today's tiny surface — 100 is reasonable while the domain is one pure helper; revisit only with a recorded decision as the domain grows).
- The Vitest runner reuses `vitest.config.ts`. Keep mutation over **domain only** (AD-23) — do not mutate `application`, `adapters`, or `app`.
- `src/domain/text.ts` (`blankToNull`) already has an internal-whitespace test added in 1-1 specifically to kill a strip-all-whitespace mutant. Verify Stryker reports no survivors; if one survives, the missing test is the fix.

### Testing standards

[Source: ARCHITECTURE-SPINE.md#AD-23; project-context.md#Testing; epics.md NFR5/NFR12]

- Vitest is the runner; the domain/application suite touches **no DB, no clock, no network** — coverage and mutation run over that fast suite. Keep it that way.
- The **axe** test is a browser test (Playwright), a *separate* project from the Vitest unit suite — it must not be pulled into `vitest run` (which stays DB/clock/network-free). Keep the Playwright config and the axe test out of `tests/**` (e.g., under `e2e/` or `tests-a11y/`) so `vitest.config.ts`'s `include: ['tests/**']` doesn't try to run it.
- Integration tests against real Postgres 18 are **1-3's**, not this story's — do not add a DB job.

### Project structure notes

- **Alignment:** no conflict with the 1-1 tree — this story adds config + a workflow, not new source layers. The one edit to product code is making the placeholder page axe-clean (semantic HTML only).
- **Package manager:** npm; CI uses `npm ci` against the committed `package-lock.json` (AC 1). Commit the updated lockfile.
- **Node in CI:** pin `actions/setup-node` to Node 24 to match `.nvmrc`/`engines`; local dev on Node 22 (per 1-1 notes) still works but CI is the source of truth for the gates.
- **Keep gates legible:** name the steps/jobs so branch protection can require them and a red run names the broken rail (AC 7).

### Anti-patterns to avoid (this story's traps)

- ❌ Enforcing only the *import* direction and forgetting `new Date()`/`Date.now()`/`Math.random()` (globals, not imports) → the purity rule needs `no-restricted-syntax`/`no-restricted-globals` too.
- ❌ Applying the purity ban to `domain` only → Law 6 and AD-23 span **domain + application**; the clock ban covers both.
- ❌ Adding a Postgres/integration job "while we're in CI" → that's 1-3 (AD-24). No DB here.
- ❌ Mutating `application`/`adapters` → mutation testing is **domain only** (AD-23).
- ❌ Letting the axe/Playwright test get swept into `vitest run` → keep it in a separate directory/project.
- ❌ Lowering the coverage floor or Stryker `break` to make a survivor "pass" → a survivor is a missing test; add the test (AC 5, 10).
- ❌ Caret/tilde ranges on the new devDeps, or upgrading a 1-1 pin → exact pins; no silent upgrades (AC 9).
- ❌ Committing the temporary red boundary/purity fixtures to `master` → prove red, record it, delete them (AC 2, 3, 10).
- ❌ A hex color literal while making the page axe-clean → AD-15; semantic HTML only, tokens are 1-5.

### References

- [Source: docs/project-context.md#The-Laws] — Laws 1 (TDD), 2 (functional core), 6 (determinism), Conventions.
- [Source: docs/project-context.md#Source-Tree-and-Boundaries] — the allowed-import matrix; "An import-boundary lint rule enforces this in CI and must exist before the second feature merges."
- [Source: docs/planning-artifacts/architecture/architecture-payroll-2026-07-17/ARCHITECTURE-SPINE.md#AD-1] — import-boundary lint, CI blocks merge.
- [Source: ...ARCHITECTURE-SPINE.md#AD-23] — coverage floor (domain+application) + mutation testing (domain); test-first enforced in review.
- [Source: ...ARCHITECTURE-SPINE.md#AD-24] — standing rails first; integration tests are the *next* story's, not this one's.
- [Source: ...ARCHITECTURE-SPINE.md#Consistency-Conventions] — accessibility gated by an automated axe pass.
- [Source: docs/planning-artifacts/epics.md#Epic-1] — Foundation epic; "CI pipeline … lint, typecheck, unit tests, the import-boundary rule, axe, a coverage floor …, and mutation testing"; NFR9, NFR12.
- [Source: docs/implementation-artifacts/1-1-project-scaffold-and-source-tree.md] — 1-1 out-of-scope table hands CI/coverage/mutation/axe/import-boundary rule to 1-2; ESLint pinned `9.39.5`; the whitespace test added to kill a `blankToNull` mutant.
- [Source: docs/implementation-artifacts/sprint-status.yaml] — story sequence 1-1 (done) → 1-2 (this) → 1-3.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Claude Opus 4.8, 1M context) — dev-story workflow.

### Debug Log References

All six gates green on the final run (local Node v22.22.0 — see Completion Notes; CI runs the pinned Node 24):

- `npm run lint` (`eslint .`, incl. import-boundary + purity) → exit 0, clean.
- `npm run typecheck` (`tsc --noEmit`, now also covers `e2e/` + `playwright.config.ts`) → exit 0.
- `npm run test:coverage` → 5 tests pass; domain 100% (2/2 stmts, 2/2 branch, 1/1 func); floor holds.
- `npm run test:mutation` → 5 killed, 0 survived, score 100.00 ≥ break 100; Done in ~2s.
- `npm run test:a11y` → 1 axe test passes (WCAG 2.2 AA over the built `/`) in ~9s.
- `npm run build` → compiles successfully.

**TDD / gate-bite evidence (Law 1, AC 2/3/4/5/6/10) — each new gate proven to fail before trusting it:**

- **Boundary + purity (lint):** temporary domain fixtures fired correctly — `Date.now()`, `Math.random()`, `new Date()`, and `node:fs` import each errored (`no-restricted-syntax` / `no-restricted-imports`); `@/adapters/clock` import from domain and `@/adapters` import from application each errored (`import/no-restricted-paths`). Control cases passed: `adapters → domain`, `app → ui`. Fixtures deleted; real tree lints clean.
- **Coverage floor:** an uncovered domain branch dropped coverage to 40% and failed both the global (90%) and `src/domain/**` (100%) thresholds, exit 1. Removed → clean.
- **Mutation:** a deliberately-untested `addOne` domain fn left a surviving `+`→`-` mutant, dropping the score to 71.43 < break 100, exit 1. Removed → score back to 100.
- **Axe:** an injected `<img>` without `alt` produced an `image-alt` violation and failed the test. Reverted → clean.

### Completion Notes List

- **Layer-boundary rule: used the documented fallback, not `eslint-plugin-boundaries`.** The story recommended `eslint-plugin-boundaries@7.0.2` with `import/no-restricted-paths` as an acceptable fallback. Boundaries v7 renamed its whole API (`boundaries/dependencies` + `policies` + `partialMatch`) and, more decisively, would not classify our files without extra resolver wiring (it left every `src/**` file `isUnknown`). `import/no-restricted-paths` (via `eslint-plugin-import`, already in the tree from `eslint-config-next`) resolves each import to a real file through the **existing TypeScript alias resolver**, so `@/adapters/clock` maps correctly, and it enforces the exact allowed-import matrix as zones. Simpler, fewer moving parts, and it reuses infrastructure Next already configures. Removed `eslint-plugin-boundaries`; added `eslint-plugin-import@2.32.0` + `eslint-import-resolver-typescript@3.10.1` as **explicit** exact-pinned devDeps (they were previously only transitive).
- **Purity ban spans domain AND application (Law 6).** `no-restricted-syntax` selectors (`new Date`, `Date.now`, `Math.random`) + `no-restricted-imports` (`fs`/`node:fs`/`@prisma/client`/`next`) are scoped to `files: ['src/domain/**','src/application/**']`. The `Date`/`Math` bans are member/`NewExpression` selectors — globals, not imports — exactly as the story flagged.
- **`all` removed in Vitest 4.** `coverage.all` no longer exists in Vitest 4's `CoverageOptions` (files in `include` are reported by default). Dropped it. Also scoped `include` to `**/*.ts` — the initial `src/**` glob matched the layer `README.md` files, which the v8 provider tried to parse as JS (Rolldown parse errors) and which broke uncovered-file collection so the floor didn't bite. Restricting to `.ts` fixed both.
- **Coverage floor = global 90 + `src/domain/**` at 100.** The application layer has no source files yet, so the global figure is computed over domain alone today (passes high); it starts biting the application layer as use-cases land in 1-3+. The pure core is held at 100 (mutation testing is the real teeth).
- **Stryker sandbox scoped with `ignorePatterns`.** By default Stryker copies the whole repo into its sandbox and its TS-check preprocessor choked on a BMAD skill `.html` template. Added `ignorePatterns` for the tooling/planning dirs (`.claude`, `_bmad`, `.bmad-loop`, `design-artifacts`, `docs`, plus build outputs). Removed JSON `_comment` keys — Stryker validates config and rejects unknown options.
- **Axe gate kept in 1-2 (Decision 1).** Honored the 1-1 hand-off; the placeholder page from 1-1 was already axe-clean (`<html lang>`, `<main>`, `<title>`, default-contrast text, no hex literals), so no product code changed. The axe test lives under `e2e/` with its own Playwright runner so it never enters the Vitest suite (which stays DB/clock/network-free, AD-23). `webServer` builds + serves the production output. **First-run setup:** `npx playwright install chromium` (the CI `a11y` job does `--with-deps chromium`).
- **No Postgres/integration job.** Deliberately out of scope — that gate arrives with 1-3 when persistence exists (AD-24).
- **No 1-1 pin upgraded.** ESLint stays `9.39.5`; Next/React/TS/Tailwind/Vitest unchanged. All new devDeps are exact-pinned (AC 9).
- **Local Node is v22.22.0, target is 24 LTS.** `npm ci`/`install` emit the expected `EBADENGINE` warning and proceed; all gates run clean on 22. CI pins Node 24 via `.nvmrc`.
- **Post-review hardening (code review, 2026-07-18).** The adversarial review empirically confirmed lint bypasses that were then closed: extension holes (`.js` in a layer linted clean under `allowJs: true`), purity escapes (bare `Date()`, `globalThis.Date`, `crypto.randomUUID`, `performance.now`, `process.env`, dynamic `import()`), and the `Math.random` ban was widened to repo-wide per AD-14 (AC 3 asked pure-layers-only; the law says repo-wide — the law wins, `prng.ts` exempt). CI gained a named Build gate, conditional cancel-in-progress (master runs always complete), all-branch push triggers, and job timeouts. Coverage gained a per-path `application` floor + colocated-test exclude; Stryker's negation and sandbox were tightened; Playwright moved to a dedicated port 3100 with `retain-on-failure` traces.
- **Recorded matrix extensions (user-approved):** `app → adapters` (composition root — Server Components/Server Actions construct adapters and inject them into use-cases; the only place shell wiring may happen) and `app → ui` (pages render components). Documented in `src/app/README.md`; `ui → adapters` remains blocked.
- **`eslint-import-resolver-typescript` pinned `3.10.1`, not the Dev-Notes `4.4.5`:** 3.10.1 is the exact version `eslint-config-next@16.2.10` already ships transitively — pinning the same version avoids two resolver majors in one tree; 4.x offers nothing the zones need.

### File List

**Added**
- `.github/workflows/ci.yml`
- `stryker.config.json`
- `playwright.config.ts`
- `e2e/accessibility.spec.ts`

**Added (review)**
- `docs/implementation-artifacts/deferred-work.md`

**Modified**
- `eslint.config.mjs` (import-boundary zones + domain/application purity rules + repo-wide Math.random ban; ignore new output dirs)
- `vitest.config.ts` (coverage floor: v8 provider, domain+application include, per-path thresholds, test-file exclude)
- `package.json` (scripts `test:coverage`/`test:mutation`/`test:a11y`; new exact-pinned devDeps)
- `package-lock.json`
- `.gitignore` (Stryker + Playwright output dirs, root-anchored)
- `README.md` (Continuous Integration section incl. Build gate; boundary-rule note updated to "enforced")
- `src/app/README.md` (recorded matrix extensions: app → ui, app → adapters composition root)
- `docs/implementation-artifacts/1-2-ci-pipeline-and-gates.md` (task checkboxes, Dev Agent Record, Review Findings, Status)
- `docs/implementation-artifacts/sprint-status.yaml` (1-2 status; `last_updated`)

## Change Log

| Date | Change |
| --- | --- |
| 2026-07-18 | Story 1-2 implemented: GitHub Actions CI (`ci.yml`) on push/PR to master; import-boundary + pure-core purity lint (`import/no-restricted-paths` + `no-restricted-syntax`/`-imports`); coverage floor on domain+application (`@vitest/coverage-v8`); domain mutation testing (Stryker, break=100); axe accessibility gate (Playwright + `@axe-core/playwright`) over the built app. Each gate proven to fail before trusting it (TDD). All six gates green locally. Status → review. |
| 2026-07-18 | Code review (3 adversarial layers): 2 decisions resolved (app→adapters composition-root edge added + recorded; history rewritten into self-consistent increments), 11 patches applied (extension holes closed, purity escapes closed, repo-wide Math.random ban, named Build gate, conditional cancel-in-progress, all-branch push CI, per-path application coverage floor, Stryker/Playwright/gitignore hardening, deviations recorded), 1 deferred (ui→application types-only enforcement → 1-6, in deferred-work.md), 1 dismissed. All gates re-verified green. Status → done. |
