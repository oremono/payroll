---
title: 'CAP-8 Gender Distribution by Level — UI'
type: 'feature'
created: '2026-07-24'
status: 'done'
baseline_revision: 'e49e4118f445f7f3a34ba6ee2c395900fbf60d8f'
final_revision: '3f7d3d64066ff246c3380d9cff2a85e0a345bfcb'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/docs/implementation-artifacts/epic-9-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Story 9-1 finalized the CAP-8 read (`getGenderDistribution(deps, asOf)` → `{ kind:'answer', distribution } | { kind:'unavailable' }`, where `distribution` carries rank-ordered per-level `{ levelCode, levelLabel, maleN, femaleN, total }` plus org-wide `totals` and `asOf`), but nothing renders it. The `/gender-insights` sidebar route is still story 1-6's placeholder, and Home shows the outlier sweep but no gender-by-level pulse. Alice cannot yet SEE how gender clusters across levels — the pattern CAP-7's within-group gap is structurally blind to.

**Approach:** Build the two ratified surfaces, consuming 9-1's finalized payload **unmodified** (Law 7): (1) the **Gender Insights** page — one rank-ordered horizontal stacked bar per level (MALE/FEMALE) with the counts fully visible as a proper data table; and (2) a compact **gender-by-level pulse** region on Home with its counts in a visually-hidden table and a drill link to Gender Insights. A pure `src/ui/gender-distribution-vm.ts` builder turns the payload union into a view-model; one presentational `src/ui/gender-distribution.tsx` renders the bars + table for both surfaces (table visibility as a prop). No backend, domain, port, adapter, Server Action, or contract change.

## Boundaries & Constraints

**Always:**
- Consume `GetGenderDistributionResult` / `GenderDistribution` / `GenderLevelCount` **unmodified**; add no field to the payload and no method to any port (Law 7). Re-derive **no count** — `maleN`, `femaleN`, `total`, `totals`, `levelLabel`, and the rank order all arrive computed (Laws 2 & 8). The UI only selects the arm, maps rows, and lays out bars.
- The per-level bar is a horizontal stacked strip: MALE segment `bg-primary`, FEMALE segment `bg-secondary` (both ≥ 3:1 against the card, token-guaranteed), **squared ends** (no `rounded`), **no gridlines**, **no legend beyond ONE caps `MALE`/`FEMALE` label**; **static and non-interactive** — no hover, no `title`/tooltip, no transition/animation, no click target on the bars (DESIGN § pulse line 219; EXPERIENCE §§ 74/119). Each segment's proportion is set from the integer count via `flex-grow` so the **browser** computes the ratio — no percentage is computed in TS or shown to the user (a percent-female figure is deliberately absent from the payload; 9-1 scope).
- **Color is never the sole carrier.** Every count is exposed as a proper `<table>` (real `<thead>` / `<th scope="col">` / `<tbody>`, `<caption class="sr-only">`): **fully visible** on Gender Insights, **visually-hidden** (`sr-only`) on the Home pulse (EXPERIENCE § Accessibility Floor, line 119). The bar visual is decorative (`aria-hidden`); the table carries the data. Numerals `font-mono text-number-sm`, **right-aligned**; levels rendered in the exact rank order delivered.
- The result union is only `answer | unavailable`. An **empty population is an ANSWER of zeros** (active levels present at 0/0, `totals` zero) — render zeros, NEVER a refusal, an `n ≥ 5` gate, a "no data" error, or an apology.
- `unavailable` → the shared calm `EmployeeUnavailable` region (region + heading, `bg-refusal-fill`, hairline, **never** `role="alert"`, never error/red color), with a **distinct heading id per surface**. Guarded on BOTH the Gender Insights page and the Home pulse.
- Pure UI logic (arm selection, row mapping, `hasPeople` flag, totals, empty handling) lives in `src/ui/gender-distribution-vm.ts`, unit-tested in `tests/ui/gender-distribution.test.ts` under Vitest **node** env — no jsdom, no React Testing Library. The `.tsx` decides nothing.
- Gender Insights is a **sidebar page**: after `await connection()`, resolve `asOf` from `?asOf=` via `resolveAsOf(params['asOf'], systemClock.todayUtc())` ONCE at the boundary and pass it inward (Law 6 / AD-11); echo it as `<time data-testid="as-of-echo" className="font-mono text-number-sm">` exactly as Home does. The nav href already carries as-of (`navHrefWithAsOf`); add no per-page as-of picker.
- The Home pulse region offers ONE **text** drill link to `/gender-insights` (carrying the as-of), reflecting that Gender Insights is the pulse's drill-down target (EXPERIENCE line 34/74) — the link is text, NOT a click target on the bars.
- No hex / `rgb()` / `oklch()` / `dark:` literal in `src/ui` or either page — semantic tokens only, light + dark via the generated file; no shadow. No `Date.now()` / `new Date()` / timezone / random read anywhere inward.

