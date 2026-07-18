---
baseline_commit: cc7d4e0af713e41558c22ccbac715eb99cc2c2f6
---

# Story 1.7: Deployment and Environments

Status: in-progress

<!-- Sequenced immediately after 1-3, before 1-4 (rk, 2026-07-18). Row order in sprint-status.yaml,
     not the key number, is execution order. -->

## Story

As **rk**, shipping this product for assessment,
I want the application **deployed on Vercel against Neon Postgres 18, with migrations applied at build and a database branch per pull request**,
so that **NFR11a is met — the product is reachable at a URL on the target stack — and every later capability lands on a deploy pipeline that already works.**

---

## Context & Scope

Epic 1's opening clause promises "a **deployed**, empty-but-real application." Stories 1-1…1-3 built the
scaffold, the CI gates, and the schema; none of them wired a host. `correct-course` on 2026-07-18 gave
deployment its own story and split NFR11 so this story owns a criterion it can actually meet.

**This story wires infrastructure around machinery that already exists.** It does not redesign it. Story
1-3 established every moving part:

| Established by 1-3 | This story's job |
| --- | --- |
| Two DB roles: owner (migrations) + `payroll_app` (runtime) | Map both onto Neon endpoints and Vercel env |
| `prisma/sql/bootstrap-roles.sql` provisions `payroll_app` | Run it once against the Neon primary |
| `migrate deploy` guarded — fails `AP002` if `payroll_app` is absent | Guarantee bootstrap precedes the first deploy |
| `prisma.config.ts` is the only source of the Prisma CLI URL | Supply `DATABASE_URL` in Vercel's build env |
| `getDbClient()` is lazy, cached on `globalThis` | Bound its pool for serverless |
| `README § Database` records `migrate deploy`-at-build as **intent** | Build the plumbing; convert intent to fact |

**Exactly one production source file changes:** `src/adapters/db/client.ts` (pool bound). Everything else is
configuration, workflow, and documentation.

### In scope

Neon project + primary provisioning · `vercel.json` with a migrating build command · Vercel project wired to
the repo · `DATABASE_URL` / `DATABASE_URL_APP` as Vercel environment variables honouring the owner/runtime
split · a preview pipeline that creates a Neon branch per PR and deploys against it · branch cleanup on PR
close · a bounded runtime connection pool · a smoke check proving the deployed URL serves · README
§ Deployment.

### Out of scope — do NOT absorb

| Item | Owner |
| --- | --- |
| App shell, sidebar, as-of control | Story 1-6. **The deployed URL will show the 1-1 placeholder page.** This trade-off was accepted explicitly when 1-7 was resequenced ahead of 1-6 — it is not a defect. |
| Design tokens / the AD-15 token build step | Story 1-5. The build command will need one more stage then; leave a named seam, build nothing. |
| The five value CHECK constraints | Story 1-4 (`deferred-work.md`) |
| `ui → application` types-only lint enforcement | Story 1-6 |
| Seeding the deployed database | Epic 12. **Seeding is never a deploy side effect** — a command, always (spine § Deployment). |
| NFR11b (planted outlier surfaced, thin group refused, on the deployed instance) | Acceptance check after Epics 6, 7, 12 |
| Auth | SPEC non-goal. Do not add any. |
| Observability, rate limiting, backup/restore | Spine § Deferred — explicitly no operational stakes at one user |

---

## Verified Environment (checked 2026-07-19 — provisioning is DONE)

The operator steps below have been completed and independently verified against the live Neon project. These
are facts, not assumptions — use them rather than re-deriving:

| Fact | Value |
| --- | --- |
| Neon project ID | `empty-unit-30800685` (also the `NEON_PROJECT_ID` GitHub variable) |
| Postgres major | **18** ✓ |
| Region | `aws-ap-southeast-1` ✓ |
| Database | `neondb`, owner `neondb_owner` ✓ |
| **Default branch name** | **`production`** — *not* `main`. Pass it explicitly as `parent_branch`. |
| Roles present | `neondb_owner`, `payroll_app` ✓ (bootstrap ran; role is visible via the Neon API) |
| Migrations applied | **4**, 9 tables in `public` ✓ |
| `payroll_app` on `salary_record` | **`INSERT, SELECT` only** — no `UPDATE`, no `DELETE` ✓ |

That last row is the one that matters most: **AD-18 layer A is confirmed enforced on Neon**, not merely on the
CI service container. The bootstrap-then-migrate ordering and the schema-scoped grants both behaved as 1-3
designed them. Do not re-run `bootstrap-roles.sql` against the primary.

**GitHub secrets and variables are all set and verified** (2026-07-19): secrets `NEON_API_KEY`,
`PAYROLL_APP_PASSWORD`, `VERCEL_TOKEN`; variables `NEON_PROJECT_ID`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
Vercel project `payroll` (team `oremonos-projects`) is live on Node 24.x and serving the 1-1 placeholder
page at <https://payroll-iota-coral.vercel.app>. **Task 1 is therefore already complete — start at Task 2,
and do not re-run `bootstrap-roles.sql`.**

### Naming rulings (rk, 2026-07-19)

| Decision | Ruling |
| --- | --- |
| Neon default branch vs git `master` | **Keep `production`.** It is Neon's own current default and semantically accurate. Do not rename to match git; pin `parent_branch: production` instead. |
| Per-PR Neon branch name | **`pr-<number>`**, e.g. `pr-42`. Not derived from the head ref. |

---

## Operator Steps (rk — NOT the dev agent)

**The dev agent cannot create accounts, projects, or secrets.** These steps are rk's, and the agent must
stop and request them rather than fake or skip them. Everything after this section is the agent's.

1. **Neon project.** Create one project, **PostgreSQL 18**, region **`aws-ap-southeast-1` (Singapore)**.
   Postgres 18 is Neon's default for new projects since 2026-06-05, but confirm it explicitly — **there is no
   in-place major upgrade on Neon**; getting off 18 later means a new project and a data migration. Default
   database name `neondb`, default role `neondb_owner`. Record the **project ID**.
2. **Generate a strong `payroll_app` password.** Neon requires **≥ 60 bits of entropy** and stores plaintext-supplied
   passwords encrypted. Use e.g. `openssl rand -base64 24`. Keep it — the workflow composes the runtime URL from it.
3. **Run the bootstrap once, against the Neon primary branch** (see the agent's runbook in Task 1 for the exact
   command). This is the one manual database step; it is what makes every later branch work.
