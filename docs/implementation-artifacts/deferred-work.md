# Deferred Work

## Deferred from: code review of 1-2-ci-pipeline-and-gates (2026-07-18)

- `ui → application` "types only" is stated in the ESLint zone message (`eslint.config.mjs`, ui zone) but not mechanically enforced — value imports from `application` into `ui` pass lint. Deferred because the `ui` layer is empty until Story 1-6; when the first component lands, add a type-only carve-out (e.g., a stricter zone plus `@typescript-eslint/consistent-type-imports`, or an importKind-aware boundary rule) so the convention becomes a gate.

## Deferred from: 1-3-data-model-and-migrations (2026-07-18)

Surfaced by this story, deliberately **not** absorbed into it. The first two are sprint-plan gaps
that need rk's decision on ownership — they are bound to Epic 1 but owned by no story in 1-1…1-6.

- **The Repository contract is ownerless.** `epics.md` line 64 binds it to Epic 1, but 1-3's
  out-of-scope table defers the typed port (`append` + read interfaces) to "its first consumer"
  (CAP-2/CAP-3), and no Epic 1 story claims it. 1-3 proves append-only at the **database**; the
  typed port does not exist. **Re-entry:** either add an Epic 1 story for the port, or record that
  Epic 1's Data-model requirement is satisfied by the schema alone and the port belongs to Epic
  2/3. Decide before CAP-2 starts, or the first consumer will invent the contract ad hoc.
- **Deployment / NFR11 is ownerless.** `epics.md` line 68 binds "the product is deployed and
  demonstrable end-to-end" to Epic 1, but no story 1-1…1-6 wires Vercel/Neon. 1-3 documents the
  `migrate deploy`-at-build intent (README § Database) and builds none of the plumbing.
  **Re-entry:** needs an Epic 1 deployment story, or an explicit decision to move NFR11 later.
- **`updated_at` carries a DB default that Prisma does not require.** `@default(now()) @updatedAt`
  was chosen so raw SQL inserts (which the role-switching integration assertions require) can omit
  the column. Harmless, but it means the DB, not only the client, can set `updated_at`.
  **Re-entry:** revisit if a future story ever needs `updated_at` to be client-authoritative.
- **`TRUNCATE` bypasses the append-only trigger.** Row-level `BEFORE DELETE` triggers do not fire
  on `TRUNCATE`. This is not a runtime hole — `payroll_app` is granted only `SELECT, INSERT` on
  `salary_record` and `TRUNCATE` is a separate privilege it never receives — but an owner
  connection could truncate the table. **Re-entry:** if a future story grants the runtime role
  broader privileges, add a `BEFORE TRUNCATE` statement-level trigger.