**Block If:**
- Rendering requires a field the finalized payload does not carry (it should not: `levels[]` each `{ levelCode, levelLabel, maleN, femaleN, total }`, `totals`, and `asOf` are all present).
- The DESIGN/EXPERIENCE source is found to mandate that THIS surface itself display a **percent-female** figure, a per-level **clustering flag/threshold/warning**, or a composed **verdict** sentence — none is derivable (no ratified rounding rule for a ratio, no ratified clustering threshold, no verdict phrasing), and 9-1 explicitly excluded all three. That is a human decision, not a silent invention. (They appear only in the non-authoritative stitch mockup, not in SPEC/EXPERIENCE/DESIGN.)

**Never:**
- No change to `getGenderDistribution`, `computeGenderDistribution`, `findGenderDistributionPopulation`, any port, adapter, use-case, Server Action, Route Handler, or Prisma schema; no new field on the payload.
- Never compute or render a percent-female number, a "stark clustering" badge/warning/threshold, a verdict / copy-answer sentence, a refusal / `n ≥ 5` state, a not-found arm, or any money / median / gap — none is in ratified CAP-8 scope.
- No CSV export (not ratified for CAP-8 — gender-gap and payroll-totals ship none; only outliers does); no hover tooltip, no bar transition/animation, no click target or `title` on the bars; no second browse/index surface for levels.
- No `role="alert"`, no JS `alert`/`confirm`/`prompt`; no float arithmetic producing a displayed statistic; no raw count recomputed in `src/ui` or the DB.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Happy path (Gender Insights) | `answer`, several levels with in-population men + women | Rank-ordered stacked bars (MALE `bg-primary` / FEMALE `bg-secondary`, proportional, squared, static) + a fully-visible counts table (Level \| Male \| Female \| Total + a totals row), mono right-aligned; as-of echo shown | none |
| Empty population | `answer`, active levels at 0/0, `totals` zero | Bars render as empty `bg-surface-tint` tracks; table shows 0/0/0 rows and zero totals — an answer of zeros, NOT a refusal | none |
| No levels at all | `answer`, `levels: []` | A calm statement ("No levels to report."), still an `answer`; no empty `<table>`/bar list | none |
| Single-gender level | a level all `MALE` (or all `FEMALE`) | That bar is one full-width `bg-primary` (resp. `bg-secondary`) segment, the absent gender omitted; table shows the absent gender as `0` | none |
| Repository unavailable | `getGenderDistribution` → `unavailable` | Calm `EmployeeUnavailable` region (region + heading, not `role="alert"`); on BOTH the page and the Home pulse | return value, not a throw |
| Home pulse | `answer` on Home | Compact bars + a `sr-only` counts table + a text drill link to `/gender-insights?asOf=…`; bars have no hover/tooltip/click target | `unavailable` → `EmployeeUnavailable` (distinct id) |

</intent-contract>

## Code Map

