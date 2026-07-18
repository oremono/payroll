# Deferred Work

## Deferred from: code review of 1-2-ci-pipeline-and-gates (2026-07-18)

- `ui → application` "types only" is stated in the ESLint zone message (`eslint.config.mjs`, ui zone) but not mechanically enforced — value imports from `application` into `ui` pass lint. Deferred because the `ui` layer is empty until Story 1-6; when the first component lands, add a type-only carve-out (e.g., a stricter zone plus `@typescript-eslint/consistent-type-imports`, or an importKind-aware boundary rule) so the convention becomes a gate.

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
- ~~**Deployment / NFR11 is ownerless.**~~ **RESOLVED (rk, 2026-07-18): add a new Epic 1 deployment
  story.** NFR11 ("the product is deployed and demonstrable end-to-end") stays bound to Epic 1 and
  gets its own story covering Neon provisioning and `migrate deploy`-at-build. **Not yet written —
  someone must create it** (suggested key `1-7-deployment`, sequenced after 1-6 so there is a shell
  worth demonstrating). 1-3 documents the `migrate deploy` intent (README § Database) and builds
  none of the plumbing; the two-role split (owner for migrations, `payroll_app` at runtime) is the
  main thing that story inherits.
- **`updated_at` carries a DB default that Prisma does not require.** `@default(now()) @updatedAt`
  was chosen so raw SQL inserts (which the role-switching integration assertions require) can omit
  the column. Harmless, but it means the DB, not only the client, can set `updated_at`.
  **Re-entry:** revisit if a future story ever needs `updated_at` to be client-authoritative.
- **`TRUNCATE` bypasses the append-only trigger.** Row-level `BEFORE DELETE` triggers do not fire
  on `TRUNCATE`. This is not a runtime hole — `payroll_app` is granted only `SELECT, INSERT` on
  `salary_record` and `TRUNCATE` is a separate privilege it never receives — but an owner
  connection could truncate the table. **Re-entry:** if a future story grants the runtime role
  broader privileges, add a `BEFORE TRUNCATE` statement-level trigger.
