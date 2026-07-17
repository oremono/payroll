---
stepsCompleted: [step-01-document-discovery, step-02-requirements-analysis, step-03-epic-coverage-validation, step-04-ux-alignment, step-05-epic-quality-review, step-06-final-assessment]
status: complete
overallReadiness: NEEDS WORK (0 critical, 2 major, 3 minor)
documentsIncluded:
  requirements: docs/specs/spec-payroll/SPEC.md
  brief: docs/planning-artifacts/briefs/brief-payroll-2026-07-16/brief.md
  briefAddendum: docs/planning-artifacts/briefs/brief-payroll-2026-07-16/addendum.md
  architecture: docs/planning-artifacts/architecture/architecture-payroll-2026-07-17/ARCHITECTURE-SPINE.md
  architectureCompanions:
    - docs/planning-artifacts/architecture/architecture-payroll-2026-07-17/TRADE-OFFS.md
    - docs/planning-artifacts/architecture/architecture-payroll-2026-07-17/C4-MODEL.md
  ux:
    - docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/EXPERIENCE.md
    - docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/DESIGN.md
  epics: docs/planning-artifacts/epics.md
  prd: NONE (SPEC-driven project — SPEC.md is the requirements contract)
---

# Implementation Readiness Assessment Report

**Date:** 2026-07-17
**Project:** payroll

---

## Step 1 — Document Discovery

### Inventory

| Type | Status | Document(s) | Format |
| --- | --- | --- | --- |
| Requirements contract | ✅ Found | `specs/spec-payroll/SPEC.md` | Whole |
| Product brief | ✅ Found | `briefs/brief-payroll-2026-07-16/brief.md` + `addendum.md` | Whole |
| Architecture | ✅ Found | `architecture-payroll-2026-07-17/ARCHITECTURE-SPINE.md` (+ `TRADE-OFFS.md`, `C4-MODEL.md`) | Whole |
| UX design | ✅ Found | `ux-payroll-2026-07-16/EXPERIENCE.md` + `DESIGN.md` | Whole |
| Epics & Stories | ✅ Found | `epics.md` | Whole |
| PRD | ⚠️ None | — | — |

### Issues

- **No PRD document.** This is a SPEC-driven (Incubyte take-home) project: `specs/spec-payroll/SPEC.md` is the settled requirements contract, and the product brief + addendum supply context. The architecture spine sources the SPEC directly. Treating SPEC.md as the requirements baseline in place of a PRD — pending rk's confirmation.
- **No duplicate formats.** No document exists as both a whole file and a sharded folder; nothing to resolve.

### Notes

- Architecture is at **revision 2** (AD-1..AD-24), status `final`; TDD (AD-23) and feature-by-feature delivery (AD-24) added this session.
- Reviews/`.memlog.md` files present alongside each artifact are provenance, not assessment inputs.

---

## Step 2 — Requirements Analysis (SPEC.md as baseline)

Requirements source: `specs/spec-payroll/SPEC.md` (canonical contract) + `briefs/.../addendum.md` (CAP-11 seed parameters). The SPEC frames requirements as **capabilities** (CAP-n = functional requirements) plus a **Constraints** section (business rules + NFRs).

### Functional Requirements (Capabilities)

- **CAP-1 — Bulk import.** Import employees + current salaries from a spreadsheet. Valid rows land in full; a row whose role/level is absent from reference tables is rejected with its reason; remaining valid rows still import. No row is mapped or guessed into a taxonomy value.
- **CAP-2 — Employee CRUD.** Create/edit an employee individually. Persists role, level, country, gender, hire date; role and level selectable only from reference tables.
- **CAP-3 — Record salary change.** Appends a new effective-dated record. Prior records remain readable and unmodified. Current salary = latest record with `effective_from ≤ today`.
- **CAP-4 — Salary timeline.** List every salary record for an employee with effective date and currency, ordered in time.
- **CAP-5 — Peer comparison / refusal.** For a peer group ≥5: report group median, spread, and this employee's distance from median, in the group's single currency. Below 5: explicit refusal naming the peer count.
- **CAP-6 — Outliers + adjustable threshold.** Surface employees whose salary differs from peer median by more than a threshold %, either direction (one finding), each with judged-against group, group size, and distance. Threshold defaults to 20%, user-adjustable. Reproducible at a fixed threshold; boundary exact (19.9% no, 20.1% yes).
- **CAP-7 — Gender gap / refusal.** For a peer group with ≥5 of each gender: report gap between male and female medians within the group. If either gender <5: refuse and say which.
- **CAP-8 — Gender by level.** Report gender counts per level org-wide, revealing clustering CAP-7 is blind to.
- **CAP-9 — Payroll totals.** Per-country totals in local currency, no conversion. Org-wide totals spanning currencies display the conversion rate used and its pinned date.
- **CAP-10 — Overdue for review.** Given a period, list employees whose most recent salary record predates it, with that record's date.
- **CAP-11 — Seed 10,000.** One command produces 10,000 employees from a fixed seed, reproducibly, exercising CAP-5 (comparable + thin groups), CAP-6 (planted outliers), CAP-7 (within-group gaps, ≥5 each gender), CAP-8 (cross-level clustering). Distribution parameters in `addendum.md`.