- `src/app/gender-insights/page.tsx` -- REPLACE the story-1-6 placeholder. RSC: `await connection()`, resolve `asOf`, `getGenderDistribution(genderDistributionDeps(), asOf)`; render the as-of echo `<p>` (mirroring Home) + `<GenderDistribution>` (visible table) or `EmployeeUnavailable`.
- `src/app/page.tsx` -- EXTEND. Add a `GenderPulse` async region under the outlier sweep (mirrors the existing `Findings` sub-component); guard `unavailable`; render `<GenderDistribution>` with the visually-hidden table + drill link.
- `src/app/employees/employee-deps.ts` -- REUSE `genderDistributionDeps()` (already exported: `{ repository: lazyEmployeeRepository() }`) — import, do not modify.
- `src/application/use-cases/gender-distribution.ts` -- CONSUME `GetGenderDistributionResult` / `GenderDistribution` (types only, unmodified).
- `src/domain/gender-distribution.ts` -- CONSUME `GenderLevelCount` (type only).
- `src/application/as-of.ts` + `src/adapters/clock.ts` -- REUSE `resolveAsOf`, `systemClock.todayUtc()`, and the `connection()` boundary idiom.
- `src/ui/nav-items.ts` -- `/gender-insights` label already present (header derives the `<h1>`); `navHrefWithAsOf` available if preferred for the drill link.
- `src/domain/plain-date.ts` -- REUSE `formatPlainDate` / `plainDateToIso` for the as-of echo and the drill-link param.
- `src/ui/employee-unavailable.tsx` -- REUSE `EmployeeUnavailable({ id, heading, statement })` for the `unavailable` arm.
- `src/ui/outlier-findings.tsx` + `src/ui/employee-table.tsx` -- PRECEDENT for the visible `<table>` (sr-only caption, `<th scope="col">` caps headers, mono right-aligned cells) and the `<section aria-labelledby>` card register.
- `docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/DESIGN.md` (§ pulse line 219), `EXPERIENCE.md` (§§ 34/74/119-120), mock `imports/stitch/screen-05-gender-insights.html` -- visual spec. Take the stacked-bar layout; STRIP the mock's hover tooltips, transitions, "STARK CLUSTERING" badge, and percent labels (non-authoritative, excluded by 9-1 scope).

**Added by this story:**
- `src/ui/gender-distribution-vm.ts` -- pure `buildGenderDistribution(result)` → `GenderDistributionVM` union + `GENDER_DISTRIBUTION_UNAVAILABLE_HEADING`/`_STATEMENT`.
- `src/ui/gender-distribution.tsx` -- presentational `GenderDistribution` server component (bars + counts table).
- `tests/ui/gender-distribution.test.ts` -- unit tests for the builder.

## Tasks & Acceptance

