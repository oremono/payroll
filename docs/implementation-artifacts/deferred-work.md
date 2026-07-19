# Deferred Work

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
