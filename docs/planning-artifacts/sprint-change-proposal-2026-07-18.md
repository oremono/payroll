# Sprint Change Proposal — 2026-07-18

**Trigger story:** 1-3 (Data Model and Migrations)
**Requested by:** rk, 2026-07-18
**Scope classification:** **Minor** — additive; no architecture or UX change
**Mode:** Batch
**Status: APPROVED and APPLIED, 2026-07-18**

## Decisions (rk, 2026-07-18)

| Question | Ruling |
| --- | --- |
| NFR11 over-specified for Epic 1 (§3.3) | **Split into NFR11a / NFR11b** — applied to `epics.md` |
| Story 1-7 sequencing (§3.1) | **Immediately after 1-3**, not at epic end — de-risk Vercel/Neon provisioning early while the migration work is fresh. Key stays `1-7-…`; row order carries the sequence |
| Story 1-3's AC-1 deviation (`prisma`/`dotenv` as dependencies) | **Ratified** — AC 1 amended in the story file so criterion and code agree |
| Apply now | **Yes** — §4.1–§4.5 all applied |

Note the NFR11 split makes this proposal a **requirements-level** change, not purely a plan
mechanic — the only such change here, and the reason §3.3 was escalated rather than assumed.

---

## 1. Issue Summary

Story 1-3 surfaced, and deliberately did not absorb, a sprint-plan gap: **`epics.md` binds Deployment
and NFR11 to Epic 1, but no story in 1-1…1-6 owns either.** rk ruled on 2026-07-18 that deployment
stays in Epic 1 and gets its own story.

**Issue type:** gap in the epic → story decomposition (not a requirement change, not a pivot).