**Execution:**
- [x] `tests/ui/gender-distribution.test.ts` -- test-first (red before green): assert `buildGenderDistribution` across the I/O matrix — `answer` multi-level → `{ kind:'answer', rows }` where rows preserve delivered order, each `{ levelLabel, maleN, femaleN, total, hasPeople: total > 0 }`, plus `totals` passed through verbatim; empty population (active levels 0/0) → all `hasPeople:false`, `totals` zero, still `kind:'answer'` (no refusal); `levels: []` → `rows: []`; single-gender level → the absent gender `0`, both fields present; `unavailable` → `{ kind:'unavailable', heading, statement }`; determinism (same input → same output); no `Date`/random/I/O.
- [x] `src/ui/gender-distribution-vm.ts` -- implement pure, total `buildGenderDistribution(result: GetGenderDistributionResult): GenderDistributionVM`. Select the arm; for `answer` map `distribution.levels` → rows (counts passed through, `hasPeople = total > 0`) and carry `distribution.totals`; `unavailable` → the module-level heading/statement consts. `import type` for payload types; no `Date`/random/I/O.
- [x] `src/ui/gender-distribution.tsx` -- presentational `GenderDistribution({ vm, visuallyHiddenTable = false, drillHref }: { readonly vm: GenderDistributionVM; readonly visuallyHiddenTable?: boolean; readonly drillHref?: string })` server component. For `answer`: a `<section aria-labelledby>` card register (`bg-surface-card`, hairline, rounded, padded) with the ONE caps `MALE`/`FEMALE` legend; the per-level stacked bars (`aria-hidden`, `flex` track with `bg-primary`/`bg-secondary` segments sized by `flex-grow` from the counts, squared, static, and an empty `bg-surface-tint` track when `!hasPeople`); and the counts `<table>` (visible, or `sr-only` when `visuallyHiddenTable`) — `<caption class="sr-only">`, caps `<th scope="col">`, mono right-aligned numeric cells, one row per level in order plus a totals row. `rows.length === 0` → a calm statement instead of an empty table/bar list. When `drillHref` is set, one trailing **text** link to it. For `unavailable`: reuse the `EmployeeUnavailable` register. Semantic tokens only, light + dark, no hex/shadow/tooltip/transition, no click target on the bars.
- [x] `src/app/gender-insights/page.tsx` -- replace the placeholder: `await connection()`; `const asOf = resolveAsOf((await searchParams)['asOf'], systemClock.todayUtc())`; `const result = await getGenderDistribution(genderDistributionDeps(), asOf)`; render the as-of echo `<p>` with `<time data-testid="as-of-echo">` then, when `result.kind === 'unavailable'`, `<EmployeeUnavailable id="gender-insights-unavailable-heading" …/>`, else `<GenderDistribution vm={buildGenderDistribution(result)} />` (visible table).
- [x] `src/app/page.tsx` -- add a `GenderPulse` async region under the sweep (mirror `Findings`): `const dist = await getGenderDistribution(genderDistributionDeps(), asOf)`; `dist.kind === 'unavailable'` → `<EmployeeUnavailable id="home-gender-unavailable-heading" …/>`; else `<GenderDistribution vm={buildGenderDistribution(dist)} visuallyHiddenTable drillHref={\`/gender-insights?asOf=${plainDateToIso(asOf)}\`} />`. Reuse the already-resolved `asOf`; import `genderDistributionDeps` from `./employees/employee-deps`.

**Acceptance Criteria:**
- Given an org-wide as-of population with in-population men and women across levels, when Gender Insights renders, then it shows one rank-ordered horizontal stacked bar per level (MALE `bg-primary` / FEMALE `bg-secondary`, proportional, squared, static/non-interactive) AND a fully-visible counts table (Level \| Male \| Female \| Total + a totals row) with mono right-aligned numerals — no count recomputed in `src/ui` or the DB, levels in the exact order delivered.
- Given an empty as-of population, when Gender Insights renders, then active levels appear at 0/0 with empty bar tracks and zero table rows/totals — an answer of zeros, never a refusal or error.
- Given `getGenderDistribution` returns `unavailable`, when either the page or the Home pulse renders, then a calm `EmployeeUnavailable` region appears (region + heading, never `role="alert"`/error color) and nothing throws.
- Given Home renders with a readable population, then a compact gender-by-level pulse appears with its counts in a visually-hidden table and a text link to `/gender-insights` carrying the as-of; the bars themselves have no hover, tooltip, or click target.
- Given `src/ui` and the two pages are searched after this story, then no percent-female number, clustering badge/threshold, verdict/copy-answer, refusal/`n ≥ 5` state, CSV export, `Date`/random read, `role="alert"`, or hex literal was added; `git diff --name-only` touches no `src/application`, `src/domain`, `src/adapters`, or `prisma`.
- Given the gates run, then lint (import-boundary + no-hex), typecheck, unit tests (incl. the new `tests/ui/gender-distribution.test.ts`), `tokens:check`, `next build`, and the axe pass over `/gender-insights` (its DB-free `unavailable` state) are all green; each failing test is committed before the code that satisfies it.

## Design Notes

**One component, two surfaces.** Gender Insights and the Home pulse render the SAME `GenderDistribution` (bars + counts table) over the SAME view-model; they differ only in the table's visibility (`visuallyHiddenTable`) and the presence of a drill link (`drillHref`). This keeps the accessible content structurally identical on both and the `.tsx` decision-free.

