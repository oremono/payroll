# Spine Pair Review — Salary Management for ACME HR (Rubric Walker)

Reviewed: `DESIGN.md` + `EXPERIENCE.md` at status:review, 2026-07-17.
Ground truth: `.memlog.md` (45 entries), `.working/source-extract.md`, `references/design-md-spec.md`, `imports/stitch/MANIFEST.md` (12 mocks).

## Overall verdict

A disciplined, near-shippable spine pair: all 45 memlog decisions trace to spine sections, all CAP-1..CAP-10 have surfaces, vocabulary is spec-verbatim with banned terms confined to ban contexts, mock links all resolve, and section order is canonical in both files. Two blockers stop a clean source-extract: Flow 3's climactic example records a **future-dated raise**, directly contradicting the SPEC constraint and the spine's own Component Patterns row; and `{colors.secondary}` is referenced but undefined, so the pulse-chart spec cannot be resolved downstream. The rest is polish: a dangling contrast-ratio promise, a missing import flow, an under-scoped correction assumption, and a handful of unspecified minor components/states.

## Category verdicts

| # | Category | Verdict |
|---|---|---|
| 1 | Flow coverage | adequate (one critical defect) |
| 2 | Token completeness | adequate |
| 3 | Component coverage | adequate |
| 4 | State coverage | adequate |
| 5 | Visual reference coverage | strong |
| 6 | Bloat & overspecification | strong |
| 7 | Inheritance discipline | strong |
| 8 | Shape fit | strong |

---

## Findings

### BLOCKER (2)

**B1 — Flow 3 records a future-dated salary change, which the SPEC and the spine itself forbid.**
- *Location:* `EXPERIENCE.md` § Key Flows → Flow 3, steps 1 and 5.
- *Evidence:* Step 1: "Priya gets ₹23,00,000 **effective 1 Aug 2026**" recorded on a Friday around 17 Jul 2026 (as-of default "today" = 16 Jul in every mock). SPEC constraint (source-extract §5): "No future-dating, no scheduled changes." EXPERIENCE.md's own Component Patterns → Record-change form row states "no future-dating, no retroactive correction." Step 5 then shows the record atop the timeline driving the derived % change — impossible if the record cannot be entered, and misleading even if it could (a 1 Aug record would not be "current" at a 16–17 Jul as-of date).
- *Fix:* Make the raise effective on or before the recording day (e.g. "effective today, 17 Jul 2026"), and keep step 5's timeline narrative consistent with the as-of resolution rule. Alternatively, if future-dating is genuinely wanted, that is a SPEC change — escalate, don't encode.

**B2 — `{colors.secondary}` is referenced but not defined in frontmatter; the pulse-chart spec is unresolvable.**
- *Location:* `DESIGN.md` § Components → Pulse charts ("…or {colors.secondary}-muted fills").
- *Evidence:* `colors` frontmatter defines no `secondary` (light or dark). Rubric rule: every `{path.to.token}` must resolve; downstream code mirrors the spine, so an extractor either crashes or silently invents a fill color for two shipped surfaces (Home pulse, Gender Insights).
- *Fix:* Either add a `secondary` (+ `secondary-dark`) hex pair to frontmatter, or reword the fill spec in terms of existing tokens (e.g. `{colors.primary}` / `{colors.border-strong}` pairs).

### SHOULD-FIX (7)

**S1 — `{colors.error}` referenced twice but undefined (deliberately) — token syntax used for a non-token.**
- *Location:* `DESIGN.md` § Colors (refusal bullet: "never {colors.error}-anything") and § Components → Refusal panel ("no {colors.error}").
- *Evidence:* The rhetorical intent ("there is no error color") is good, but a mechanical extractor cannot distinguish rhetoric from a broken reference; both occurrences fail resolution alongside B2.
- *Fix:* Reword without brace syntax: "never an error red — no error color exists in this system."

**S2 — Contrast ratios promised to DESIGN.md, never delivered.**
- *Location:* `EXPERIENCE.md` § Accessibility Floor ("contrast ratios live in DESIGN.md") vs. `DESIGN.md` (no contrast statement anywhere).
- *Evidence:* Rubric requires contrast targets stated for load-bearing combinations. None are given for e.g. `amber-badge-text` on `amber-badge-bg`, `ink-faint` on `surface-card`, `accent-indigo` on `surface-tint`, or any `*-dark` pairing (the dark set is self-declared provisional, which makes stated targets more important, not less).
- *Fix:* Add a short contrast clause to DESIGN.md Colors (e.g. "all text/background pairs ≥ 4.5:1; verified pairs listed; dark derivations must hold the same floor").

