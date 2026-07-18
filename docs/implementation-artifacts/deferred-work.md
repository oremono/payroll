# Deferred Work

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

- **Five value constraints deferred to Story 1-4**, which owns the reference values they constrain
  (code review 2026-07-18; `fx_rate.rate > 0` and `UNIQUE (level.rank)` were judged load-bearing and
  landed in 1-3 instead): `settings.outlier_threshold_pct` range CHECK (0 or negative makes outlier
  detection meaningless), `currency.minor_unit_exponent` range CHECK (a negative exponent renders
  every salary 100× wrong through the one money formatter), `effective_from >= hire_date`,
  case-insensitive uniqueness on reference `code` columns (so `usd` and `USD` cannot both exist),
  and non-empty CHECKs on `employee.name` and the `code` columns.

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