**Bar proportion via `flex-grow`, not a computed percentage.** The two segments carry `flex-grow` set from `maleN` and `femaleN` (integers), so the browser computes the split — no ratio/percentage is computed in TS and none is shown. This honors 9-1's deliberate omission of a percent-female statistic (the numbers the user reads come only from the counts table) and keeps the render a pure function of the payload. `total === 0` ⇒ both grows are 0 ⇒ the empty `bg-surface-tint` track shows (an active empty level reads as a blank strip; the table shows 0/0/0).

**Why no refusal / verdict / percent / clustering.** CAP-8 is a knowing-tool distribution surface: gender counts per level exposed as a chart + table, not a single judgement. There is no `n ≥ 5` gate (empty is a valid answer of zeros), no subject employee (no not-found), and — per 9-1's ratified scope and the Block-If above — no percent-female, no clustering flag/threshold, and no verdict sentence. The union is `answer | unavailable` only.

**a11y coverage.** `/gender-insights` is directly in the axe ROUTES (`e2e/accessibility.spec.ts`) and `e2e/shell.spec.ts`; the DB-free axe run renders the `unavailable` region, whose register is the already-audited shared `EmployeeUnavailable`. The populated bars are decorative (`aria-hidden`) over a real `<table>`, correct by construction and token conformance, and exercised by the `browser-db` e2e job. The `.tsx` render paths are not unit-tested (project constraint: no jsdom/RTL); the pure view-model beneath them is.

**Golden view-model example.**
```ts
// distribution.levels: [ {L1, maleN:3, femaleN:2, total:5}, {L2, maleN:0, femaleN:1, total:1} ], totals {male:3,female:3,total:6}
// → { kind:'answer',
//     rows: [ {levelLabel:'L1', maleN:3, femaleN:2, total:5, hasPeople:true},
//             {levelLabel:'L2', maleN:0, femaleN:1, total:1, hasPeople:true} ],
//     totals: { male:3, female:3, total:6 } }
```

## Verification

**Commands:**
- `npm run test -- tests/ui/gender-distribution.test.ts` -- expected: RED first, then all green once the VM lands.
- `npm run test` -- expected: full suite green (new builder tests + untouched suites).
- `npm run typecheck` -- expected: clean (payload consumed unmodified; may need `npx prisma generate` in a fresh worktree, no source change).
- `npm run lint` -- expected: clean, incl. import-boundary (`src/ui` imports only domain/application types + pure domain) and `no-hex`.
- `npm run tokens:check` -- expected: clean (only existing semantic tokens; no new hex).
- `npm run test:a11y` -- expected: axe green over `/gender-insights` (DB-free → the `unavailable` region). If the worktree's Turbopack workspace-root constraint blocks the Playwright build (as recorded for 8-2), note it and rely on the shared audited register.
- `npm run build` -- expected: `next build` succeeds; `/gender-insights` and `/` build clean.

**Manual checks:**
- Gender clustering is legible in grayscale (bar split + the counts table); color is never the sole carrier.
- The bars have no hover, tooltip, transition, or click target; the drill link is text only.
- `git diff --name-only` touches only the three new `src/ui`/`tests/ui` files and the two pages — no `src/application`, `src/domain`, `src/adapters`, or `prisma`.

## Spec Change Log

_No bad_spec loopback occurred — empty._

## Review Triage Log

