# Deferred Work

## Deferred from: 3-2-employee-crud-ui (2026-07-19)

- **`e2e/employees.spec.ts` is not re-runnable without re-seeding, and fails confusingly when it
  is.** The suite MUTATES state — "a successful create" adds an employee — while other assertions
  pin the directory at the fixture's 30 rows. `e2e/fixtures/seed-employees.ts` truncates and
  reseeds, but it is a separate command (`npm run e2e:seed`), so a second local run of
  `npm run test:browser:db` without reseeding sees 31 employees and fails in a way that looks like
  a product defect rather than stale fixture state. Observed exactly that during 3-2's
  verification. CI is unaffected — the `browser-db` job seeds a fresh database once per run — so
  this is a local-developer trap only. **Re-entry:** have the Playwright suite seed in a
  `globalSetup`, or assert the expected starting count in a `beforeAll` and fail with a message
  naming `npm run e2e:seed`. This is the same family as the standing fixture-accumulation entries
  above.

## Deferred from: loop operation — squashed stories lose the red/green artifact (2026-07-19)

- **A cleanly-completed `bmad-loop` run squashes the whole story into ONE commit, which erases the
  red-before-green artifact the standing practice requires.** Verified across the loop-completed
  stories: `1-4` (`45e745c`), `1-5` (`acb8527`) and `3-1` (`63a5041`) are each a single
  "implemented and reviewed via bmad-loop" commit carrying tests and implementation together, so no
  commit holds the assertions without the code that satisfies them.

  This is exactly what the practice adopted after 1-3's code review exists to prevent — it was
  ratified *because* a Dev Agent Record narrative was judged "the author's own uncorroborated
  account", and it states it "applies from Story 1-7 onward". The gate suites do not catch it:
  every one of those three stories is 100% coverage, 100% mutation, and green on all four required
  checks. Only reading the history reveals it.

  The inversion is worth stating plainly: the stories that KEEP the artifact are the ones that went
  **wrong** — `1-6` (30 commits), `2-1` (15), `2-2` (6) — because their raw per-step commits
  survived a timeout escalation and were recovered by hand. The runs that went right are the ones
  that lost it. So the evidence quality of a story is currently inverse to how smoothly it was
  produced.

  Not a code defect, and no rework of shipped stories is implied. It matters because the Incubyte
  assessment reads commit history, and because TDD ordering is a Law (Law 1) whose only durable
  evidence is the commit sequence.

  **Investigated 2026-07-19 — it is by design, not a bug.** `.bmad-loop/policy.toml` `[scm]` has
  `merge_strategy = "merge"` with `ff | merge | squash`, but its own comment scopes it to worktree
  mode ("worktree mode merges the unit branch into target locally"), and this project runs
  `isolation = "none"` (in place). `commit_message_template` is documented as *"the commit message
  dev sessions use for **a story's commit**"* — singular. One commit per story is the intended
  shape, and the generated message ("story X: implemented and reviewed via bmad-loop") is the
  loop's own. The granular per-step commits visible on 1-6/2-1/2-2 are the dev session's working
  commits, which survived only because a timeout ended the run before the story commit consolidated
  them.

  **RULED 2026-07-19 (rk): option 1 — switched to worktree isolation.** `.bmad-loop/policy.toml` now
  has `isolation = "worktree"` with `merge_strategy = "merge"`, so each story's unit branch keeps
  the session's own red/green commits and the merge preserves them in history. The standing practice
  and the pipeline now agree, and nothing about the practice needed weakening.

  One non-obvious step was required to make it work: `worktree_seed = [".env"]`. A git worktree
  checks out **tracked files only**, and `.env` is gitignored yet read by both `prisma.config.ts`
  and `vitest.integration.config.ts` — without seeding it, every worktree session would have no
  `DATABASE_URL` and each migrate/integration step would fail in a way that reads like a database
  outage rather than a config gap. `node_modules` and `src/adapters/db/generated/` are gitignored
  too but are rebuilt by `npm ci` + `postinstall`, so they are deliberately not seeded; if a first
  worktree run dies on a missing module, that is the place to look before debugging anything else.

  This also retires the in-place hazard behind every manual recovery in this session — the two
  timeout escalations, the two killed host processes, and the stale-`master` checkout that briefly
  reverted the working tree all trace to the loop operating directly in the main checkout.

  Note the policy file itself is gitignored, so this ruling lives here rather than in the diff.

  **Original options, kept for the record:**
  1. Switch to `isolation = "worktree"` with `merge_strategy = "merge"`. The unit branch keeps the
     session's own red/green commits and the merge preserves them in history. This also removes the
     in-place-checkout hazard that produced every manual recovery this session.
  2. Accept the squash deliberately and amend the standing practice in this file, so a ratified
     rule and the pipeline stop contradicting each other. If this is chosen, the red/green evidence
     has to live somewhere else that is not the author's own narrative — otherwise the practice
     reverts to exactly what 1-3's review rejected.

## Deferred from: loop operation (2026-07-19)

- **Two stories shipped without an independent review pass.** `1-6-app-shell-and-as-of-control` and
  `2-1-bulk-import-backend` both record `dev x1 review x0`, against `1-4` (review x2) and `1-5`
  (review x1). In both cases the dev session hit `limits.session_timeout_min = 90` *after* finishing
  the work, so the loop escalated before its review phase ever ran. The only review those two
  received was the dev pass reviewing itself, and the `followup_review_recommended: false` flag that
  waved them through is that same pass's self-assessment. rk was offered an adversarial review of
  2-1 and declined it (2026-07-19), accepting the green gates plus Law spot-checks (Law 4 no
  hard-coded exponent, Law 6 single `Date.now`, Law 8 refusals returned not thrown, AD-21 route
  handler count) as sufficient. Recorded because this epic repeatedly produced defects that survived
  a fully green gate run — the `.env`-pointed-at-production fixture leak, the silently dropped `L3`,
  and a false "no host committed" claim in a Dev Agent Record were all found by reading, not by
  gates. **Re-entry:** 2-1 is the boundary payload 2-2 consumes as fixed, so if anything in the
  import contract later proves wrong, look here first. Raising `session_timeout_min` to ~120 would
  stop the review phase being skipped by timeout.

## Deferred from: 2-1-bulk-import-backend (2026-07-19)

- **The CSV money-cell encoding needs ratifying into the spine's Consistency Conventions before the
  export stories pick their own.** Story 2-1 had to settle how money is spelled in a CSV cell, and
  the answer is forced rather than chosen: AD-4 forbids a bare amount, so `2340000` alone is
  illegal; AD-6 makes any currency in the file non-authoritative but *validated against* the
  country's resolution, which presupposes something to validate; and a symbol-bearing cell
  (`₹23,40,000`) would need locale- and grouping-aware parsing, which collides with "nothing is
  guessed" (AD-7). Exactly one encoding survives all three, and it is what CAP-1 now implements:
  **two columns, `amount_minor` (integer minor units) + `currency` (ISO-4217), with a mismatch
  against the country's currency rejecting the row.** The derivation is sound, but the CONVENTION is
  cross-cutting and currently lives only in `src/domain/import-row.ts` and this story's spec. Three
  CSV *export* stories are still ahead of it, and if they each derive their own answer the product
  will read and write money in different shapes. **Re-entry:** promote the two-column encoding to
  the spine's Consistency Conventions (alongside the `snake_case` / calendar-`DATE` rules) so import
  and all three exports inherit one spelling, and note there that the exponent for rendering comes
  from the `currency` reference table, never a hard-coded 100.

## Deferred from: code review of 1-7-deployment-and-environments (2026-07-19)

Migrated from the story's Review Findings when 1-7 was closed. All six were assessed as
**non-essential**: NFR11a is met and verified in production, every gate is green, and none of these
block a consumer. They are hardening and bookkeeping, kept live here for `bmad-loop sweep`.

- **Preview deployments durably retain production-equivalent credentials.** `vercel deploy
  --env/--build-env` bakes `DATABASE_URL` (owner) and `DATABASE_URL_APP` into the deployment record,
  which Vercel retains after the PR closes and the Neon branch is deleted. Because branches inherit
  the parent's roles *and passwords*, `payroll_app`'s password on `pr-N` is byte-identical to the one
  valid against `production` — only the host differs, so the value is replayable against production
  by swapping it. Exploiting it requires Vercel project access, which today is one person on a
  private team, and the app half is `SELECT`/`INSERT` only. **Re-entry:** if repo or Vercel access
  ever widens beyond one operator, rotate `payroll_app` per branch (`ALTER ROLE` after branch
  creation) so an inherited credential stops being a production credential. *Worth noting alongside
  this: the isolation failure that actually occurred was far more mundane — `.env` pointing at the
  production branch so the test suite wrote to it (see the 1-4/1-5 section). The boring path is the
  one that bit.*
- **`expires_at` is never refreshed when a Neon branch is reused.** It is set at creation; on
  `synchronize` the action returns the existing branch and nothing extends the TTL. A PR open longer
  than 7 days without a push loses its branch under a live preview URL, which then errors on every
  database path with no signal — the smoke check already passed and does not re-run. **Re-entry:**
  set the expiry unconditionally after the create step (`neonctl branches update`), or drop the TTL
  and rely solely on the `closed` cleanup now that it queues correctly.
- **Both database credentials are broadcast to every later step via `$GITHUB_ENV`.** Only three
  steps need them, but `npx playwright install --with-deps chromium` and `npx vercel@…` — packages
  fetched from the network at run time — also see them. **Re-entry:** move to step-level `env:`.
