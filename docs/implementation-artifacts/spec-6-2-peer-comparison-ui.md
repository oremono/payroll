---
title: 'Peer Comparison — UI (CAP-5, story 6-2)'
type: 'feature'
created: '2026-07-23'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: 'bee17b56fa1f58a691a5ec4e061bc68643f1c066'
final_revision: '4504c2016df1b985743888c7856830e030899e36'
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/docs/implementation-artifacts/epic-6-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Story 6-1 finalized the CAP-5 read (`getPeerComparison` → `answer | refusal | not-found | unavailable`, each arm carrying a server-composed `verdict` sentence), but nothing renders it. The employee detail page (`src/app/employees/[id]/page.tsx`) shows identity and the salary timeline only; an HR manager still cannot see where an employee sits relative to peers, nor read the dignified refusal a thin group earns.

**Approach:** Add the peer-comparison surface as a third sibling section on the employee detail page, consuming 6-1's finalized payload **unmodified** (Law 7). A pure `src/ui/peer-comparison-vm.ts` builder turns the payload union into a view-model (verdict sentence, provenance caption, and — for an answer — the peer-median / range / distance figures formatted from the payload's already-computed values). A presentational `src/ui/peer-comparison.tsx` renders the answer card and the refusal panel in the same layout slot. A tiny `"use client"` `src/ui/copy-answer.tsx` ghost button copies the verdict sentence verbatim and announces "Answer copied" via the existing app-level live region. The page calls `getPeerComparison(deps, id, today)` and renders the arms. No backend, port, adapter, or contract change.

## Boundaries & Constraints

**Always:**
- Consume the finalized `GetPeerComparisonResult` **unmodified**; add no field to the payload and no method to any port (Law 7). Re-derive **no statistic** — `verdict`, `distancePct`, `n`, `currency`, `peerMedian`, `spread`, `subjectSalary` all arrive computed (Laws 2 & 8). The UI only *formats* money and dates and *selects* the arm to render.
- The `verdict` string is the ONE composed sentence (`src/domain/verdict.ts`), rendered by the card and copied by copy-answer **byte-for-byte unmodified** — never recomposed, reworded, or re-cased (Law 8). Both the answer card and BOTH refusal states carry and render their `verdict`.
- Money figures render through the ONE money formatter (`formatMoney` after `fromBoundaryMoney`) with the `CurrencyFormat` looked up by the payload's `currency` code from the reference `currencies` list — never a bare number, never a raw `bigint`/decimal string surfaced, never a hard-coded exponent, never a cross-currency conversion (Law 4, AD-4, AD-6). Numerals are `font-mono`, right-aligned. If any figure cannot be formatted (currencies unreadable / unsupported exponent), **fail closed**: drop the structured figures and still render the verdict + provenance + copy (the verdict is a complete server-composed string) — never a partial or bare amount.
- The refusal (`thin-peer-group` or `no-salary-as-of`) is a first-class designed state occupying the **same layout slot** as the answer: render it as a **region with a heading** (reuse the `EmployeeUnavailable`/refusal register — `bg-refusal-fill`, hairline, default radius), **never** `role="alert"`, never error color, never an apology (epic UX; WCAG 2.2 AA). Copy-answer is present on the refusal too — a copied refusal is a full citizen.
- The provenance caption (`body-sm`, `text-ink-muted`) sits directly beneath the computed figure on the answer, naming group size and as-of date: "Based on N peers as of 16 Jul 2026" (`n` + `formatPlainDate(asOf) ?? plainDateToIso(asOf)`, both from the payload). Never separated from its number by more than one line.
- Copy-answer is a ghost icon button (inline-SVG copy glyph, `text-ink-faint hover:text-primary`, no border/fill) with a real accessible name (`aria-label="Copy answer"`, glyph `aria-hidden`). On click it writes `verdict` to the clipboard and calls `useAnnounce()('Answer copied')` (the existing single `aria-live="polite"` region in `src/ui/announcer.tsx`, not remounted). Clipboard failure is caught and total — never throws, never a modal/alert dialog.
- Pure UI logic (arm selection, money/date formatting, provenance/figure assembly, fail-closed decision) lives in `src/ui/peer-comparison-vm.ts` and is unit-tested in `tests/ui/peer-comparison.test.ts` under Vitest **node** env — no jsdom, no React Testing Library. The `.tsx` files decide nothing.
- `asOf` passed to the read is the page's existing `today` (`systemClock.todayUtc()` read once at the boundary), matching the sibling `getEmployee`/`getSalaryTimeline` reads (Law 6). `deps = employeeReadDeps()` already satisfies `PeerComparisonDeps` — reuse it, no wiring change.