### 2026-07-24 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 0, low 5)
- defer: 0
- reject: 2: (high 0, medium 0, low 2)
- addressed_findings:
  - `[low]` `[patch]` Both hunters CONVERGED on the top finding: the bar `<li>` and table `<tr>` keyed on `levelLabel`, but `level.name` (→ `levelLabel`) is NOT `@unique` in the Prisma schema (only `level.code`/`level.rank` are). The VM discarded the unique `levelCode`. Fixed: `GenderDistributionRow` now carries `levelCode` and both lists key on it; added a unit test proving two levels sharing a display label keep distinct `levelCode`s. Removes a duplicate-key/mis-reconciliation risk on `?asOf=` change.
  - `[low]` `[patch]` Blind Hunter: the `unavailable` heading/statement were triplicated (VM consts + hardcoded literals in both pages), a drift trap. Fixed: both pages now import and use `GENDER_DISTRIBUTION_UNAVAILABLE_HEADING`/`_STATEMENT` from the VM.
  - `[low]` `[patch]` Blind Hunter: the presentational component `GenderDistribution` collided by name with the use-case type `GenderDistribution` (the sibling documented naming its component `GenderGapCard` to avoid exactly this). Fixed: renamed the component to `GenderDistributionChart` (+ its two import sites).
  - `[low]` `[patch]` Blind Hunter: the MALE/FEMALE legend rendered even on a `levels: []` answer (a key with nothing to key). Fixed: the legend now renders only inside the has-rows branch.
  - `[low]` `[patch]` Blind Hunter: the `sr-only` table caption paraphrased genders as "men/women" while the verbatim-vocabulary rule (Law 3) mandates `MALE`/`FEMALE`. Fixed: caption reworded to `MALE`/`FEMALE`.
- notes: Both hunters ran adversarially on the full diff and CONVERGED on the duplicate-key finding as the one genuine correctness item (both verified `level.name` non-unique against `prisma/schema.prisma`). Verified boundaries reported as correctly handled: negative/non-integer counts unreachable (domain derives every count from `array.length`, `total = maleN + femaleN`); `hasPeople && maleN===0 && femaleN===0` impossible for the same reason; `formatPlainDate` null guarded by `?? plainDateToIso`; the drill `asOf` from `plainDateToIso` is URL-safe `YYYY-MM-DD`; `unavailable` handled on both surfaces; `levels: []` distinguished from empty population. Rejected (2, all low): (1) a full-DB outage stacks the settings-unavailable and gender-unavailable panels on Home — within the established independent-region pattern (each read reports its own calm HTTP-200 state; the outlier sweep and settings already coexist), not a defect; (2) an extreme-skew minority segment collapses sub-pixel in the decorative bar — spec-sanctioned (the browser computes the honest proportion, the count is always in the table, and a min-width would FALSIFY the ratio); recorded as a residual risk instead.

## Auto Run Result

Status: **done**

### Summary
Implemented the CAP-8 gender-distribution UI — the two ratified surfaces — consuming story 9-1's finalized `getGenderDistribution` payload **unmodified** (Law 7). The **Gender Insights** sidebar page (`/gender-insights`, replacing the story-1-6 placeholder) renders one rank-ordered horizontal stacked bar per level (MALE `bg-primary` / FEMALE `bg-secondary`, proportion computed by the browser via `flex-grow` from the integer counts — no percentage in TS, honoring 9-1's deliberate omission of a percent-female figure), squared ends, no gridlines, one caps `MALE`/`FEMALE` legend, static and non-interactive, alongside a **fully-visible** counts table (Level · MALE · FEMALE · Total + a totals row, mono right-aligned). Home gains a compact **gender-by-level pulse** with the same bars, a **visually-hidden** counts table, and a text drill link to Gender Insights carrying the as-of. The bar visual is `aria-hidden` (decorative); the real `<table>` is the accessible carrier, so color is never the sole carrier (WCAG 2.2 AA). An empty population is an answer of zeros (empty tracks, zero table), never a refusal; `unavailable` renders the calm shared `EmployeeUnavailable` region on both surfaces. All UI judgement lives in the pure `buildGenderDistribution` view-model (unit-tested, Vitest node env); the `.tsx` decides nothing. No backend, domain, port, adapter, Server Action, or contract change.

