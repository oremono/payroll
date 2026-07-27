# Epic Breakdown

Scannable version. Full requirements inventory unchanged in [`epics.md`](epics.md).

**12 epics.** One foundation, then one per capability in CAP order. Epic number = CAP number + 1.

## The shape of every capability epic

Two stories, in this order, never overlapping:

1. **Backend story** — schema, use-case, domain logic. Written test-first. Finalized boundary payload.
   At least one integration test against a real disposable Postgres 18 where it touches persistence.
2. **Frontend story** — the surface, consuming the fixed payload. **Adds nothing to the contract.**

**"Backend done" is a gate, not a mood:** domain + application suites green, the integration test
green, and the payload finalized. No frontend story starts before its backend story clears it.

## The epics

| # | Delivers | Covers |
| --- | --- | --- |
| **1** | **Foundation & deployable skeleton.** The source tree, CI gates, full data model with reference tables and migrations, the deployment pipeline, money/currency primitives written test-first, generated design tokens, and the app shell with sidebar and the global as-of control. After this, Alice can open the deployed app and see the shell — and every later epic has a paradigm, a schema, tokens, and a pipeline to build into. | — (enables all) |
| **2** | **Bulk import.** 10,000 employees from a spreadsheet with a per-row report. Valid rows land in full; unknown role/level/country rows are rejected with their reason. **Nothing is guessed into a taxonomy value.** | CAP-1 |
| **3** | **Employee CRUD.** Create and edit individually. Role and level only from reference tables. Country fixed at create. | CAP-2 |
| **4** | **Record a salary change.** A raise as a new effective-dated record, in ~30 seconds. Prior records untouched. No future-dating. | CAP-3 |
| **5** | **Salary timeline.** Full history, newest first, each record with its effective date and currency. Current salary resolves against the as-of date. | CAP-4 |
| **6** | **Peer comparison or refusal.** Median, spread, signed distance, all with receipts — or a dignified refusal naming the count when the group is under five. **Establishes the reusable refusal panel, provenance caption, and copy-answer affordance.** | CAP-5 |
| **7** | **Outliers & threshold.** Home shows, unprompted, everyone more than the threshold from their peer median — either direction, one finding each. Threshold adjustable in Settings with an explicit Apply. The sweep is a pure function of data + threshold + as-of. The boundary is exact. | CAP-6 |
| **8** | **Gender gap or refusal.** The gap between male and female medians within a peer group, or a refusal saying which gender is short. | CAP-7 |
| **9** | **Gender distribution by level.** Org-wide clustering — the thing the peer view is structurally blind to. | CAP-8 |
| **10** | **Payroll totals.** Per-country in local currency, plus an org-wide total showing the rate used and the date it was pinned to. | CAP-9 |
| **11** | **Overdue for review.** Employees whose most recent salary record predates a chosen period, measured from the as-of date. | CAP-10 |
| **12** | **Seed 10,000.** One command, fixed seed, reproducible — planting the structure that makes every other capability demoable: comparable groups, thin groups, outliers, within-group gender gaps, and gender clustering. Backend-only, no surface. | CAP-11 |

## Cross-cutting requirements

These are standing gates established in Epic 1 and enforced in every epic after it.

| | Requirement |
| --- | --- |
| **NFR1** | **Determinism.** Every answer is a pure function of the data and a *supplied* as-of date. No domain code reads the wall clock. |
| **NFR2** | **Currency always visible.** No salary displayed without its currency, anywhere. Integer minor units + ISO code, never a bare number. |
| **NFR3** | **Currency isolation.** No comparison crosses a currency. FX appears only in aggregate totals, pinned to a date and displayed with the figure. |
| **NFR4** | **Append-only history.** Enforced by revoked `UPDATE`/`DELETE`, not by discipline. |
| **NFR5** | **Fast deterministic tests.** Fixed seed, no wall clock, no database. |
| **NFR6** | **Boundary exactness.** Distance in percentage points, magnitude rounded half-up then signed, flag tests `\|d\| > threshold` strictly. 19.9% no, 20.0% no, 20.1% yes. |
| **NFR7** | **Refusal over widening.** Below n ≥ 5 the product refuses out loud and never widens the group. A refusal is a designed state, never an error. |
| **NFR8** | **Reproducible seed.** Byte-reproducible from a fixed seed. `Math.random` banned repo-wide. The five structural obligations are asserted by tests. |
| **NFR9** | **Accessibility floor.** WCAG 2.2 AA, gated by an automated axe pass. Color never the sole carrier. |
| **NFR10** | **Desktop surface.** 1280px+ primary. No mobile layout specified. |
| **NFR11** | **Deployed (a) and demonstrable end-to-end (b).** 11a is Epic 1. **11b is verified only after Epics 6, 7 and 12** — a planted outlier surfaced without being searched for, and a thin group refused out loud. |
| **NFR12** | **Test-first development.** Enforced in review; mechanically backed in CI by the coverage floor and domain mutation testing. |

> **NFR11 was split mid-flight.** The original wording bound the full demonstration to Epic 1, which
> structurally cannot satisfy it: the planted outlier needs CAP-6 (Epic 7) and the seed (Epic 12), and
> the out-loud refusal needs CAP-5 (Epic 6). Splitting lets each half sit with an epic that can
> actually meet it.

## UX design requirements

19 actionable items, distributed across the epics. The ones that shape more than one surface:

- **DR1 Generated design tokens** — the Tailwind theme is emitted from `DESIGN.md` frontmatter. **No
  hex literal in application code.**
- **DR3 Global as-of control** — persistent header element on every screen, defaulting to today.
  Changing it recomputes every view and announces via `aria-live`.
- **DR5 Refusal panel** — flat neutral tint, headline + explanation, announced as a region with a
  heading. **Never `role="alert"`, never error styling.**
- **DR17 State patterns** — skeleton hairline rows on cold load, no spinners. Recompute swaps values
  in place, never back to skeleton.
- **DR18 Interaction primitives** — `/` focuses search, Enter submits, Esc cancels, modals one level
  deep. **Banned everywhere:** notification affordances of any kind, red/green semantics, celebration
  animations, infinite scroll on data tables, free text for reference-table fields.

Full list of all 19 in [`epics.md`](epics.md).