**Block If:**
- Rendering requires a field the finalized payload does not carry (it should not: verdict, distancePct, n, currency, peerMedian, spread, asOf are all present; the peer-group **display labels** are already inside the verdict sentence — see Design Notes).
- The DESIGN source mandates a color-only up/down or outlier signal the token system cannot express (it cannot — direction rides the signed number and the verdict's direction word).

**Never:**
- No change to `getPeerComparison`, `comparePeers`, `composeVerdict`, `resolveCurrentSalary`, any port, adapter, Server Action, or Route Handler; no second verdict sentence; no statistic (median/distance/spread/count) recomputed in `src/ui` or the DB.
- No outlier / threshold / "in range" status badge and no threshold read on this surface — outlier flagging is CAP-6/7; the threshold is never read here (project-context Conventions). CAP-5 shows only the signed distance, never a pass/fail verdict.
- No `Date.now()`/`new Date()`/timezone read in `src/ui` (or anywhere inward); no float arithmetic; no raw `bigint`/decimal-string or bare amount crossing into a prop or the DOM.
- No peer-group index/browse surface, no as-of URL-param control on this page, no widening of a thin group, no re-resolving currency from `employee.country` (AD-6). No `role="alert"`, no JS `alert/confirm/prompt`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Answer, peers ≥ 5 | `{ kind:'answer', comparison }`, currencies resolvable | Answer card: verdict sentence; peer-median, range (`min – max`), and signed `distancePct` figures (mono, right-aligned); provenance "Based on N peers as of DATE"; copy button | none |
| Answer, distance sign | `distancePct` `"-8.0"` / `"0.0"` / `"20.5"` | Rendered verbatim with `%` (`-8.0%` / `0.0%` / `20.5%`); direction word carried by the unmodified verdict | none |
| Thin-peer-group refusal | `{ kind:'refusal', refusal:{reason:'thin-peer-group', counts:{n:3}, verdict, ...} }` | Refusal panel (region+heading, `bg-refusal-fill`): the verdict naming the count; copy button present | none (refusal is data) |
| No-salary-as-of refusal | `{ kind:'refusal', refusal:{reason:'no-salary-as-of', verdict, asOf} }` | Same refusal panel; verdict names subject + asOf; no figures, no provenance | none |
| Currencies unreadable | `answer` but `options.kind !== 'options'` (or format lookup fails) | Fail closed: verdict + provenance + copy shown; structured money figures omitted; no bare/raw amount | none |
| Repository unreadable | `getPeerComparison` → `unavailable` | `EmployeeUnavailable` "unreadable" region (distinct from a refusal) | return value, not a throw |
| Defensive not-found | `getPeerComparison` → `not-found` (race after `getEmployee` resolved) | Same "unreadable" region; page does not crash | return value, not a throw |
| Copy on answer or refusal | user activates copy button | `verdict` written to clipboard verbatim; `announce('Answer copied')`; identical text re-announces | clipboard reject caught; total, no dialog |

</intent-contract>

## Code Map

- `src/app/employees/[id]/page.tsx` -- the RSC to extend: already reads `today` (`systemClock.todayUtc()`), `deps = employeeReadDeps()`, `getEmployee`, `loadEmployeeFormOptions` (→ `options`, source of `currencies`), `getSalaryTimeline`; renders identity + timeline siblings in a fragment. Add the peer read + card as a third sibling. `deps` already satisfies `PeerComparisonDeps`.
- `src/application/use-cases/peer-comparison.ts` -- `getPeerComparison(deps, employeeId, asOf)`; the finalized `GetPeerComparisonResult` / `PeerComparison` / `PeerRefusal` consumed unmodified (see Design Notes for exact shape).
- `src/domain/money.ts` -- `formatMoney(money, format): string | null`, `fromBoundaryMoney(BoundaryMoney): Money | null`, `isSupportedExponent`, `CurrencyFormat`, `BoundaryMoney`. The one money formatter.
- `src/domain/plain-date.ts` -- `formatPlainDate(date): string | null`, `plainDateToIso(date): string`, `PlainDate`. Date display idiom (`formatPlainDate(d) ?? plainDateToIso(d)`).
- `src/ui/salary-timeline-vm.ts` + `src/ui/salary-timeline.tsx` -- the pure-`-vm` + presentational-`.tsx` pattern to mirror (fail-closed withholding, `import type`, module-level statement consts).
- `src/ui/employee-unavailable.tsx` -- `EmployeeUnavailable({ id, heading, statement })` region (`bg-refusal-fill`, hairline, region+heading, not `role="alert"`); reuse for the `unavailable`/`not-found` arms with a distinct `id`.
- `src/ui/announcer.tsx` -- `useAnnounce(): (message: string) => void`, the ONE app-level `aria-live="polite"` region; the copy button's "Answer copied" mechanism.
- `src/ui/as-of-control.tsx` -- `"use client"` + `useAnnounce()` (inside a transition) precedent; `CalendarGlyph` inline-SVG idiom to mirror for the copy glyph (`stroke="currentColor"`, `aria-hidden`).
- `docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/DESIGN.md` (§ Components: refusal-panel, provenance-caption, copy-answer, peer card) + `imports/stitch/screen-03-employee-detail.html` -- token names, radius, mono/right-align rules.

**Added by this story:**
- `src/ui/peer-comparison-vm.ts` -- pure `buildPeerComparison(result, currencies)` → `PeerComparisonVM` union.
- `src/ui/peer-comparison.tsx` -- presentational `PeerComparison` (answer card / refusal panel), server component.
- `src/ui/copy-answer.tsx` -- `"use client"` ghost copy button (clipboard + `useAnnounce`).
- `tests/ui/peer-comparison.test.ts` -- unit tests for the builder.

**Extended by this story:**
- `src/app/employees/[id]/page.tsx` -- peer read + card section (third fragment sibling).

## Tasks & Acceptance

**Execution:**
- [x] `tests/ui/peer-comparison.test.ts` -- assert `buildPeerComparison` across the I/O matrix (test-first, red): `answer` with resolvable currencies → `{ kind:'answer', verdict, provenanceText:'Based on N peers as of DATE', figures:{ peerMedianText, rangeText:'MIN – MAX', distanceText:'<distancePct>%' } }` where each money text = `formatMoney(fromBoundaryMoney(field), formatFor(currency))` and `verdict` is passed through byte-identical; distance verbatim (`-8.0%`/`0.0%`/`20.5%`); `answer` with empty/failing currencies → `figures: null`, verdict + provenance still present (fail closed, no bare amount); `thin-peer-group` and `no-salary-as-of` → `{ kind:'refusal', verdict }` (verdict unmodified); `not-found`/`unavailable` → `{ kind:'unreadable', heading, statement }`; determinism (same input → same output); no `Date`/`Math.random`/I/O.
- [x] `src/ui/peer-comparison-vm.ts` -- implement pure `buildPeerComparison(result: GetPeerComparisonResult, currencies: readonly CurrencyFormat[]): PeerComparisonVM`. Select the arm; for `answer` build `provenanceText` and `figures` (resolve `CurrencyFormat` by `comparison.currency`; `figures: null` if median/min/max cannot format); carry `verdict` unmodified on answer + refusal; map `not-found`/`unavailable` to `unreadable` with the module-level heading/statement consts. `import type` for payload/format types; import only pure domain functions. Total, no `Date`/random/I/O.
- [x] `src/ui/copy-answer.tsx` -- `"use client"` `CopyAnswer({ verdict }: { verdict: string })`: a ghost `<button aria-label="Copy answer">` with an inline-SVG copy glyph (`aria-hidden`, `stroke="currentColor"`, `text-ink-faint hover:text-primary`, no border/fill). `onClick`: `try { await navigator.clipboard.writeText(verdict); announce('Answer copied'); } catch { /* total; optional muted failure announce */ }` using `useAnnounce()`. No JS dialog. No prop beyond `verdict`.
- [x] `src/ui/peer-comparison.tsx` -- presentational `PeerComparison({ vm })` server component. `answer`: `<section aria-labelledby="peer-comparison-heading" className="mt-4 rounded border border-border-hairline bg-surface-card p-4">` with a header row (`flex items-center justify-between`) — caps `<h2 id="peer-comparison-heading" className="text-label-caps text-ink-muted uppercase">Peer comparison</h2>` + `<CopyAnswer verdict={vm.verdict} />`; the verdict sentence (`text-body-md text-ink`); when `figures` present, the peer-median / range / distance rows (label `text-label-caps text-ink-muted`, figure `font-mono text-number-md text-ink` right-aligned); provenance caption (`text-body-sm text-ink-muted`). `refusal`: the refusal-panel register (`bg-refusal-fill`, hairline, region+heading, not `role="alert"`) rendering the verdict, with `<CopyAnswer>` in the header. Semantic tokens only, light + dark, no hex, no shadow.
- [x] `src/app/employees/[id]/page.tsx` -- after `timeline`, call `const peer = await getPeerComparison(deps, id, today)`; add a third sibling section: `peer.kind === 'unavailable' || peer.kind === 'not-found'` → `<EmployeeUnavailable id="peer-comparison-unavailable-heading" heading=… statement=… />`; else `<PeerComparison vm={buildPeerComparison(peer, options.kind === 'options' ? options.options.currencies : [])} />`. Reuses in-scope `deps`/`today`/`options`; adds nothing to the contract.

**Acceptance Criteria:**
- Given an employee whose `(role, level, country)` peer group has ≥ 5 in-population members, when the detail page renders, then a peer-comparison card shows the verdict sentence, the peer-median and min–max range (mono, right-aligned, each with its currency via `formatMoney`), the signed `distancePct` (`-8.0%`/`0.0%`/`20.5%`), and a "Based on N peers as of DATE" provenance caption — no figure recomputed in the UI or DB.
- Given a peer group below 5 (or a subject with no salary as of today), when the page renders, then the peer-comparison slot shows a refusal region with a heading (never `role="alert"`, never error color) rendering the payload's `verdict` verbatim (naming the count, or the subject + as-of), with the copy button present.
- Given `getPeerComparison` returns `unavailable` (or defensively `not-found`), when the page renders, then an "unreadable" region appears — visibly distinct from a refusal — and nothing throws.
- Given the reference currencies cannot be read (or a currency has no supported format), when an answer renders, then the structured money figures are withheld while the verdict + provenance + copy still render, and no bare or raw amount is shown.
- Given the user activates copy-answer on either an answer or a refusal, then the payload's `verdict` string is written to the clipboard byte-for-byte and "Answer copied" is announced via the single polite live region; a clipboard failure is swallowed without a crash or dialog.
- Given `src/ui` is searched after this story, then it contains no `Date.now()`/`new Date()`/timezone read and no float arithmetic; `getPeerComparison` and all ports/adapters/prisma are unchanged (`git diff` touches no `src/application`, `src/adapters`, `prisma`).
- Given the gates run, then lint, typecheck, import-boundary, unit tests (incl. the new `tests/ui/peer-comparison.test.ts`), the axe a11y pass, coverage floor, and `next build` are all green; each failing test appears in a commit before the code that satisfies it.

## Design Notes

**The verdict is the spine; figures are honest formatting, not re-derivation.** Every number the card shows already exists in the payload: `verdict` (server-composed sentence, carries the peer-group **display labels** — "Software Engineer · L4 · India" — the distance word, the median, and the as-of), `distancePct` (pre-formatted signed one-decimal string), `n`, `currency`, and the `BoundaryMoney` figures. The UI recomputes nothing (Law 2/8); it runs `formatMoney(fromBoundaryMoney(field), format)` to turn already-computed minor units into display text — the same move `salary-timeline-vm` makes. Because the payload's `peerGroup` carries **codes** (not labels) while the verdict already carries the human labels, the card does **not** render a separate structured peer-group label line (which would need reference-label resolution the UI can't cleanly do); the verdict is where the group reads in words, and the provenance caption uses only `n` + `asOf`.

