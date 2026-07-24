---
title: 'CAP-9 Payroll Totals — UI'
type: 'feature'
created: '2026-07-24'
status: 'done'
baseline_revision: '61791bf0d083b5d3ee324042dc3607510e9e98fd'
final_revision: 'b6b1e9f2b1411ba918ec3c459131a82426366bbf'
review_loop_iteration: 0
followup_review_recommended: false
context: ['{project-root}/docs/project-context.md', '{project-root}/docs/implementation-artifacts/epic-10-context.md', '{project-root}/docs/implementation-artifacts/spec-10-1-payroll-totals-backend.md']
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Story 10-1 finalized the payroll-totals boundary payload but nothing renders it. Alice still has no screen showing what the org spends on salary: per-country totals in each country's own currency (never converted) and one org-wide total in the reporting currency that must show its receipts — the FX rate(s) used and the date they were pinned to — or refuse out loud when the rates are missing. Home shows no payroll pulse or headline total.

**Approach:** Deliver the CAP-9 frontend slice, consuming `getPayrollTotals` (10-1) **unmodified**. Replace the `/payroll-totals` placeholder with the Payroll Totals surface (per-country table in local currency, org-wide converted total with an ambient provenance caption + a "View Base Rates" disclosure of `ratesUsed`, a calm refusal region when the org-wide total can't convert, and an "Export CSV" affordance) and add to Home a headline **TOTAL PAYROLL** tile plus a by-country pulse. Follow the established VM/component split (all judgement in a pure, unit-tested `-vm.ts`; markup-only `.tsx`), reusing `formatMoney`/`fromBoundaryMoney`, `formatPlainDate`, `EmployeeUnavailable`, the `bg-refusal-fill` region register, the decorative-bars-over-accessible-table pulse pattern, and the outliers CSV Route-Handler pattern.

## Boundaries & Constraints

**Always:**
- Obey every Law in `project-context.md`. The UI **consumes the fixed payload and adds nothing to the contract** (AD-24, Law 7): `import type` only from `@/application/use-cases/payroll-totals`; no new payload field, port method, or change to `src/application`/`src/domain`/`src/adapters`/`prisma`. Re-derive no statistic — `n`, per-country `total`, org-wide `total`, `ratesUsed`, `pinnedOn` all arrive computed (Laws 2 & 8).
- **Never convert in the UI.** Per-country totals render in their own currency; the only cross-currency figure is the org-wide `total`, already converted by the domain. The payload carries **no per-country converted amount**, so the UI must not multiply a per-country total by a rate or compare per-country totals across currencies (Law 3 / AD-13). The by-country pulse therefore sizes its bars by **headcount `n`** (currency-neutral, in-payload), never by payroll magnitude.
- **Money only through the one formatter** (Law 4 / AD-4): every amount rendered via `formatMoney(fromBoundaryMoney(total), format)` with `format` resolved from the currencies reference list by the amount's **own** currency code. **Fail closed** — if a figure can't format, withhold that figure (render nothing / blank cell), never a bare number, raw `amountMinor` string, or currency-less amount. Every visible amount carries its ISO currency code. All numerals (totals, headcounts, rates, dates-in-data) in the monospace numeric face, numeric columns right-aligned.
- **Provenance rides one line beneath its figure** (DR6): a muted `text-body-sm text-ink-muted` caption composed in the VM from payload fields — reporting currency, `asOf`, and for the converted total the pinned date (`converted at rates pinned <DD Mon YYYY>`). Never separate a converted number from its receipts. The "View Base Rates" disclosure lists every `ratesUsed` receipt.
- **Refusal is data, not error** (Law 8 / AD-20, project-context Conventions): the org-wide `refusal` arm (`no-rate-set` / `missing-rate`) renders as a flat neutral **region with a heading** (`bg-refusal-fill`, never `role="alert"`, never error/red styling, never an apology), while the per-country table stays fully present. The outer `unavailable` arm renders the shared `EmployeeUnavailable` region. HTTP 200 on every arm.
- **As-of is resolved once at the boundary and passed inward** (Law 6 / AD-11): each RSC / Route Handler reads `systemClock.todayUtc()` once and `resolveAsOf(...)` the URL `asOf`; no `Date`/clock/random in `src/ui`/`src/domain`. Recompute on as-of change swaps values in place and rides the existing app-level `aria-live="polite"` region (never remounted, never `role="alert"`).
- **CSV export** (DR16, epic-10 context) serves the visible per-country list at the current as-of via a new Route Handler mirroring the outliers export, with currency + as-of + org-wide conversion provenance columns; the pure serializer consumes the payload unmodified and fails money cells closed to blank.
- TDD (Law 1): the pure `-vm.ts` and the pure CSV serializer are written **test-first** (failing test committed first); their suites touch no DB/clock/network. The `.tsx` render paths carry no unit test (no jsdom/RTL in this project) — all judgement lives in the tested VM. WCAG 2.2 AA is the floor (axe green light + dark).

**Block If:**
- A planning source is found mandating the by-country pulse (or any surface) compare **payroll magnitude across currencies** (bars/ranking sized by converted or raw cross-currency totals) — that contradicts Law 3 / AD-13 and the payload (no per-country converted amount), and cannot be satisfied unattended without either re-deriving a forbidden conversion in the UI or widening the 10-1 contract.
- Rendering any figure would require adding a field to the payload, a new port/use-case, or a second money formatter / abbreviating formatter (e.g. `$1.2B`) — the contract is frozen and there is exactly one money formatter.
- The finalized `getPayrollTotals` payload on disk differs from what 10-1's Design Notes recorded (a field renamed/removed), so the UI cannot bind to it as documented.

**Never:**
- Never mutate the backend contract, re-resolve currency from country, convert per-employee or per-country, abbreviate money, or compare per-country totals by bar length. Never add a third+ Route Handler beyond upload + CSV-export (this export IS the sanctioned CSV-export job; AD-21's own text anticipates three CSV exports — see Design Notes). Never `fetch` our own origin from an RSC. Never style a refusal as an alert/error, add a per-page as-of picker or a page `<h1>` (the header derives it from `nav-items`), or introduce a hex/`rgb()`/`dark:` literal (semantic tokens only, AD-15).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Answer, org-wide converted | `answer`; multi-currency `perCountry`; `orgWide.answer` with `ratesUsed` + `pinnedOn` | Per-country table (countryName, currency, `n`, local total each via `formatMoney`), ordered as delivered (`countryCode` asc); headline org-wide `total` in reporting currency + caption `converted at rates pinned <DD Mon YYYY>`; "View Base Rates" lists each `ratesUsed` receipt | No error |
| Answer, no conversion needed | `orgWide.answer`, `ratesUsed:[]`, `pinnedOn:null` (all in reporting currency, or empty population → total 0) | Headline total renders; caption states summed directly with no conversion (as-of only); no "View Base Rates" disclosure (no rates) | No error |
| Org-wide refusal `no-rate-set` | `orgWide.refusal reason:'no-rate-set'`, `pinnedOn:null` | Per-country table fully present; org-wide block is a calm region+heading ("Org-wide total unavailable") stating no rates are pinned on/before the as-of; no headline number | No error |
| Org-wide refusal `missing-rate` | `orgWide.refusal reason:'missing-rate'`, `pinnedOn` set, `missingPairs:[…]` | As above but the statement names the absent pair(s) and the set's pinned date | No error |
| Unavailable | `{ kind:'unavailable' }` (repository outage / DB-free build) | Whole surface renders the shared `EmployeeUnavailable` region (distinct heading id); axe-clean; no crash | No error |
| Empty population | `answer`; `perCountry:[]`; `orgWide.answer` total 0 | Calm "no countries to report" statement instead of an empty table; headline total 0 in reporting currency | No error |
| Money won't format | a `total`/currency absent from currencies list or exponent mismatch | That figure is withheld (blank cell / omitted headline), the rest of the surface still renders — never a bare/raw amount | Fail closed |
| Home headline + pulse | Home reads `getPayrollTotals` once | TOTAL PAYROLL tile (org-wide answer total + caption, or calm refusal/unavailable) + by-country pulse (top-5 by `n`, decorative bars `aria-hidden`, counts+local totals in an accessible table), drill link to `/payroll-totals?asOf=…` | No error |
| CSV export | `GET /api/payroll-totals/export?asOf=…` | `text/csv` attachment (UTF-8 BOM, `no-store`), one row per country with currency + local total + `n` + the FX rate used to convert it + as-of, plus an org-wide summary row; unreadable → header-only CSV, HTTP 200 | Always 200 |

</intent-contract>

## Code Map

- `src/application/use-cases/payroll-totals.ts` -- CONSUME (types only). `GetPayrollTotalsResult`, `PayrollTotals`, `PayrollCountryTotal`, `PayrollOrgWideTotal`; `RateReceipt`/`CurrencyPair` re-exported from `@/domain/payroll-totals`. Never modify.
- `src/app/employees/employee-deps.ts` -- REUSE `payrollTotalsDeps()` (already exists) + `employeeReadDeps()`/`loadEmployeeFormOptions` for the currencies list. Never modify.
- `src/domain/money.ts` -- REUSE `formatMoney`, `fromBoundaryMoney`, `CurrencyFormat`, `BoundaryMoney` (the ONE formatter; fail-closed `null`).
- `src/domain/plain-date.ts` -- REUSE `formatPlainDate` (`DD Mon YYYY`), `plainDateToIso`.
- `src/application/as-of.ts` + `src/adapters/clock.ts` -- REUSE `resolveAsOf`, `systemClock` at each boundary (page + route).
- `src/ui/employee-unavailable.tsx` -- REUSE `EmployeeUnavailable({ id, heading, statement })` for `unavailable` + as the register for the org-wide refusal region.
- `src/ui/gender-distribution.tsx` / `-vm.ts` -- PATTERN to mirror: decorative `aria-hidden` bars sized by inline `flexGrow: n`, paired with an accessible `<table>`; `visuallyHiddenTable`/`drillHref` props; keys on the schema code, not the label.
- `src/ui/outlier-findings.tsx` -- PATTERN: hairline ghost `<a href={exportHref}>Export CSV</a>` (not a client island).
- `src/app/api/outliers/export/route.ts` + `src/adapters/csv/format-outliers-csv.ts` -- PATTERN for the new export route + serializer (BOM, `no-store`, header-only fallback, RFC-4180 quoting, formula-guard on text cells, money fail-closed to blank).
- `src/app/gender-insights/page.tsx` -- PATTERN for the RSC (`await connection()`, resolve as-of, echo `<time data-testid="as-of-echo">`, branch arms).
- `src/app/page.tsx` -- EDIT: add a `PayrollSummary` async sub-component (mirrors `GenderPulse`), one read, renders headline tile + pulse.
- `src/ui/nav-items.ts` -- ALREADY has `{ href:'/payroll-totals', label:'Payroll Totals' }`; no nav change.
- `e2e/accessibility.spec.ts` / `e2e/shell.spec.ts` -- ALREADY list `/payroll-totals`; the populated surface must stay axe-clean.

## Tasks & Acceptance

**Execution:**
- [x] `tests/ui/payroll-totals.test.ts` + `src/ui/payroll-totals-vm.ts` -- TEST-FIRST. Pure `buildPayrollTotals(result, currencies): PayrollTotalsVM` (+ `PAYROLL_TOTALS_UNAVAILABLE_HEADING`/`_STATEMENT` consts): select arm; format every per-country `total` via `formatMoney(fromBoundaryMoney(...), format)` (fail closed → figure withheld); preserve delivered per-country order; compose the org-wide answer headline + provenance caption + `ratesUsed` disclosure rows, or the refusal heading/statement (naming `missingPairs` + `pinnedOn` for `missing-rate`); select the pulse rows (top-5 countries by `n` desc, tie-break `countryCode` asc). `import type` only; total; no `Date`/random/I/O. Cover every I/O-matrix VM row incl. money fail-closed, empty population, keys on `countryCode`.
- [x] `src/ui/payroll-totals.tsx` -- Presentational server components (markup only, `readonly` props, semantic tokens, light+dark): `PayrollTotalsView({ vm, exportHref })` — per-country `<table>` (caps `<th scope="col">`, mono right-aligned numerals, empty-state statement), the org-wide block (answer: headline figure + one-line provenance caption + native `<details>`/`<summary>` "View Base Rates" listing `ratesUsed`; refusal: `bg-refusal-fill` region with heading + statement), and the hairline ghost `Export CSV` `<a>`; plus `PayrollHeadlineTile({ vm })` and `PayrollByCountryChart({ vm, visuallyHiddenTable?, drillHref? })` for Home (decorative `aria-hidden` bars sized by `flexGrow:n`, squared ends, no interactivity, paired with an accessible counts+local-totals table). No unit test (no jsdom).
- [x] `src/app/payroll-totals/page.tsx` -- Replace the placeholder RSC: `await connection()`; `resolveAsOf(params['asOf'], systemClock.todayUtc())`; read currencies via `loadEmployeeFormOptions(employeeReadDeps())`; `getPayrollTotals(payrollTotalsDeps(), asOf)`; echo `<time data-testid="as-of-echo">` in the first `rounded bg-surface-card p-3 text-body-md` card; render `EmployeeUnavailable` on `unavailable` else `<PayrollTotalsView vm={buildPayrollTotals(result, currencies)} exportHref={/api/payroll-totals/export?asOf=…} />`. No `<h1>`, no per-page as-of picker.
- [x] `src/app/page.tsx` -- Add async `PayrollSummary({ asOf })` (one `getPayrollTotals` read, build VM once): render `EmployeeUnavailable` on `unavailable`, else `<PayrollHeadlineTile>` + `<PayrollByCountryChart visuallyHiddenTable drillHref={/payroll-totals?asOf=…} />`; mount it after `GenderPulse` in the same `resolveAsOf`ed as-of. Change nothing else.
- [x] `tests/adapters/format-payroll-totals-csv.test.ts` + `src/adapters/csv/format-payroll-totals-csv.ts` -- TEST-FIRST. Pure `formatPayrollTotalsCsv(totals, currencies): string`: header + one row per country (`Country`, `Currency`, `Headcount`, `Annual Payroll Total`, the `FX Rate` applied to that currency→reporting from `ratesUsed` [blank if same currency or on refusal], `Rate Pinned On`, `As Of`) then an org-wide summary row (converted `total`, or `Unavailable — <reason> <pairs>` on refusal); RFC-4180 quoting + CRLF; money via the one formatter, fail closed to blank; formula-guard on text cells only; empty/absent inputs → header-only. Cover both refusal reasons, no-conversion-needed, and fail-closed money.
- [x] `src/app/api/payroll-totals/export/route.ts` -- `GET(request)` composition root mirroring the outliers route: read clock once, `resolveAsOf(url.searchParams.getAll('asOf'), today)`, `getPayrollTotals(payrollTotalsDeps(), asOf)` + currencies, serialize; `unavailable` → header-only CSV; return `text/csv; charset=utf-8` with UTF-8 BOM, `Content-Disposition: attachment; filename="payroll-totals-<iso>.csv"`, `Cache-Control: no-store`; always HTTP 200.

**Acceptance Criteria:**
- Given an `answer` with a converted `orgWide`, when the Payroll Totals page renders, then per-country totals appear in local currency (each with its ISO code, mono right-aligned, delivered order), and the org-wide total appears in the reporting currency with a one-line `converted at rates pinned <DD Mon YYYY>` caption and a "View Base Rates" disclosure listing every `ratesUsed` receipt — no figure re-derived or converted in the UI.
- Given an `orgWide` refusal (`no-rate-set` or `missing-rate`), when the page renders, then the per-country table is fully present and the org-wide block is a calm region with a heading (never `role="alert"`/error styling) whose statement names the reason (and the absent pairs + pinned date for `missing-rate`).
- Given `unavailable`, then the surface renders the shared `EmployeeUnavailable` region and stays axe-clean (this is the DB-free `test:a11y` state for `/payroll-totals`).
- Given Home, then a TOTAL PAYROLL tile shows the org-wide converted total (or a calm refusal/unavailable) with its provenance caption, and a by-country pulse shows decorative `aria-hidden` bars sized by headcount with the counts and local totals carried in an accessible table; the drill link opens `/payroll-totals` on the same as-of.
- Given `GET /api/payroll-totals/export?asOf=…`, then a `text/csv` attachment downloads (UTF-8 BOM, `no-store`) carrying per-country currency + local total + `n` + the FX rate used + as-of, plus the org-wide summary; an unreadable payload yields a header-only CSV at HTTP 200.
- Given the full gate: `npm run test` green (VM + CSV suites written test-first), `typecheck`, `lint` (import-boundary: `src/ui` imports only domain/application types + pure domain formatters), `tokens:check`, `test:a11y` (axe green light+dark), and `build` all pass; `git diff --name-only` touches no `src/application`/`src/domain`/`src/adapters/db`/`prisma`.

## Spec Change Log

## Review Triage Log

### 2026-07-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 0
- reject: 14: (high 0, medium 0, low 14)
- addressed_findings:
  - `[medium]` `[patch]` Home `PayrollSummary` rendered both `PayrollHeadlineTile` and `PayrollByCountryChart` unconditionally, so an `unavailable` read stacked TWO identical `EmployeeUnavailable` regions (ids `home-payroll-unavailable-heading` + `home-payroll-pulse-unavailable-heading`) — a visible doubled "could not be read" block on Home and a deviation from the spec task ("render `EmployeeUnavailable` on `unavailable`, else tile + pulse"). Fixed by branching ONCE in `PayrollSummary`: an unreadable VM now renders a single calm region; the tile/pulse keep their own defensive arms for any other caller.
- notes: The 14 rejects split into two themes. (A) **Defends a 10-1-forbidden state the VM/CSV already guard** (all low, consumer = HR manager): a missing-rate refusal with an empty `missingPairs` or a null `pinnedOn` (the backend contract guarantees missing-rate names its pairs and carries the winning set's date; the VM guards on `pinnedOn` and falls back honestly, and the CSV mirrors it); an org-wide answer whose `pinnedOn`/`ratesUsed` disagree (the contract couples them); a negative money cell escaping the CSV formula-guard (salaries are validated positive and totals are sums of positives — unreachable, and money cells are exempt exactly as the outliers serializer exempts them); `refusal.asOf` vs `totals.asOf` divergence (equal by contract). A reachable-looking guard for any of these would be dead, untestable code — the same stance 10-1's review took on DB-forbidden states. (B) **Critiques an established, axe-passing house pattern**: per-composition-root `readCurrencies` (the outliers route + Home already each own one); the Home pulse's decorative `aria-hidden`, unlabeled bars + `sr-only` table (identical to the shipped gender pulse, which explicitly documents "no per-segment labels"); the `Currency` column alongside the currency-carrying money cell ("currency always visible", Law 4, matches the outliers CSV); serial reads in the export route (matches the outliers route); the `→` (CSV data cell) vs ` → ` (screen prose) arrow, each correct for its medium; and three items of harmless dead defensive code (`CountryBar` `n<=0` track, the chart's unused visible-table default, the never-firing formula-guard on the "Unavailable —" refusal summary).

## Design Notes

**Why the by-country pulse is sized by headcount, not payroll.** Per-country totals are single-currency and the payload exposes no per-country *converted* amount (10-1 gives only the summed org-wide `total` + `ratesUsed`). Sizing bars by raw local totals would compare `₹982Cr` against `$890M` by pixel width — an implicit cross-currency comparison the currency-isolation Law forbids ("comparisons never cross currencies; conversion exists only for [the org-wide] total"). Converting per-country in the UI is doubly forbidden (Law 2/3 + "add nothing to the contract"). The one currency-neutral per-country quantity in the payload is `n`, so the pulse bars encode headcount and the per-country **local totals** live only in the accompanying data table (each with its own currency, never bar-compared). This is a deliberate, faithful deviation from the Stitch mock's magnitude bars, which are unimplementable under the Laws + frozen payload.

**Headline money is the full grouped amount — no abbreviation.** The mock shows `$1.2B`; there is exactly one money formatter and it groups fully (`$1,210,000,000 USD`, Indian lakh/crore where applicable). An abbreviating formatter would be a second formatter (Law 4) — out of scope. The headline uses `formatMoney` verbatim.

**AD-21 reconciliation (the CSV export is sanctioned).** AD-21's "exactly two routes" names two route-handler *jobs* — the multipart upload and **CSV export downloads** — and its own "Prevents" clause explicitly anticipates *three CSV exports*; epics.md assigns DR16 (CSV export) to Epics 7, **10**, and 11. The per-capability export route (`/api/outliers/export`, CAP-6) is the established shape; `/api/payroll-totals/export` is the same job for CAP-9, not a new kind of handler. (The outliers route's "SECOND and LAST" comment is aspirational-at-authoring, subordinate to the spine + epics.md; leave it untouched.)

**VM shape (single builder, both surfaces, no drift):**
```ts
type PayrollTotalsVM =
  | { kind: 'unavailable'; heading: string; statement: string }
  | { kind: 'answer';
      perCountry: { countryCode; countryName; currency; n; total: string | null }[]; // total null ⇒ withheld
      orgWide:
        | { kind: 'answer'; headline: string | null; reportingCurrency: string; caption: string;
            rates: { fromCurrency; toCurrency; rate: string; pinnedOn: string }[] }   // rates:[] ⇒ no disclosure
        | { kind: 'refusal'; heading: string; statement: string };
      pulse: { countryCode; countryName; n; total: string | null }[]; };            // top-5 by n desc, countryCode asc
```
Home's tile reads `vm.orgWide`; Home's pulse reads `vm.pulse`; the screen reads all three. `formatPlainDate(d) ?? plainDateToIso(d)` everywhere a date is shown.

## Verification

**Commands:**
- `npm run test -- tests/ui/payroll-totals.test.ts tests/adapters/format-payroll-totals-csv.test.ts` -- expected: green (written test-first, red before green).
- `npm run test` -- expected: full Vitest suite green (`src/ui` outside the coverage gate; domain/application floors unchanged — no domain/application code added).
- `npm run typecheck` && `npm run lint` -- expected: clean, incl. import-boundary (`src/ui` imports only domain/application **types** + pure domain formatters; no adapters/prisma/clock).
- `npm run tokens:check` -- expected: clean (no hex/`rgb()`/`dark:` literal; semantic tokens only).
- `npm run test:a11y` -- expected: axe green over `/payroll-totals` (DB-free → `unavailable` region) in light + dark.
- `npm run build` -- expected: `/payroll-totals`, `/`, and `/api/payroll-totals/export` build clean.

**Manual checks (if no CLI):**
- Grayscale legibility: currency codes/words carry meaning, not bar fill; bars have no hover/tooltip/transition/click target; provenance caption never orphaned from its number; refusal reads as a calm region, not an alert.
- `npx prisma generate` may be needed once in a fresh worktree before `typecheck`/`build`; Turbopack workspace-root may need a temporary `turbopack.root` repoint for the Playwright build (applied+reverted, never committed) — both are documented worktree gotchas, no source change.

## Auto Run Result

Status: **done**

### Summary
Delivered the CAP-9 payroll-totals FRONTEND slice (story 10-2), consuming story 10-1's finalized `getPayrollTotals` payload UNMODIFIED (Law 7 / AD-24). Replaced the `/payroll-totals` placeholder with the real surface — a per-country table in each country's own local currency (never converted), an org-wide **Total payroll** block showing the one converted figure with a one-line provenance caption (`Converted to <R> at rates pinned <DD Mon YYYY>, as of <date>`) and a native `<details>` "View base rates" disclosure of every `ratesUsed` receipt, a calm `bg-refusal-fill` region (never `role="alert"`) when the org-wide total can't convert while per-country totals stay fully present, and a hairline ghost **Export CSV** affordance. Home gained a **Total payroll** headline tile and a by-country **pulse** whose decorative `aria-hidden` bars are sized by the currency-neutral headcount `n` (never payroll magnitude, which would be a forbidden cross-currency comparison), with counts and local totals carried in an accessible table. A pure, unit-tested VM makes every judgement (arm selection, money fail-closed via the ONE `formatMoney`, provenance/refusal composition, top-5 pulse selection) so the `.tsx` is markup-only; a new pure CSV serializer + a third CSV-export Route Handler (the sanctioned CSV-export job; AD-21's own text anticipates three CSV exports; epics.md assigns DR16 to Epics 7/10/11) serve the visible list with currency + as-of + conversion provenance and always answer HTTP 200 (header-only on an unreadable payload). The UI added NOTHING to the backend contract.