### Files changed
- `src/ui/gender-distribution-vm.ts` (new) — pure, total `buildGenderDistribution(result)` → `{ kind:'answer', rows, totals } | { kind:'unavailable', heading, statement }`; rows carry `levelCode` (the React key), `levelLabel`, the counts passed through verbatim, and `hasPeople = total > 0`; module-level unavailable heading/statement consts. `import type` only; no `Date`/random/I/O.
- `src/ui/gender-distribution.tsx` (new) — presentational `GenderDistributionChart({ vm, visuallyHiddenTable?, drillHref? })` server component: caps `MALE`/`FEMALE` legend (only when there are bars), decorative `aria-hidden` per-level stacked bars (`flex-grow` from counts, squared, empty `bg-surface-tint` track for a populated-but-zero level), and the counts `<table>` (`sr-only` caption, `<th scope>` caps headers, mono right-aligned, totals `<tfoot>`) visible or `sr-only`; `rows: []` → a calm statement; optional trailing text drill link. Semantic tokens only, light + dark; no hex/shadow/tooltip/transition, no click target on the bars.
- `src/app/gender-insights/page.tsx` — replaced the placeholder with an RSC that resolves `asOf` at the boundary (`connection()` → `resolveAsOf`), reads `getGenderDistribution(genderDistributionDeps(), asOf)`, echoes the as-of, and renders the chart (visible table) or the shared unavailable region.
- `src/app/page.tsx` — added a `GenderPulse` async region under the outlier sweep (mirrors `Findings`): the visually-hidden-table pulse + drill link, or the shared unavailable region (distinct id), over the already-resolved `asOf`.
- `tests/ui/gender-distribution.test.ts` (new) — 9 unit cases over the builder (Vitest node env), written test-first (red before green): multi-level order + `hasPeople`, rank-order preservation, empty population → answer of zeros, `levels: []` → `rows: []`, single-gender level, totals verbatim, unavailable arm, determinism, and unique-`levelCode`-under-duplicate-label.

### Review findings breakdown
- **Patches applied (5, all low):** keyed the bar/table on the unique `levelCode` instead of the non-unique `levelLabel` (both hunters' convergent finding); sourced the pages' unavailable copy from the exported VM consts (removed a drift trap); renamed the component `GenderDistribution` → `GenderDistributionChart` (avoids the documented use-case-type name collision); moved the legend into the has-rows branch; reworded the sr-only caption to verbatim `MALE`/`FEMALE`.
- **Deferred (0).**
- **Rejected (2, all low):** stacked settings+gender unavailable panels on a full DB outage (established independent-region pattern, each a calm HTTP-200 state); sub-pixel minority segment under extreme skew (spec-sanctioned honest proportion; the table carries the exact count; a min-width would falsify the ratio — kept as a residual risk).

### Verification performed
- `npm run test -- tests/ui/gender-distribution.test.ts` — RED first (`Cannot find package '@/ui/gender-distribution-vm'`), then **9/9 GREEN** (8 original + the added unique-`levelCode` test).
- `npm run test` (full) — **49 files, 1389 passed**, no regressions.
- `npm run typecheck` — clean (needed `npx prisma generate` in the fresh worktree; no source change).
- `npm run lint` — clean (import-boundary + no-hex held). `npm run tokens:check` — clean (in sync with DESIGN.md; no new hex).
- `npm run build` (`next build`) — succeeds; 11 routes incl. `/gender-insights` and `/` build clean (applied + reverted the documented temporary `turbopack.root` repoint to the parent repo; no committed config change).
- `npm run test:a11y` — **20 passed**, incl. `/gender-insights` in light AND dark mode (WCAG 2.2 AA axe), via the same temporary repoint (reverted). The DB-free axe run renders the `unavailable` region; the populated chart is decorative-bar-over-real-table by construction.
- `git diff --name-only` since baseline touches only the two pages + the three new files (+ this spec) — no `src/application`, `src/domain`, `src/adapters`, or `prisma`.

### Residual risks
- Under extreme per-level gender skew, the minority segment of the decorative bar collapses sub-pixel; on the Home pulse (where the table is `sr-only`) a sighted glance can then read a near-single-gender level, though the exact counts remain in the assistive-tech table and in the fully-visible Gender Insights drill-down. This is the ratified compact-pulse behavior (honest browser-computed proportion, no falsifying min-width); flagged, not fixed.
- The populated chart/table render paths are not unit-tested (project constraint: no jsdom/RTL) and the DB-free axe run scans only the `unavailable` state; the markup sits over a fully unit-tested pure view-model, its registers are the already-audited shared ones, and the populated surface is exercised by the `browser-db` e2e job.
