# Epic 1 Context: Foundation & Deployable Skeleton

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Stand up a deployed, empty-but-real application on the target stack so that every capability epic afterward lands on standing rails. This epic delivers the functional-core/imperative-shell source tree, the CI gate set, the full data model with reference tables and migrations, the deployment pipeline itself, the money/currency domain primitives, the generated design-token system, and the app shell with sidebar navigation and the global as-of date control. It covers no user-facing capability directly; its value is that after it, a person can open the deployed app and see the shell, and every later epic has a paradigm, a schema, tokens, and a test-first CI pipeline to build into.

## Stories

Execution order is the row order below (the `1-7` key is historical — deployment is sequenced third, immediately after the data model).

- Story 1.1: Project scaffold and source tree
- Story 1.2: CI pipeline and gates
- Story 1.3: Data model and migrations
- Story 1.7: Deployment and environments
- Story 1.4: Money/currency domain primitives
- Story 1.5: Design token build
- Story 1.6: App shell and as-of control

## Requirements & Constraints

- **Determinism.** Every answer must be a pure function of the data plus a supplied as-of date (and, where relevant, a threshold). No domain code reads the wall clock; the as-of date is a parameter passed inward, never a reading taken inside.
- **Currency always visible.** No salary value is ever displayed or passed without its currency. Money is integer minor units plus an ISO-4217 code — never a bare number, never a float. The minor-unit exponent comes from the currency reference table, never a hard-coded 100. Across JSON and Server Action boundaries the minor amount serializes as a decimal string, never a JS number or raw bigint.
- **Append-only salary history.** Salary records are append-only and effective-dated. This is enforced at the database role (UPDATE/DELETE revoked, plus an unbypassable trigger), not by convention. No future-dating, no scheduled changes, no retroactive correction.
- **Fast deterministic tests.** Core logic is covered by unit tests with no database, no clock, and no network. Integration tests are the one place DB access is allowed and live outside the domain suite.
- **Test-first development.** TDD is the standard: a failing test precedes the code that satisfies it. Ordering is enforced in review via the commit sequence; CI enforces it mechanically through a coverage floor on the domain and application layers and mutation testing over the domain layer (a surviving mutant fails the gate).
- **Accessibility floor.** WCAG 2.2 AA across the desktop web surface, gated in CI by an automated axe pass. Color is never the sole carrier of meaning.
- **Desktop surface.** 1280px+ is the primary target; 768–1279px prioritizes columns and stacks card grids. No mobile layout is specified.
- **Deployed and reachable.** The product must be live on the target hosting stack with migrations applied at build and a database branch created per pull request. The end-to-end demonstration of an outlier and a refusal is not this epic's obligation — it is verified after the peer-comparison, outlier, and seed epics.

## Technical Decisions