### Files changed
- `src/ui/payroll-totals-vm.ts` (new) — pure `buildPayrollTotals(result, currencies)` + `PAYROLL_TOTALS_UNAVAILABLE_HEADING`/`_STATEMENT`; formats every per-country/pulse/headline total fail-closed to `null`; composes the org-wide answer caption + `ratesUsed` disclosure or the refusal heading/statement; selects the top-5-by-headcount pulse. `import type` only + pure domain formatters.
- `src/ui/payroll-totals.tsx` (new) — markup-only server components: `PayrollTotalsView` (screen: per-country table + Export CSV + org-wide block with `<details>` base rates or refusal region), `PayrollHeadlineTile`, `PayrollByCountryChart` (decorative headcount bars + accessible table).
- `src/adapters/csv/format-payroll-totals-csv.ts` (new) — pure `formatPayrollTotalsCsv`: header + per-country rows (Country, Currency, Headcount, Annual Payroll Total, FX Rate applied, Rate Pinned On, As Of) + org-wide summary; RFC-4180 quoting/CRLF, money fail-closed to blank, formula-guard on text cells, header-only on `null`.
- `src/app/api/payroll-totals/export/route.ts` (new) — `GET` composition root mirroring the outliers route (clock once, `resolveAsOf` on `getAll('asOf')`, UTF-8 BOM, `no-store`, attachment filename, always HTTP 200).
- `src/app/payroll-totals/page.tsx` — replaced the story-1-6 placeholder RSC with the real read + render (`connection()`, resolve as-of, read currencies, `getPayrollTotals`, as-of echo, `PayrollTotalsView`).
- `src/app/page.tsx` — added async `PayrollSummary` after `GenderPulse` (one read → one VM → tile + pulse); branches ONCE on `unavailable` (the review patch).
- Tests (new, test-first): `tests/ui/payroll-totals.test.ts` (12), `tests/adapters/format-payroll-totals-csv.test.ts` (8).