**Total FRs: 11 capabilities.**

### Non-Functional Requirements & Constraints (Business Rules)

Extracted from SPEC § Constraints and companions (binding):

- **NFR-1 Determinism/reproducibility.** Same question asked twice returns the same answer; every answer is a function of data + a supplied as-of date, never the wall clock.
- **NFR-2 Testability.** Core logic (peer grouping, medians, outliers, gap, thresholds, currency isolation) covered by fast, deterministic unit tests — fixed seed, no wall-clock dependence.
- **NFR-3 Stack.** Backend Node/TypeScript over a relational DB; UI React or Next.js; deployed and demonstrable.
- **NFR-4 Accessibility.** WCAG 2.2 AA floor on every surface (EXPERIENCE.md / DESIGN.md), axe-gated in CI.
- **BR-1 Peer identity.** A peer group = same role + level + country. Nothing else.
- **BR-2 Percentage distance,** not std-dev / quartiles / percentile ranks (unreliable at n≥5, typically <10).
- **BR-3 Symmetric outliers.** Underpaid and overpaid are the same finding.
- **BR-4 Gender sliced within a group, never part of peer identity.**
- **BR-5 No comparison crosses a currency** (structural, via country in peer identity).
- **BR-6 FX only in aggregate totals,** pinned to a date and displayed.
- **BR-7 Append-only salary series.** No overwrite, no future-dating, no scheduled/retroactive changes, no approval workflow.
- **BR-8 Below threshold, refuse — never widen** the peer group.
- **BR-9 Reference tables (role, level).** No free text anywhere, including import.
- **BR-10 Gender values MALE / FEMALE only.**
- **BR-11 No salary displayed without its currency.**

### Additional Requirements — CAP-11 seed parameters (addendum)

Log-normal within peer group; country cost-of-labour multipliers; ~15–20% level progression (no level inversion); planted outliers above/below; deliberately thin cells (1–3 people) for the refusal path; two gender effects seeded into *different* cells (within-peer gap needing ≥5 men *and* ≥5 women; cross-level clustering); density engineered so n≥5 doesn't starve the demo.

### Requirements Completeness Assessment

- **Strong.** The SPEC is a preservation-validated canonical contract with zero open questions; every capability carries an explicit success criterion; constraints are precise and testable (exact boundary, determinism, append-only). The architecture spine (AD-1..AD-24) already binds each CAP to enforcement rules, which is unusually complete for a pre-implementation baseline.
- **Watch items for traceability (validated in later steps):** (1) no standalone PRD — CAP success criteria are the acceptance source; (2) authentication is an explicit non-goal but a named pre-production gate; (3) the CAP-2 country-immutability *deviation* recorded in AD-6 narrows the SPEC's "edit country" — epics must reflect the narrowing, not the raw SPEC.

---

## Step 3 — Epic Coverage Validation

Epics source: `planning-artifacts/epics.md` (epic-level breakdown; `stepsCompleted: [validate-prerequisites, design-epics]`). It uses the SPEC's own `CAP-N` as the FR identifiers and carries an explicit **FR Coverage Map**.

### FR Coverage Matrix

| FR (CAP) | Requirement | Epic Coverage | Status |
| --- | --- | --- | --- |
| CAP-1 | Bulk import | Epic 2 | ✓ Covered |
| CAP-2 | Employee CRUD | Epic 3 | ✓ Covered |
| CAP-3 | Record salary change | Epic 4 | ✓ Covered |
| CAP-4 | Salary timeline | Epic 5 | ✓ Covered |
| CAP-5 | Peer comparison / refusal | Epic 6 | ✓ Covered |
| CAP-6 | Outliers + threshold | Epic 7 | ✓ Covered |
| CAP-7 | Gender gap / refusal | Epic 8 | ✓ Covered |
| CAP-8 | Gender by level | Epic 9 | ✓ Covered |
| CAP-9 | Payroll totals | Epic 10 | ✓ Covered |
| CAP-10 | Overdue for review | Epic 11 | ✓ Covered |
| CAP-11 | Seed 10,000 | Epic 12 | ✓ Covered |
| (foundational) | Deployable skeleton, source tree, CI gates, data model, tokens, app shell | Epic 1 | ✓ Covered |