**No outlier badge here.** DESIGN's mock shows an outlier/status badge, but that is CAP-6/7 (threshold-driven) — CAP-5 never reads the threshold and never renders a pass/fail. The signed `distancePct` is shown as a neutral figure; the direction ("under"/"over"/"at the peer median") is carried by the unmodified verdict, not by color.

**Fail-closed on money.** If `options.kind !== 'options'` (reference read failed) or any of median/min/max cannot format, `figures` is `null` and the card degrades to verdict + provenance + copy. The verdict is a complete server-side string (the use-case returns `unavailable`, not a broken sentence, if the domain could not compose it), so it is always safe to show; a raw/bare amount is never printed.

```ts
// view-model (src/ui/peer-comparison-vm.ts) — the component consumes this
type PeerFigures = {
  readonly peerMedianText: string;   // formatMoney(fromBoundaryMoney(peerMedian), format)
  readonly rangeText: string;        // `${minText} – ${maxText}` (en dash U+2013)
  readonly distanceText: string;     // `${comparison.distancePct}%`  → "-8.0%" | "0.0%" | "20.5%"
};
type PeerComparisonVM =
  | { kind: 'answer'; verdict: string; provenanceText: string; figures: PeerFigures | null }
  | { kind: 'refusal'; verdict: string }
  | { kind: 'unreadable'; heading: string; statement: string };
```