### Review findings breakdown
- **Patches applied (1, medium).** Home rendered two stacked `EmployeeUnavailable` regions on an unreadable read (tile + pulse each branched independently); fixed by branching once in `PayrollSummary`.
- **Deferred (0).**
- **Rejected (14, all low).** Findings that defend a 10-1-forbidden state the VM/CSV already guard (missing-rate with empty pairs / null pinnedOn, pinnedOn↔ratesUsed disagreement, negative money cell, asOf divergence) or critique an established axe-passing house pattern (per-composition-root `readCurrencies`, decorative unlabeled Home pulse bars matching the gender pulse, Currency column + currency-in-money-cell, serial reads, prose vs data-cell arrow, harmless dead defensive code). Full reasoning in the Review Triage Log.

### Verification performed (independently re-run after the patch)
- `npm run test` — **54 files, 1451 passed** (+20 over the backend baseline; the two new pure suites were written test-first, seen red for "cannot find module" before implementation).
- `npm run typecheck` — clean (0 errors). `npm run lint` — clean (import-boundary held: `src/ui` imports only domain/application **types** + pure domain formatters).
- `npm run tokens:check` — in sync with `DESIGN.md` (semantic tokens only).
- `npm run test:a11y` — **20 passed**; `/payroll-totals` and `/` axe-clean in light + dark.
- `npm run build` — clean; `/payroll-totals`, `/`, and `/api/payroll-totals/export` all built. (Playwright/build used the documented temporary `turbopack.root` repoint, applied + reverted — `next.config.ts` is unchanged in git.)
- `git status` confirms the diff touches no `src/application`/`src/domain`/`src/adapters/db`/`prisma` — the backend contract is untouched.

### Residual risks
None material. The UI consumes the frozen 10-1 payload and adds nothing to it; every "refuse-vs-invent" and malformed-payload edge the review surfaced is unreachable given 10-1's contract (missing-rate names its pairs and carries its pinned date; `ratesUsed`↔`pinnedOn` are coupled; totals are non-negative sums of validated-positive salaries) and is handled fail-closed if it ever occurred. The by-country pulse deliberately encodes headcount, not payroll magnitude, to honor the currency-isolation Law under the frozen payload — a faithful deviation from the Stitch mock, documented in Design Notes.