4. **Vercel project**, linked to this GitHub repository. Framework preset Next.js. Record **org ID** and **project ID**.
5. **Set the secrets and variables** listed in the table in Task 4. Vercel env vars added via
   `vercel env add` default to **sensitive** (write-only — not viewable afterwards); that is correct here, so
   record values outside Vercel before entering them.

---

## Acceptance Criteria

1. **Production is reachable and serves the app.** A Vercel production deployment built from `master` responds
   `200` at its URL and renders the 1-1 placeholder page. The URL is recorded in `README § Deployment`. *(NFR11a)*

2. **Migrations are applied at build, from version-controlled config.** A committed `vercel.json` sets:

   ```json
   { "buildCommand": "prisma generate && prisma migrate deploy && next build" }
   ```

   `buildCommand` in `vercel.json` — **not** the dashboard Build Command and **not** a `vercel-build` npm
   script. `vercel.json` is reviewable in the diff; the dashboard is invisible state, and `vercel-build` is
   documented today only for Vercel Functions in an `api/` directory, not for framework-preset projects.
   `prisma generate` is in the build command **as well as** `postinstall` and both must stay: Vercel restores
   `node_modules` from cache before install, so an unchanged lockfile means `postinstall` never fires while
   `schema.prisma` has changed — the documented "outdated Prisma Client" failure. `postinstall` remains
   because CI, local installs, and `npm ci --omit=dev` all depend on it.

3. **The owner/runtime split survives the move to Neon, and each URL uses the correct endpoint.**

   | Variable | Role | Neon endpoint | Consumed by |
   | --- | --- | --- | --- |
   | `DATABASE_URL` | `neondb_owner` | **direct / unpooled** | `prisma.config.ts` → `migrate deploy` at build |
   | `DATABASE_URL_APP` | `payroll_app` | **pooled** (`-pooler` in the host) | `src/adapters/db/client.ts` at runtime |

   The direct endpoint for migrations is mandatory, not stylistic: Neon's pooler runs PgBouncer in
   **transaction mode**, which discards session state between statements and does not support session-level
   advisory locks — the exact mechanism a migration runner uses to serialize itself. Both URLs carry
   `sslmode=require`; Neon rejects non-TLS connections outright. `client.ts` still **requires**
   `DATABASE_URL_APP` with no fallback to `DATABASE_URL` — that guard is AD-18 layer A and must not be
   loosened to make deployment easier.

4. **The runtime connection pool is bounded.** `src/adapters/db/client.ts` constructs `PrismaPg` with an
   explicit `max`, and the choice is justified in a comment. This closes the `deferred-work.md` item
   "No `pg` pool sizing for serverless". The pooled endpoint is the primary fix — PgBouncer, not this
   process, is the real pool. `max` bounds sockets from one function instance. **`max: 1` is rejected**: it
   serializes every concurrent query behind any in-flight interactive transaction, and it is not current
   Neon guidance (Neon's own Vercel examples set no `max` at all; `max: 1` is unsourced folklore).
   Default to **`max: 5`**. It is a module constant, not an env var — env holds only connection strings and
   the deploy target (Conventions / AD-19).

5. **AC 4 is delivered test-first, in two commits.** An integration test asserts the bound **behaviourally, by
   timing** — not by reading the constant back, and **not** via `pg_stat_activity`. Shape:

   - **Baseline:** `max` concurrent `SELECT pg_sleep(1)` through `getDbClient()` complete in ~1 s (one wave).
     Without this sub-assertion, a pool that serializes everything would pass the main assertion for the
     wrong reason.
   - **Bound:** `max + 3` concurrent `pg_sleep(1)` take **≥ ~2 s** (two waves), with a generous upper ceiling.

   `pg_stat_activity` is explicitly rejected: behind PgBouncer in transaction mode it reports the pooler's
   server-side backends, which have no 1:1 relation to this process's sockets and are shared across clients —
   so the assertion would be wrong exactly where AC 10 forces this suite to run against the pooled endpoint.
   `neondb_owner` is also not a superuser, so restricted columns may come back `NULL`. The timing assertion
   holds identically on direct and pooled endpoints. The 30 s `testTimeout` in `vitest.integration.config.ts`
   accommodates it; `fileParallelism: false` keeps it from contending with the other file.

   **The failing test and the code that satisfies it are separate commits** — the test commit must be pushed
   red against the current default of 10. This is the standing practice adopted after 1-3's review and it
   **binds from this story onward**; 1-3's Dev-Agent-Record narrative is explicitly not acceptable evidence.
   The red commit is *expected* to fail the `Integration (Postgres 18)` gate on the branch (`ci.yml` triggers
   on every push to every branch) — that failure is the artifact. AC 14 is evaluated at the branch tip and on
   `master`, not on every intermediate commit.

6. **Bootstrap runs once per Neon project, and this is proven, not assumed.** `bootstrap-roles.sql` is executed
   against the Neon **primary** with a real generated password. It is **not** re-run per preview branch: a Neon
   branch is a copy-on-write clone that inherits its parent's roles *and their passwords*, so `payroll_app`
   already exists on every branch. This is precisely why 1-3's split holds on Neon — role creation is
   cluster-scoped and inherited, while the schema-scoped `USAGE`/`GRANT`/`REVOKE` live in the migration and are
   re-applied by every `migrate deploy`. `README § Deployment` states this inheritance explicitly, because the
   `AP002` guard in `20260718163326_append_only_and_checks` makes the ordering unforgiving: bootstrap before the
   first `migrate deploy`, or the migration history is poisoned with `P3018`.

7. **A Neon branch is created per pull request and the preview deploys against it.** On `pull_request`
   (`opened`, `synchronize`, `reopened`) a workflow creates/reuses a Neon branch named for the git branch, and
   deploys a Vercel preview whose `DATABASE_URL` and `DATABASE_URL_APP` point at that branch. On PR close the
   branch is deleted. Pinned actions: `neondatabase/create-branch-action@v6` and
   `neondatabase/delete-branch-action@v3`. **Pin the moving `@v6` tag, never `v6.4.0`** — that tag exists but
   points at an *older* commit than the `6.3.1` release and carries no release. The v6 input/output names
   differ from the v5 examples still published in Neon's own docs (`username`→`role`, `parent`→`parent_branch`,
   `*_with_pooler`→`*_pooled`); the v5 names will fail silently or with an unhelpful error.