- **Greenfield, hand-scaffolded.** A single full-stack Next.js App Router deployable, scaffolded by hand rather than cloned from a starter template.
- **Functional core, imperative shell.** Source layout: a pure `domain` layer, an `application` layer holding use-cases and ports (repository, clock, prng, id), an `adapters` layer (prisma/db, csv, clock, prng), and the Next.js app plus UI components. Dependencies point strictly inward; adapters reach the domain only through declared ports.
- **Import-boundary lint gate.** A CI lint rule forbids the domain layer from importing Prisma, Next, `Date`, `Math.random`, or `fs`. It must exist before the second feature merges. `Math.random` is banned repo-wide; randomness is injected and seeded.
- **CI gate set.** Every push runs lint, typecheck, unit tests, the import-boundary rule, an axe accessibility pass, the coverage floor, and domain mutation testing. A failing gate blocks merge.
- **Data model.** `employee` (UUIDv7 id, immutable country), `salary_record` (BIGSERIAL insertion sequence for same-date tie-break, positive-amount CHECK, currency code, effective-from DATE), reference tables for role, level, country, and currency (with minor-unit exponent), an FX rate table with from/to/rate/pinned-on, and a single-row settings table holding the outlier threshold and reporting currency. A peer group is `(role, level, country)` derived at read time — never a table. An employee may have zero salary records.
- **One canonical resolver each.** A single median function, a single current-salary resolver (greatest effective-from, then insertion sequence, at or before the as-of date), a single verdict-sentence composer, and a single money formatter that does not typecheck without a currency. No capability writes its own.
- **Delivery boundary.** Server Components call use-cases in-process (no self-fetch); mutations are Server Actions; exactly two Route Handlers will ever exist (the import multipart upload and CSV export downloads).
- **Answer payload shape.** Computed answers cross the boundary as a discriminated union of answer or refusal, carrying value and provenance (group, n, as-of date, currency, threshold, rate and pinned date) in one object. A refusal is a return value, never an exception. This shape is established here and consumed by every later epic.
- **Design tokens are generated, not copied.** A build step emits the Tailwind theme from the design source's frontmatter, producing paired light and dark sets. No hex literal appears in application code; copied-in UI primitives are re-pointed at generated tokens.
- **Deployment.** Vercel plus Neon Postgres 18 (major pinned across local, preview, and production; Singapore region), `prisma migrate deploy` at build, a Neon branch per PR. Seeding is always an explicit command, never a deploy side effect. No staging tier and no auth (an accepted deferral).
- **Stack pins.** Node 24 LTS, TypeScript 5.9, Next.js 16.2.10, React 19.2.7, PostgreSQL 18, Prisma 7.8.0, Tailwind 4.3.2, shadcn/ui copied in, Vitest 4.1.10, Playwright.
- **Typed repository port deferred.** The salary-record write funnel (currency-from-country, no-future-dating) and its typed port land with their first consumer, not here. This epic's obligation is satisfied by the schema-level append-only enforcement.

## UX & Interaction Patterns

- **App shell and IA.** Fixed 256px sidebar (Home, Employees, Gender Insights, Payroll Totals, Overdue for Review, Import, Settings — Settings pinned to the bottom) plus a fixed 64px header and a fluid workspace. Proper `nav`/`main` landmarks, a skip-to-content link past the fixed sidebar, and `aria-current="page"` on the active item.
- **Global as-of date control.** A persistent, right-aligned header element on every screen, defaulting to today. It is a single named button (visible text plus accessible name) opening a date picker; its calendar glyph is decorative. Changing it recomputes every view and announces the change via a polite live region. It is both a control and ambient provenance.
- **Visual foundations.** Flat broadsheet aesthetic: no shadows; hierarchy comes from tonal layering and hairlines. Hanken Grotesk for UI, JetBrains Mono for all numerals, right-aligned. 4px spacing scale. Badges are near-sharp stamps. Light and dark modes both meet the AA contrast floor; dark values are derived and treated as provisional until verified against real renders.
- **Cross-cutting state patterns (apply from this epic onward).** Skeleton hairline rows on cold load, never spinners; recomputation swaps values in place rather than returning to skeleton, with a polite announcement. Empty and first-run states point at Import.
- **Cross-cutting interaction primitives.** `/` focuses search; Tab follows reading order; Enter submits and Esc cancels the topmost form; modals are one level deep and trap then return focus. Banned everywhere: notification affordances of any kind, red/green semantics, celebration animations, infinite scroll on data tables (paginate instead), and free text for reference-table fields.

## Cross-Story Dependencies

- The source tree and paradigm scaffold precede everything; the CI gates depend on it and must be in place before further feature work merges.
- Deployment depends on the data model and migrations landing first, and is deliberately sequenced early to de-risk hosting and database provisioning while migration work is fresh.
- The design-token build must precede the app shell, since the shell consumes generated tokens and no hex literal may appear in application code.
- Money/currency primitives are consumed by every capability epic that touches salary values; the canonical formatter and money type originate here.
- This entire epic gates all twelve capability epics: none can start without the schema, the paradigm, the tokens, and the CI pipeline it establishes.