**No FRs in epics that are absent from the SPEC.** No orphan epics.

### NFR & UX-DR Coverage (spot-check)

- All 11 NFRs (NFR1–11) are placed: cross-cutting gates established in Epic 1 and enforced thereafter; NFR6 owned by Epic 7, NFR8 by Epic 12.
- All 19 UX design requirements (UX-DR1–19) are distributed to epics; DR17/DR18 correctly marked cross-cutting.
- Additional (architecture) requirements — source tree, import-boundary lint, CI pipeline, data model, repository contract, canonical resolvers, delivery boundary, receipt payloads, deployment, stack pins — land in Epic 1.

### Missing Requirements

- **None.** Every functional requirement has a traceable epic.

### Coverage Statistics

- Total FRs (CAPs): **11**
- FRs covered in epics: **11**
- Coverage: **100%**

### Traceability Observations (non-blocking, carried to later steps)

1. **Epics reflect architecture revision 2.** `epics.md` line 115 already states the backend-story-before-frontend-story rule (AD-24), and CAP-2 already carries the AD-6 country-immutability deviation — the epics are aligned with the just-updated spine at the *structural* level.
2. **AD-23 (TDD) not yet named in the epics.** Backend stories say "fast deterministic unit tests" (NFR5) but do not yet mention test-first ordering or the CI mutation-testing/coverage gate that AD-23 adds. Not an FR-coverage gap; flagged for the story-quality/cohesion step — Epic 1's CI-pipeline story and each backend story should reference the AD-23 gate.
3. **Stories are pattern-level, not enumerated.** `epics.md` defines each capability epic as "backend story + frontend story" but does not yet break out individual story specs with acceptance criteria. Whether that is sufficient for "implementation ready" is a judgment for the cohesion/quality steps.

---

## Step 4 — UX Alignment

### UX Document Status

**Found — two-part contract.** `EXPERIENCE.md` (behavior, status final) + `DESIGN.md` (look, tokens). Both source the SPEC directly; DESIGN.md is referenced by the spine's AD-15 as the single source of visual truth. 12 Stitch mocks are present as references, explicitly subordinate to the two spines on conflict.

### UX ↔ SPEC Alignment

- ✅ Every CAP has a named surface: Home/Sweep (CAP-6, CAP-10 summary), Employees + form (CAP-2), Employee detail (CAP-3, CAP-4, CAP-5), Peer group (CAP-7), Gender Insights (CAP-8), Payroll Totals (CAP-9), Overdue (CAP-10), Import (CAP-1). CAP-11 correctly has no UI (seed feeds the demo data).
- ✅ SPEC vocabulary used verbatim; banned terms ("snapshot", "compa-ratio") banned in UX too — matches the spine's naming convention row.
- ✅ Determinism, refusal-over-widening, currency-always-visible, exact boundary, append-only 3-field form — all reflected behaviorally.

### UX ↔ Architecture Alignment

- ✅ **All 5 "Notes for Architecture" the UX raised are settled by the spine:** spread=min–max (AD-9), currency-on-record (AD-6), opaque identifier (AD-10), country-on-import (AD-7), same-date tie-break (AD-8). No open UX→architecture question remains.
- ✅ Architecture supports every UX need: generated tokens (AD-15 ↔ UX-DR1), receipt payloads (AD-20 ↔ provenance caption / copy-answer / refusal), as-of parameterization (AD-11 ↔ global as-of control), findings-are-computed (AD-12 ↔ fresh-every-visit findings list), threshold-as-parameter (AD-19 ↔ Settings Apply), accessibility floor (spine convention row ↔ EXPERIENCE Accessibility Floor).
- ✅ Delivery boundary (AD-21) supports the surfaces: RSC reads + Server Action mutations + exactly two route handlers (import upload, CSV export) — matches UX's import flow and CSV export affordances.

### Alignment Issues / Warnings