8. **The preview deployment is CI-driven, not Git-driven.** Vercel's automatic Git deployment is disabled for
   non-`master` branches so that a preview build never starts before its Neon branch and env vars exist.
   `master` keeps auto-deploying to production. Configure this in `vercel.json` (verify the current
   `git.deploymentEnabled` shape against Vercel's `vercel.json` reference before writing it; if that key no
   longer exists, use the Ignored Build Step and say so in the Dev Agent Record). Preview env values are passed
   per-deployment via `vercel deploy --build-env` / `--env` rather than persisted with `vercel env add`, so no
   per-branch state accumulates in the Vercel project and nothing needs cleaning up beyond the Neon branch.

9. **The Neon-managed and Vercel-managed native integrations are NOT installed.** Record the reason in
   `README § Deployment`: the native integration injects its own `DATABASE_URL` — a **pooled owner** URL, which
   is wrong on both axes (pooled breaks `migrate deploy`, owner-at-runtime voids AD-18 layer A) — it
   **silently overrides** preview env vars for the deployment with no failure signal, it **fails setup outright**
   if `DATABASE_URL` already exists on the project, and it cannot express a second role at all. The
   Vercel-managed variant also ties branch lifetime to Vercel's deployment retention (6 months by default)
   rather than to the PR.

10. **The provisioned Neon branch is proven correct by the existing integration sequence.** The preview
    workflow reproduces `ci.yml`'s integration steps against the Neon branch, **in full and in order**:
    `npx prisma migrate deploy` → `npx prisma migrate diff --from-config-datasource --to-schema
    prisma/schema.prisma --exit-code` → `npm run test:integration`. All three must pass. Running only the
    test step would prove nothing about migrations: a Neon branch is a copy-on-write clone that already
    carries the parent's schema, so on a PR that *adds* a migration the suite would test a stale schema and
    the first real exercise of `migrate deploy` on Neon would be the Vercel build — after the gate. This is
    the mechanical proof that bootstrap-inheritance, `migrate deploy`, the schema-scoped grants, and the
    append-only `REVOKE` all behave on Neon exactly as they do on the CI service container — the single
    largest risk in this story. **Reuse `tests/integration/*`; write no Neon-specific variant of it.**

11. **No health-check route handler is added.** AD-21 fixes the route-handler count at exactly two (the CAP-1
    multipart upload and CSV export) and neither exists yet. Deployed database connectivity is proven by AC 10,
    from CI, against the branch — never by a new endpoint. This constraint is the reason AC 10 is shaped the way
    it is.

12. **A smoke check proves the deployed URL serves — without widening the a11y gate.** `e2e/smoke.spec.ts`
    asserts the page renders at `baseURL`. `playwright.config.ts` takes `baseURL` from `PLAYWRIGHT_BASE_URL`
    when set and skips `webServer` in that case; unset, behaviour is unchanged (build + serve on port 3100).

    **`test:a11y` must be narrowed at the same time.** It is `playwright test` with no filter today, and
    `testDir` is `./e2e` — so simply adding a second spec silently makes the `Accessibility (axe)` job run a
    reachability test, and makes the preview run the axe spec against the deployed URL. Neither is sanctioned.
    Split them:

    ```
    "test:a11y":   "playwright test e2e/accessibility.spec.ts",
    "test:smoke":  "playwright test e2e/smoke.spec.ts",
    ```

    (Two Playwright `projects` with `testMatch` is an acceptable alternative.) `package.json` is therefore a
    modified file in this story.

13. **No secret is committed.** `.env.example` gains commented Neon URL *shapes* only — no host, no password,
    no project ID. Real values live in GitHub secrets and Vercel env. Grep the diff for the Neon host and the
    `payroll_app` password before the final commit.

14. **Every existing gate still passes.** All four required checks — `Lint · Typecheck · Build · Unit +
    Coverage`, `Mutation testing (domain)`, `Integration (Postgres 18)`, `Accessibility (axe)` (these are the
    `name:` display strings, which are what branch protection and `README § Continuous Integration` use — not
    the job ids) — are green at the branch tip and on `master`, unmodified in intent. The new preview workflow
    is a **separate workflow file**; do not entangle it with `ci.yml`. If a deploy check is added to branch
    protection, update the required-check list in `README § Continuous Integration`.

15. **Documentation is updated to fact, not intent.** `README` gains a **§ Deployment & environments** section
    (environment table, the two URLs and their endpoints, bootstrap-once-per-project + branch inheritance, the
    production URL, why the native integration is not used). The blockquote in `README § Database` saying the
    plumbing "is not built yet" is **removed** — it is now false. `deferred-work.md` closes the pool-sizing
    item.

---

## Tasks / Subtasks

- [x] **Task 1 — Provision Neon and run the bootstrap** (AC: 3, 6) — *requires the operator steps above*
  - [x] Confirm the Neon project is PG **18**, region `aws-ap-southeast-1`, database `neondb`.
  - [x] Capture both primary connection strings from the Neon console: direct (owner) and pooled (`-pooler`).
  - [x] Run bootstrap once against the primary. Note psql needs a psql-parsable URL — pass parameters
        explicitly, exactly as `ci.yml` does, rather than reusing a Prisma-shaped URL. Take the host verbatim
        from the Neon console (direct hosts look like `ep-<endpoint-id>.<region>.aws.neon.tech`; do not
        hand-construct it):
        ```
        PGPASSWORD='<neondb_owner password>' psql \
          -h ep-<endpoint-id>.ap-southeast-1.aws.neon.tech -U neondb_owner -d neondb \
          -v ON_ERROR_STOP=1 -v payroll_app_password="$PAYROLL_APP_PASSWORD" \
          -f prisma/sql/bootstrap-roles.sql
        ```
  - [x] Verify: `\du payroll_app` shows the role with `LOGIN` and **no** `neon_superuser` membership. A
        SQL-created role is deliberately not granted `neon_superuser` — that is the restriction we want.
  - [x] Run `npx prisma migrate deploy` locally against the Neon **owner direct** URL. Confirm it applies
        cleanly (no `AP002`, no `P3018`), then `npx prisma migrate status` is clean.
  - [x] Verify `ALTER DEFAULT PRIVILEGES` took effect for the *Neon* owner. Migration
        `20260718170934_runtime_role_default_privileges` keys default privileges to **the role that ran it**;
        locally that was `postgres`, on Neon it is `neondb_owner`. Confirm `payroll_app` can `SELECT` every
        table. If it cannot, record the finding — do not silently re-grant.