**Copy-answer is the first clipboard client island.** It receives only `verdict` and copies it verbatim — no assembly, no derivation, so it needs no unit test of its own (the `.tsx` decides nothing; the VM is what's tested). It mirrors `as-of-control.tsx` for the `"use client"` + `useAnnounce()` pattern and the inline-SVG glyph idiom.

## Verification

**Commands:**
- `npm run lint` -- expected: clean, incl. import-boundary and `no-hex` token zones.
- `npm run typecheck` -- expected: no errors (payload consumed unmodified).
- `npm run test` -- expected: all green, incl. the new `tests/ui/peer-comparison.test.ts` and the untouched suites.
- `npm run test:a11y` -- expected: axe green on the employee detail surface (answer + refusal states).
- `npm run test:coverage` -- expected: domain 100% / application ≥ 90% floors still pass (this story adds no domain/application code).
- `npm run build` -- expected: succeeds; `/employees/[id]` builds clean.

**Manual checks:**
- The copy button has an accessible name ("Copy answer"), the glyph is `aria-hidden`, and activating it announces via the single `#app-announcer` region without remounting it.
- Direction is legible in grayscale (signed number + verdict word); no red/green.
- `git diff --name-only` touches only the four new `src/ui`/`tests/ui` files and `src/app/employees/[id]/page.tsx` — no `src/application`, `src/adapters`, or `prisma`.

## Spec Change Log

_No bad_spec loopback occurred — empty._

## Review Triage Log

### 2026-07-23 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 1: (high 0, medium 0, low 1)
- reject: 5
- addressed_findings:
  - `[low]` `[patch]` Copy-answer button was a bare 16×16 glyph (no padding) that met WCAG 2.2 AA § 2.5.8 Target Size only via the undocumented-spacing exception, and it styled `hover` but not keyboard `focus`. Since the peer card is not covered by the axe gate (the a11y route renders `notFound()` before the card), nothing would catch a regression. Fixed `src/ui/copy-answer.tsx` — `-m-1 rounded p-1` grows the hit area to 24×24 while keeping the glyph visually flush, and `focus-visible:text-primary` mirrors the hover color cue. No behavior/markup-semantics change; typecheck, lint, and the full 1236-test suite stayed green.
- notes: Blind Hunter (adversarial-general) + Edge Case Hunter, deduplicated. No functional defect found: payload consumed unmodified (all `import type`, no port touched), verdict passed byte-for-byte, money fails closed to `figures: null` through every path (empty currencies, absent code, unsupported exponent, non-canonical amount, one-of-three figures), determinism/purity held (no `Date`/random/float in `src/ui`), refusal is a region-with-heading not `role="alert"`, no bare/raw amount can reach the DOM, every token exists. Deferred (1, low, logged to `deferred-work.md`): the detail page awaits its independent reads (timeline + peer comparison) sequentially rather than under one `Promise.all` — a pre-existing page-wide serial-read pattern this story extends by one hop, not a defect it caused. Rejected (5): provenance date not wrapped in `<time>`/mono (DESIGN specifies a prose caption; the mono-numeral law targets the data figures, which are mono); the VM's `unreadable` arm is unreachable dead code (spec-intended totality over the union; Edge Case Hunter confirmed NO live duplicate-id bug — the page short-circuits before the component arm can fire); `aria-label="Copy answer"` fixed on refusals (spec-sanctioned — a refusal is a first-class answer); no per-figure currency-mismatch unit test (guarded by `formatMoney`, proven fail-closed via four other paths, unreachable under the single-currency invariant); `formatPlainDate` ignores a bad day/year (a pre-existing domain-function limitation outside the diff, unreachable via the real boundary where `asOf` is the server-validated `today`).

## Auto Run Result

Status: **done**

### Summary
Implemented the CAP-5 peer-comparison surface on the employee detail page — the card, the refusal panel, the provenance caption, and the copy-answer affordance — consuming story 6-1's finalized `getPeerComparison` payload **unmodified** (Law 7). An HR manager can now see where an employee sits relative to `(role, level, country)` peers: the composed verdict sentence, the peer median and min–max range (each with its currency), the signed distance, and a "Based on N peers as of DATE" caption — or a dignified refusal (thin group naming the count, or "no salary as of D") in the same layout slot, never `role="alert"`, never widening the group. A ghost copy button copies the ONE verdict sentence verbatim on both answer and refusal and announces "Answer copied" through the app's single polite live region. The UI re-derives no statistic — it only formats the money/date the domain already computed, and fails closed to verdict + provenance + copy if a currency cannot be read.

### Files changed
- `src/ui/peer-comparison-vm.ts` (new) -- pure, total `buildPeerComparison(result, currencies)` → `PeerComparisonVM`; selects the arm, formats money via the ONE `formatMoney(fromBoundaryMoney(...))` (`CurrencyFormat` resolved by the payload's own `currency`, AD-6), builds the provenance caption from `n` + `asOf`, carries `verdict` byte-for-byte, and withholds the whole `figures` object (never a partial/bare amount) when any money cannot be read.
- `src/ui/copy-answer.tsx` (new) -- `"use client"` ghost copy button; `navigator.clipboard.writeText(verdict)` + `useAnnounce('Answer copied')`, total `try/catch` (muted failure announce, no throw, no dialog); inline-SVG glyph `aria-hidden` with `aria-label="Copy answer"`; 24×24 hit area, hover + focus-visible cue.
- `src/ui/peer-comparison.tsx` (new) -- presentational server component; answer card (caps heading + copy, verdict, mono right-aligned peer-median/range/distance rows, provenance caption; figures withheld when null), refusal panel (`bg-refusal-fill`, region+heading, never `role="alert"`), and the shared "unreadable" region. No outlier/status badge (CAP-6), no color-only signal, semantic tokens only.
- `src/app/employees/[id]/page.tsx` -- added the CAP-5 read at the page's existing `today` and the card as a third sibling section (`unavailable`/`not-found` → `EmployeeUnavailable`; else `PeerComparison` from the built VM). Reuses in-scope `deps`/`today`/`options`; no backend/port/adapter/prisma change.
- `tests/ui/peer-comparison.test.ts` (new) -- 17 unit cases over the builder's whole I/O matrix (Vitest node env), written test-first (red committed before green).

### Review findings breakdown
- **Patches applied (2, low):** copy-answer target-size (→ 24×24, off the spacing exception) and keyboard `focus-visible` color cue, in one edit.
- **Deferred (1, low):** the page's independent reads run sequentially rather than under one `Promise.all` — a pre-existing page-wide pattern; logged to `deferred-work.md`.
- **Rejected (5):** provenance `<time>`/mono (DESIGN prose caption), dead `unreadable` VM arm (spec-intended totality, no live duplicate-id bug), fixed `aria-label` on refusals (spec-sanctioned), missing per-figure currency-mismatch test (unreachable, already guarded), `formatPlainDate` day/year gap (pre-existing domain limitation outside the diff).

### Verification performed
- `npm run test` -- 38 files, **1236 passed** (1219 prior + 17 new).
- `npm run typecheck` -- clean (required `npx prisma generate` — the worktree shipped without the generated Prisma client; no source change).
- `npm run lint` -- clean (import-boundary + no-hex).
- `npm run test:a11y` -- 20/20 axe green (light + dark); the peer card's live states are not directly axe-scanned (the a11y route renders `notFound()` before the card), but the card reuses already-audited registers (`surface-card`/`refusal-fill`/caps heading).
- `npm run build` (`next build`) -- succeeds; `/employees/[id]` builds clean. (Build/a11y needed the temporary `turbopack.root` repoint story 5-2 documented; done and reverted — no committed config change.)
- `git diff --name-only` since baseline touches only the four new files + `page.tsx` (+ this spec) — no `src/application`, `src/adapters`, or `prisma`.

### Residual risks
- The peer card's populated answer/refusal render paths are not unit-tested (project constraint: no jsdom/RTL) and not directly axe-scanned; the markup-only `.tsx` sits over a fully unit-tested pure view-model, and its registers are audited elsewhere.
- The as-of-current reads on the detail page run sequentially (deferred) — a latency micro-cost, not a correctness issue.
- `test:coverage`/`test:mutation` were not re-run — this story adds no `src/domain`/`src/application` code, so the floors and mutation scope are unchanged; `src/ui` is outside both gates by configuration.
