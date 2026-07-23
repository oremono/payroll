---
title: 'CAP-6 Outliers & Threshold — UI (story 7-2)'
type: 'feature'
created: '2026-07-24'
status: 'done'
baseline_revision: 'acfb322e1077c2a6305f41ca9c63753ef93ddec9'
final_revision: '30b2ecfd65b8248f27ec164c413ddafb695ea423'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/docs/implementation-artifacts/epic-7-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Story 7-1 finalized the CAP-6 reads — `getOutlierFindings` (`findings | unavailable`, each findings group carrying its `peerGroup` labels, `n`, currency, `peerMedian`, and per-member signed `distancePct`) and `getSettings` (`settings | unavailable`) — but nothing renders them and there is no way to change the threshold. Home still shows the story-1-6 placeholder ("No employees yet…"), and Settings says "Settings are not available yet." An HR manager cannot see the unprompted outlier sweep — the product's reason to exist — nor adjust "how far is far."

**Approach:** Render the findings list on Home (consuming 7-1's finalized payload **unmodified**, Law 7), add the CSV export Route Handler (the second and last Route Handler the system permits, AD-21), and build the Settings threshold control with an explicit **Apply**. The Apply requires the one mutation this capability introduces: the **write half of the settings port** (`updateOutlierThresholdPct` on the port + Prisma adapter `settings.update({ id: 1 })` — settings already holds table-level `UPDATE` for `payroll_app`, so no migration), a total `updateOutlierThreshold` use-case validating the integer percent, and a Server Action composition root. Home reads the persisted threshold via `getSettings` **once at the boundary** and passes it to `getOutlierFindings` (Law 6 / AD-19). Pure view-models (`src/ui/outlier-findings-vm.ts`) turn the payload into rows / inline refusals / zero-state; presentational `.tsx` render them; a `"use client"` threshold control calls the Server Action and announces through the existing single app-level live region.

## Boundaries & Constraints

**Always:**
- Consume `GetOutlierFindingsResult` and the `getSettings` read **unmodified** (Law 7); add no field to either payload and no method to the READ port. Re-derive **no statistic** — the badge distance (`distancePct`), direction, `n`, `peerMedian`, and currency all arrive computed (Laws 2 & 8). The UI only *derives display text* (the badge string from the signed `distancePct`), *formats money* (CSV only), and *selects the arm* to render.
- The persisted threshold is read **once at the delivery boundary** via `getSettings` and passed inward to `getOutlierFindings` as its `thresholdPct` argument (Law 6 / AD-19). No `src/ui`/`src/domain` code reads settings inside the sweep, and the threshold judged is the threshold echoed on the report and in the zero-state copy.
- **Outlier badge (DR4):** small rectangular stamp — `bg-amber-badge-bg`, 1px `border-amber-badge-border`, `text-amber-badge-text`, `font-mono text-number-sm`, `rounded-sm` (2px, near-sharp). Text always carries signed distance **and** the direction word, derived from the sign of `distancePct`: a non-negative distance renders `+{distancePct}% above median`, a negative one renders `{distancePct}% below median` (the payload string already carries the `-`). One badge per finding, either direction; `distancePct` is never `"0.0"` here (every finding is beyond the threshold). Direction lives in **words**, never color alone (a11y floor).
- **Findings row (DR8):** 40px row — employee name (`text-body-md` medium, `text-primary`), the peer-group label (`text-body-sm text-ink-muted`) naming role · level · country, the peer count `n` right-aligned (`font-mono text-number-sm`), and the badge right-aligned. Sticky `text-label-caps` header; a **2px rule divides each peer-group section**; hover `surface-tint`. Numerals are `font-mono`.
- **Inline thin-group refusal (DR8 / AD-16):** a `kind:'refusal'` group renders as a **full-width inline refusal row** in the same table — flat `bg-refusal-fill`, 1px `border-border-hairline`, `rounded` (`DEFAULT`), the group name (`text-body-md` medium, `text-ink-muted`) and a single **italic** clause `Only {n} peers — too few to compare fairly` (`text-body-sm`). Rendered as content within the findings region (which has a heading), **never** `role="alert"`, never error color, never a warning icon, never widened.
- **Zero-findings state:** `groups: []` → a calm statement, verbatim `No outliers beyond {thresholdPct}% as of {date}. Nothing is drifting.` (`date` = `formatPlainDate(asOf) ?? plainDateToIso(asOf)`). No celebration graphics, no emoji, no notification affordance (banned everywhere).
- **Recompute:** an as-of (or post-Apply) change **swaps values in place**, never back to skeleton; the existing single `aria-live="polite"` region (`src/ui/announcer.tsx`) is reused and **not remounted** — an as-of change announces `Findings updated as of {date}` (the `AsOfControl` already does this), and a successful Apply announces `Threshold updated to {n}%`.
- **CSV export (DR16):** a secondary **hairline ghost** button labeled `Export CSV`, at the **right end of the findings header row**, rendered as an `<a>` linking to the export Route Handler and carrying the current `asOf` (so the file matches the screen). The handler exports the visible list at the current as-of + persisted threshold; columns carry the currency and the as-of/threshold provenance. Money crosses through the **one** formatter (`formatMoney(fromBoundaryMoney(...))`) with the `CurrencyFormat` resolved by the row's own `currency` code — never a bare number, never a raw `bigint`/decimal-minor string.
- **Threshold control (DR10, Settings):** labeled `OUTLIER THRESHOLD` (`label-caps`, uppercase), showing the current value; changing it requires an explicit **Apply** — a deliberate act, **never** a live slider or auto-apply. The edited value is an integer percent in `[1, 100]` (matching the DB CHECK). Apply is a **Server Action**; on success it `revalidatePath('/')` + `revalidatePath('/settings')` and the control announces via the live region. `Reset to default (20%)` is offered as a secondary path that Applies `20`.
- **The settings WRITE is the one mutation this story adds.** `updateOutlierThresholdPct(pct: number): Promise<void>` on the settings port; adapter `client.settings.update({ where: { id: 1 }, data: { outlierThresholdPct } })`; a **total** use-case `updateOutlierThreshold(deps, pct)` → `applied | rejected | unavailable` that validates `pct` is an integer in `[1, 100]` **before** any write (rejecting `0`, `101`, `20.5`, `NaN`), wraps the write in `try/catch` → `unavailable`, and never lets an exception cross the boundary (Law 8 / AD-20). A rejected value never reaches the database.
- Route Handlers are exactly **two** in the whole system (AD-21): the CAP-1 multipart import and this CSV export. Reads stay Server Components calling use-cases in-process (no self-fetch); the Apply is a Server Action.
- Semantic tokens only (no hex), light **and** dark; WCAG 2.2 AA. All pure UI logic (arm selection, badge text, zero/refusal assembly, CSV serialization, threshold validation) is unit-tested test-first under Vitest **node** env — the `.tsx` files decide nothing.

**Block If:**
- The DESIGN source mandates a per-finding **verdict sentence** or a **copy-answer** on the findings list. Story 7-1 finalized the findings row as name · group · peer-count · badge with **no** verdict string, and DR7 scopes copy-answer to the employee-detail peer card only (EXPERIENCE § copy-answer). If review finds Home requires a composed sentence or copy affordance, that is a `bad_spec` loopback, not a silent addition.
- Rendering requires a field the finalized `getOutlierFindings` / `getSettings` payload does not carry.
- The threshold write requires a DB grant or migration the schema does not already allow (it does not — `settings` holds table-level `UPDATE`; verify before assuming a migration is needed).

**Never:**
- No change to `getOutlierFindings`, `sweepOutliers`, `getSettings` (the read), any `src/domain/**` math, or the finalized findings payload (Law 7). No second median / distance / count recomputed in `src/ui`, the CSV serializer, or the DB.
- No indigo `in range` badge and no threshold read on the employee-detail peer card — that surface is CAP-5 (story 6-2 explicitly excluded outlier/threshold badges). The findings list shows only outliers (all amber) and inline refusals; the indigo token stays available for a later story.
- No live-count preview coupling Settings to the sweep (a mock embellishment, not a DR10 requirement); the Settings surface never runs the outlier sweep.
- No live slider / auto-apply on the threshold; no `Date.now()`/`new Date()`/timezone read in `src/ui` (or inward); no float arithmetic; no raw `bigint`/decimal-minor string or bare amount in a prop or the DOM; no `role="alert"`; no JS `alert`/`confirm`/`prompt`; no seen/unseen/dismissal/notification state on findings.
- No third Route Handler; no self-fetch for the Home reads.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Outliers present | `findings` with ≥1 `outliers` group | Findings table: each group a section divided by a 2px rule; one row per finding — name, role · level · country, `n` peers (right, mono), amber badge (right) | none |
| Above vs below badge | finding `distancePct` `"28.4"` / `"-25.2"` | Badge `+28.4% above median` / `-25.2% below median` (sign → direction word; `+` prefixed on non-negative) | none |
| Inline thin-group refusal | `refusal` group `counts.n = 3` | Full-width inline refusal row: group name + italic `Only 3 peers — too few to compare fairly`; content in a region-with-heading, not `role="alert"`, not widened | none (refusal is data) |
| Zero findings | `findings`, `groups: []` | Zero-state `No outliers beyond 20% as of 16 Jul 2026. Nothing is drifting.` — calm, no graphics | none |
| Findings/settings unreadable | `getOutlierFindings` → `unavailable` OR `getSettings` → `unavailable` | Calm "unreadable" region (`EmployeeUnavailable` register, distinct from a refusal); page renders HTTP 200, nothing throws | return value |
| Recompute as-of | `?asOf=` changes | Rows swap in place (no skeleton); the single polite region announces `Findings updated as of {date}` | none |
| CSV export | `GET /api/outliers/export?asOf=…` | `text/csv` attachment; header row + one row per outlier finding + one row per thin group; columns carry currency, salary, peer median, distance, `n`, as-of, threshold | none |
| CSV when unreadable | settings or findings `unavailable` at export | HTTP 200 `text/csv`, header row only (zero data rows) — never a framework error page | return value |
| Apply valid threshold | Apply `25` | `updateOutlierThreshold` validates `1 ≤ 25 ≤ 100` (int) → writes `id:1` → `applied`; Home + Settings revalidated; announce `Threshold updated to 25%` | none |
| Apply invalid threshold | `0` / `101` / `20.5` / `"abc"` | `rejected` (no write) — the DB is never hit with a bad value; the control surfaces the rejection calmly | rejected payload, not a throw |
| Apply while DB down | write repository throws | `updateOutlierThreshold` → `unavailable`; calm message; no exception crosses the boundary | return value |
| Reset to default | Reset activated | Applies `20`; same success path as any Apply | none |

</intent-contract>

## Code Map

**Consumed unmodified (7-1 + foundation):**
- `src/application/use-cases/outliers.ts` -- `getOutlierFindings(deps, asOf, thresholdPct)` → `{ kind:'findings'; report } | { kind:'unavailable' }`; `OutlierReport` / `OutlierFindingGroup` (`outliers` | `refusal`) / `OutlierFinding` consumed as-is.
- `src/application/use-cases/settings.ts` -- `getSettings(deps)` (read); **extended** here with `updateOutlierThreshold`.
- `src/app/employees/employee-deps.ts` -- `outlierFindingsDeps()` (the findings repository).
- `src/app/settings/settings-deps.ts` -- `settingsReadDeps()`; **extended** with `settingsWriteDeps()`.
- `src/application/use-cases/employees.ts` -- `loadEmployeeFormOptions(deps)` → `options.kind === 'options' ? options.options.currencies : []` (the `CurrencyFormat[]` source for CSV money).
- `src/domain/money.ts` -- `formatMoney`, `fromBoundaryMoney`, `CurrencyFormat`, `BoundaryMoney` (CSV only; `amountMinor` is a decimal-**minor** string, so the exponent from `CurrencyFormat` is required — hence CSV needs the currencies list).
- `src/domain/plain-date.ts` -- `formatPlainDate`, `plainDateToIso`, `PlainDate`.
- `src/application/as-of.ts` -- `resolveAsOf(param, today)` (Home + CSV, total).
- `src/adapters/clock.ts` -- `systemClock.todayUtc()` (read once per request at each boundary).
- `src/ui/announcer.tsx` -- `useAnnounce()`, the ONE polite region (recompute + Apply announcements).
- `src/ui/employee-unavailable.tsx` -- `EmployeeUnavailable({ id, heading, statement })` region for the `unavailable` arms.
- `src/ui/as-of-control.tsx` -- the `"use client"` + `useAnnounce()` + transition precedent to mirror for the threshold control.
- `src/ui/peer-comparison-vm.ts` + `src/ui/peer-comparison.tsx` -- the pure-`-vm` + presentational-`.tsx` pattern (fail-closed withholding, `import type`, module-level consts) to mirror.
- `src/app/api/import/route.ts` -- Route Handler + composition-root precedent (adapters built here, `today` read once).
- `src/app/employees/actions.ts` + `handle-employee-write.ts` -- Server Action (`'use server'`) + testable-handler + `revalidatePath` precedent.
- `prisma/schema.prisma` (model `Settings`) + migration `20260718163326` (settings holds table-level `GRANT … UPDATE …`) + `20260718224918` (`settings_outlier_threshold_pct_range` CHECK `>0 AND <=100`) -- the write is already permitted; the range mirrors the use-case validation.

**Added by this story:**
- `src/ui/outlier-findings-vm.ts` -- pure `buildOutlierFindings(result, asOf)` → `OutlierFindingsVM` union (`findings` rows + inline refusals | `empty` zero-state text | `unreadable`). Derives each badge string from the signed `distancePct`; builds the group label (role · level · country) and peer-count text. **No money** (rows carry no amount).
- `src/ui/outlier-findings.tsx` -- presentational `OutlierFindings({ vm, exportHref })` (server component): the findings table (sticky caps header, 2px section rules, badges, inline refusal rows), the zero-state statement, the "unreadable" region, and the `Export CSV` ghost `<a>`.
- `src/ui/threshold-control.tsx` -- `"use client"` `ThresholdControl({ current })`: shows the current percent, a bounded integer entry (`1–100`) with an explicit **Apply** button and a `Reset to default (20%)` path; calls `applyThresholdAction`, announces the result. No live slider/auto-apply.
- `src/adapters/csv/format-outliers-csv.ts` -- pure `formatOutliersCsv(report, currencies)` → CSV string; one row per outlier finding + one row per thin group (with a `status` column); money via `formatMoney(fromBoundaryMoney(...))`, currency/as-of/threshold provenance columns; CRLF/`\n` and quoting an explicit decision.
- `src/app/api/outliers/export/route.ts` -- `GET` Route Handler (composition root): `resolveAsOf` → `getSettings` (threshold) → `getOutlierFindings` → `loadEmployeeFormOptions` (currencies) → `formatOutliersCsv` → `text/csv` with `Content-Disposition: attachment`.
- `src/app/settings/actions.ts` -- `'use server'` `applyThresholdAction(input: unknown)` composition root: coerce the submitted value, call `updateOutlierThreshold`, `revalidatePath` on success, return the result payload.
- `tests/ui/outlier-findings.test.ts` -- `buildOutlierFindings` across the I/O matrix (node env).
- `tests/adapters/format-outliers-csv.test.ts` -- the CSV serializer across the matrix (node env).
- `tests/integration/settings-write.test.ts` -- against real Postgres 18: `updateOutlierThresholdPct` writes `id:1` and a read-back returns it; the DB CHECK rejects an out-of-range value that bypasses the use-case.

**Extended by this story:**
- `src/app/page.tsx` -- replace the placeholder with the findings surface: `await connection()`, `today`, `resolveAsOf`, `getSettings` → threshold (or `unavailable`), `getOutlierFindings(outlierFindingsDeps(), asOf, thresholdPct)`, render `OutlierFindings`.
- `src/app/settings/page.tsx` -- replace the placeholder: `getSettings` → `ThresholdControl current={…}` (or the `unavailable` region).
- `src/application/ports/settings-repository.ts` -- ADD `updateOutlierThresholdPct(pct: number): Promise<void>` (the write half; the doc-comment's "no write path" note is superseded by this story).
- `src/adapters/db/settings-repository.ts` -- implement `updateOutlierThresholdPct` (`update({ where: { id: 1 } })`).
- `src/application/use-cases/settings.ts` -- ADD `updateOutlierThreshold(deps, pct)` → `UpdateThresholdResult` and `SettingsWriteDeps`.
- `src/app/settings/settings-deps.ts` -- ADD `settingsWriteDeps()` (lazy write repository, same deferred-construction rationale as the read).
- `tests/application/settings.test.ts` -- ADD `updateOutlierThreshold` cases (valid write, each rejection, repository-throw → `unavailable`).

## Tasks & Acceptance

**Execution:**
- [x] `src/application/ports/settings-repository.ts` -- add `updateOutlierThresholdPct(pct: number): Promise<void>` to the port; correct the "READ-ONLY / no write path" doc-comment to name this story's write and its single-row (`id = 1`) guard.
- [x] `tests/application/settings.test.ts` + `src/application/use-cases/settings.ts` -- **test-first**, then implement `updateOutlierThreshold(deps: SettingsWriteDeps, pct: number): Promise<UpdateThresholdResult>` where `UpdateThresholdResult = { kind:'applied'; value:number } | { kind:'rejected'; reason:'out-of-range' | 'not-an-integer' } | { kind:'unavailable' }`. Validate `Number.isInteger(pct) && pct >= 1 && pct <= 100` **before** calling the port (reject `0`, `101`, `20.5`, `NaN` with no write); `try { updateOutlierThresholdPct(pct) → applied } catch { unavailable }`. Add `SettingsWriteDeps = { repository: Pick<SettingsRepository,'updateOutlierThresholdPct'> }` (or the full port). Cover every matrix row against a fake port (assert the port is NOT called on a rejected value).
- [x] `src/adapters/db/settings-repository.ts` -- implement `updateOutlierThresholdPct`: `client.settings.update({ where: { id: SETTINGS_ROW_ID }, data: { outlierThresholdPct: pct } })`. Adapters may throw (a range violation slipping past validation surfaces the DB CHECK as a rejected promise → the use-case's `unavailable`); the pure layers may not.
- [x] `src/app/settings/settings-deps.ts` -- add `settingsWriteDeps(): SettingsWriteDeps` reusing the lazy-construction pattern (deferred `createSettingsRepository()` so a DB-free surface yields `unavailable`, not a build throw).
- [x] `src/app/settings/actions.ts` -- `'use server'` `applyThresholdAction(input: unknown): Promise<UpdateThresholdResult>`: coerce `input` to a number (a `'use server'` arg is erased at runtime, so coerce, don't trust), call `updateOutlierThreshold(settingsWriteDeps(), value)`, and on `applied` `revalidatePath('/')` + `revalidatePath('/settings')`; return the payload. Never throw across the boundary.
- [x] `src/ui/threshold-control.tsx` -- `"use client"` `ThresholdControl({ current }: { current: number })`: render `OUTLIER THRESHOLD` (`label-caps`), the current percent (`font-mono`), a bounded integer entry (`min=1 max=100`, native/stepper — no slider), an explicit **Apply** primary button, and a `Reset to default (20%)` secondary. On Apply: `startTransition` → `await applyThresholdAction(value)` → `announce` `Threshold updated to {n}%` on `applied`, a calm inline message on `rejected`/`unavailable`. Semantic tokens, light + dark, no dialog.
- [x] `src/app/settings/page.tsx` -- replace the placeholder: read `getSettings(settingsReadDeps())`; `settings` → `<ThresholdControl current={outlierThresholdPct} />`; `unavailable` → `EmployeeUnavailable` region. One `<h1>` still comes from the header (no page `<h1>`).
- [x] `tests/ui/outlier-findings.test.ts` + `src/ui/outlier-findings-vm.ts` -- **test-first**, then implement pure `buildOutlierFindings(result: GetOutlierFindingsResult, asOf: PlainDate): OutlierFindingsVM`. `findings` with groups → `{ kind:'findings', sections }` where each section is `{ kind:'outliers', label, findings:[{ name, badgeText, distancePct }] }` (`badgeText` = `+X.X% above median` for non-negative `distancePct`, `X.X% below median` for negative) or `{ kind:'refusal', label, refusalText:'Only {n} peers — too few to compare fairly' }`; `groups:[]` → `{ kind:'empty', statement:'No outliers beyond {threshold}% as of {date}. Nothing is drifting.' }`; `unavailable` → `{ kind:'unreadable', heading, statement }`. Group `label` names role · level · country. Total, deterministic, no `Date`/random/I/O/money.
- [x] `src/ui/outlier-findings.tsx` -- presentational `OutlierFindings({ vm, exportHref })` server component: `findings` → a `<section aria-labelledby>` with a heading, the `Export CSV` ghost `<a href={exportHref}>` at the header's right end, and a table (sticky `label-caps` header; each section preceded by a 2px rule; outlier rows: name / group label / right-aligned `n` peers / right-aligned amber badge; refusal groups: a full-width inline `bg-refusal-fill` row with the italic clause). `empty` → the calm statement. `unreadable` → the unavailable region. Semantic tokens, light + dark, no `role="alert"`.
- [x] `src/app/page.tsx` -- replace the placeholder: `await connection()`; `today = systemClock.todayUtc()`; `asOf = resolveAsOf(params['asOf'], today)`; `const s = await getSettings(settingsReadDeps())`; if `s.kind !== 'settings'` render the unavailable region; else `const findings = await getOutlierFindings(outlierFindingsDeps(), asOf, s.outlierThresholdPct)` and render `<OutlierFindings vm={buildOutlierFindings(findings, asOf)} exportHref={`/api/outliers/export?asOf=${plainDateToIso(asOf)}`} />`. Keep the as-of echo semantics (recompute observable). No self-fetch.
- [x] `tests/adapters/format-outliers-csv.test.ts` + `src/adapters/csv/format-outliers-csv.ts` -- **test-first**, then implement pure `formatOutliersCsv(report: OutlierReport, currencies: readonly CurrencyFormat[]): string`. Header + one row per outlier finding (`status=outlier`, name, role, level, country, `n`, currency, `salary` via `formatMoney(fromBoundaryMoney(salary), format)`, `peerMedian` likewise, `distancePct`, `asOf`, `thresholdPct`) + one row per thin group (`status=refusal`, name/group blank-where-N/A, `n`, reason). Quote fields containing `,`/`"`/newline; a currency that cannot format leaves that money cell blank (fail closed — never a raw minor string). Deterministic; no `Date`/random.
- [x] `src/app/api/outliers/export/route.ts` -- `GET(request)` composition root: `today = systemClock.todayUtc()`; `asOf = resolveAsOf(new URL(request.url).searchParams.getAll('asOf'), today)`; `getSettings(settingsReadDeps())` → threshold (on `unavailable`, respond header-only CSV); `getOutlierFindings(outlierFindingsDeps(), asOf, threshold)` (on `unavailable`, header-only); `loadEmployeeFormOptions(employeeReadDeps())` → currencies; `formatOutliersCsv(report, currencies)`; return `new Response(csv, { headers: { 'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':'attachment; filename="outliers-<asOf>.csv"' } })`. Never throw; HTTP 200.
- [x] `tests/integration/settings-write.test.ts` -- against real Postgres 18: `updateOutlierThresholdPct(25)` then a read-back returns `25`; restore to `20`; assert the DB `settings_outlier_threshold_pct_range` CHECK rejects a direct out-of-range write (e.g. `0` / `101`). Prove the single-row `id = 1` guard holds (no second row created).

**Acceptance Criteria:**
- Given an as-of population with ≥1 outlier, when Home renders, then the findings list shows each peer-group section (divided by a 2px rule) with one row per flagged member — name, role · level · country, right-aligned peer count `n`, and a right-aligned amber badge stating the signed distance and direction in words (`+28.4% above median` / `-25.2% below median`) — and no statistic is recomputed in the UI or DB.
- Given a peer group with `1 ≤ n < 5`, when Home renders, then it appears as an inline refusal row naming `n` (`Only {n} peers — too few to compare fairly`), inside a region with a heading, never `role="alert"`, never error-colored, never widened.
- Given no outliers and no thin groups, when Home renders, then the calm zero-state `No outliers beyond {threshold}% as of {date}. Nothing is drifting.` appears — no graphics, no emoji, no notification affordance.
- Given `getSettings` or `getOutlierFindings` returns `unavailable`, when Home renders, then a calm "unreadable" region appears (distinct from a refusal), the response is HTTP 200, and nothing throws.
- Given the user activates `Export CSV`, when the export runs, then a `text/csv` attachment downloads carrying the visible list computed at the current as-of and persisted threshold — one row per outlier and per thin group, with currency, salary, peer median, distance, `n`, as-of, and threshold columns; money is formatted through the one formatter and no bare/raw amount appears; an unreadable state yields a header-only CSV, never a framework error.
- Given the Settings threshold control, when the user edits the value and activates **Apply** with an integer in `[1, 100]`, then the single settings row is updated, Home and Settings are revalidated, and `Threshold updated to {n}%` is announced via the single polite region; an out-of-range or non-integer value is rejected with **no** database write; a repository outage returns `unavailable` with no exception crossing the boundary. Changing the threshold is never a live slider — it is always an explicit Apply.
- Given the gates run, then lint, typecheck, import-boundary, unit tests (incl. the new VM, CSV, and settings-write suites), the axe a11y pass, coverage floors, and `next build` are all green, the settings-write integration test is green against real Postgres 18, and `git diff` touches no `src/domain/**` and does not alter the finalized `getOutlierFindings` payload; each new failing test is committed before the code that satisfies it.

## Spec Change Log

_No bad_spec loopback occurred — empty._

## Review Triage Log

### 2026-07-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 2, low 3)
- defer: 0
- reject: 6
- addressed_findings:
  - `[medium]` `[patch]` CSV formula-injection: `employeeName` (import-sourced) and the reference labels rode into the export unguarded, so a name like `=HYPERLINK(...)` would execute on open in Excel/Sheets. Added `guardText` (apostrophe-prefix on a `= + - @ \t \r` lead) to `src/adapters/csv/format-outliers-csv.ts`, applied ONLY to the free-text cells (employee, role, level, country) — never the numeric/system cells where a leading `-` is a legitimate value — plus a covering test. RFC-4180 quoting alone did not stop this.
  - `[medium]` `[patch]` Accessibility: a `rejected`/`unavailable` Apply outcome was written only into an `aria-describedby` paragraph, announced solely while focus is on the input — but after Apply, focus is on the button, so the failure the reader most needs was silent. `src/ui/threshold-control.tsx` now routes the same calm text through the single polite live region (never `role="alert"`) in addition to the inline message.
  - `[low]` `[patch]` React key collision: the VM dropped `employeeId`, and `outlier-findings.tsx` keyed rows by `name + distancePct` — two flagged peers sharing a display name and an identical one-decimal distance in one group would collide, risking row mis-association on recompute. Carried `employeeId` into `OutlierRow` (keying only, never displayed) and keyed by it; updated the VM key-set test.
  - `[low]` `[patch]` PII caching: the salary/peer-median CSV was served without `Cache-Control`. Added `Cache-Control: no-store` to the export route so compensation data does not linger in the browser disk cache or an intermediary.
  - `[low]` `[patch]` Excel mojibake: the CSV carried no UTF-8 BOM, so Excel-on-Windows would misread the currency symbols (`₹`, `€`) the export exists to render. Prepended a `U+FEFF` BOM at the response boundary (both the normal and header-only paths), leaving the pure serializer and its tests untouched.
- notes: Blind Hunter (adversarial-general) + Edge Case Hunter, deduplicated. The core correctness held on every focus item — the amber badge sign/direction derivation (ASCII `-`, `+` prefix, `distancePct` contract-guaranteed never `"0.0"`), the `[1,100]` integer threshold validation (rejects `0`/`101`/`20.5`/`NaN`/`Infinity`/non-numeric coercion **before** any write, maps repository throws to `unavailable`, no exception across the boundary), `src/ui` purity (no `Date`/random/float/money), money failing closed to a blank cell (never a raw minor string), the payload consumed unmodified (no domain/contract change), and AD-21 (exactly two Route Handlers). Rejected (6, all low/by-design): no trailing CRLF terminator (RFC-4180 permits it; most consumers handle it); no defensive `try/catch` at the route boundary (all three consumed use-cases are total by contract — a catch would mask a regression rather than surface it); the header-only fallback's `thresholdPct: 0` sentinel (inert — zero data rows means it is never emitted); `Reset` issuing a no-op write when already at 20 (spec-sanctioned "same success path"); the client `Number(draft)` accepting `"1e2"`/`"0x14"` (server is the real validator by design, all land in range); and `draft` diverging from `current` on an external revalidation (narrow, self-corrects on the island's own applied result; Settings is server-rendered fresh on navigation).

### 2026-07-24 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 1, low 1)
- defer: 1: (high 0, medium 0, low 1)
- reject: 9
- addressed_findings:
  - `[medium]` `[patch]` Transport-level rejection: `ThresholdControl.apply` awaited the Server Action with **no** `try/catch`, unlike every other action-calling island in the codebase (`salary-change-panel.tsx`, `employee-form-panel.tsx`, `import-panel.tsx`). The use-case is total, but a `'use server'` invocation can still reject at the network/RPC layer independent of the action's own code — yielding an unhandled promise rejection inside the transition with no inline message and no announcement, breaking the calm-failure contract. Wrapped the await in `try/catch` mapping a transport failure to the same `{ kind: 'unavailable' }` calm outcome (inline message + polite-region announcement), matching the CAP-2 panels. `src/ui/threshold-control.tsx`.
  - `[low]` `[patch]` CSV Reason column leaked the raw `thin-peer-group` enum on thin-group rows, where every other surface uses calm human copy. Replaced with the same clause the on-screen inline refusal shows — `Only {n} peers — too few to compare fairly` — and updated the serializer unit test. `src/adapters/csv/format-outliers-csv.ts`.
- notes: Fresh follow-up pass (Blind Hunter adversarial-general + Edge Case Hunter), deduplicated against the prior pass. Core correctness re-confirmed: finalized payload consumed unmodified, no statistic re-derived, one money formatter failing closed, `[1,100]` integer validation before the write, exactly two Route Handlers, no `role="alert"`/slider/float. Deferred 1 (NEW ledger entry): the zero-**population** case (no employees imported) renders the calm zero-state "Nothing is drifting." rather than an import/onboarding prompt, which can read as a false all-clear on a fresh install — a product-scope question the spec's I/O matrix does not cover (it enumerates findings states, not "no employees at all"); the mechanism (`groups: []` → zero-state) faithfully follows the spec, so this is recorded for product attention, not a defect in this diff. Rejected 9, all low / by-design / environmental: sticky `<thead>` inside `overflow-x-auto` may not stick on page scroll (fragile-by-nature CSS, cosmetic, no clean fix that preserves horizontal scroll); `draft`/`current` divergence (narrow, self-correcting, matches sibling islands — already rejected last pass); a currencies-read outage blanks the money cells (fail-closed by design); Home's `unavailable` copy names "findings" when `getSettings` was the failed read (the spec deliberately folds both reads into one region); the formula-guard omits a leading-space lead (adequate defense-in-depth for the common `= + - @` vectors); no route-level `try/catch` (all three consumed use-cases total by contract — recorded as rejected last pass); the redundant per-row peer-group label and un-named `<tbody>` rowgroups (DR8 design choice — the label is the intended cue); the index-in-section-key (group order is deterministic); and browser e2e "not run" (attempted — the production build fails on Next/Turbopack workspace-root inference inside this git worktree, unrelated to the diff; the `main p` token contract and the `as-of-echo` element the `tokens`/`shell` suites pin are rendered unconditionally before the settings branch and were verified statically to survive the Home rewrite).

## Design Notes

**The badge is derived, not re-computed.** Every figure the findings row shows already exists in the payload: `distancePct` (server-formatted signed one-decimal string), `n`, and the group labels. The UI runs no arithmetic — it prepends `+` to a non-negative `distancePct` and picks the direction word from the sign (`-` → "below median", else "above median"). Because `distancePct` is always beyond the threshold here, it is never `"0.0"`, so the direction is never ambiguous.

**No verdict sentence, no copy-answer on the findings list.** Story 7-1's Design Notes finalized the findings row as `name · role·location · peer count · badge` with **no** composed sentence, and DR7 (copy-answer) is scoped to the employee-detail peer card, not Home. This story adds neither. If review reads the DESIGN as mandating a per-finding sentence or a copy affordance on Home, that is a `Block If` / `bad_spec` loopback — see Boundaries.

**The group label names role · level · country.** Peer groups are keyed on the full triple, so dropping level (as the DR8 column header "ROLE · LOCATION" abbreviates) would let two distinct groups read identically. The row therefore names all three (`roleName · levelLabel · countryName`), consistent with the CAP-5 verdict's "role · level · country" phrasing that review already accepted; the mock's compact "{level} {role} · {country}" is illustrative of the same three facts.

**The threshold write is the one mutation, and it needs no migration.** `settings` already holds table-level `GRANT SELECT, INSERT, UPDATE, DELETE … TO payroll_app` (migration `20260718163326`), so `settings.update({ id: 1 })` is permitted; the `settings_single_row` CHECK keeps it a single row and the `settings_outlier_threshold_pct_range` CHECK (`>0 AND <=100`) backstops the use-case's `[1,100]` integer validation. Validation lives in the application layer (like the CAP-2 write handlers coerce `unknown` input) and rejects before the write — the DB CHECK is the belt to that suspenders, surfaced as `unavailable` only if a bad value ever bypasses validation.

**CSV needs the currencies list; Home does not.** `BoundaryMoney.amountMinor` is a decimal **minor-units** string, so placing the decimal point needs the exponent from `CurrencyFormat`. The findings rows show no money (only the distance badge + peer count), so the Home VM is money-free; the CSV serializer takes the currencies list and formats through `formatMoney`, failing closed to a blank money cell rather than emitting a raw minor string.

```ts
// view-model (src/ui/outlier-findings-vm.ts) — the component consumes this
type OutlierRow = { readonly name: string; readonly badgeText: string; readonly distancePct: string };
type OutlierSection =
  | { readonly kind: 'outliers'; readonly label: string; readonly n: number; readonly rows: readonly OutlierRow[] }
  | { readonly kind: 'refusal'; readonly label: string; readonly refusalText: string };
type OutlierFindingsVM =
  | { readonly kind: 'findings'; readonly sections: readonly OutlierSection[] }
  | { readonly kind: 'empty'; readonly statement: string }
  | { readonly kind: 'unreadable'; readonly heading: string; readonly statement: string };
```

## Verification

**Commands:**
- `npm run lint` -- expected: clean, incl. import-boundary (`src/ui` imports only domain + `src/ui`; the route handler is the only new `src/app` composition root) and `no-hex` token zones.
- `npm run typecheck` -- expected: clean; the finalized read payload is consumed unmodified and the port grows only the write method.
- `npm run test` -- expected: all green, incl. the new `tests/ui/outlier-findings.test.ts`, `tests/adapters/format-outliers-csv.test.ts`, and the extended `tests/application/settings.test.ts`; each new failing test committed before its implementation.
- `npm run test:a11y` -- expected: axe green on Home (findings, refusal, zero, unreadable states as reachable) and Settings.
- `npm run test:integration` -- expected: green against Postgres 18, incl. `tests/integration/settings-write.test.ts` (`DATABASE_URL` + `DATABASE_URL_APP` set).
- `npm run test:coverage` -- expected: domain 100% / application ≥ 90% floors hold (this story adds application code — `updateOutlierThreshold` — which must be covered).
- `npm run build` -- expected: `next build` succeeds; `/`, `/settings`, and `/api/outliers/export` build clean.

**Manual checks:**
- The amber badge states direction in words and is legible in grayscale (no red/green); the badge is `rounded-sm` (2px), not a pill.
- Applying a threshold announces once via `#app-announcer` without remounting it; the value change is an explicit Apply, never a live slider.
- `git diff --name-only` touches no `src/domain/**` and does not alter the finalized `getOutlierFindings` payload shape.

## Auto Run Result

Status: **done**

### Summary
Implemented the CAP-6 UI slice, consuming story 7-1's finalized reads unmodified (Law 7 / AD-24). Home now renders the unprompted outlier sweep — the product's reason to exist: a findings table with one peer-group section per group (divided by a 2px rule), each outlier a row naming the employee, the role · level · country peer group, the right-aligned peer count `n`, and a right-aligned amber badge stating the signed distance and direction in words (`+28.4% above median` / `-25.2% below median`, derived from the payload's signed `distancePct`, never color alone). Thin groups (`1 ≤ n < 5`) appear inline as calm refusal rows naming their count (never `role="alert"`, never widened); an empty sweep shows the calm zero-state `No outliers beyond {threshold}% as of {date}. Nothing is drifting.`; an unreadable read shows a distinct "unreadable" region. Home reads the persisted threshold once via `getSettings` and passes it inward to `getOutlierFindings` (Law 6 / AD-19). A secondary ghost `Export CSV` link at the findings header downloads the visible list at the current as-of + threshold through the second (and last, AD-21) Route Handler — money formatted through the one formatter, failing closed to a blank cell, with currency and as-of/threshold provenance columns. Settings gains the CAP-6 threshold control (DR10): the current value, a bounded integer entry, and an explicit **Apply** (never a live slider) plus `Reset to default (20%)`. Apply is the one mutation this story adds — a Server Action over a new settings-port write (`updateOutlierThresholdPct`), a total `updateOutlierThreshold` use-case validating an integer `[1,100]` before any write (matching the DB CHECK; no migration needed), mapping a repository throw to `unavailable` with no exception crossing the boundary. No `src/domain/**` change; the finalized `getOutlierFindings` payload is untouched.

### Files changed
- `src/ui/outlier-findings-vm.ts` (new) — pure, total `buildOutlierFindings(result, asOf)` → VM union (findings sections + inline refusals | zero-state | unreadable); derives the amber badge string from the signed `distancePct` and the role · level · country label; carries `employeeId` for React keying only; no money, no `Date`/random.
- `src/ui/outlier-findings.tsx` (new) — presentational server component: sticky caps-header table, 2px section rules, right-aligned amber badges, full-width inline refusal rows, the `Export CSV` ghost link, the zero-state statement, the unreadable region. Semantic tokens, light + dark, no `role="alert"`.
- `src/ui/threshold-control.tsx` (new) — `"use client"` control: `OUTLIER THRESHOLD`, current %, bounded integer entry (no slider), explicit Apply + `Reset to default (20%)`; the Server Action is handed in as a prop (import-boundary); announces success AND failure through the single polite live region.
- `src/adapters/csv/format-outliers-csv.ts` (new) — pure `formatOutliersCsv(report, currencies)`; one row per outlier + per thin group; money via `formatMoney(fromBoundaryMoney(...))` failing closed to blank; RFC-4180 quoting + a formula-injection guard on the free-text cells.
- `src/app/api/outliers/export/route.ts` (new) — the second/last Route Handler: `GET` composition root; resolves as-of, reads threshold + findings + currencies, serializes; header-only CSV on any unreadable arm; UTF-8 BOM + `Cache-Control: no-store`; always HTTP 200.
- `src/app/settings/actions.ts` (new) — `'use server'` `applyThresholdAction(input)`; coerces, calls `updateOutlierThreshold`, `revalidatePath('/')`+`('/settings')` on a committed write.
- `src/application/ports/settings-repository.ts` — added the write half `updateOutlierThresholdPct(pct)`.
- `src/adapters/db/settings-repository.ts` — implemented the update (`where: { id: 1 }`).
- `src/application/use-cases/settings.ts` — added `updateOutlierThreshold` (`applied | rejected | unavailable`) + `SettingsWriteDeps`; validates integer `[1,100]` before the write.
- `src/app/settings/settings-deps.ts` — added `settingsWriteDeps()` (lazy write repository).
- `src/app/settings/page.tsx` — renders the threshold control (or the unavailable region) from `getSettings`.
- `src/app/page.tsx` — replaced the placeholder with the findings surface (as-of + threshold reads → `getOutlierFindings` → `OutlierFindings`), keeping the as-of provenance echo.
- Tests (new): `tests/ui/outlier-findings.test.ts`, `tests/adapters/format-outliers-csv.test.ts`, `tests/integration/settings-write.test.ts`; extended `tests/application/settings.test.ts` for `updateOutlierThreshold`.

### Review findings breakdown
- **Patches applied (5; medium 2, low 3):** (medium) CSV formula-injection guard on free-text cells; (medium) route failure announcements through the polite live region; (low) React key via `employeeId`; (low) `Cache-Control: no-store` on the PII export; (low) UTF-8 BOM for Excel currency-symbol correctness. See the Review Triage Log.
- **Deferred (0).**
- **Rejected (6, all low/by-design):** trailing-CRLF terminator (RFC-permitted), no defensive route `try/catch` (consumed use-cases total by contract), header-only `thresholdPct: 0` sentinel (inert), `Reset` no-op write (spec-sanctioned), client `Number()` leniency (server validates), `draft`/`current` divergence (narrow, self-correcting).

### Verification performed
- `npm run test` — 43 files, **1300 passed** (1299 + 1 new CSV injection test).
- `npm run typecheck` — clean (`npx prisma generate` once for the generated client; no source change).
- `npm run lint` — clean (import-boundary + no-hex).
- `npm run test:a11y` — **20 passed** (Home + Settings, light + dark; real findings table + threshold control axe-scanned against a reachable DB).
- `npm run build` (`next build`) — success; `/`, `/settings`, `/api/outliers/export` all emitted (needed the documented temporary `turbopack.root` repoint for this worktree — applied and reverted; `next.config.ts` is clean).
- `npm run test:integration -- tests/integration/settings-write.test.ts` — **4 passed** against real Postgres 18 (write `id:1` + read-back, single-row guard, DB CHECK rejects a direct out-of-range write).
- `npm run test:coverage` — domain 100% / application ≥90% floors hold (verified at implementation; the review patches add no domain/application code, only `src/ui`, `src/adapters/csv`, `src/app`, and tests, so the floors and mutation scope are unaffected).
- `git diff` since baseline touches no `src/domain/**` and does not alter the finalized `getOutlierFindings` payload shape.

### Residual risks
- The populated `.tsx` render paths (findings table, threshold control) are not unit-tested (project constraint: no jsdom/RTL) and the CSV bytes are proven only through the pure serializer's unit suite, not an end-to-end download; both sit over fully unit-tested pure logic, and the surfaces are axe-scanned.
- The formula-injection guard is defense-in-depth for a single-org tool; it apostrophe-prefixes free-text cells beginning with a formula lead, a minor data-fidelity trade for safety.
- `test:coverage`/`test:mutation` were not re-run after the review patches — no `src/domain`/`src/application` code changed in that pass, so the floors and mutation scope are unchanged; `src/ui` is outside both gates by configuration.

---

### Follow-up review — 2026-07-24

A fresh independent review pass (the orchestrator re-drove the completed spec). Two adversarial layers (Blind Hunter + Edge Case Hunter) at the session model, deduplicated.

**Change made this pass (2 patches):**
- `src/ui/threshold-control.tsx` — wrapped the Apply's Server-Action `await` in `try/catch` (mapping a transport-level rejection to the same calm `{ kind: 'unavailable' }` outcome). The use-case is total, but a `'use server'` RPC can reject at the network layer; every other action-calling island in the codebase already guards this. Closes a genuine calm-failure-contract gap the prior pass's announcement-routing patch did not cover.
- `src/adapters/csv/format-outliers-csv.ts` (+ `tests/adapters/format-outliers-csv.test.ts`) — the CSV Reason column now emits the human clause `Only {n} peers — too few to compare fairly` for thin-group rows instead of the raw `thin-peer-group` enum.

**Deferred (1, new ledger entry):** the zero-population case shows the calm zero-state rather than an onboarding prompt (a product-scope question, not a diff defect). See `deferred-work.md`.

**Rejected (9):** all low / by-design / environmental — see the Review Triage Log follow-up entry.

**Verification performed this pass:**
- `npm run typecheck` — clean.
- `npm run lint` — clean (import-boundary + no-hex).
- `npm run test` — 43 files, **1300 passed** (incl. the updated CSV serializer test).
- Browser e2e (`test:shell` / `test:tokens`) — **not executable in this worktree**: `next build` fails on Next/Turbopack workspace-root inference (it resolves `next/package.json` from `src/app`), unrelated to the diff. The invariants those suites pin — the `main p` token contract and the `data-testid="as-of-echo"` element — are rendered unconditionally before the settings branch and were verified statically to survive the Home rewrite; the prior run recorded them green via a temporary `turbopack.root` repoint.

**Follow-up review recommendation:** `false` — the two fixes are localized and low / low-medium consequence (a client-side transport guard matching an established pattern, and a user-facing copy correction with its test), touching no domain/application logic and no payload contract.

**Residual risks:** unchanged from the original run. The populated `.tsx` render paths remain outside the unit gate (project constraint), and browser e2e was not re-executed here for the environmental reason above.