- [x] **Task 2 — Bound the runtime pool, test-first** (AC: 4, 5)
  - [x] **Commit A (red):** add the timing assertion of AC 5 to `tests/integration/client.test.ts` — that file
        already exercises the real `getDbClient()` (it exists precisely because `schema.test.ts` uses
        hand-rolled pools and so never tested the shipped client). Push it failing against the current default
        of 10. Do not reach for the owner `Pool` at line 19: it is there to plant fixtures, and connection-count
        introspection is rejected by AC 5.
  - [x] **Commit B (green):** `new PrismaPg({ connectionString, max: APP_POOL_MAX })` in
        `src/adapters/db/client.ts`, with `APP_POOL_MAX = 5` as a module constant and a comment carrying AC 4's
        rationale (PgBouncer is the real pool; this bounds per-instance sockets; `max: 1` rejected and why).
  - [x] Keep the adapter construction **inside** `createClient()` — 1-3 put it there deliberately so dev
        hot-reload does not leak a pool per reload. Do not hoist it.

- [x] **Task 3 — `vercel.json`** (AC: 2, 8)
  - [x] `buildCommand` exactly as in AC 2.
  - [x] Disable Git auto-deploy for non-`master` branches. **Decision rule — do not escalate to a human:**
        first try `{"git": {"deploymentEnabled": {"master": true}}}` and check against Vercel's current
        `vercel.json` reference whether per-branch entries behave as a deny-by-default allowlist. If they do
        not (i.e. unlisted branches still deploy), fall back to an **Ignored Build Step** that exits non-zero
        for any ref other than `master`, keyed on `$VERCEL_GIT_COMMIT_REF`. Record which mechanism you used
        and what you verified in the Dev Agent Record.
  - [x] Add `.vercel/` to `.gitignore` — the CLI creates it on `vercel deploy`/`vercel pull` and it is
        currently untracked noise at best, committed local project linkage at worst.
  - [x] Leave a comment (or a README note, since JSON has no comments) marking where the AD-15 token build
        step will slot in at Story 1-5. Build nothing for it.
  - [x] Do **not** set `installCommand` — Vercel's default (`npm install`, driven by the lockfile) runs
        `postinstall`, which is what generates the git-ignored Prisma client. Overriding the install command at
        project level makes Vercel pick the *oldest* available package-manager version; leave it alone.

- [ ] **Task 4 — Secrets and environment** (AC: 3, 13)
  - [ ] Confirm with rk that these exist before writing any workflow that consumes them:

    | Where | Name | Value |
    | --- | --- | --- |
    | GitHub secret | `NEON_API_KEY` | Neon API key |
    | GitHub secret | `VERCEL_TOKEN` | Vercel access token |
    | GitHub secret | `PAYROLL_APP_PASSWORD` | the generated `payroll_app` password |
    | GitHub variable | `NEON_PROJECT_ID` | Neon project ID |
    | GitHub variable | `VERCEL_ORG_ID` | Vercel org ID |
    | GitHub variable | `VERCEL_PROJECT_ID` | Vercel project ID |
    | Vercel env (Production) | `DATABASE_URL` | owner, **direct**, `sslmode=require` |
    | Vercel env (Production) | `DATABASE_URL_APP` | `payroll_app`, **pooled**, `sslmode=require` |

  - [ ] Preview-scope Vercel env vars are **not** set — preview values are passed per-deployment (Task 5).
  - [ ] Update `.env.example`: commented Neon URL *shapes* beneath the existing local defaults, showing the
        `-pooler` host difference and `sslmode=require`. Local development still points at the Docker
        Postgres 18 on port 55432 — do not change the local defaults.