- **One documented reconciliation (not a gap):** EXPERIENCE Flow 1 says "41 people are currently overdue" / "currently"; the spine's AD-22 explicitly supersedes this — the overdue card must name the as-of date, not say "currently." This is recorded in AD-22 itself, so it is a known, settled override; **implementers must follow AD-22, not the Flow 1 prose.**
- **CSV export column layouts** are marked `[ASSUMPTION]` in EXPERIENCE and Deferred in the spine — a story-level detail, constrained by AD-4/AD-13/AD-20 (currency + as-of columns required). Non-blocking.
- No unsupported UI components; no architectural gap for any UX requirement.

### Verdict

UX ↔ SPEC ↔ Architecture are **mutually consistent**, with the single AD-22 override already documented on both sides.

---

## Step 5 — Epic Quality Review

Validated `epics.md` against epic/story best practices (user value, independence, no forward dependencies, sizing, AC quality, table-creation timing, greenfield setup).

### Structural fact

`epics.md` frontmatter: `stepsCompleted: [validate-prerequisites, design-epics]`. **Epics are designed; individual stories are defined at the pattern level** ("each capability epic = a backend story then a frontend story", line 115) **but not yet elaborated into story specs with acceptance criteria.** The per-CAP success criteria + governing ADs act as strong epic-level acceptance bars; story-level BDD ACs do not yet exist.

### Best-practices checklist (per epic)

| Check | Result |
| --- | --- |
| Epic delivers user value | ✅ Epics 2–11 user-centric (CAP-N, "Alice …"). Epic 1 (foundation) and Epic 12 (seed) are borderline — see Minor 2. |
| Epic independence (no Epic N → N+1) | ✅ Foundation-first, then CAP order; no epic requires a later one. Soft note on seed — see Minor 3. |
| Stories appropriately sized | ⚠️ Backend/frontend split is sound, but stories aren't elaborated yet — see Major 1. |
| No forward dependencies | ✅ Backend-before-frontend ordering within each epic; no story references a later story. |
| Tables created when needed | ⚠️ Full schema provisioned in Epic 1 — see Minor 1. |
| Clear acceptance criteria | ⚠️ Epic-level only (CAP success + ADs); story-level ACs absent — see Major 1. |
| Traceability to FRs | ✅ Every epic maps to exactly one CAP; unbroken story→CAP→AD chain. |
| Starter template handling | ✅ Greenfield, no starter kit; Epic 1 Story 1 hand-scaffolds Next.js (correct per standard). |
| Greenfield setup early | ✅ Source tree, CI gates, import-boundary lint, migrations all in Epic 1. |

### 🔴 Critical Violations

- **None.** No technical-milestone-only epic without a value path, no hard forward dependency, no circular dependency, no epic-sized story masquerading as a story.

### 🟠 Major Issues

1. **Stories are not yet elaborated with acceptance criteria.** `epics.md` stopped at `design-epics`; no story specs with Given/When/Then ACs exist. The CAP success criteria and architecture ADs are unusually strong guardrails, but a dev picking up "Epic 2 backend story" has the *shape* and *governing ADs*, not a testable AC list. **Recommendation:** run create-story for at least the near-term epics (Epic 1 → Epic 3) before starting implementation, deriving ACs from each CAP's success criterion + governing ADs + the relevant UX-DRs.
2. **AD-23 (TDD) is not reflected in the epics.** AD-23 was added to the architecture *this session*; `epics.md` predates it and says only "fast deterministic unit tests" (NFR5). It does not name test-first ordering or the CI **coverage-floor + mutation-testing** gate AD-23 introduces. **Recommendation:** update Epic 1's CI-pipeline scope to add the coverage floor and domain mutation-testing gate, and add "written test-first per AD-23" to every capability epic's backend-story acceptance. (Note: AD-24 — backend-before-frontend — is *already* reflected at line 115, so only AD-23 is missing.)

### 🟡 Minor Concerns

1. **Full schema provisioned in Epic 1** rather than each epic creating its own tables — a deviation from the generic "create tables when first needed" guideline. **Defensible:** the data model is small, settled, and highly interdependent (`employee`, `salary_record`, reference tables, `fx_rate`, `settings`), and the functional-core paradigm (AD-1/AD-2) treats the schema as one foundational artifact. Recommend documenting this rationale in Epic 1 so it reads as a decision, not an oversight.
2. **Epic 1 (foundation) and Epic 12 (seed) carry limited direct user value.** Accepted: Epic 1 ends with an openable deployed shell (thin but real user-visible slice) and greenfield standards expect early setup/CI; Epic 12 is SPEC-mandated capability CAP-11. Flagged per the "borderline" rule, not blocking.
3. **Seed (Epic 12) is last in CAP order but is what makes analytics Epics 6–11 richly demoable.** Not a dependency violation — Epic 2 (import) supplies data, so 6–11 function without 12. But mid-project demos of the analytics epics will be data-poor until the seed lands. **Consider** either accepting import-driven demos for interim checkpoints, or landing a minimal seed subset earlier.

