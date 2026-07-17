# Sprint Change Proposal — Neon DB region (India availability)

- **Date:** 2026-07-17
- **Author:** rk (with dev agent)
- **Trigger:** "Neon is not available in India."
- **Scope classification:** **Minor** (Direct Adjustment) — docs-only; no code, no epic, no story, no MVP change.
- **Status:** applied to source-of-truth specs; companion-doc sync pending approval.

---

## Section 1 — Issue Summary

During Epic 1 (foundation), before any database code was written, rk raised that **Neon is not available in India**. The ratified stack (memlog 2026-07-17) is **Vercel + Neon Postgres 18**, chosen because Vercel's ephemeral filesystem rules out SQLite. The concern put that DB choice in question.

**Evidence:** Neon's live region list (`neon.com/docs/introduction/regions`, checked 2026-07-17) has **no India/Mumbai `ap-south-1` region**. AWS regions offered: US ×3, Frankfurt, London, **Singapore (`aws-ap-southeast-1`)**, Sydney, São Paulo. Azure regions are deprecated (no new projects).

**Discovery point:** raised conversationally after Story 1-1 merged; Story 1-3 (first DB-touching story) is still `backlog`, so no implementation depends on the decision yet.

## Section 2 — Impact Analysis

- **Epic impact:** none. No epic can or must change. Epic 1 proceeds unchanged.
- **Story impact:** none structurally. Story **1-3** (data-model-and-migrations) is the first to touch the DB; it simply provisions the Neon project in the Singapore region and reads `DATABASE_URL`. No AC change.
- **Code impact:** **none.** Story 1-1 references no DB. Per AD-2, no domain/application/migration code touches the provider — the repository port isolates it; only `DATABASE_URL` ever changes.
- **Artifact conflicts (source of truth — already updated & committed `67a4bfc`):**
  - `ARCHITECTURE-SPINE.md` — Stack row, C4 Neon subgraph label, Deployment-table region note ✅
  - `docs/project-context.md` — Tech Stack table ✅
  - `docs/planning-artifacts/epics.md` — Deployment line ✅
  - `.memlog.md` — decision + region-check event ✅
- **Artifact drift (found by this correct-course sweep — pending):** the derived companion artifacts still say plain "Neon" without the region and now contradict the spine:
  - `C4-MODEL.md` — context subgraph label + deployment diagram + narrative
  - `epics.md` line 69 — Stack-pins line
  - `TRADE-OFFS.md` — DB trade-off row
  - `architecture-deck.html` — stack/trade-off slide (presentation artifact)
- **Testing note — no change needed:** the "Neon branch or local instance" integration-test mechanism (spine §189/291-293, project-context §101) still holds — Neon branching works regardless of region, and we are keeping Neon.

## Section 3 — Recommended Approach

**Option 1 — Direct Adjustment (SELECTED).** Keep Vercel + Neon Postgres 18; pin the region to **`aws-ap-southeast-1` (Singapore)**, the nearest region to India. Effort **Low**, risk **Low**.

Rationale:
- No Neon India region exists, but Neon is fully usable from India via Singapore (~40–70 ms — immaterial for a single-user deployment).
- Data is **fully synthetic** (AD-14 seed, no real PII) → **no data-residency constraint** forcing an in-country host.
- Keeping Neon preserves the branch-per-PR preview workflow and the entire ratified deploy story — zero churn to the plan.
- The decision stays **cheap to reverse** (AD-2): if a Mumbai host is ever required, only `DATABASE_URL` changes.

Options **not** taken: Option 2 (rollback) — nothing to roll back, no DB code exists. Option 3 (MVP review) — MVP unaffected. Alternative providers (Supabase Mumbai / managed PG18 Mumbai / local-PG18-now) were considered and rejected once rk confirmed the blocker was region availability, not access.

## Section 4 — Detailed Change Proposals (companion sync)

> Source-of-truth edits are already committed (`67a4bfc`). Below are the remaining companion-doc syncs to eliminate drift.

**4.1 `C4-MODEL.md` (context diagram, line ~48)**
```
OLD:  subgraph NEON["Neon"]
NEW:  subgraph NEON["Neon · aws-ap-southeast-1 (Singapore)"]
```

**4.2 `C4-MODEL.md` (deployment diagram, line ~153)**
```
OLD:  V1["Vercel<br/><i>Next.js 16</i>"] --> N1[("Neon primary<br/><i>Postgres 18</i>")]
NEW:  V1["Vercel<br/><i>Next.js 16</i>"] --> N1[("Neon primary<br/><i>Postgres 18 · ap-southeast-1</i>")]
```

**4.3 `C4-MODEL.md` (narrative, line ~169)** — append:
```
NEW: Region is aws-ap-southeast-1 (Singapore) — Neon has no India region; synthetic data means no residency constraint.
```

**4.4 `epics.md` (Stack pins, line 69)**
```
OLD: … React 19.2.7 · PostgreSQL 18 (Neon) · Prisma 7.8.0 …
NEW: … React 19.2.7 · PostgreSQL 18 (Neon · ap-southeast-1 Singapore) · Prisma 7.8.0 …
```

**4.5 `TRADE-OFFS.md` (DB trade-off row, line ~121)** — append to the rationale cell:
```
NEW: Neon has no India region; pinned to Singapore (aws-ap-southeast-1) — nearest region, and synthetic data imposes no residency constraint.
```

**4.6 `architecture-deck.html` (trade-off slide, line ~260)** — append to the correction note:
```
NEW: … Region pinned to Singapore (aws-ap-southeast-1): Neon has no India region.
```

**Not edited (intentional):** `reviews/*.md` are point-in-time review records and must stay immutable.

## Section 5 — Implementation Handoff

- **Scope:** Minor → **Developer agent**, direct implementation (this session).
- **Deliverables:** this proposal; the 6 companion edits (4.1–4.6); a commit.
- **Sprint-status:** no epic/story changes → **no `sprint-status.yaml` edit** required.
- **Success criteria:** `grep -ri '\bneon\b' docs` shows every forward-looking artifact naming the Singapore region; no companion contradicts the spine; Story 1-3 provisions the Neon project in `aws-ap-southeast-1`.
- **Carry-forward for Story 1-3:** create the Neon project in `aws-ap-southeast-1`; `DATABASE_URL` is the only env that references the provider.