- [x] **Task 5 — Preview pipeline** (AC: 7, 8, 10) — new file `.github/workflows/preview.yml`
  - [x] Trigger: `pull_request` on `opened`, `synchronize`, `reopened` against `master`. Add a `concurrency`
        group keyed on the PR ref with `cancel-in-progress: true`, mirroring `ci.yml:15-17` — without it two
        rapid pushes race on branch creation and deploy.
  - [x] Standard preamble, same as every `ci.yml` job: `actions/checkout@v4`, `actions/setup-node@v4` with
        `node-version-file: .nvmrc` and `cache: npm`, `npm ci`.
  - [x] **Read `action.yml` at the pinned `@v6` ref before writing the step.** Confirm the exact input and
        output names rather than trusting this story's list — v6 renamed them (`username`→`role`,
        `parent`→`parent_branch`, `*_with_pooler`→`*_pooled`) and Neon's own published sample workflow is
        still on v5. Then: `neondatabase/create-branch-action@v6` with `project_id: ${{ vars.NEON_PROJECT_ID }}`,
        `api_key: ${{ secrets.NEON_API_KEY }}`, `role: neondb_owner`, and the two names ruled on below:
        - **`parent_branch: production`** — the default branch is *not* named `main`; the action's default
          parent will not resolve. (rk, 2026-07-19: keep Neon's `production`, do not rename to match git.)
        - **`branch_name: pr-${{ github.event.number }}`** — *not* derived from the head ref. (rk, 2026-07-19.)
          The PR number is identical on the `opened`/`synchronize` and `closed` events and needs no
          sanitizing, so cleanup always resolves the same name it created. A head-ref-derived name must be
          sanitized (git refs carry slashes and characters awkward in a branch name) and orphans its Neon
          branch if the git branch is renamed mid-PR — and orphans are not cosmetic here, they consume the
          project's branch quota.

        Idempotent — a re-run on `synchronize` returns the existing branch with `created: false`.
  - [x] **Compose `DATABASE_URL_APP` in the workflow** — do **not** ask the Neon API for `payroll_app`'s
        credentials. The password is known because branches inherit it (AC 6), and whether the API can return
        credentials for a SQL-created role is unverified; composing removes the dependency entirely. The
        action's output is a **full connection URI for `neondb_owner`**, not a bare host, so this is a
        *rewrite*: take `db_url_pooled`, substitute user and password with `payroll_app` /
        `secrets.PAYROLL_APP_PASSWORD`, and ensure `sslmode=require` is present (AC 3 requires it; the
        action's output may or may not carry it). Mask the composed value with `::add-mask::` before it can
        reach a log.
  - [x] **Reproduce `ci.yml:115-124` against the branch, all three steps in order** (AC 10):
        `npx prisma migrate deploy` → `npx prisma migrate diff --from-config-datasource --to-schema
        prisma/schema.prisma --exit-code` → `npm run test:integration`, with `DATABASE_URL` = owner **direct**
        and `DATABASE_URL_APP` = app **pooled**. Any of the three failing must fail the job — this is the gate
        that catches a mis-provisioned branch before the deploy. Do **not** run `bootstrap-roles.sql` here;
        the role is inherited (AC 6), and re-running it per branch is the mistake this story exists to avoid.
  - [x] Deploy. The Vercel CLI is **not** a project dependency — invoke it pinned via `npx vercel@<pin>` and
        record the pin. It needs: `--token=${{ secrets.VERCEL_TOKEN }}`, `--yes`, and `VERCEL_ORG_ID` /
        `VERCEL_PROJECT_ID` exported as **environment variables** (the CLI reads them from the environment to
        skip interactive linking — passing them as GitHub `vars` alone does nothing). Pass
        `--build-env DATABASE_URL=…` and `--env DATABASE_URL_APP=…`, and capture the URL the CLI prints on
        stdout into a step output (`echo "url=$URL" >> "$GITHUB_OUTPUT"`) for the smoke step.
        The build needs only `DATABASE_URL`; `client.ts` is lazy, so the build never touches
        `DATABASE_URL_APP` — that laziness is load-bearing here, do not make the client eager.
  - [x] Smoke: `npx playwright install --with-deps chromium` (required — the runner has no browser, exactly as
        `ci.yml:138-139` handles it), then `npm run test:smoke` with `PLAYWRIGHT_BASE_URL` set to the captured
        URL.
  - [x] Second workflow / job on `pull_request: [closed]` → `neondatabase/delete-branch-action@v3` with
        `branch: pr-${{ github.event.number }}` (input is `branch`; `branch_id` is deprecated). It must fire
        on close **whether or not the PR merged**, and must not fail the run if the branch is already gone.
  - [x] Guard against forks: `secrets` are unavailable to fork PRs. Skip the job cleanly rather than failing.
  - [x] Note the branch quota in `README § Deployment`: Neon plans cap branches per project (commonly 10 on
        free), and the `closed` cleanup does not fire for git branches deleted outside a PR, so orphans
        accumulate. Set a branch TTL/expiry if the action supports one, and document the manual cleanup path.

- [x] **Task 6 — Smoke check** (AC: 12)
  - [x] `playwright.config.ts`: `baseURL` from `process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3100'`;
        `webServer` omitted when `PLAYWRIGHT_BASE_URL` is set.
  - [x] `e2e/smoke.spec.ts`: navigate to `/`, assert a `200` and that the page renders. Keep it thin — it
        asserts *reachability*, not content; content is Story 1-6's.
  - [x] Narrow `test:a11y` and add `test:smoke` per AC 12, then confirm the `Accessibility (axe)` job runs
        **only** the axe spec — same scope as before, not merely still-green.
  - [x] `e2e/` is inside both gates: `tsconfig.json` includes `**/*.ts` and `eslint.config.mjs` does not
        ignore `e2e/`. `smoke.spec.ts` must pass `npm run lint` and `npm run typecheck` — check locally rather
        than discovering it in CI.

- [ ] **Task 7 — Production deploy and verification** (AC: 1, 14)
  - [ ] Merge to `master`, confirm the production build runs `migrate deploy` (check the build log for the
        Prisma output) and succeeds.
  - [ ] Confirm the URL responds `200` and renders the placeholder page.
  - [ ] Confirm Node **24** in the build log (`.nvmrc` + `engines.node >= 24 <25`), rather than assuming.
  - [ ] **Verify `pg` resolves in the deployed function.** `pg@8.22.0` and `@types/pg` are
        **devDependencies**, but `@prisma/adapter-pg` is a runtime dependency that needs `pg` at runtime. This
        is the same class of trap that put `prisma` and `dotenv` in `dependencies`, and it was not re-checked
        then. If the function cannot resolve `pg`, promote it to `dependencies` (leave `@types/pg` in
        devDependencies) and note it in the Dev Agent Record.
  - [ ] Confirm all four existing CI checks are green on `master`.

- [x] **Task 8 — Documentation** (AC: 15, 9, 13)
  - [x] `README § Deployment & environments` — new section per AC 15, including the AC 9 rationale.
  - [x] Remove the now-false "plumbing is not built yet" blockquote from `README § Database`.
  - [x] `deferred-work.md`: close the pool-sizing item, pointing at this story.
  - [x] Record in `deferred-work.md` anything you hit and deliberately did not fix — in particular the
        integration-fixtures-accumulate item, which preview branches now partly mitigate (each PR gets a fresh
        clone) but do not solve for the primary.

---

## Dev Notes

### Why bootstrap runs once, not per branch — the load-bearing insight

A Neon branch is a copy-on-write clone of its parent and **inherits the parent's Postgres roles together with
their passwords**. `payroll_app` is therefore present, with the same credential, on every branch created from
the primary — which is what lets a story built around a cluster-wide role survive a branch-per-PR model
without re-bootstrapping.

This maps 1-3's split onto Neon exactly:

| 1-3 put it here | Because | On Neon |
| --- | --- | --- |
| `CREATE ROLE` in `bootstrap-roles.sql`, not a migration | roles are cluster-wide and outlive `migrate dev`'s shadow DB (prisma/prisma#6581) | run once on the primary; inherited by every branch |
| `USAGE` + table `GRANT`/`REVOKE` in the migration | schema-scoped privileges are silently revoked when the schema is rebuilt | re-applied by `migrate deploy` on every branch |

Get the order wrong on a **fresh project** and the `AP002` guard raises, `migrate deploy` exits `P3018`, and
the migration history is left poisoned. 1-3 confirmed this empirically and flagged it by name as the thing
that would block this story.

### Endpoint selection is a correctness constraint, not a performance preference

Pooled (`-pooler` in the hostname) runs PgBouncer in transaction mode: a connection can be handed to another
client between statements. That discards `SET`/`RESET`, `LISTEN`/`NOTIFY`, temp tables, SQL-level `PREPARE`,
and **session-level advisory locks** — which is exactly how a migration runner prevents two concurrent
migrators from racing. Migrations therefore need the **direct** endpoint. Runtime wants **pooled**: PgBouncer
absorbs up to 10,000 client connections, which is the real answer to "each lambda opens its own pool."

### Prisma 7 constraints that shape the build command

- `prisma migrate deploy` has **no `--url` flag** in v7 (the whole option table is `--help`). The URL can only
  arrive via `prisma.config.ts` reading `DATABASE_URL` from the environment. That is why `DATABASE_URL` must be
  a **build-time** variable on Vercel, not merely a runtime one.
- `prisma generate` needs **no database** — it reads the generator and data model blocks only. `prisma.config.ts`
  deliberately *warns* rather than throws on a missing `DATABASE_URL` for exactly this reason. Do not
  "improve" that to a throw; it would break the `check` and `a11y` CI jobs, which build with no database.
- The generated client is **git-ignored** and rebuilt by `postinstall`. `prisma` and `dotenv` are runtime
  `dependencies` (not devDeps) specifically so `npm ci --omit=dev` can still generate. This was ratified by rk
  on 2026-07-18 — do not "tidy" them back into devDependencies; it breaks the Vercel build.
- **Known open upstream issue to watch:** `prisma migrate deploy` failing with *"The datasource.url property is
  required in your Prisma config file"* in containerized builds despite `DATABASE_URL` being set — reported as
  a 7.2.0 regression, still open. Prove `migrate deploy` works in the Vercel build **early** (Task 1 does it
  locally against Neon first, which isolates Neon from Vercel as failure domains). If it reproduces, record it
  and raise it rather than working around it silently.
- Prisma 7 replaced the Rust query engine with node-`pg`, which **changes SSL handling**. Neon's console now
  emits `channel_binding=require` alongside `sslmode=require`. Test the connection explicitly; if
  `channel_binding` causes trouble with `@prisma/adapter-pg`, `sslmode=require` alone is sufficient for Neon —
  record the finding either way.

### Files being modified — current state and what must be preserved

**`src/adapters/db/client.ts`** — the only production file this story touches. Today: imports `PrismaPg` and
the generated `PrismaClient`; `createClient()` reads `DATABASE_URL_APP` and **throws** if absent;
`getDbClient()` caches on `globalThis` unconditionally. Three things must survive unchanged:

1. **The no-fallback requirement on `DATABASE_URL_APP`.** A fallback to `DATABASE_URL` would let the app
   connect as owner, and a table owner bypasses privilege checks — `REVOKE UPDATE, DELETE` would become a
   silent no-op. This was a real defect found in 1-3's review. Deployment pressure is exactly the situation in
   which someone adds that fallback. Do not.
2. **Unconditional `globalThis` caching, including in production.** The common Next.js snippet caches only
   outside production because there a module-level binding is the real singleton; this module has no such
   binding, so making it conditional would build a fresh `PrismaClient` + pool per call and exhaust
   connections within a few dozen requests.
3. **Laziness.** Merely importing the module must not open a connection — the `check` and `a11y` jobs build and
   serve the app with no database, and the Vercel build does too.

**`playwright.config.ts`** — today: `testDir: './e2e'`, port **3100** (deliberately not 3000, so a stray
`next dev` is never audited), `baseURL: http://localhost:3100`, `webServer` runs `npm run build && npm run
start -- --port 3100`, chromium only, `retries: 0`. Adding a deployed `baseURL` must not change any of this
when `PLAYWRIGHT_BASE_URL` is unset.

**`.github/workflows/ci.yml`** — four jobs: `check`, `mutation`, `integration`, `a11y`. The `integration` job
already models the exact sequence this story reproduces on Neon: bootstrap via `psql` → `migrate deploy` →
drift check → integration tests. **Read it as the reference implementation.** Note its comment already
anticipates this story: *"a deployed environment supplies a real secret the same way."* Note also its
documented psql/Prisma URL incompatibility — psql rejects `?schema=public` as an invalid URI query parameter,
so the two tools cannot share one URL string. The same class of problem recurs with Neon's query parameters.

**`README.md`** — headings today: Prerequisites, Install, Commands, Database (Connection strings, Local setup,
Schema and migrations), Continuous Integration, Source tree, Testing. **No Deployment section exists.** Add it;
remove the § Database blockquote that says the plumbing is not built.

### Testing standards

- The new pool assertion is an **integration** test — it needs a real database. It belongs in
  `tests/integration/`, which is excluded from the unit suite so that suite stays DB-free and clock-free.
- Do not add to the domain/application suites; this story writes no domain code, and the coverage floor
  (domain 100 / application 90 / global 90) and the `src/domain` mutation gate are unaffected.
- Red-before-green must be **visible in the commit sequence** (AC 5). This is the story where that practice
  starts being enforced as an artifact rather than a narrative.
- **Law 1's testable surface in this story is the pool bound, and only that.** `vercel.json`, `preview.yml`,
  the `package.json` script split, and the Playwright config change have no runtime behaviour to drive a
  failing test against; they are verified by the pipeline running. Do not invent tests for YAML or JSON to
  feel compliant, and do not record a Law 1 violation for them — Law 1 binds production code, and
  `src/adapters/db/client.ts` is the only production code here. (1-3's review established that an adapter *is*
  production code and Law 1 binds it exactly as it binds the domain — which is why the pool change is
  test-first rather than waved through as "just config".)

### Anti-patterns specific to this story

- ❌ Adding a `/api/health` route handler. AD-21 caps route handlers at exactly two, and neither has been built.
- ❌ Installing the native Neon–Vercel integration "because it is easier" — it injects a pooled owner URL and
  silently overrides preview env vars.
- ❌ Using one connection string for both roles, or one endpoint for both migrations and runtime.
- ❌ Seeding as part of the deploy. Seeding is always an explicit command (spine § Deployment; Epic 12).
- ❌ Setting the build command in the Vercel dashboard instead of `vercel.json` — invisible state, absent from
  code review.
- ❌ Copying Neon's published sample workflow verbatim; it is still pinned to `@v5` with the old output names.
- ❌ Adding auth, observability, or rate limiting. All explicitly deferred.
- ❌ Committing a Neon host, project ID, or password.

### Project Structure Notes

New files: `vercel.json` (repo root), `.github/workflows/preview.yml`, `e2e/smoke.spec.ts`.
Modified: `src/adapters/db/client.ts`, `package.json` (script split — AC 12), `playwright.config.ts`,
`tests/integration/client.test.ts`, `.gitignore` (`.vercel/`), `.env.example`, `README.md`,
`docs/implementation-artifacts/deferred-work.md`.

No `src/domain/**` or `src/application/**` file is touched — this story adds no domain surface, and the
import-boundary lint zones are unaffected. `vercel.json` at the repo root matches Vercel's expected location
and sits alongside the other root-level config (`next.config.ts`, `playwright.config.ts`, `prisma.config.ts`).

Node is pinned by `.nvmrc` (`24`) and `engines.node >= 24 <25`; Vercel's build image offers Node 24.x, so no
extra configuration is needed — confirm 24 in the build log rather than assuming.

### Git and workflow

Branch off `master` before committing. Small, incremental commits — the Incubyte assessment reads commit
history. AC 5 mandates the red and green commits be separate.

### References

- [Source: docs/planning-artifacts/epics.md#Epic 1] — deployment named as a workstream (line 124)
- [Source: docs/planning-artifacts/epics.md#NonFunctional Requirements] — NFR11a / NFR11b (lines 51–54)
- [Source: docs/planning-artifacts/epics.md#Additional Requirements] — Deployment (line 71), stack pins (line 72)
- [Source: docs/planning-artifacts/architecture/architecture-payroll-2026-07-17/ARCHITECTURE-SPINE.md#Deployment & environments] — the environment table and region ruling (lines 287–297)
- [Source: .../ARCHITECTURE-SPINE.md#AD-18] — append-only enforced at the database role by migration (line 153)
- [Source: .../ARCHITECTURE-SPINE.md#AD-21] — exactly two route handlers exist (line 171)
- [Source: .../ARCHITECTURE-SPINE.md#Consistency Conventions] — "Env holds only connection strings and the deploy target" (line 200)
- [Source: .../ARCHITECTURE-SPINE.md#Deferred] — observability, rate limiting, backup/restore out of scope (line 323)
- [Source: .../C4-MODEL.md#Deployment] — the three-environment deployment diagram (lines 148–171)
- [Source: docs/planning-artifacts/sprint-change-proposal-2026-07-18.md#3.1] — this story's scope sketch and sequencing ruling
- [Source: docs/implementation-artifacts/1-3-data-model-and-migrations.md] — the two-role split, `bootstrap-roles.sql` rationale, `migrate deploy`-at-build intent, the `AP002`/`P3018` finding
- [Source: docs/implementation-artifacts/deferred-work.md] — pool-sizing item (line 29); separate red/green commits, binding from this story (lines 9–16)
- [Source: docs/project-context.md] — the Laws; Law 1 (TDD), Law 5 (append-only), Delivery Boundary
- [Source: .github/workflows/ci.yml] — the reference bootstrap → migrate → drift → test sequence (lines 107–124)
- [Source: prisma/sql/bootstrap-roles.sql] — invocation contract, `current_database()` handling for Neon's `neondb`

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Claude Code, `bmad-dev-story`), 2026-07-19.

### Debug Log References

Every claim below is backed by a CI run or a command output, not by narrative.

| Evidence | Where |
| --- | --- |
| **Red commit fails `Integration (Postgres 18)`, other three gates pass** | [run 29658638514](https://github.com/oremono/payroll/actions/runs/29658638514) on `3961010` — `AssertionError: expected 1003.42 to be greater than or equal to 1900` |
| Preview pipeline green end-to-end (branch → migrate → diff → integration → deploy → smoke) | [run 29658480123](https://github.com/oremono/payroll/actions/runs/29658480123), 2m46s |
| Four required gates green at branch tip | [run 29658480127](https://github.com/oremono/payroll/actions/runs/29658480127) |
| Four required gates green on `master` after merge | [run 29658726061](https://github.com/oremono/payroll/actions/runs/29658726061) |
| Neon branch lifecycle create → delete | `Branch pr-1 created successfully`; cleanup [run 29658726129](https://github.com/oremono/payroll/actions/runs/29658726129) deleted `br-withered-flower-azy5bodw`, expiry `2026-07-25` (the 7-day TTL) |
| `ignoreCommand` blocks Git deploys on non-`master` | PR #1 Vercel check: **"Canceled by Ignored Build Step"** |
| `migrate deploy` genuinely runs in the Vercel build | Preview deploy log: `4 migrations found in prisma/migrations` / `No pending migrations to apply` |
| Migrations use the **direct** endpoint | Preview log datasource host `ep-withered-scene-az2n01hp.c-3.ap-southeast-1.aws.neon.tech` — no `-pooler` |
| Composed URLs never reach a log | Both render as `***` in every step's `env:` block |
| **Production build FAILS** (the blocker) | `payroll-5zz121ofc` — `Error: Connection url is empty. See https://pris.ly/d/config-url` |

### Completion Notes List

**Status: BLOCKED on an operator step. Tasks 1–3, 5, 6, 8 are complete and verified; Tasks 4 and 7
are not.** 13 of 15 ACs are met and evidenced. AC 1 is not met, and AC 3 is met in preview but not
in production.

#### The blocker (rk's action — I must not do this one)

The production build fails at `prisma migrate deploy` with **`Connection url is empty`**. The Vercel
`DATABASE_URL` variable exists and is scoped to Production, but **its value does not reach the build
step**. `vercel env pull --environment=production` returns it as an empty string while non-secret
system variables in the same pull carry real values.

This is consistent with the variable having been created as **sensitive** — which is exactly what
Operator Step 5 instructed. That step says `vercel env add` "defaults to sensitive … that is correct
here." **It is correct for `DATABASE_URL_APP` and wrong for `DATABASE_URL`**, because this story
moves `migrate deploy` into `buildCommand`, and a sensitive variable is exposed at runtime, not at
build. AC 3 states the requirement plainly ("`DATABASE_URL` must be a **build-time** variable"); the
operator step contradicts it. Recording rather than working around, per the story's own instruction.

The fix is one operator command (the value is the Neon **owner, direct** URL already recorded
outside Vercel):

```bash
vercel env rm  DATABASE_URL production --yes
vercel env add DATABASE_URL production --no-sensitive   # paste the owner DIRECT url
vercel redeploy https://payroll-iota-coral.vercel.app   # or push any commit to master
```

Leave `DATABASE_URL_APP` sensitive — it is only ever read at runtime, so sensitive is right for it.

If a redeploy still reports `Connection url is empty` after that, the cause is not sensitivity and
the next thing to check is whether the value itself was stored blank.

**Production is NOT down.** Vercel kept the last good alias; `https://payroll-iota-coral.vercel.app`
still returns `200`. But it is serving a **pre-story** build, which is why AC 1 cannot be signed off.
Every future `master` build will fail until the variable is fixed.

#### Three findings where I did not follow the story, and why

1. **`git.deploymentEnabled` cannot express deny-by-default (Task 3).** Task 3's decision rule said
   to try `{"git": {"deploymentEnabled": {"master": true}}}` first and check the reference. Checked:
   Vercel documents per-branch entries as an opt-**out** map — *"Unspecified branches default to
   true"* — so that shape would have left every branch deploying. `{"deploymentEnabled": false}`
   would also have stopped `master`. Used the story's documented fallback, `ignoreCommand`.
2. **`ignoreCommand`'s exit codes are inverted from the story's hint.** Task 3 says to exit
   "non-zero for any ref other than `master`". Vercel's documented semantics are the reverse —
   **exit 0 ignores the build, exit 1 continues it** — so the literal instruction would have
   deployed every non-`master` branch and skipped `master`. Implemented to the documented behaviour.
   Verified live: PR #1's Vercel check reads *"Canceled by Ignored Build Step."*
3. **`pg` did not need promoting to `dependencies` (Task 7).** Task 7 pre-authorised the promotion.
   It is not needed: `@prisma/adapter-pg` declares `pg: ^8.16.3` as a **hard dependency, not a
   peerDependency**, so `npm ls pg --omit=dev` still resolves `pg@8.22.0` under it. Our root entry
   is a version pin for the integration tests, which import `pg` directly. Made no change.

#### Notes on the rest

- **`ignoreCommand` + CLI deploys.** Vercel's docs do not state whether the Ignored Build Step runs
  for `vercel deploy`-created deployments. Rather than rest on unverified behaviour, the pipeline
  passes `--build-env CI_DRIVEN_PREVIEW=1` and `ignoreCommand` honours it — correct either way.
- **`::add-mask::` is only parsed from stdout.** The natural way to write the URL-composition step
  (`python3 <<PY >> "$GITHUB_ENV"`) silently discards the mask, because stdout is redirected. Env
  assignments are appended to `$GITHUB_ENV` from inside Python so the mask can stay on stdout.
- **`pg_sleep` cannot be selected directly through Prisma** — it returns `void` and the deserializer
  rejects a void column. Moved into `FROM`. The first red run failed on this, not on the assertion;
  fixed before the red commit so the recorded failure is the *intended* one.
- **The pool bound holds on the pooled endpoint**, which is the claim AC 5 rests on: the timing
  assertion passed against Neon's `-pooler` host in CI (5.3 s for the whole test) as well as against
  the local container. Cross-region latency (runner in `eastus2`, Neon in `ap-southeast-1`) leaves
  roughly a 2× margin on the 1.9 s boundary — recorded in `deferred-work.md` with a re-entry path.
- **`migrate deploy` reported "No pending migrations"** on the preview branch. That is the expected
  copy-on-write behaviour AC 10 predicts, not a skipped step — the clone already carried the
  parent's 4 migrations. The drift check (`No difference detected`) is what proves the schema right.
- **Merged with a merge commit, not a squash** (rk's call, asked explicitly): a squash would have
  destroyed the red→green pair that AC 5 requires to survive in history.
- **Fixed in passing:** the Vercel CLI had appended `.env*` to `.gitignore` *after* the
  `!.env.example` negation. Last-match-wins meant `.env.example` was silently re-ignored; it
  survived only because it was already tracked, and a fresh clone could not have re-added it.
- **Branch `evidence/1-7-pool-bound-red`** exists solely to carry the red commit's failing CI run
  (I pushed all six commits at once, so Actions only ran on the tip and the red artifact would
  otherwise have been my own uncorroborated account — the exact weakness this practice was adopted
  to fix). Safe to delete once the story is accepted; the Actions run record survives branch
  deletion.

#### AC status

| AC | Status |
| --- | --- |
| 1 Production reachable | ❌ **Not met** — production serves a pre-story build; the new build fails |
| 2 Migrations at build from `vercel.json` | ✅ Proven in the preview build |
| 3 Owner/runtime + direct/pooled split | ⚠️ Proven in preview; **production blocked** by the env var |
| 4 Pool bounded, justified | ✅ `APP_POOL_MAX = 5` |
| 5 Delivered test-first in two commits | ✅ Red run 29658638514, green `941c89f` |
| 6 Bootstrap once per project, proven | ✅ Integration suite green on an un-bootstrapped branch |
| 7 Neon branch per PR | ✅ `pr-1` created and deleted |
| 8 Preview is CI-driven | ✅ "Canceled by Ignored Build Step" |
| 9 Native integration not installed | ✅ Not installed; rationale in README |
| 10 Branch proven by the integration sequence | ✅ All three steps green on Neon |
| 11 No health-check route | ✅ None added |
| 12 Smoke check without widening a11y | ✅ Verified by `--list`, not by staying green |
| 13 No secret committed | ✅ Diff grepped for host, password, project id — placeholders only |
| 14 Every existing gate still passes | ✅ Green on branch tip and on `master` |
| 15 Docs updated to fact | ✅ README § Deployment & environments; `deferred-work.md` closed |

### File List

| File | Change |
| --- | --- |
| `src/adapters/db/client.ts` | Modified — `APP_POOL_MAX = 5`, passed to `PrismaPg` |
| `tests/integration/client.test.ts` | Modified — behavioural pool-bound timing assertion |
| `vercel.json` | **Added** — `buildCommand`, `ignoreCommand` |
| `.github/workflows/preview.yml` | **Added** — Neon branch per PR, gate, deploy, smoke, cleanup |
| `e2e/smoke.spec.ts` | **Added** — deployed-URL reachability check |
| `playwright.config.ts` | Modified — `PLAYWRIGHT_BASE_URL`; `webServer` omitted when set |
| `package.json` | Modified — `test:a11y` narrowed; `test:smoke` added |
| `.gitignore` | Modified — kept `.vercel/`; removed the CLI-appended `.env*` |
| `.env.example` | Modified — commented Neon URL shapes (no real values) |
| `README.md` | Modified — § Deployment & environments; removed the stale § Database blockquote |
| `docs/implementation-artifacts/deferred-work.md` | Modified — closed pool sizing; recorded new items |
| `docs/implementation-artifacts/1-7-deployment-and-environments.md` | Modified — this record |
| `docs/implementation-artifacts/sprint-status.yaml` | Modified — status tracking |

### Change Log

| Date | Change |
| --- | --- |
| 2026-07-19 | Pool bound landed test-first as separate red (`3961010`) and green (`941c89f`) commits |
| 2026-07-19 | `vercel.json` added; Git auto-deploy restricted to `master` via `ignoreCommand` |
| 2026-07-19 | Preview pipeline added; verified end-to-end on PR #1 |
| 2026-07-19 | Smoke check added; `test:a11y` narrowed to its own spec |
| 2026-07-19 | Documentation moved from intent to fact; pool-sizing deferred item closed |
| 2026-07-19 | Merged to `master` (merge commit `e32172b`); all four gates green on `master` |
| 2026-07-19 | **Blocked:** production build fails — `DATABASE_URL` not exposed to the Vercel build step |