**S3 — Both spines say "eleven mocks"; there are twelve.**
- *Location:* `DESIGN.md` opening paragraph; `EXPERIENCE.md` intro blockquote.
- *Evidence:* MANIFEST.md lists 12 (screen-11 add-employee added in the finalize pass), and EXPERIENCE.md's own IA table links `screen-11-add-employee.html`. Internal contradiction between prose and the linked manifest.
- *Fix:* "twelve mocks" in both files.

**S4 — CAP-1 (bulk import) has no Key Flow; Coverage admits it ("Flow (implicit)").**
- *Location:* `EXPERIENCE.md` § Key Flows, § Coverage.
- *Evidence:* Import is the first-run gateway (the empty-state points at it) and carries the most intricate behavior in the product (per-row rejection, partial success, taxonomy no-guessing). Surface + component + state rows exist, but no protagonist walk with a climax verifies they compose.
- *Fix:* Add a short Flow 4 (Alice, first morning: upload, read "9,942 imported · 58 rejected," fix a rejected row's role, re-import) or explicitly justify the omission.

**S5 — Flow 3 failure-path [ASSUMPTION] is under-scoped and asserts SPEC permission the SPEC doesn't grant.**
- *Location:* `EXPERIENCE.md` § Key Flows → Flow 3 failure path.
- *Evidence:* "appends a corrected record with the same effective date semantics the SPEC allows" — the SPEC explicitly lists "no retroactive correction," and CAP-3's "latest record with `effective_from` on or before the as-of date" defines no tie-break when two records share an `effective_from`. The tag claims resolution follows from a rule that doesn't decide it.
- *Fix:* Soften the claim, and add the same-`effective_from` tie-break as item 5 in Notes for Architecture.

**S6 — "Preset chips" have no visual spec and collide with the "no pill shapes in v1" rule.**
- *Location:* `EXPERIENCE.md` § Component Patterns → Overdue period control (chips 1y/18mo/2y/3y) and Salary timeline ("percent-change chip") vs. `DESIGN.md` § Shapes ("{rounded.full} is reserved… no pill shapes in v1").
- *Evidence:* "Chip" conventionally means a pill; DESIGN.md Components has no chip row, so a downstream builder must either invent anatomy or break the pill ban.
- *Fix:* Add a chip spec to DESIGN.md Components (e.g. rectangular stamp at {rounded.sm}, consistent with badges) or rename to a specced component.

**S7 — No cold-load/loading treatment anywhere; several surfaces have zero state rows.**
- *Location:* `EXPERIENCE.md` § State Patterns.
- *Evidence:* Rubric state walk: a 10,000-row directory and fresh-computed findings imply visible compute/load moments, yet no loading state is specified; Overdue ("no one overdue"), Payroll Totals, and Gender Insights have no states at all. Only Home, Import, Employees, and the refusal surfaces are covered.
- *Fix:* Add rows for cold-load posture (even "no spinners; skeleton hairline rows" is a decision) and the zero-overdue state.

### NIT (6)

**N1 — Add-employee "side panel" has no elevation/anatomy spec.** (`EXPERIENCE.md` IA → Add employee; `DESIGN.md` § Elevation defines only L2 modals.) Is the panel a modal for Esc/stacking purposes? *Fix:* one clause in Elevation & Depth or Components.

**N2 — CSV export affordance has no visual spec.** (`EXPERIENCE.md` Component Patterns → CSV export; no `DESIGN.md` Components row or token.) Memlog records "export placement" corrections, so a placement/appearance sentence exists to be captured. *Fix:* add a row (likely secondary button in list headers).

**N3 — Pulse charts have visual spec only, no behavioral rule.** (`DESIGN.md` Components vs. `EXPERIENCE.md` Component Patterns.) Interactive or static? *Fix:* one line, e.g. "static, non-interactive; Gender Insights is the drill-down."

**N4 — `/`-search hedge: "findings filter if present."** (`EXPERIENCE.md` § Interaction Primitives.) Whether Home has a filter is left undecided in a spine that decides everything else. *Fix:* decide or delete the parenthetical.

**N5 — Breakpoints declared but no Responsive section.** (`DESIGN.md` § Layout & Spacing declares 768–1279 behavior; `EXPERIENCE.md` has no Responsive section, a required-when-applicable default when breakpoints exist.) Sidebar behavior below 1280 is unspecified. Defensible for a desktop-primary tool, but say so where the shape spec expects it.

**N6 — MANIFEST.md cites files that don't exist.** (`imports/stitch/MANIFEST.md` line 27: "`screen-03-employee-detail-A.png` / `-B.png` … kept for reference" — neither file is present in `imports/stitch/`.) *Fix:* drop the sentence.

---

## Mechanical notes

- **Sources resolve:** both frontmatter `sources` paths verified on disk (`brief.md`, `SPEC.md`); addendum correctly excluded per memlog.
- **All 12 mock links resolve** to real files; spines-win-on-conflict stated in both spines; no orphan mocks (PNGs are declared thumbnails; design-system doc linked from DESIGN.md).
- **All 7 `{components.*}` references in EXPERIENCE.md resolve** to DESIGN.md frontmatter by exact name. Broken refs are only B2/S1 (`colors.secondary`, `colors.error`).
- **Frontmatter shape compliant** with design-md-spec: flat kebab hex colors (light + dark pairs), typography subsets, rounded scale, named spacing, component token maps. `as-of-control.placement` is a layout fact in a visual-token map — tolerable.
- **DESIGN.md body order canonical:** Brand & Style → Colors → Typography → Layout & Spacing → Elevation & Depth → Shapes → Components → Do's and Don'ts. EXPERIENCE.md carries all 8 required defaults; invented sections (Trust & Provenance, Notes for Architecture, Coverage) earn their place.
- **Vocabulary:** grep confirms "snapshot" / "compa-ratio" / "pay bands" / "range penetration" appear only inside ban statements. Spec terms (peer group, peer median, spread, distance, outlier, threshold, refusal, salary timeline, `effective_from`, as-of date, overdue for review, reference tables, `MALE`/`FEMALE`) used verbatim throughout.
- **Memlog traceability:** every (decision) entry maps to a spine section — landscape-led Home, overdue BOTH placement, threshold in Settings, fresh findings, global as-of, min–max spread + architecture flag, copy+CSV-only export, chips+custom period, no Peer Groups nav, 3-field no-reason form, no notifications, dark-in-scope, Review-All removal (absent, as decided), screen-11 mock. No orphaned or contradicted decisions found beyond B1.
- **Flows:** all three have named protagonist (Alice), numbered steps, an explicit bolded climax, and a failure path/variant.
- **[ASSUMPTION] count:** 5, matching memlog; all scoped to genuinely source-silent ground except S5.

---

## Resolution log

Resolved 2026-07-17 (finalize pass).

| Finding | Status | Note |
|---|---|---|
| B1 | RESOLVED | Flow 3 rewritten: raise takes effect today, 16 Jul 2026 (= the as-of date); day corrected Friday→Thursday; step 5 now walks the as-of resolution rule making the record current. |
| B2 | RESOLVED | `secondary: #64748b` / `secondary-dark: #8494ab` added to frontmatter; pulse-chart fills now `{colors.primary}` / `{colors.secondary}` — every `{path.to.token}` in both spines resolves. |
| S1 | RESOLVED | Both `{colors.error}` occurrences reworded without brace syntax ("no error color exists in this system"). |
| S2 | RESOLVED | "Contrast floor" subsection added to DESIGN.md § Colors with computed worst pairs and re-verify rule; EXPERIENCE.md pointer updated. |
| S3 | RESOLVED | "twelve mocks" in both spines. |
| S4 | RESOLVED | Flow 4 — First Morning (import walk with climax and failure path) added; Coverage now reads "CAP-1 → … + Flow 4". |
| S5 | RESOLVED | Failure-path [ASSUMPTION] softened — no longer claims SPEC permission; same-`effective_from` tie-break added as Notes for Architecture item 5. |
| S6 | RESOLVED | Preset chip specced in DESIGN.md Components (rectangular stamp, {rounded.sm}, not a pill) + `preset-chip` frontmatter map; covers Overdue presets and the percent-change chip. |
| S7 | RESOLVED | "Cold load / recompute" (no spinners; skeleton hairline rows; in-place recompute) and "Zero overdue" rows added to State Patterns. |
| N1 | RESOLVED | Side panels declared L2 with modal Esc/stacking rules (Elevation & Depth). |
| N2 | RESOLVED | CSV export affordance row added to DESIGN.md Components (secondary button in the list header row). |
| N3 | RESOLVED | Pulse charts declared static/non-interactive in both spines; Gender Insights named as the drill-down. |
| N4 | RESOLVED | "findings filter if present" hedge deleted — `/` targets Employees search only. |
| N5 | RESOLVED | Desktop-primary posture and below-1280 behavior stated in EXPERIENCE.md Foundation, cross-referencing DESIGN.md § Layout & Spacing. |
| N6 | RESOLVED | Sentence citing nonexistent `screen-03-employee-detail-A/-B.png` dropped from MANIFEST.md. |

Editorial pass (no decision changes): Flow 1 weekday aligned to the 16 Jul 2026 as-of date (Thursday); duplicate threshold-boundary parentheticals in DESIGN.md now cross-reference EXPERIENCE.md § Component Patterns → Threshold control (single home for the rule); cross-ref notation normalized; all relative links re-verified against the filesystem (all resolve).