**How it arose.** `epics.md` describes epics but **enumerates no stories**. The story rows in
`sprint-status.yaml` were derived from Epic 1's prose description, which names six workstreams —
source tree, CI gates, data model, money/currency primitives, design tokens, app shell. Deployment
appears in that description only in the opening clause ("Stand up a **deployed**, empty-but-real
application"), so the derivation never produced a story for it. NFR11 is listed under the epic's
NFRs, but a listed NFR with no owning story is not a plan.

**Evidence.**

- `epics.md:51` — NFR11 exists as a requirement.
- `epics.md` "Additional Requirements → Deployment" — Vercel + Neon, `prisma migrate deploy` at
  build, branch-per-PR.
- `sprint-status.yaml` — Epic 1 holds `1-1` … `1-6` and no deployment row.
- Story 1-3 documented the `migrate deploy`-at-build **intent** in `README.md § Database` and built
  none of the plumbing, because it was correctly out of scope.

---

## 2. Impact Analysis

**Epic impact — Epic 1:** completable as planned, plus one story. The epic's own description
already promises a deployed application, so **no scope change** — this gives an existing promise an
owner.

**Other epics:** none affected. No capability epic depends on deployment to proceed; they depend on
schema (1-3, done) and tokens/shell (1-5, 1-6).

**Artifact conflicts:**

| Artifact | Change needed |
| --- | --- |
| `SPEC.md` | **None.** Line 81 already states "The product is deployed and demonstrable." |
| Architecture spine | **None.** § Deployment & environments already specifies Vercel + Neon, Postgres 18, `migrate deploy` at build, Neon branch per PR. The story implements what is already designed. |
| `epics.md` | Make deployment an explicit Epic 1 workstream; correct NFR11's binding (see §3.3) |
| `sprint-status.yaml` | Add the story row |
| `deferred-work.md` | Mark the entry resolved |
| UX artifacts | **None.** |

**Technical impact:** additive only. 1-3 already established the two-role split and the
`migrate deploy` command; the new story wires Vercel and Neon around them.

---

## 3. Recommended Approach

**Direct Adjustment** — add one story to Epic 1. No rollback, no MVP reduction.

### 3.1 New story

**Key:** `1-7-deployment-and-environments`
**Sequenced:** immediately after `1-3`, before `1-4`. *(Final — see the Decisions table. The analysis below originally proposed after `1-6`; rk chose earlier, to de-risk Vercel/Neon provisioning while the migration work is fresh.)*

Rationale for the position: the story has no hard technical dependency on 1-4/1-5, and placing it
straight after the data model proves the Vercel/Neon pipeline while the migration work is fresh —
CI had only just been observed green remotely when this was decided. The trade-off accepted: until
1-6 lands, the deployed URL shows the default page rather than the app shell.

**Scope sketch** (the story itself is written by `bmad-create-story`, not here): Neon project +
branch-per-PR provisioning; Vercel project wired to the repo; `prisma migrate deploy` at build;
`DATABASE_URL` / `DATABASE_URL_APP` as environment secrets, honouring the owner-vs-runtime split
1-3 established; `prisma/sql/bootstrap-roles.sql` run once per environment; the deployed skeleton
reachable at a URL.

### 3.2 Repository contract — record the other ruling

The same 1-3 analysis flagged that `epics.md` "Additional Requirements → Repository contract" is
also unowned. rk ruled it **defers to its first consumer (CAP-2/CAP-3)**. That ruling currently
lives only in a story's Completion Notes and in `deferred-work.md`; it belongs in `epics.md`, where
the next planner will look. No new story — an annotation.

### 3.3 ⚠️ NFR11 is over-specified for Epic 1 — RESOLVED (split approved)

This was the one item that was **not** a rubber stamp, and it is why this proposal is worth reading.
It is recorded below as it was argued, with the ruling at the end.

`SPEC.md:81` says only: *"The product is deployed and demonstrable."* `epics.md:51` restates NFR11
as:

> the product is deployed and demonstrable end-to-end: **a planted outlier surfaced without being
> searched for, and a thin peer group refused out loud.**

Those two clauses are a **demonstration script**, and they cannot be satisfied in Epic 1 at any
point. A planted outlier requires CAP-6 (Epic 7) and the seeded population (Epic 12); a thin peer
group refusing out loud requires CAP-5 (Epic 6). So NFR11 as written is **unachievable by the epic
it is bound to** — binding it to Epic 1 guarantees Epic 1 closes with an unmet NFR.

**Recommendation — split it:**

- **NFR11a — Deployed** (Epic 1, story 1-7): the pipeline exists and the app is reachable at a URL,
  migrations applied at build. This is what Epic 1 can actually own and what story 1-7 delivers.
- **NFR11b — Demonstrable end-to-end** (verified after Epics 6, 7, and 12): the planted outlier and
  the out-loud refusal, on the deployed instance. A final acceptance check, not a build task.

The alternative — leave NFR11 whole and bound to Epic 1 — means either 1-7 carries acceptance
criteria it cannot meet, or the epic closes with a known-unmet NFR. Neither is honest.

**RESOLVED (rk, 2026-07-18): split approved and applied to `epics.md`.** It is a requirements-level correction, not a plan mechanic, which is why it was escalated rather than assumed.

---

## 4. Detailed Change Proposals

### 4.1 `docs/planning-artifacts/epics.md` — Epic 1 description

**Section:** Epic List → Epic 1: Foundation & Deployable Skeleton

**OLD:**

> …the generated design-token system, and the app shell with sidebar IA and the global as-of date
> control. After this epic Alice can open the deployed app and see the shell; …

**NEW:**

> …the generated design-token system, the app shell with sidebar IA and the global as-of date
> control, **and the deployment pipeline itself (Vercel + Neon, `prisma migrate deploy` at build,
> Neon branch per PR)**. After this epic Alice can open the deployed app and see the shell; …

**Rationale:** deployment was implicit in "Stand up a deployed…" and so was dropped when stories
were derived from this description. Naming it as a workstream is what prevents the same omission
recurring.

### 4.2 `docs/planning-artifacts/epics.md` — NFR11

**Section:** NonFunctional Requirements

**OLD:**

> - **NFR11 — Deployed and demonstrable** · the product is deployed and demonstrable end-to-end: a
>   planted outlier surfaced without being searched for, and a thin peer group refused out loud.
>   (SPEC; AD deployment table)

**NEW:**

> - **NFR11a — Deployed** · the product is deployed on the target stack and reachable: Vercel +
>   Neon, migrations applied at build, preview branch per PR. *Owned by Epic 1 (story 1-7).* (SPEC;
>   AD deployment table)
> - **NFR11b — Demonstrable end-to-end** · on the deployed instance, a planted outlier is surfaced
>   without being searched for and a thin peer group is refused out loud. *Verified after Epics 6,
>   7, and 12 — it depends on CAP-5, CAP-6, and the seeded population; it is an acceptance check,
>   not a build task.* (SPEC; AD deployment table)

**Rationale:** §3.3. **Approved and applied.**

### 4.3 `docs/planning-artifacts/epics.md` — Repository contract annotation

**Section:** Additional Requirements → Repository contract

**Appended:** *Ruled 2026-07-18: the typed port lands with its first consumer (CAP-2/CAP-3), not in
Epic 1 — Epic 1's data-model requirement is satisfied by the schema, whose DB-level append-only
enforcement (story 1-3) is the part that could not wait.*

### 4.4 `docs/implementation-artifacts/sprint-status.yaml`

**OLD:**

```yaml
  1-6-app-shell-and-as-of-control: backlog
  epic-1-retrospective: optional
```

**NEW:**

```yaml
  1-3-data-model-and-migrations: review
  1-7-deployment-and-environments: backlog   # <- sequenced here, per the Decisions table
  1-4-money-currency-domain-primitives: backlog
```

The key keeps its `1-7` number because ~24 existing cross-references bind `1-4` to the
money/currency story; **row order in `sprint-status.yaml`, not the key number, is what
`create-story` and `dev-story` read as execution order.**

Plus a dated note recording that this row came from a correct-course, not from the original
derivation.

### 4.5 `docs/implementation-artifacts/deferred-work.md`

Mark the "Deployment / NFR11 is ownerless" entry **resolved**, pointing at story
`1-7-deployment-and-environments` and this proposal.

---

## 5. Implementation Handoff

**Scope: Minor** — direct implementation, no replan.

| Deliverable | Owner | Status |
| --- | --- | --- |
| §4.1, §4.3, §4.4, §4.5 edits | Developer agent | Ready on approval |
| §4.2 NFR11 split | rk | **Approved 2026-07-18 — applied to `epics.md`** |
| Story 1-7 authoring | `bmad-create-story` | After 1-4…1-6, or earlier if resequenced |

**Success criteria:** `sprint-status.yaml` holds a `1-7` row; `epics.md` names deployment as an
Epic 1 workstream; `deferred-work.md` shows no open ownerless-requirement entries; NFR11's binding
is either split or explicitly reaffirmed by rk.