- **`e2e/smoke.spec.ts`'s second assertion is close to vacuous.** `expect(page.locator('body'))
  .toBeAttached()` holds for any HTML document including an error shell, which the adjacent comment
  claims it distinguishes; the status assertion does that work alone. **Re-entry:** assert on a
  deployment-identifying signal (an `x-vercel-id` header, or `response.request().url()` matching the
  target) so the spec earns the discriminating power its comment claims — that would also partly
  cover the "was this build ignored rather than deployed?" gap.
- **The "~2× margin" claim for the pool-timing assertion extrapolates local numbers.** The measured
  ~1.0 s / ~2.0 s figures are local; the only CI datum is total test duration, which does not isolate
  the baseline assertion's headroom on a cross-region run (runner in `eastus2`, Neon in
  `ap-southeast-1`). **Re-entry:** log the two phase timings if it ever flakes, then widen
  `SLEEP_SECONDS` rather than loosening the boundary.
- **AC 5's "pushed red **on the branch**" was met in spirit, not letter.** All six commits were
  pushed at once, so CI never ran on the red commit on the story branch; the failing run lives on
  `evidence/1-7-pool-bound-red` ([run 29658638514](https://github.com/oremono/payroll/actions/runs/29658638514)).
  The commit pair itself is genuine and correctly scoped. **Re-entry:** either keep that branch as
  the durable artifact, or amend AC 5's wording for later stories to accept a linked run record —
  the Actions run survives branch deletion, so the branch itself is disposable.

## Deferred from: post-loop verification of 1-4 / 1-5 (2026-07-19)

Found while verifying the `bmad-loop` run that landed 1-4 and 1-5. Both are about the same thing:
reference data that fails **silently**.

- **The reference-data seed uses a TARGETLESS `ON CONFLICT DO NOTHING`, so any unique collision
  silently drops an FK-target row.** `20260718225000_reference_data` states the choice explicitly
  ("EVERY STATEMENT IS `ON CONFLICT DO NOTHING`, deliberately without a conflict TARGET"). The
  intent — idempotent re-runs of `migrate deploy` — is right; the implementation is wider than the
  intent. Without a target it swallows a violation of *any* unique constraint, not just `code`.
  **Observed, not theorised:** on a long-lived local database a leftover test fixture held
  `level.rank = 3`, so the `L3` insert collided on `level_rank_key` and vanished. The database then
  had five levels and no `L3`, with no error anywhere. That matters because the migration's own
  header calls these rows load-bearing — "until these exist, no employee, no import, and no seed can
  be written at all" — so a silently missing level means no employee can ever be created at it.
  **Aggravating factor: it is not self-healing.** Once the migration is recorded applied,
  `migrate deploy` reports "No pending migrations to apply" and never retries the dropped row; L3
  had to be re-inserted by hand. **Re-entry:** a corrective migration that either narrows each
  statement to `ON CONFLICT (code) DO NOTHING` (so a rank collision *raises*, which is what you
  want — it means something is genuinely wrong) or asserts the expected cardinalities (8/8/25/6)
  and raises if short. Production was verified intact (`L1..M2` = ranks 1–6) before this was
  deferred.

- **`tests/integration/reference-data.test.ts` asserts on global table state via an unenforced
  convention.** The `seeds six levels…` case scopes itself by `WHERE rank <= 6` and justifies it in
  a comment: *"every test fixture rank in the repo is >= 1_000, so this IS the exact global set."*
  Nothing enforces that; it is a convention held in a comment, in a suite whose own deferred-work
  entry says fixtures accumulate unbounded. It passes on CI's fresh Postgres and fails on any
  long-lived database — the exact order-dependent confound 1-3's review created
  `tests/integration/client.test.ts` to eliminate. **Re-entry:** scope the assertion to the seeded
  codes (`WHERE code = ANY(...)`) so it stops depending on what else is in the table, or enforce the
  rank band with a CHECK.

- ~~**Integration fixtures accumulate on the `production` Neon branch.**~~ **RESOLVED 2026-07-19.**
  The predicted failure had happened: `.env`'s `DATABASE_URL` pointed at the Neon **production**
  branch, so every `npm run test:integration` — including every session of the loop run — planted
  fixtures there. Found 25 fixture sets across `role`/`level`/`country`/`currency`, 25 `employee`
  rows, and **38 `salary_record` rows that no application path could remove**, since append-only is
  working exactly as designed. Cleaned by `TRUNCATE salary_record, employee CASCADE` as owner plus
  targeted deletes of non-seeded reference codes; `TRUNCATE` was required precisely because it is
  the one statement that bypasses the row-level `AP001` trigger (the escape hatch already noted
  below). Production verified back to 8/8/25/6 reference rows and zero data rows. `.env` now points
  at the Docker Postgres on 55432 as `.env.example` always documented, with the previous values kept
  in the git-ignored `.env.neon.bak`. **Re-entry:** the underlying hazard is unchanged — nothing
  *prevents* `.env` from being pointed at a deployed branch. A guard in the integration setup that
  refuses to run against a host containing `neon.tech` would make it mechanical rather than a
  convention.

## Deferred from: code review of 1-2-ci-pipeline-and-gates (2026-07-18)

- `ui → application` "types only" is stated in the ESLint zone message (`eslint.config.mjs`, ui zone) but not mechanically enforced — value imports from `application` into `ui` pass lint. Deferred because the `ui` layer is empty until Story 1-6; when the first component lands, add a type-only carve-out (e.g., a stricter zone plus `@typescript-eslint/consistent-type-imports`, or an importKind-aware boundary rule) so the convention becomes a gate.

## Standing practice adopted 2026-07-18 (code review of 1-3)

- **Commit the failing test and the code that satisfies it as SEPARATE commits.** Story 1-3's AC 10
  required red-before-green to be evidenced by "the commit sequence", but `03e9273` landed
  `tests/integration/schema.test.ts` and the constraints migration together, so no commit holds the
  assertions without the constraints — the narrative in the Dev Agent Record was the only evidence,
  and it is the author's own uncorroborated account. rk accepted it for 1-3, on the condition that
  every later story make the artifact real. Note this coexists with the Dev-Notes rule that each
  commit be self-consistent: a commit containing a deliberately failing test is self-consistent, it
  simply is not green. **Applies from Story 1-7 onward.**

- ~~**Five value constraints deferred to Story 1-4**, which owns the reference values they
  constrain (code review 2026-07-18; `fx_rate.rate > 0` and `UNIQUE (level.rank)` were judged
  load-bearing and landed in 1-3 instead): `settings.outlier_threshold_pct` range CHECK (0 or
  negative makes outlier detection meaningless), `currency.minor_unit_exponent` range CHECK (a
  negative exponent renders every salary 100× wrong through the one money formatter),
  `effective_from >= hire_date`, case-insensitive uniqueness on reference `code` columns (so `usd`
  and `USD` cannot both exist), and non-empty CHECKs on `employee.name` and the `code`
  columns.~~ **CLOSED by story `1-4-money-currency-domain-primitives` (2026-07-19)**, all five in
  `prisma/migrations/20260718224918_currency_display_and_value_constraints/migration.sql`, each
  proven by its violating input being refused in `tests/integration/reference-data.test.ts`:
  - `settings_outlier_threshold_pct_range` — `CHECK (> 0 AND <= 100)`. The upper bound was added
    beyond the deferral's wording: above 100 the flag can never fire below the median, because
    distance bottoms out at −100%, so half the control would be dead.
  - `currency_minor_unit_exponent_range` — `CHECK (>= 0 AND <= 4)`. **Zero is valid and
    load-bearing** (JPY); 4 is the largest exponent ISO-4217 defines.
  - `employee_name_not_blank` and `{role,level,country,currency}_code_not_blank` — `btrim(x) <> ''`,
    so whitespace-only is caught, not merely `''`.
  - `{role,level,country,currency}_code_lower_key` — UNIQUE expression indexes on `lower(code)`.
    Chosen over a `citext` column: citext is an extension, changes comparison semantics everywhere
    including `ORDER BY`, and would read as drift against `String @db.Text`. The plain UNIQUE
    constraints from `..._init` are kept — they are what the FKs reference.
  - `effective_from >= hire_date` — a `BEFORE INSERT` **trigger** (`AP004`), not a CHECK: a CHECK
    sees only its own row and `hire_date` is on another table, and 1-3's migrations are immutable.
    `INSERT` only, because `salary_record` admits no `UPDATE` at all; the `IS NOT NULL` guard lets
    the FK raise its own accurate error on a bogus `employee_id`, since FK checks run *after* row
    triggers.

## Deferred from: code review of 1-3-data-model-and-migrations (2026-07-18)

- **Law 1 (TDD) was violated for `src/adapters/db/client.ts`.** It shipped in `03e9273` with no test; `tests/integration/client.test.ts` arrived three commits later as code-review remediation. This was the root cause of BOTH serious defects in the story (owner-role connection voiding AD-18 layer A, and the production caching omission) — they survived a fully green gate run because the only file without tests was the only file with bugs. Remediated. **Re-entry:** raise at the Epic 1 retrospective; the standing lesson is that an adapter is production code and Law 1 binds it exactly as it binds the domain.
- ~~**No `pg` pool sizing for serverless.**~~ **CLOSED by story `1-7-deployment-and-environments`
  (2026-07-19).** Both halves of the suggested re-entry were taken, and the ordering between them
  matters: `DATABASE_URL_APP` now points at Neon's **pooled** endpoint, which is the primary fix
  (PgBouncer is the real pool), and `client.ts` sets `APP_POOL_MAX = 5` to bound the sockets a
  single instance opens toward it. The suggested `max: 1` was **rejected** — it serializes every
  concurrent query behind any in-flight interactive transaction, and it is not current Neon
  guidance. The bound is asserted behaviourally by timing in `tests/integration/client.test.ts`,
  landed red before green as separate commits.
- **`TRUNCATE` bypasses the append-only trigger.** Row-level `BEFORE DELETE` triggers do not fire on `TRUNCATE`. Not a runtime hole (`payroll_app` never receives the `TRUNCATE` privilege), but an owner connection could erase all salary history in one statement. **Re-entry:** add a statement-level `BEFORE TRUNCATE` trigger if the runtime role's privileges are ever broadened.
- **CI Postgres health window is a fixed 50s** (`--health-retries 5` × 10s) with no wait loop before the `psql` bootstrap step. **Re-entry:** if the integration job ever flakes with connection-refused, add `until pg_isready; do sleep 1; done`.
- **Integration fixtures accumulate unbounded.** The suite cannot delete `salary_record` (that is the invariant working), so rows pile up on a persistent local database. The disposable-database assumption is documented but unenforced. **Re-entry:** assert an empty `salary_record` in `beforeAll`, or provision a fresh database per run.
- **Requirements-level edits rode in a data-model story's branch.** The NFR11 split and `epics.md` rewrite landed in `6a672cd` on the 1-3 branch, despite the story's out-of-scope table saying "Flag to rk; do **not** absorb either into 1-3". rk ratified them, so this was not unilateral — but the authorizing document was internally inconsistent at the time. **Re-entry:** future correct-course runs should land on their own branch.
- **AC 1 was amended to match the implementation** rather than the implementation reconciled to the AC. The reasoning is sound and recorded, but the declined alternative (commit the generated client rather than move `prisma` to `dependencies`) is a real architectural fork now invisible at AC level. **Re-entry:** revisit if the generated-client-as-runtime-artifact assumption is ever challenged.

## Deferred from: 1-7-deployment-and-environments (2026-07-19)

Surfaced while wiring deployment, deliberately **not** absorbed.

- **Integration fixtures still accumulate — partly mitigated, not solved.** Preview branches now
  give every PR a fresh copy-on-write clone, so fixture rows no longer pile up across PRs. They
  still accumulate on the **`production` branch** (which the local `.env` may point at) and on any
  long-lived branch, because the suite cannot delete `salary_record` — that is the invariant
  working. The disposable-database assumption remains documented but unenforced. **Re-entry:** as
  before — assert an empty `salary_record` in `beforeAll`, or provision a fresh branch per run.
- **The pool-bound assertion is timing-based and therefore load-sensitive.** `tests/integration/
  client.test.ts` distinguishes one wave from two with a 1.9 s boundary against `pg_sleep(1)`. This
  is the correct assertion (`pg_stat_activity` is meaningless behind PgBouncer in transaction mode,
  and reading the constant back is tautological), but a severely contended runner or a very slow
  link could in principle push a single wave past 1.9 s and fail it spuriously. Observed at ~1.0 s
  and ~2.0 s locally, so the margin is currently ~2×. **Re-entry:** if it ever flakes, widen the
  sleep to 2 s rather than loosening the boundary — a longer sleep raises the signal, a looser
  boundary lowers it.
- **`ignoreCommand`'s behaviour for CLI-created deployments is unverified.** Vercel's docs do not
  state whether the Ignored Build Step runs for `vercel deploy` as it does for Git-triggered
  builds. The preview pipeline is correct either way because it passes an explicit
  `--build-env CI_DRIVEN_PREVIEW=1` escape hatch, but the underlying question was not settled.
  **Re-entry:** if Vercel documents this, the escape hatch may become removable.
- ~~**`pg` is a devDependency while `@prisma/adapter-pg` is a runtime dependency.**~~ **NOT A
  DEFECT — checked, no change made (2026-07-19).** Story 1-7 Task 7 anticipated the same trap that
  put `prisma` and `dotenv` into `dependencies`, but it does not apply: `@prisma/adapter-pg`
  declares `pg: ^8.16.3` as a **hard dependency, not a peerDependency**, so npm installs and hoists
  `pg` for it regardless of our entry. Verified with `npm ls pg --omit=dev`, which still resolves
  `pg@8.22.0` under `@prisma/adapter-pg`. The root devDependency is a version pin for the
  integration tests (which import `pg` directly to plant fixtures), not the edge that makes it
  resolvable at runtime. **Re-entry:** revisit only if a future `@prisma/adapter-pg` moves `pg` to
  a peerDependency — that would silently reintroduce the trap.

## Deferred from: 1-4-money-currency-domain-primitives (2026-07-19)

Surfaced while landing the money primitive and the reference values, deliberately **not** absorbed.
The first three are named by the story's own Design Notes as items to record rather than resolve.

- **The taxonomy draft is unratified.** 1-3 Decision 1 authorized the dev agent to *draft* the
  reference values, and the cardinalities (6 levels / 8 countries / 25 roles / 8 currencies) are
  ratified — but the specific codes and names are one agent's proposal, now shipped as a data
  migration to every environment. Levels are `L1` Associate / `L2` Mid / `L3` Senior / `L4` Staff /
  `M1` Manager / `M2` Director; the 25 roles are job families with no seniority word in any name.
  Migrations are immutable, so a correction is a *new* migration, not an edit. **Re-entry:** rk
  reviews `prisma/migrations/20260718225000_reference_data/migration.sql`; anything he changes lands
  as a follow-up migration, and if names change, `is_active = false` on the retired row rather than
  a rename — the codes are natural FK targets.
- **8 countries vs the mocks' "14 countries".** The architecture addendum's grid sizing implies 8
  and the ratified cardinality is 8, but UX mock copy says 14 in at least one place. 8 shipped,
  because it is the ratified number. This is a requirements-level conflict, not an implementation
  choice. **Re-entry:** settle it before CAP-9 (Payroll Totals), which renders the per-country grid
  and is the first surface where the difference is visible.
- **May `src/ui` import a pure domain FUNCTION, or only types?** AD-1 says types-only, and the
  ESLint zone message repeats it. `formatMoney` now exists and is exactly the thing a table cell
  wants to call. Either the rule bends for pure functions, or the boundary resolves a
  `CurrencyFormat` and formats in the use-case so the UI receives pre-rendered strings. Nothing in
  this story forces the answer — no call site exists yet. **Re-entry:** Story 1-6 (app shell) or
  the first capability frontend, whichever renders a salary first; it pairs with the still-open
  "`ui → application` types-only is not mechanically enforced" item from the 1-2 review.
- **Backfilled fixture currencies carry a placeholder `¤` symbol.** The new NOT NULL
  `currency.symbol` / `currency.grouping_style` columns were added with a temporary default that is
  then dropped, so pre-existing rows on long-lived databases (the Neon `production` branch, a
  developer's local container) were backfilled with `¤` / `WESTERN`. Those rows are all
  uniquely-suffixed integration fixtures — `TC…`, `CO…` — never reference data, and `¤` is
  deliberately not a real symbol so they cannot be mistaken for one. **Re-entry:** none needed
  unless a real currency is ever added by direct SQL rather than a migration; the placeholder is a
  tell that something skipped the migration path.
- **Every reference `code` column now carries two indexes.** The plain UNIQUE from `..._init` plus
  the new UNIQUE on `lower(code)`. The plain one is kept because the FKs reference it and dropping
  it would mean rewriting them. Harmless at these row counts (tens of rows), and both are used —
  but it is duplication a reader will notice. **Re-entry:** if a reference table ever grows to a
  size where the write cost matters, migrate the FKs onto the expression index and drop the plain
  UNIQUE.
- **Integration count assertions are scoped to the seeded values, not global.** `SELECT count(*)
  FROM currency` cannot be asserted, because sibling integration files plant fixture rows in the
  same tables and cannot delete them. The scoped assertions are strictly stronger (they fail on a
  missing, duplicated, or wrong row), but the story's AC is phrased as "exactly 8 currencies", and
  that literal form was verified **manually** against a fresh container rather than by the suite.
  **Re-entry:** this dissolves the moment the outstanding "provision a fresh database per run" item
  is taken — then the global count becomes assertable and should replace the scoped one.

## Deferred from: 1-3-data-model-and-migrations (2026-07-18)

Surfaced by this story, deliberately **not** absorbed into it. The first two were sprint-plan gaps
bound to Epic 1 but owned by no story in 1-1…1-6; **both were ruled on by rk on 2026-07-18** and
are recorded here as resolved rather than deleted, so the reasoning survives.

- ~~**The Repository contract is ownerless.**~~ **RESOLVED (rk, 2026-07-18): defer to the first
  consumer.** Epic 1's Data-model requirement (`epics.md` line 64) is satisfied by the schema
  alone; the typed port (`append` + read interfaces) lands with **CAP-2/CAP-3**, where its shape is
  actually known. 1-3 proves append-only at the **database**, which is the part that cannot wait.
  No Epic 1 story is needed. Note for whoever writes the port: the DB already refuses `UPDATE`/
  `DELETE`, so a port exposing them would fail at runtime, not merely violate convention.
- ~~**Deployment / NFR11 is ownerless.**~~ **CLOSED by correct-course, 2026-07-18**
  (`docs/planning-artifacts/sprint-change-proposal-2026-07-18.md`). Story
  **`1-7-deployment-and-environments`** now exists in `sprint-status.yaml`, sequenced **immediately
  after 1-3** to de-risk Vercel/Neon provisioning early, and `epics.md` names deployment as an
  explicit Epic 1 workstream. NFR11 was also **split**: **NFR11a (Deployed)** is Epic 1's, while
  **NFR11b (Demonstrable end-to-end)** moved to a post-Epic-6/7/12 acceptance check, because the
  planted outlier and out-loud refusal it names depend on CAP-5, CAP-6, and the seeded population —
  Epic 1 could never have satisfied the original wording. The story still needs authoring via
  `bmad-create-story`; it inherits from 1-3 the two-role split (owner for migrations, `payroll_app`
  at runtime), `prisma/sql/bootstrap-roles.sql`, and the `migrate deploy`-at-build intent recorded
  in README § Database.
- **`updated_at` carries a DB default that Prisma does not require.** `@default(now()) @updatedAt`
  was chosen so raw SQL inserts (which the role-switching integration assertions require) can omit
  the column. Harmless, but it means the DB, not only the client, can set `updated_at`.
  **Re-entry:** revisit if a future story ever needs `updated_at` to be client-authoritative.
- **`TRUNCATE` bypasses the append-only trigger.** Row-level `BEFORE DELETE` triggers do not fire
  on `TRUNCATE`. This is not a runtime hole — `payroll_app` is granted only `SELECT, INSERT` on
  `salary_record` and `TRUNCATE` is a separate privilege it never receives — but an owner
  connection could truncate the table. **Re-entry:** if a future story grants the runtime role
  broader privileges, add a `BEFORE TRUNCATE` statement-level trigger.

## Deferred from: code review of 1-4 (2026-07-19)

Findings from the adversarial + edge-case review pass on story 1-4 that were judged real but not
this story's problem. Recorded in the dev-auto triage format.

- source_spec: `spec-1-4-money-currency-domain-primitives.md`
  summary: `fromBoundaryMoney` validates `amountMinor` exhaustively but copies `currency` through
    unchecked, so a blank or malformed code crosses the boundary and only surfaces later as a
    salary that silently fails to render.
  evidence: The function's own JSDoc frames it as the defence against "a hostile or buggy caller",
    and it rejects five distinct `BigInt` coercion traps — but `{amountMinor:'1', currency:''}`
    returns a `Money`. The domain cannot check ISO-4217 *membership* (that needs the currency
    table), but it can check *shape*. Deliberately not fixed here: the spec's I/O matrix specified
    only the `amountMinor` rejections, so a shape rule is a new decision, not a missed one.

- source_spec: `spec-1-4-money-currency-domain-primitives.md`
  summary: `ON CONFLICT DO NOTHING` converges on row *existence*, never on row *values*, so a
    divergent pre-existing reference row survives every future deploy unrepaired.
  evidence: If a crashed pre-1-4 integration run left `settings id=1` pointing at a fixture
    currency, the data migration applies cleanly, changes nothing, and that environment's AD-13
    conversion target is wrong permanently. `DO UPDATE` is NOT the fix for `settings` — it would
    clobber a real threshold change on every deploy — so this needs a deliberate per-table ruling.

- source_spec: `spec-1-4-money-currency-domain-primitives.md`
  summary: The reference-count assertions are scoped to the expected code list, so an *extra*
    seeded row — a 26th role, a 9th currency — is invisible to the suite.
  evidence: `WHERE code = ANY($1)` + `toHaveLength(25)` proves the 25 expected roles exist and
    nothing more. A future edit adding `staff_engineer` would violate the story's own "no seniority
    word in a role name" rule and the ratified cardinality, and every test would still pass. The
    literal "exactly 8/8/6/25/1" counts were verified out-of-band against a fresh container.

- source_spec: `spec-1-4-money-currency-domain-primitives.md`
  summary: The new CHECK constraints and `lower(code)` unique indexes are added VALIDATING, so on a
    long-lived database holding a violating row the migration fails and wedges every later deploy.
  evidence: Story 1-7 documented this exact failure mode (P3009/P3018 leaves the history
    unrecoverable). Reference tables shipped empty from 1-3 so nothing violates them today, but
    accumulated integration fixtures are undeletable and a future constraint may not be so lucky.
    `ADD CONSTRAINT ... NOT VALID` followed by a separate `VALIDATE CONSTRAINT` is the safe shape.

- source_spec: `spec-1-4-money-currency-domain-primitives.md`
  summary: `salary_record` rows that already violate `effective_from >= hire_date` are never
    detected — the triggers guard both write paths but nothing validates history.
  evidence: Both triggers are `BEFORE INSERT`/`BEFORE UPDATE`; neither looks backwards. No such
    rows can exist yet (no story writes salary records), so this is cheap to close now and
    expensive after CAP-2/CAP-3 and the Epic 12 seed have run.

- source_spec: `spec-1-4-money-currency-domain-primitives.md`
  summary: `groupRightToLeft` recurses once per digit group with no depth bound, so a pathologically
    long `amountMinor` overflows the stack — throwing from a module contracted never to throw.
  evidence: `fromBoundaryMoney` accepts any canonical integer string, including a 100,000-digit
    one. The value would be nonsense, but the failure mode is a `RangeError` escaping `src/domain`,
    which is the same totality breach the exponent guard was patched to close. An iterative
    rewrite, or a digit-length bound at the boundary, closes it.

- source_spec: `spec-1-4-money-currency-domain-primitives.md`
  summary: `btrim()` is called with no second argument in every `*_not_blank` CHECK, so it strips
    only ASCII spaces — a code, name, or symbol consisting solely of a tab, newline, or NBSP is
    accepted as non-blank.
  evidence: `btrim(E'\t') = E'\t' <> ''` is true, so the CHECK passes. An invisible `currency.symbol`
    renders a salary with no symbol (what `currency_symbol_not_blank` exists to prevent), and an
    invisible reference `code` becomes a valid FK target that silently splits a peer group. Affects
    the 1-3 CHECKs on `role`/`level`/`country`/`currency.code` and `employee.name` identically, so
    the fix is one migration covering all of them: `CHECK (code ~ '[^[:space:]]')`.

- source_spec: `spec-1-4-money-currency-domain-primitives.md`
  summary: The reference-data migration's `ON CONFLICT DO NOTHING` carries no conflict target, so a
    conflict on ANY unique constraint — not just the primary key — is silently swallowed.
  evidence: The targetless form is deliberate (it must also cover the `lower(code)` indexes), but it
    cannot distinguish "already seeded" from "a different row occupies this unique slot". If a
    long-lived database holds any `level` row at rank 1-6, the matching seeded level is skipped with
    no error and the deploy reports success with five levels. Worse on the currency chain: a
    pre-existing lowercase `'usd'` suppresses the `'USD'` insert, and the `settings` insert then
    fails its FK, marking the migration FAILED and wedging every later deploy.

- source_spec: `spec-1-4-money-currency-domain-primitives.md`
  summary: `currency.minor_unit_exponent` and `currency.symbol` are UPDATE-able by `payroll_app`
    with no immutability guard, so changing one after salary records exist silently re-renders every
    stored amount in that currency.
  evidence: Reference tables were granted full `SELECT, INSERT, UPDATE, DELETE` in 20260718163326
    because they are editable. But `amount_minor` is stored against an assumed exponent: moving USD
    from 2 to 0 turns every `$2,150,000.00` into `$215,000,000` through the one formatter, with no
    error anywhere. A `BEFORE UPDATE` trigger rejecting a change to either column once any
    `salary_record` references the currency would close it.

- source_spec: `spec-1-4-money-currency-domain-primitives.md`
  summary: The `settings_outlier_threshold_pct_range` CHECK caps the threshold at 100, an upper
    bound no architecture decision ratifies, inside an immutable migration.
  evidence: The deferral this story closed specified only that zero or negative makes outlier
    detection meaningless. The `<= 100` bound was added beyond that wording on the reasoning that
    above 100 nothing below the median can flag — but a deliberately asymmetric threshold (150 flags
    only people paid more than 2.5x their peer median) is a coherent configuration, not a data-entry
    error. Relaxing it later costs a new migration. Needs product ratification either way.

- source_spec: `spec-1-4-money-currency-domain-primitives.md`
  summary: A `DATABASE_URL_APP` password containing a URL-reserved character silently disables the
    12 integration tests that use the restricted runtime role — they fail with `Invalid URL` before
    reaching the database.
  evidence: Observed on this machine: the provisioned `payroll_app` password contains an unencoded
    `/`, so `new URL()` rejects the connection string and every `client.test.ts` and role-scoped
    `schema.test.ts` case errors at setup rather than asserting anything. Neon generates passwords
    from an alphabet that includes such characters, so any developer can hit this. The failure names
    the URL, never the password, which makes it slow to diagnose. `.env.example` and the README
    should state that the password must be percent-encoded.

- source_spec: `spec-1-4-money-currency-domain-primitives.md`
  summary: Two `salary_record` acceptance tests COMMIT a row on every run into a table with no
    DELETE path, so the fixture table grows unboundedly and unrecoverably.
  evidence: `reference-data.test.ts` wraps every other acceptance case in
    `expectAcceptedThenRolledBack` for the stated reason that a committed row "grows a reference
    table permanently, on every run, forever" — but the hire-date boundary cases insert outside any
    transaction. They must commit as written, because the `hire_date` UPDATE tests below them need a
    committed record to conflict with; closing this means creating that record once in `beforeAll`
    and rolling the two boundary assertions back. Not done here: the change reorders fixture
    lifetimes and could not be verified, since the integration suite cannot reach a database on this
    machine.

- source_spec: `spec-1-4-money-currency-domain-primitives.md`
  summary: The four reference `name` columns have no non-blank CHECK, and the suite asserts a
    property the schema does not enforce.
  evidence: `20260719050000_review_hardening_1_4` added `btrim(x) <> ''` to `employee.name`, all
    four `code` columns, and `currency.symbol` — but not to `currency.name`, `role.name`,
    `level.name`, or `country.name`. Meanwhile `reference-data.test.ts` asserts
    `rows.every((r) => r.name.trim().length > 0)` for currencies and roles, so it verifies an
    invariant nothing upholds. A role named `'   '` is an invisible label on every chart axis and on
    the Settings screen and is accepted today — the same harm the `currency.symbol` CHECK exists to
    prevent.

- source_spec: `spec-1-4-money-currency-domain-primitives.md`
  summary: `level.rank` has no positivity CHECK, which the "six sequential ranks" assertion silently
    depends on.
  evidence: The seeded-ladder test selects `WHERE rank <= 6` and documents that this "IS the exact
    global set" because every fixture rank in the repo is >= 1,000 — an assumption nothing in the
    schema enforces. A rank of `0` or `-1` from a future fixture, an import, or a manual edit joins
    that result set and fails the test with an opaque array mismatch pointing at the reference data
    rather than at the intruding row. `CHECK (rank > 0)` belonged with the five range/non-blank
    CHECKs this story already added.

- source_spec: `spec-1-4-money-currency-domain-primitives.md`
  summary: The spec's frozen "Always" constraint states `payroll_app` gets `SELECT, INSERT` only and
    never `UPDATE`/`DELETE`, which the story's own migration correctly contradicts.
  evidence: `20260718224918` executes `GRANT SELECT, INSERT, UPDATE, DELETE ON "currency" TO
    "payroll_app"`, matching 1-3's grant for the reference tables — the grant is right and the
    constraint prose is over-broad, since the withholding is specific to `salary_record` (Law 5 /
    AD-18). Both review passes recorded "no spec defects". The trap was defused in `prisma/README.md`
    during this pass, but the constraint line lives inside `<intent-contract>`, which this workflow
    may not amend; an agent reading it literally would revoke a needed privilege.

- source_spec: `spec-1-4-money-currency-domain-primitives.md`
  summary: The `FOR SHARE` write-skew fix introduces a lock-upgrade deadlock path and an unmeasured
    per-row locking cost, neither documented.
  evidence: `20260719060000_hire_date_lock` takes `FOR SHARE` on the employee row inside the
    insert-side trigger. Two transactions that each insert a `salary_record` and then update the same
    employee's `hire_date` upgrade a shared lock to exclusive in opposite orders — a textbook 40P01
    deadlock, and no retry path exists anywhere in the codebase. Separately, every `salary_record`
    insert now takes a share lock, so the 10,000-row Epic 12 seed and every CSV import pay it per
    row, with concurrent share-lockers on one employee row promoting to multixacts. The migration
    comment explains the correctness need but names neither cost.

- source_spec: `spec-1-4-money-currency-domain-primitives.md`
  summary: `GroupingStyle` in the domain has no compile-time linkage to the Prisma `grouping_style`
    enum, and an unrecognized value renders INDIAN grouping silently.
  evidence: `groupMajor` is `if (style === 'WESTERN') { ... }` followed by an unguarded INDIAN path,
    so any other value falls through to Indian grouping — no error, no `null`, in a module whose
    entire contract is that a failure is a `null` return. The value arrives from a database row via a
    cast at the delivery boundary. Adding a third enum value in a later migration would re-group every
    salary in that currency with nothing detecting it. Left as-is deliberately: the honest fix is an
    exhaustiveness branch, which is unreachable under the current closed union and would therefore
    break the 100% coverage and 100% mutation-score gates this story is held to. Closing it properly
    means generating `GroupingStyle` from the Prisma enum, or relaxing the gate for a `never` guard.

## Deferred from: 1-5-design-token-build (2026-07-19)

Named by the story's own Design Notes as items to **record rather than resolve**. `DESIGN.md` is
read-only to this story, so none of them could have been closed here without amending the single
source of visual truth.

- **`input-border` misses DESIGN's own 3:1 floor on two of the three surfaces.** Computed from the
  ratified frontmatter: `input-border` on `surface-card` is **3.09:1** (passes), but on
  `surface-base` it is **2.96:1** and on `surface-tint` **2.82:1** — both below the ≥ 3:1
  non-text floor DESIGN.md § Contrast floor states for input borders. This is a defect in the source
  document, not in the generator. `tests/tokens/contrast.test.ts` therefore gates **only** the pair
  that actually occurs (forms sit on `surface-card`), because gating the other two would block the
  story on a token it may not change — but the token is one shade too light the moment a form is
  placed on `surface-base` or a tinted section. Dark mode has no such problem (`input-border-dark`
  on `surface-card-dark` is 4.74:1). **Re-entry:** the first story that puts an input on
  `surface-base` or `surface-tint` — realistically 1-6's shell or the CAP-2 employee form. The fix
  is a darker `input-border` in DESIGN.md and a rebuild; if the two pairs are instead ruled
  acceptable, the ruling belongs in DESIGN.md § Contrast floor, which currently claims otherwise.
- **The dark token set is still flagged provisional, and nothing here can clear it.** DESIGN.md
  § Dark mode records `[ASSUMPTION]`: the 17 `*-dark` values are one agent's conservative derivation
  by inversion, never mocked and never verified against a real render. This story proves they meet
  the contrast floor **by computation** — which is exactly what DESIGN already claimed and is a
  strictly weaker statement than "they look right". The generator now ships them to every
  environment, so the provisional set is live in production the moment 1-6 renders anything.
  **Re-entry:** whoever first views a real dark render (1-6's app shell is the earliest surface) —
  DESIGN.md says the flag comes off only after verification against real renders, and the values
  change in DESIGN.md followed by `npm run tokens:build`, never in the generated file.
- **shadcn/ui copy-in in 1-6 is where AD-15 is most likely to be violated.** shadcn primitives ship
  their own CSS variables (`--background`, `--foreground`, `--primary`, `--border`, `--ring`, …)
  with hard-coded values in their own `:root` block, plus a `.dark` class block — all three of which
  contradict the contract landed here: values that are not from DESIGN.md, a second set of names for
  colors that already have tokens, and a class-based dark hook where only `prefers-color-scheme` is
  ratified. `npx shadcn add` writes them without asking. **Re-entry: story 1-6, at copy-in.** They
  must be **re-pointed** at the generated tokens (`--primary: var(--color-primary)`), never added
  alongside them, and the `.dark` block dropped. The ESLint hex ban catches a hex literal in a
  `.tsx` primitive but **not** one written into a `.css` file — `tests/tokens/no-hex.test.ts` is
  what catches that, and it is worth re-reading before the copy-in rather than after.

Also surfaced while landing the story, outside the Design Notes:

- **The `--font-sans` / `--font-mono` tokens are emitted, but no webfont is loaded.** Loading Hanken
  Grotesk and JetBrains Mono (`next/font`) is explicitly 1-6's shell work and out of scope here, so
  today the fallback stacks in the generated file are what actually renders. That is a real visual
  gap, not merely a deferred nicety: DESIGN's binding rule is that ALL numerals are monospaced, and
  a fallback `ui-monospace` satisfies the monospacing but not the identity. **Re-entry:** story 1-6.
- **The mono/proportional split is decided by a regex on the family name.** `liftFontFamilies`
  classifies a family as monospaced by `/mono/i`. It is guarded on both sides — exactly one family
  must land in each bucket, so a third face or a rename fails the build by name — but a mono face
  that does not carry "mono" in its name (Iosevka, Fira Code, Courier) would be misfiled as
  `--font-sans` and fail with a confusing message. The frontmatter carries no other signal.
  **Re-entry:** if DESIGN.md ever changes either face, add an explicit `role: mono` key to the
  typography block rather than widening the regex.

## Deferred from: code review of 1-5-design-token-build (2026-07-19)

- source_spec: `docs/implementation-artifacts/spec-1-5-design-token-build.md`
  summary: Border tokens that form the visual boundary of interactive controls are excluded from the contrast gate, at ratios far below WCAG 2.2 SC 1.4.11's 3:1.
  evidence: `tests/tokens/contrast.test.ts` excludes `border-hairline`/`border-strong` as "decorative rules and table dividers", but DESIGN.md's own `components:` block makes them control boundaries — `button-secondary.border` is `1px solid {colors.border-hairline}` (measured **1.18:1** on `surface-base`, **1.23:1** on `surface-card`), `preset-chip.border` is `border-strong`, and `outlier-badge.border` is `amber-badge-border` (**1.11:1** on `surface-card`). Same class as the recorded `input-border` item, and neither gated nor previously recorded. DESIGN.md is read-only to this story, so it could not be closed here. **Re-entry:** story 1-6, which renders the first real button and badge.

- source_spec: `docs/implementation-artifacts/spec-1-5-design-token-build.md`
  summary: `refusal-fill` is a fourth surface that the contrast gate never checks, and it passes today only by coincidence.
  evidence: `components.refusal-panel` sets `background: {colors.refusal-fill}` with `foreground: {colors.ink-muted}`, but `SURFACES` in `tests/tokens/contrast.test.ts` is only base/card/tint. It is numerically safe purely because `refusal-fill` and `surface-tint` happen to hold identical values in both modes — nothing asserts that, so a future DESIGN.md change to `refusal-fill` alone would ship an ungated refusal panel. Refusals are a first-class product surface (AD-20), not an edge case. **Re-entry:** the first story that renders a refusal (CAP-5, story 6-2), or sooner if DESIGN.md touches `refusal-fill`.

- source_spec: `docs/implementation-artifacts/spec-1-5-design-token-build.md`
  summary: The contrast gate enumerates the tokens it checks, so a color added to DESIGN.md is silently never contrast-checked.
  evidence: `TEXT_INKS` and `SURFACES` are hard-coded lists. Adding a new ink or surface to DESIGN.md rebuilds the theme, passes `tokens:check`, and ships — with no contrast assertion ever written for it and no failure to prompt one. DESIGN § Contrast floor commits that "Any future token change must re-verify the matrix", which an enumerated list cannot honor. **Re-entry:** add a completeness assertion (every non-`-dark` color is either gated or explicitly excluded by name) — cheap now, and it is what makes the other two entries above self-reporting rather than dependent on a reviewer noticing.

- source_spec: `docs/implementation-artifacts/spec-1-5-design-token-build.md`
  summary: `~550` lines of generator logic sit outside the coverage floor and the mutation gate that the rest of the repo is held to.
  evidence: `vitest.config.ts` coverage `include` is `src/domain/**` + `src/application/**` and stryker `mutate` is domain-only, so `scripts/design-tokens/**` carries neither — while deciding what colors the entire product renders and whether the accessibility claim holds. The story deliberately did not move those gates (correctly: they are domain-purity gates). The review found three real validation holes in exactly this uncovered code, all now closed with direct tests, but the *gate* asymmetry remains. **Re-entry:** consider a separate coverage project for `scripts/**` with its own floor, rather than widening the domain gate.

- source_spec: `docs/implementation-artifacts/spec-1-5-design-token-build.md`
  summary: `allowImportingTsExtensions` was enabled repo-wide to serve a `scripts/`-only need.
  evidence: `tsconfig.json` `include` is `**/*.ts`, so `src/**` and `tests/**` may now write `import … from './money.ts'` and typecheck clean, while Next's bundler resolves such specifiers differently — the gate that would have caught a bad specifier no longer does. The setting is needed only because Node's ESM loader requires full specifiers when type-stripping `scripts/**` in place. **Re-entry:** scope it with a `scripts/tsconfig.json` extending the root, and drop it from the root config.

- source_spec: `docs/implementation-artifacts/spec-1-5-design-token-build.md`
  summary: No `.gitattributes` pins the generated stylesheet to LF, so a CRLF checkout would fail the drift gate permanently with zero real drift.
  evidence: `tokens:check` compares the committed file byte-for-byte against freshly generated output, which always uses `\n`. On a platform or clone where git normalizes checkout to CRLF, every run fails and no rebuild can fix it — the failure message would send the reader to `npm run tokens:build`, which regenerates an identical-but-LF file. No Windows developer is in play today. **Re-entry:** add `*.css text eol=lf` (or `-text`) to `.gitattributes` before anyone clones on Windows.

## Deferred from: follow-up code review of 1-5-design-token-build (2026-07-19)

- source_spec: `docs/implementation-artifacts/spec-1-5-design-token-build.md`
  summary: Nothing declares `color-scheme` and nothing paints the page canvas, so dark mode renders a white body around a dark island.
  evidence: `tokens.generated.css` re-points every `--color-*` under `prefers-color-scheme: dark`, but `:root` carries no `color-scheme: light dark` and `<body>` carries no background. With OS dark mode, `main` renders `#0f172a` while the surrounding canvas stays UA-white, and native form controls, scrollbars and focus rings render light-on-dark from the first real form onward. `e2e/tokens.spec.ts` asserts computed styles on `main` in dark mode and never observes the canvas behind it. 1-5's Never clause explicitly scopes out `body` background and layout styling, so this could not be closed here. **Re-entry:** story 1-6, which builds the app shell — add `color-scheme: light dark` and the body surface together, and extend the token e2e to assert the canvas.

- source_spec: `docs/implementation-artifacts/spec-1-5-design-token-build.md`
  summary: The "no component ever writes `dark:`" prohibition is stated in five places and enforced nowhere — the same unenforced-prohibition shape this story exists to fix.
  evidence: `src/ui/README.md`, `src/app/globals.css`, `scripts/design-tokens/README.md`, `to-css.ts`'s header and the spec all state that a `dark:` variant must never appear, because there is no `-dark` token to reach for. `eslint.config.mjs` mechanizes the hex ban but not this one. Story 1-6's shadcn copy-in is the most likely violator — its primitives ship `dark:bg-*` variants by default — and lint, `tokens:check` and `no-hex` would all stay green. **Re-entry:** story 1-6, alongside the copy-in; a `Literal[value=/\bdark:/]` selector in the existing `colorLiteralBanConfig` block is roughly four lines.

- source_spec: `docs/implementation-artifacts/spec-1-5-design-token-build.md`
  summary: Both halves of the AD-15 color ban are scoped to `src/**`, so a stylesheet anywhere else in the repo is invisible to it.
  evidence: `tests/tokens/no-hex.test.ts` hard-codes `SRC` and the ESLint block is scoped to `src/**`. A future `styles/print.css`, `.storybook/preview.css`, or an email template at the repo root carrying `#1e293b` passes every gate. The `src/`-only scope is a reasonable default but the READMEs describe the ban as if it were total. **Re-entry:** the first story that adds a stylesheet outside `src/` — widen both halves together, or state the scope limit in the README so it is a decision rather than an oversight.

- source_spec: `docs/implementation-artifacts/spec-1-5-design-token-build.md`
  summary: Named CSS colors (`red`, `white`, `transparent`) escape both halves of the color ban entirely.
  evidence: `COLOR_LITERAL` in `tests/tokens/no-hex.test.ts` and the mirrored patterns in `eslint.config.mjs` match hex and color *functions* only. `color: 'red'` or `background: white` in a component or a stylesheet under `src/` is a hard-coded color outside the token contract that neither gate can see. It is a genuinely different class from the hex ban this story mechanized, and widening it needs care — `transparent` and `currentColor` are legitimate and must stay allowed. **Re-entry:** story 1-6, when real components start writing color declarations; add a named-color alternation to both patterns with an explicit allowlist.

## Deferred from: 1-6-app-shell-and-as-of-control (2026-07-19)

Named by the story's own Design Notes as items to **record rather than resolve**, plus what surfaced
while landing the shell. `DESIGN.md` is read-only to this story, so nothing that needs a token change
could have closed here.

- ~~**The shadcn/ui copy-in re-enters at story 1-6.**~~ **MOVED, not taken.** 1-5's review recorded
  the copy-in as 1-6's obligation and as the place AD-15 was most likely to be violated. 1-6 built
  no shadcn primitive at all: the only one it needed was a date picker, and shadcn's is
  `react-day-picker` + `popover` + `button` — five runtime dependencies whose Tailwind v4 templates
  ship `oklch` literals, a second set of variable names (`--background`, `--primary`, `--ring`) with
  hard-coded values, and a `.dark` class block. A native `<input type="date">` inside a hand-built
  popover is fully keyboard-accessible, inherits `color-scheme`, adds nothing, and violates nothing.
  **Re-entry: the first capability form that needs a primitive the shell does not build** —
  realistically CAP-2's employee form (story 3-2). The obligation is unchanged: primitives must be
  **re-pointed** at the generated tokens (`--primary: var(--color-primary)`), never added alongside
  them, and the `.dark` block dropped. Note that the ESLint ban now also catches a `dark:` variant,
  which shadcn primitives ship by default — but it still cannot see a `.css` file, so
  `tests/tokens/no-hex.test.ts` is what catches a literal written there and is worth re-reading
  before the copy-in rather than after.
- **`ui → application` types-only is still mechanically unenforced, and now there is something to
  enforce against.** Open since the 1-2 review, when the `ui` layer was empty. It no longer is:
  `src/ui/as-of-control.tsx` imports `resolveAsOf` as a VALUE, because a client component must turn
  a URL param into a displayed date where no server render is available to do it. **1-6 rules that
  this is allowed** — `ui` may call PURE, total, clock-free functions from `domain` and
  `application`; what stays banned is a use-case, a repository port, or anything under
  `src/adapters/**`. That ruling is recorded in `src/ui/README.md`, but the ESLint zone message
  still says "types only, by convention" and lint still passes on any value import from
  `application`, including one that would not be pure. So the gate and the rule now disagree in a
  new way: previously the rule was unenforced, now it is also mis-stated. **Re-entry:** either
  amend the zone message to the ruling above and add a narrower rule that bans `application/
  use-cases/**` and `adapters/**` from `ui` specifically, or reverse the ruling and resolve the
  as-of date server-side into pre-formatted strings passed as props. This also closes the still-open
  "May `src/ui` import a pure domain FUNCTION, or only types?" item from the 1-4 deferral, which
  named 1-6 as its re-entry point — the answer is above, but the enforcement is not.
- **Named CSS colors (`red`, `white`, `transparent`) still escape both halves of the color ban.**
  Unchanged from the 1-5 follow-up review, which named 1-6 as re-entry "when real components start
  writing color declarations". Real components now exist, and none of them writes a named color —
  every surface, ink, and border in the shell is a token utility — so nothing was violated and there
  was no forcing case to design the rule against. `COLOR_LITERAL` in `tests/tokens/no-hex.test.ts`
  and the mirrored patterns in `eslint.config.mjs` still match hex and color *functions* only.
  **Re-entry:** the first component that needs a non-token color at all, or a routine hardening
  pass; widening needs an explicit allowlist because `transparent` and `currentColor` are legitimate
  and in use (`as-of-control.tsx`'s glyph is `stroke="currentColor"`).
- **The dark token set's `[ASSUMPTION]` flag can now be assessed against a real render for the first
  time — and this story could only do half of it.** DESIGN.md § Dark mode says the flag comes off
  only after verification against real renders. `e2e/accessibility.spec.ts` now runs axe over all
  seven routes in BOTH color schemes and the opened popover besides, so the 17 derived values are
  measured by a browser on real elements rather than computed over frontmatter — a strictly stronger
  statement than 1-5 could make, and it is green. But axe measures CONTRAST, and the flag is about
  whether the values *look right*, which no automated gate can answer. **Re-entry:** a human loads
  the deployed app with the OS in dark mode and rules. If they clear, the flag comes off in
  DESIGN.md; if they do not, the values change in DESIGN.md followed by `npm run tokens:build` —
  never in the generated file, and never in a story that may not amend DESIGN.md, which this one
  could not.
- **`input-border` on `surface-base` / `surface-tint` was avoided, not fixed.** 1-5 recorded that
  the token misses DESIGN's own 3:1 non-text floor on two of the three surfaces (2.96:1 and 2.82:1
  against 3.09:1 on `surface-card`) and named 1-6's shell as a likely re-entry. The shell put its
  one form control — the as-of picker's panel and its date input — on `surface-card`, which is
  inside the floor, so the defect is untouched rather than triggered. Same for the border tokens the
  1-5 code review flagged (`border-hairline` at 1.18:1 as `button-secondary.border`): the shell's
  buttons use `input-border` and `bg-primary`, not the hairline, so no control boundary in it sits
  below 3:1. **Re-entry unchanged:** the first story that puts an input on `surface-base` or
  `surface-tint`, or renders DESIGN's `button-secondary` / `outlier-badge` as specified. The fix is
  a darker token in DESIGN.md and a rebuild.
- **The `/`-focuses-search shortcut is deferred to the first surface with a search field.**
  EXPERIENCE § Interaction Primitives specifies it ("active only when focus is outside editable
  fields"), and the shell deliberately does not implement it: there is no search field anywhere in
  the product yet, so the shortcut would either do nothing or focus something invented.
  **Re-entry:** the Employees capability (story 3-2), which is the first surface with a search
  field. Implementing it there also means implementing the "focus is outside editable fields" guard
  — with a date input now in the header, a naive global key handler would swallow `/` while someone
  is typing in it.

Also surfaced while landing the story, outside the Design Notes:

- **The six placeholder pages are near-identical files with no shared component.** Each is one
  `<p className="rounded bg-surface-card p-3 text-body-md">` differing only in its sentence. Not
  factored into a shared `ui` primitive because every one of them is due to be replaced wholesale by
  a real capability surface, and a shared placeholder component would be an abstraction with a
  guaranteed lifetime of one epic. **Re-entry:** none expected — the duplication disappears as the
  capability epics land. Worth naming only so a reviewer sees it was a choice.
- **`e2e/shell.spec.ts` mirrors the seven routes and labels rather than importing `nav-items.ts`.**
  Deliberate: a gate that imported the thing it gates passes on any renaming of both at once, and
  the labels are ratified requirements, not implementation detail. The cost is that adding a
  destination means editing two lists, and forgetting the second is a silent coverage gap rather
  than a failure. **Re-entry:** if the nav ever grows past a handful of stable entries, consider
  asserting the two lists agree in `tests/ui/nav-items.test.ts` — which keeps the e2e list
  independent while making a divergence loud.

- source_spec: `docs/implementation-artifacts/spec-2-1-bulk-import-backend.md`
  summary: The coverage floor and the mutation gate both stop at `src/domain/**` + `src/application/**`, leaving every adapter — the hand-rolled CSV parser, the Prisma write funnel, the Route Handler — measured by nothing.
  evidence: Story 2-1's review found two data-loss defects, both in `src/adapters/**`, in code that passed every CI gate. The gate set reads as rigor ("100% mutation score") while the riskiest code in the change is ungated. Widening the gates is a project-level decision, not a story call, but the asymmetry is now demonstrated rather than theoretical.

- source_spec: `docs/implementation-artifacts/spec-2-1-bulk-import-backend.md`
  summary: `epochMillisUtc()` in `src/adapters/clock.ts` is reachable from `src/app/**`, so a Server Component can branch on the time of day despite the clock port deliberately withholding milliseconds.
  evidence: `eslint.config.mjs` grants `src/app/**` the composition-root exception to import `./adapters`. The restriction that keeps raw time out of rendering is currently a doc comment, not a lint rule, so nothing mechanically prevents the outcome the port exists to make impossible.

- source_spec: `docs/implementation-artifacts/spec-2-1-bulk-import-backend.md`
  summary: The integration suite cannot clean up after itself, so every CI run permanently accumulates employees and reference rows in the shared database.
  evidence: `salary_record` has UPDATE/DELETE revoked at the `payroll_app` role (AD-18), which is correct and deliberate — but it means integration fixtures are immortal. Later stories asserting population counts will inherit the accumulated debris, and any fixture scheme deriving a value against a UNIQUE column will eventually collide. Needs a disposable-branch-per-run policy or an owner-role teardown path.

- source_spec: `spec-3-1-employee-crud-backend.md`
  summary: Integration suites derive their `level.rank` band from a hashed UUID prefix modulo a
    fixed span, so runs collide with no retry once enough rows accumulate — and `rank` is UNIQUE
    with no cleanup path.
  evidence: The scheme is inherited from `tests/integration/import-employees.test.ts`, so this is a
    pre-existing pattern rather than anything story 3-1 introduced. A collision surfaces as a
    unique-violation thrown from `beforeAll`, which errors every test in the file with a message
    that names neither the cause nor the fix. This dissolves the moment the outstanding "provision a
    fresh database per run" item is taken; until then a retry or an `ON CONFLICT (rank) DO NOTHING`
    on the taxonomy insert would make it self-healing.

- source_spec: `spec-3-1-employee-crud-backend.md`
  summary: Neither Server Action nor any Route Handler performs authentication or authorization —
    anyone who can reach the deployment can create and edit the employee directory.
  evidence: There is no `middleware.ts`, no session check, and no auth story anywhere in the sprint
    plan; the CAP-1 upload endpoint shipped under the same posture, so this is a product-level gap
    rather than a story-3-1 regression. Recorded because the surface just widened from one
    file-upload endpoint to structured create/edit RPCs over the whole directory, which makes the
    absence materially more consequential than it was in Epic 2.

- source_spec: `spec-3-1-employee-crud-backend.md`
  summary: `createEmployeesWithSalaries` re-resolves country only inside its transaction and never
    re-checks role or level activity, so the batch import can still write an employee against a role
    deactivated between judgement and write.
  evidence: Surfaced by story 3-1, which closed the same window on both single-employee write paths
    and so made the batch path's gap visible by contrast. The country re-resolution exists to protect
    the AD-6 currency written onto the salary record, not to guard activity generally; role and level
    were simply never considered. The FKs target `code` and check existence, not `is_active`, so
    nothing else notices. This is story 2-1's code — 3-1 deliberately did not widen its blast radius
    by editing the import funnel.

- source_spec: `spec-3-1-employee-crud-backend.md`
  summary: `payroll_app` holds `DELETE` on `employee` — granted in 1-3 and, unlike `salary_record`,
    never revoked — so the "no delete path" guarantee rests entirely on the port omitting a method.
  evidence: Verified against the live database: `role_table_grants` for `payroll_app` on `employee`
    returns SELECT, INSERT, DELETE. Story 3-1 asserted the guarantee with a regex over repository
    method names, which a method called `archive` or `purge` would pass. `salary_record` shows the
    intended pattern (`REVOKE UPDATE, DELETE` plus a trigger); `employee` never received it. A
    migration revoking DELETE would make the invariant structural rather than conventional.

- source_spec: `spec-3-1-employee-crud-backend.md`
  summary: `hasErrorCode`'s depth bound of 5 is a guess unvalidated against real driver nesting, and
    the walk descends only `cause`/`meta`, missing errors nested in arrays such as `meta.errors[]`.
  evidence: A miss silently converts the AP004 hire-date rejection — which the user must see and can
    act on — into a generic "could not be saved". Nothing in the migrations or the adapter
    establishes how deeply `@prisma/adapter-pg` actually wraps a raised SQLSTATE, so the bound is
    asserted by a test rather than derived from the driver's behaviour.

- source_spec: `docs/implementation-artifacts/spec-3-1-employee-crud-backend.md`
  summary: The reference-activity re-resolution in `createEmployee` / `updateEmployee` narrows but
    does not close the deactivation race; a `FOR SHARE` lock on the role/level/country rows would.
  evidence: Both transactions issue plain `SELECT`s at PostgreSQL's default READ COMMITTED, which
    take no row lock, so a concurrent `UPDATE role SET is_active = false` can commit between the
    re-read and the write and the FK — targeting `code`, checking existence rather than activity —
    will not notice. This repo already establishes the remedy: `20260719060000_hire_date_lock`
    takes `FOR SHARE` on the parent row and argues at length that "no amount of trigger logic that
    only READS can prevent it". Consequence is small (one employee holding a code retired moments
    earlier, which the system tolerates for existing holders anyway), which is why review pass 3
    corrected the overclaiming comments rather than churning a green adapter; the lock is the real
    fix and needs `$queryRaw` plus stub-test rework.

- source_spec: `docs/implementation-artifacts/spec-3-1-employee-crud-backend.md`
  summary: Every error in the CAP-2 stack is swallowed with no diagnostic trail — eight bare
    `catch` blocks discard the error object entirely, leaving no way to tell an outage from a bug.
  evidence: Five in `src/application/use-cases/employees.ts`, two in
    `src/app/employees/handle-employee-write.ts`, one in `revalidateCommitted`. A deadlock, a
    connection failure, a schema mismatch and a genuine `TypeError` all become the same opaque
    `{ kind: 'unavailable' }` or "The employee could not be saved". The story's own headers cite
    2-1's "HTTP 500 carrying no report at all" as the defect being fixed, and the fix substitutes a
    payload carrying no report while additionally destroying the stack trace the 500 preserved.
    Pre-existing in shape — `handle-import-request.ts` swallows identically — so the resolution is a
    logging port decided once for the codebase, not a patch inside this story.

- source_spec: `docs/implementation-artifacts/spec-3-1-employee-crud-backend.md`
  summary: `updateEmployee` is a blind full-column overwrite with no optimistic concurrency, so two
    editors of the same employee silently lose one set of edits.
  evidence: Every call writes all five granted columns from a form snapshot with no precondition on
    the row's prior state. `employee.updated_at` exists (`prisma/schema.prisma`) and is inside the
    column-level UPDATE grant, so the token an optimistic check would use is already there and
    already writable. `UpdateEmployeeOutcome` has no arm for a stale write, so adding one is a
    change to a contract this story finalized for 3-2 — which is why it is a decision rather than a
    patch. CAP-2's deliverable is a shared multi-user edit form, so the lost update is reachable.

- source_spec: `docs/implementation-artifacts/spec-3-1-employee-crud-backend.md`
  summary: CAP-2 form rejections reuse the CSV importer's sentence composer verbatim, so a form
    user is shown spreadsheet vocabulary — "The hire_date cell is blank" — including the raw column
    token the same module goes to trouble to strip elsewhere.
  evidence: `src/domain/employee.ts` reuses `composeRejectionSentence`, and
    `tests/domain/employee.test.ts` pins outputs like `'The name cell is blank.'` and
    `'The hire_date cell reads "31-12-2020", which is not a date in YYYY-MM-DD form.'` as the form's
    copy. Meanwhile `EMPLOYEE_FIELD_LABELS` and `employeeOffendingValue` carry long comments arguing
    `hire_date` is "a database column token" with "no business in a sentence a user reads", and a
    test asserts no underscore reaches any `nonTextFieldRejection` sentence. The care is real but
    applied to the rejection a user will almost never see. The spec's Code Map mandates reusing the
    composer "verbatim", so a form projection of the sentences is a spec-level decision for 3-2's
    copy pass, not a unilateral contract change.

## Deferred from: 4-1-record-salary-change-backend (2026-07-19)

The first two entries are named by the story's own Design Notes as items to **record rather than
resolve**; both are pre-existing, and what this story changes is the exposure of the second. The
entries after them were added by the story's review passes.

- source_spec: `docs/implementation-artifacts/spec-4-1-record-salary-change-backend.md`
  summary: Historical `effective_from < hire_date` rows are still never detected — the invariant is
    enforced only at write time, never over rows that already exist.
  evidence: `20260719050000_review_hardening_1_4` guards both write directions (a `salary_record`
    INSERT and an `employee.hire_date` UPDATE), and `salary-fields.ts` now judges the same rule in
    the domain for both write paths. Nothing scans for rows that predate those guards or that a
    direct owner-connection insert planted, and the AD-16 population predicate reads
    `effective_from` unconditionally, so such a row silently joins an as-of population before its
    subject was hired. Closing it is a data-repair migration plus a standing assertion, neither of
    which belongs to a story whose surface is one append.

- source_spec: `docs/implementation-artifacts/spec-4-1-record-salary-change-backend.md`
  summary: This story adds a SECOND concurrent inserter to the `FOR SHARE` lock the hire-date
    trigger takes, on the unretried 40P01 deadlock path already recorded under
    `spec-1-4-money-currency-domain-primitives.md`.
  evidence: `appendSalaryRecord` inserts into `salary_record` inside its own transaction, so it
    fires `salary_record_effective_from_not_before_hire`, which takes `FOR SHARE` on the employee
    row (`20260719060000_hire_date_lock`). Until now the only inserters were the batch import and
    the seed — both effectively serial. CAP-3 is a per-employee form, so two HR users recording
    changes for one person, or one recording a change while another edits that person's hire date,
    now upgrade a shared lock to exclusive in opposite orders. No retry path exists anywhere in the
    codebase, and a 40P01 reaching the boundary surfaces as the generic "The salary change could not
    be saved, so nothing was recorded." The remedy is unchanged from the original entry — a bounded
    serialization-failure retry decided once for the codebase — and it is not this story's to
    invent, but the probability of hitting it is materially higher after this story than before it.

- source_spec: `spec-4-1-record-salary-change-backend.md`
  summary: An employee whose `hire_date` is in the future can never be given a salary at all — every
    possible effective date is rejected by one of two rules that cannot both be satisfied.
  evidence: `checkSalaryEffectiveFrom` rejects `effectiveFrom > today` (Law 5 / AD-18) and rejects
    `effectiveFrom < hireDate` (AD-16 / the `AP004` trigger). When `hireDate > today` the two
    windows are disjoint, so the form refuses every date, alternating between two contradictory
    sentences. Future hire dates are explicitly legal: `employee-fields.ts:139` says "whether a date
    may be in the future is a property of the CALLER's rule (a salary record may not be
    future-dated; a hire date may)", and `employee.ts:19` says "a future-hired employee is simply
    out of population until their date arrives." The BEHAVIOUR is arguably correct — the epic
    forbids scheduled and pending changes, so a not-yet-hired person legitimately has no pay yet —
    but nothing tells the user that, and CAP-2 can create such an employee with no salary. The
    decision needed is copy plus possibly an affordance ("pay can be recorded from <hire date>"),
    which is a spec-level call, not this story's.

- source_spec: `spec-4-1-record-salary-change-backend.md`
  summary: A double-submitted salary change plants a second, permanently undeletable row, and
    nothing in the system can distinguish it from a legitimate same-day correction.
  evidence: `salary_record` carries unique indexes only on `id` and `seq`; `salaryRecordId` is
    generated server-side per invocation (`record-salary-change.ts`), so a retry cannot reuse one.
    A double-click on story 4-2's Save, or a browser retry of a slow Server Action, appends two
    identical rows, and `salary_record` admits no DELETE — the duplicate is permanent and shows
    twice in the timeline forever. `handle-salary-change.ts`'s own `revalidateCommitted` comment
    reasons about exactly this hazard for the write-failure path and then leaves the ordinary
    double-click open. A unique constraint is NOT the fix: same-date, same-amount appends are the
    designed correction mechanism (AD-18), so the schema cannot tell the two apart. The remedy is an
    idempotency key on the payload, which trips this spec's "Block If" (adding a field), or UI-level
    submit suppression in 4-2 — a decision above this story.

- source_spec: `spec-4-1-record-salary-change-backend.md`
  summary: CAP-3's user-facing rejection sentences quote raw database column tokens and CSV
    vocabulary — the same defect already recorded for CAP-2, now reproduced on a new surface.
  evidence: `tests/domain/salary-change.test.ts` pins the form's sentences as `The effective_from
    cell is blank.`, `amount_minor "0" is not greater than zero.` and `effective_from 2026-07-20 is
    later than today, 2026-07-19.` Story 4-2 will render these beside fields labelled "Effective
    date" and "Amount", showing a user schema identifiers and the word "cell" for a form they did
    not import. This story BUILT the right vocabulary — `SALARY_FIELD_LABELS` in `salary-change.ts`
    maps to "effective date"/"amount" — but wired it only into `nonTextSalaryFieldRejection`, the
    rejection only a hostile caller reaches. The sentences cannot simply be changed here: they come
    from the one shared composer and this spec's "Block If" forbids altering an import rejection
    sentence. Closing it means a CAP-3 sentence set distinct from CAP-1's, which is a spec decision.

- source_spec: `spec-4-1-record-salary-change-backend.md`
  summary: The `unknown-country` sentence blames a missing reference row when the real condition is
    a DEACTIVATED one — inherited from CAP-1, now reachable from a form.
  evidence: `composeRejectionSentence` renders `Country code "IN" is not in the country reference
    table.`, but `loadReferenceData` filters on `is_active`, so the reason fires when the row IS
    present and merely inactive (`record-salary-change.ts` says so in its own comment). An admin
    retiring a country sends HR looking for a row that is right there. Pre-existing: the import path
    has always had the same imprecision, and correcting the shared sentence is forbidden by this
    spec's "Block If". Closing it means a distinct reason kind for the deactivated case.

- source_spec: `docs/implementation-artifacts/spec-4-1-record-salary-change-backend.md`
  summary: The CAP-3 payload applies two different whitespace policies across its three fields — the
    effective date is trimmed before judging, the amount and the currency are not.
  evidence: `validateSalaryChange` reaches the date through `checkEffectiveFromCell` ->
    `checkDateCell` (`employee-fields.ts`), which trims, so `' 2026-07-19 '` is ACCEPTED.
    `checkSalaryAmount` and `checkSalaryCurrency` deliberately do not trim, so `' 2500000'` is
    `malformed-amount` and `' INR'` produces `Currency " INR" is not "INR", the currency of country
    "IN".` — a sentence that reads as nonsense. A padded value is a realistic form input (paste from
    a spreadsheet, a mobile keyboard's trailing space), and the two policies are invisible to the
    user. Not closable here: `checkDateCell` is shared with CAP-1, so making the date strict would
    change the import contract this spec's "Block If" protects, and trimming the amount would
    contradict this spec's own I/O matrix (`'  12'` must reject). The decision is where CAP-3
    normalizes its payload, which belongs to story 4-2's form.

- source_spec: `docs/implementation-artifacts/spec-4-1-record-salary-change-backend.md`
  summary: `currency` is a required, byte-exact field on a form path where the server already knows
    the only correct answer.
  evidence: AD-6 states currency FOLLOWS from the country and is never chosen, yet
    `SalaryChangeInput` requires the caller to submit it and `checkSalaryCurrency` compares with
    `!==` after no normalization. For CSV import the field is a genuine assertion worth confirming;
    on a form there is nothing to confirm — 4-2 will render it disabled or hidden, and a disabled
    input is not submitted in `FormData` at all, yielding `The currency field was not submitted as
    text.` on a field the user cannot correct. Deferred rather than patched because the field is
    named in this spec's `<intent-contract>` I/O matrix ("Currency not the country's" -> rejected),
    so removing or defaulting it is a spec-level change this story is not entitled to make.

- source_spec: `docs/implementation-artifacts/spec-4-1-record-salary-change-backend.md`
  summary: Reference data changing between the use-case's read and the adapter's transaction
    collapses to a generic write failure instead of the specific rejection the union could carry.
  evidence: `assertSalaryRecordWritable` THROWS on both the inactive-country and currency-mismatch
    arms; `appendSalaryRecord` does not map either to `AppendSalaryRecordOutcome`, so
    `record-salary-change.ts` catches and returns `salaryWriteFailureRejection()` — "The salary
    change could not be saved, so nothing was recorded." The user cannot tell whether a retry would
    succeed (country deactivated: never; currency edited: yes, with the new currency).
    `tests/integration/salary-records.test.ts` proves both races reach the guard. Deferred because
    adding arms to `AppendSalaryRecordOutcome` widens a port story 4-2 already consumes, and this
    story's own residual risk notes that union moved once during review already.