### Assessment

The epic *architecture* is clean — full FR traceability, correct greenfield foundation, sound backend-before-frontend slicing, no critical violations. The gap to "implementation ready" is **elaboration depth (Major 1) and one architecture-sync (Major 2)**, not structural soundness.

---

## Summary and Recommendations

### Overall Readiness Status

**NEEDS WORK** — narrowly. Requirements, architecture, and UX are exceptionally strong and mutually consistent (100% FR coverage, zero critical violations). The gap is **story elaboration depth** and **one architecture-sync**, both mechanical to close. This is "finish the last planning mile," not "rethink the plan."

### What is solid (evidence)

- **100% functional coverage.** All 11 CAPs map 1:1 to Epics 2–12, plus a Foundation epic. No missing FRs, no orphan epics.
- **Requirements baseline is unusually complete.** SPEC is a preservation-validated canonical contract with zero open questions; every CAP carries a testable success criterion; 24 architecture ADs bind each CAP to enforcement.
- **UX ↔ SPEC ↔ Architecture are consistent.** All 5 UX "Notes for Architecture" are settled by ADs; every UX-DR has architectural support; the one override (AD-22 vs. Flow 1 "currently") is documented on both sides.
- **Epic structure is clean.** Greenfield foundation-first, correct hand-scaffold (no starter kit), sound backend-before-frontend slicing (AD-24 already reflected), full story→CAP→AD traceability, no forward/circular dependencies.

### Issues requiring action before implementation

**🟠 Major (2):**

1. **Elaborate stories with acceptance criteria.** `epics.md` stopped at `design-epics`; no per-story BDD ACs exist. Run create-story for at least Epic 1 → Epic 3 before coding, deriving ACs from each CAP success criterion + governing ADs + relevant UX-DRs.
2. **Sync the epics to architecture revision 2 (AD-23 / TDD).** Epics predate this session's AD-23. Add the CI coverage-floor + domain mutation-testing gate to Epic 1's pipeline scope, and "written test-first (AD-23)" to every capability epic's backend-story acceptance. (AD-24 is already reflected — line 115.)

**🟡 Minor (3):** document the upfront-schema rationale in Epic 1; acknowledge Epic 1/Epic 12 as intentionally low-user-value (foundation + SPEC-mandated seed); decide the interim-demo data story for analytics Epics 6–11 (import-driven vs. early minimal seed).

### Recommended Next Steps

1. **Update `epics.md` for AD-23** (Major 2) — fastest, ~15 min: extend the Additional-Requirements CI bullet and each backend story's acceptance. Closes the only gap this session's architecture change opened.
2. **Run create-story for Epic 1** (and ideally Epics 2–3) (Major 1) — produces the testable ACs implementation needs; Epic 1 unblocks everything downstream.
3. **Resolve the 3 Minor items** in `epics.md` prose (schema rationale, foundation-value note, interim-demo decision) — low effort, removes reviewer ambiguity.
4. **Proceed to implementation** once Epic 1 stories exist — the remaining epics can be elaborated just-in-time given the strength of the CAP + AD guardrails.

### Final Note

This assessment reviewed 6 artifacts across requirements, architecture, UX, and epics, and found **0 critical, 2 major, 3 minor** issues. No blocking structural defects. The plan is sound; it needs its last layer of story detail and a one-paragraph sync to the just-updated architecture before Phase 4. You may address the majors and proceed, or proceed with Epic 1 elaborated and elaborate the rest just-in-time.

**Assessor:** Implementation Readiness workflow · **Date:** 2026-07-17 · **For:** rk

---

## Post-assessment update (2026-07-17)

- **🟠 Major 2 — RESOLVED.** `epics.md` synced to architecture revision 2: added **NFR12 (test-first / TDD)**; extended Epic 1's CI-pipeline scope to include the coverage floor + domain mutation-testing gate; added a test-first-discipline additional-requirement bullet; and rewrote the capability-epic backend-story pattern to require test-first (AD-23), a finalized AD-20 payload, and a real-Postgres adapter integration test before the frontend story. Epic 1 description and the cross-cutting-NFR line now name NFR12.
- **Remaining open:** 🟠 Major 1 (elaborate stories with acceptance criteria — run create-story for Epic 1 → Epic 3) and the 3 🟡 Minor items. Overall status stays **NEEDS WORK** until story elaboration (Major 1) is done.
