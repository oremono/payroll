---
title: 'Gender Gap — UI (CAP-7, story 8-2)'
type: 'feature'
created: '2026-07-24'
status: 'done'
baseline_revision: '8f9c6cd8176e4d3be8a958f0bf0a65ca190d8500'
final_revision: '083e1e4e93e164729b78bacdeacb634dcea320b3'
review_loop_iteration: 0
followup_review_recommended: false # clean review pass — 0 patches, 0 bad_spec; only 3 low/cosmetic rejects, no code changed
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/docs/implementation-artifacts/epic-8-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Story 8-1 finalized the CAP-7 read (`getGenderGap` → `answer | refusal | not-found | unavailable`, each arm carrying a server-composed `verdict` sentence), but nothing renders it. The employee detail page (`src/app/employees/[id]/page.tsx`) shows identity, the salary timeline, and the CAP-5 peer-comparison card, but an HR manager still cannot see whether men and women in the same `(role, level, country)` peer group are paid differently, nor read the dignified refusal a gender-thin group earns.

**Approach:** Add the gender-gap surface as a fourth sibling section on the employee detail page, consuming 8-1's finalized `GetGenderGapResult` payload **unmodified** (Law 7), exactly mirroring the shipped CAP-5 pattern. A pure `src/ui/gender-gap-vm.ts` builder turns the payload union into a view-model (verdict sentence, provenance caption, and — for an answer — the male-median / female-median / gap figures formatted from the payload's already-computed values). A presentational `src/ui/gender-gap.tsx` renders the answer card and the refusal panel in the same layout slot, reusing the peer-comparison card register and the existing `CopyAnswer` island. The page calls `getGenderGap(deps, id, today)` and renders the arms. No backend, port, adapter, Server Action, or contract change.

## Boundaries & Constraints

**Always:**
- Consume the finalized `GetGenderGapResult` **unmodified**; add no field to the payload and no method to any port (Law 7). Re-derive **no statistic** — `verdict`, `gapPct`, `maleN`, `femaleN`, `currency`, `maleMedian`, `femaleMedian`, `counts`, `shortGender` all arrive computed (Laws 2 & 8). The UI only *formats* money and dates and *selects* the arm to render.
- The `verdict` string is the ONE composed sentence (`src/domain/verdict.ts`), rendered by the card and copied by `CopyAnswer` **byte-for-byte unmodified** — never recomposed, reworded, or re-cased (Law 8). The answer card AND the refusal panel both carry and render their `verdict`.
- Money figures (male median, female median) render through the ONE money formatter (`formatMoney(fromBoundaryMoney(field), format)`) with the `CurrencyFormat` looked up by the payload's `currency` code from the reference `currencies` list — never a bare number, never a raw `bigint`/decimal string surfaced, never a hard-coded exponent, never a cross-currency conversion (Law 4, AD-4, AD-6). Numerals are `font-mono`, right-aligned. If any figure cannot be formatted (currencies unreadable / unsupported exponent), **fail closed**: drop the whole `figures` object and still render the verdict + provenance + copy (the verdict is a complete server-composed string) — never a partial or bare amount.
- The `gapPct` renders verbatim with a `%` suffix (`"8.0"`→`8.0%`, `"-8.7"`→`-8.7%`, `"0.0"`→`0.0%`); direction (men paid more / women paid more / parity) is carried by the unmodified verdict word, **never by color alone**.
- The refusal (`reason:'insufficient-gender'`) is a first-class designed state occupying the **same layout slot** as the answer: render it as a **region with a heading** in the refusal register (`bg-refusal-fill`, hairline, default radius), **never** `role="alert"`, never error/red color, never an apology (epic UX; WCAG 2.2 AA). The verdict already names both counts and which gender is short; `CopyAnswer` is present on the refusal too — a copied refusal is a full citizen.
- The provenance caption (`text-body-sm`, `text-ink-muted`) sits directly beneath the answer's figures, naming both gender counts and the as-of date: "Based on N men and M women as of 16 Jul 2026" (`maleN`, `femaleN` + `formatPlainDate(asOf) ?? plainDateToIso(asOf)`, all from the payload). Never separated from its figures by more than one line.
- Reuse the existing `CopyAnswer` island (`src/ui/copy-answer.tsx`) unchanged (`aria-label="Copy answer"`, writes `verdict` to the clipboard, announces "Answer copied" via the single `useAnnounce()` polite live region; clipboard failure caught and total, no dialog) and the existing `EmployeeUnavailable` region for the `unavailable`/`not-found` arms.
- Pure UI logic (arm selection, money/date formatting, provenance/figure assembly, fail-closed decision) lives in `src/ui/gender-gap-vm.ts` and is unit-tested in `tests/ui/gender-gap.test.ts` under Vitest **node** env — no jsdom, no React Testing Library. The `.tsx` file decides nothing.
- `asOf` passed to the read is the page's existing `today` (read once at the boundary), matching the sibling `getSalaryTimeline`/`getPeerComparison` reads (Law 6). Reuse the in-scope `deps` (it structurally satisfies `GenderGapDeps`, as it already does `PeerComparisonDeps`) — no wiring change and no new import.

**Block If:**
- Rendering requires a field the finalized payload does not carry (it should not: `verdict`, `gapPct`, `maleN`, `femaleN`, `currency`, `maleMedian`, `femaleMedian`, `asOf`, `counts`, `shortGender` are all present; the peer-group **display labels** are already inside the verdict sentence).
- The DESIGN source mandates a color-only direction/parity signal the token system cannot express (it cannot — direction rides the signed `gapPct` and the verdict's direction word).

**Never:**
- No change to `getGenderGap`, `computeGenderGap`, `composeVerdict`, `findGenderGapPopulation`, any port, adapter, Server Action, Route Handler, or Prisma schema; no second verdict sentence; no statistic (median/gap/count) recomputed in `src/ui` or the DB.
- No whole-group median/spread rendered inside the gender-gap card — that stays with the CAP-5 peer-comparison card already on the page (AD-9); the gender-gap card adds only the gender split.
- No CSV export, no outlier/threshold badge, no amber signal (amber is CAP-6-only), no sidebar entry, no browse index, no as-of URL-param control on this page, no widening of a gender-thin group, no re-resolving currency from `employee.country` (AD-6).
- No `Date.now()`/`new Date()`/timezone read in `src/ui` (or anywhere inward); no float arithmetic; no raw `bigint`/decimal-string or bare amount crossing into a prop or the DOM. No `role="alert"`, no JS `alert/confirm/prompt`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Answer, men higher | `{ kind:'answer', gap }`, `gapPct:"8.0"`, currencies resolvable | Answer card: verdict; male-median, female-median (mono, right-aligned, each with its currency), gap `8.0%`; provenance "Based on N men and M women as of DATE"; copy button | none |
| Answer, women higher / parity | `gapPct:"-8.7"` / `"0.0"` | Rendered verbatim with `%` (`-8.7%` / `0.0%`); direction word carried by the unmodified verdict | none |
| Insufficient-gender refusal | `{ kind:'refusal', refusal:{ reason:'insufficient-gender', counts:{male,female}, shortGender, verdict, ... } }` | Refusal panel (region+heading, `bg-refusal-fill`): the verdict naming both counts + the short gender; copy button present; no figures, no provenance | none (refusal is data) |
| Currencies unreadable | `answer` but currencies empty / a median cannot format | Fail closed: verdict + provenance + copy shown; structured money figures omitted; no bare/raw amount | none |
| Repository unreadable | `getGenderGap` → `unavailable` | `EmployeeUnavailable` "unreadable" region (distinct from a refusal) | return value, not a throw |
| Defensive not-found | `getGenderGap` → `not-found` (race after `getEmployee` resolved) | Same "unreadable" region; page does not crash | return value, not a throw |
| Copy on answer or refusal | user activates copy button | `verdict` written to clipboard verbatim; `announce('Answer copied')`; identical text re-announces | clipboard reject caught; total, no dialog |

</intent-contract>

## Code Map

- `src/app/employees/[id]/page.tsx` -- the RSC to extend: already reads `today`, `deps = employeeReadDeps()`, `options` (source of `currencies`), `getEmployee`, `getSalaryTimeline`, `getPeerComparison` and renders identity + timeline + peer-comparison siblings in a fragment. Add the CAP-7 read + card as a fourth sibling after the peer block. `deps` already satisfies `GenderGapDeps`.
- `src/application/use-cases/gender-gap.ts` -- `getGenderGap(deps: GenderGapDeps, employeeId, asOf)`; the finalized `GetGenderGapResult` (arms `{kind:'answer', gap}` / `{kind:'refusal', refusal}` / `not-found` / `unavailable`), `GenderGap`, `GenderGapRefusal`, `PeerGroupProvenance` consumed unmodified (see Design Notes for exact shape).
- `src/ui/peer-comparison-vm.ts` + `src/ui/peer-comparison.tsx` -- the direct sibling precedent to mirror (VM union, fail-closed `figures: null`, `unreadable` arm + `*_UNREADABLE_HEADING`/`_STATEMENT` consts, `import type`, module-level statement consts, card/refusal register).
- `src/ui/copy-answer.tsx` -- `"use client"` `CopyAnswer({ verdict })` ghost copy button; reuse unchanged.
- `src/ui/employee-unavailable.tsx` -- `EmployeeUnavailable({ id, heading, statement })` region (`bg-refusal-fill`, hairline, region+heading, not `role="alert"`); reuse for the `unavailable`/`not-found` arms with a distinct `id`.
- `src/ui/announcer.tsx` -- `useAnnounce()`; already wired into `CopyAnswer` (no direct use here).
- `src/domain/money.ts` -- `formatMoney`, `fromBoundaryMoney`, `CurrencyFormat`, `BoundaryMoney`, `Money`. The one money formatter.
- `src/domain/plain-date.ts` -- `formatPlainDate`, `plainDateToIso`, `PlainDate`. Date display idiom (`formatPlainDate(d) ?? plainDateToIso(d)`).
- `docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/DESIGN.md` (§§ surfaces/refusal) + `imports/stitch/screen-03b-refusal-tomas.html`, `screen-04-peer-group.html` -- token names, refusal register, mono/right-align rules. No distinct gender-gap register exists — reuse the peer-comparison card register.

**Added by this story:**
- `src/ui/gender-gap-vm.ts` -- pure `buildGenderGap(result, currencies)` → `GenderGapVM` union + `GENDER_GAP_UNREADABLE_HEADING`/`_STATEMENT`.
- `src/ui/gender-gap.tsx` -- presentational `GenderGapCard({ vm })` server component (answer card / refusal panel).
- `tests/ui/gender-gap.test.ts` -- unit tests for the builder.

**Extended by this story:**
- `src/app/employees/[id]/page.tsx` -- CAP-7 read + card section (fourth fragment sibling).

## Tasks & Acceptance

**Execution:**
- [x] `tests/ui/gender-gap.test.ts` -- assert `buildGenderGap` across the I/O matrix (test-first, red before green): `answer` with resolvable currencies → `{ kind:'answer', verdict, provenanceText:'Based on N men and M women as of DATE', figures:{ maleMedianText, femaleMedianText, gapText:'<gapPct>%' } }` where each money text = `formatMoney(fromBoundaryMoney(field), formatFor(currency))` and `verdict` passes through byte-identical; `gapPct` rendered verbatim (`8.0%`/`-8.7%`/`0.0%`); `answer` with empty/failing currencies (or an unsupported-exponent median) → `figures: null`, verdict + provenance still present (fail closed, no bare amount); `refusal` (any `shortGender`) → `{ kind:'refusal', verdict }` (verdict unmodified); `not-found`/`unavailable` → `{ kind:'unreadable', heading, statement }`; determinism (same input → same output); no `Date`/`Math.random`/I/O.
- [x] `src/ui/gender-gap-vm.ts` -- implement pure `buildGenderGap(result: GetGenderGapResult, currencies: readonly CurrencyFormat[]): GenderGapVM`. Select the arm; for `answer` resolve `CurrencyFormat` by `gap.currency`, build `provenanceText` from `maleN`/`femaleN`/`asOf` and `figures` (`maleMedianText`, `femaleMedianText`, `gapText = \`${gap.gapPct}%\``; `figures: null` if either median cannot format or the currency is unresolvable); carry `verdict` unmodified on answer + refusal; map `not-found`/`unavailable` to `unreadable` with the module-level heading/statement consts. `import type` for payload/format types; import only pure domain functions. Total, no `Date`/random/I/O.
- [x] `src/ui/gender-gap.tsx` -- presentational `GenderGapCard({ vm }: { readonly vm: GenderGapVM })` server component, mirroring `PeerComparison`. `answer`: a `<section aria-labelledby="gender-gap-heading">` in the card register (`bg-surface-card`, hairline, rounded) with a header row — caps `<h2 id="gender-gap-heading">Gender pay gap</h2>` + `<CopyAnswer verdict={vm.verdict} />`; the verdict sentence (`text-body-md text-ink`); when `figures` present, the male-median / female-median / gap rows in a `<dl grid grid-cols-[max-content_1fr]>` (label `text-label-caps text-ink-muted`, figure `font-mono text-number-md text-ink` right-aligned); provenance caption (`text-body-sm text-ink-muted`). `refusal`: the refusal-panel register (`bg-refusal-fill`, hairline, region+heading, not `role="alert"`) rendering the verdict, with `<CopyAnswer>` in the header. `unreadable`: reuse the `EmployeeUnavailable`-style region. Semantic tokens only, light + dark, no hex, no shadow, no amber, no red/green.
- [x] `src/app/employees/[id]/page.tsx` -- after the `peer` block, call `const genderGap = await getGenderGap(deps, id, today)`; add a fourth sibling section: `genderGap.kind === 'unavailable' || genderGap.kind === 'not-found'` → `<EmployeeUnavailable id="gender-gap-unavailable-heading" heading=… statement=… />`; else `<GenderGapCard vm={buildGenderGap(genderGap, options.kind === 'options' ? options.options.currencies : [])} />`. Reuses in-scope `deps`/`today`/`options`; adds nothing to the contract.

**Acceptance Criteria:**
- Given an employee whose `(role, level, country)` peer group has ≥ 5 in-population men AND ≥ 5 in-population women as of today, when the detail page renders, then a gender-gap card shows the verdict sentence, the male and female medians (mono, right-aligned, each with its currency via `formatMoney`), the signed `gapPct` (`8.0%`/`-8.7%`/`0.0%`), and a "Based on N men and M women as of DATE" provenance caption — no figure recomputed in the UI or DB, and the whole-group median/spread is NOT duplicated here.
- Given either gender has fewer than 5 in-population members, when the page renders, then the gender-gap slot shows a refusal region with a heading (never `role="alert"`, never error color) rendering the payload's `verdict` verbatim (naming both counts and which gender is short), with the copy button present.
- Given `getGenderGap` returns `unavailable` (or defensively `not-found`), when the page renders, then an "unreadable" region appears — visibly distinct from a refusal — and nothing throws.
- Given the reference currencies cannot be read (or a median has an unsupported exponent), when an answer renders, then the structured money figures are withheld while the verdict + provenance + copy still render, and no bare or raw amount is shown.
- Given the user activates copy-answer on either an answer or a refusal, then the payload's `verdict` string is written to the clipboard byte-for-byte and "Answer copied" is announced via the single polite live region; a clipboard failure is swallowed without a crash or dialog.
- Given `src/ui` is searched after this story, then it contains no `Date.now()`/`new Date()`/timezone read and no float arithmetic; `getGenderGap` and all ports/adapters/prisma are unchanged (`git diff` touches no `src/application`, `src/adapters`, `prisma`).
- Given the gates run, then lint (incl. import-boundary + no-hex), typecheck, unit tests (incl. the new `tests/ui/gender-gap.test.ts`), `tokens:check`, and `next build` are all green; each failing test appears in a commit before the code that satisfies it.

## Design Notes

**8-2 is the CAP-7 twin of 6-2.** The shipped `src/ui/peer-comparison-vm.ts` + `peer-comparison.tsx` are the exact structural precedent — same VM union (`answer | refusal | unreadable`), same fail-closed `figures: null` rule, same `CopyAnswer` island, same card/refusal register. The only differences are the payload's shape and which figures render.

**Payload shape (consumed unmodified — from 8-1's finalized contract):**

```ts
type GetGenderGapResult =
  | { readonly kind: 'answer'; readonly gap: GenderGap }        // note: `gap` wrapper (CAP-5 used `comparison`)
  | { readonly kind: 'refusal'; readonly refusal: GenderGapRefusal }
  | { readonly kind: 'not-found' } | { readonly kind: 'unavailable' };
type GenderGap = { employeeId; asOf: PlainDate; peerGroup: PeerGroupProvenance;
  maleN: number; femaleN: number; currency: string;
  maleMedian: BoundaryMoney; femaleMedian: BoundaryMoney; gapPct: string; verdict: string };
type GenderGapRefusal = { reason: 'insufficient-gender'; peerGroup: PeerGroupProvenance;
  counts: { male: number; female: number }; shortGender: 'MALE'|'FEMALE'|'BOTH'; asOf: PlainDate; verdict: string };
```

**View-model the component consumes:**

```ts
type GenderGapFigures = {
  readonly maleMedianText: string;   // formatMoney(fromBoundaryMoney(maleMedian), format)
  readonly femaleMedianText: string; // formatMoney(fromBoundaryMoney(femaleMedian), format)
  readonly gapText: string;          // `${gap.gapPct}%` → "8.0%" | "-8.7%" | "0.0%"
};
type GenderGapVM =
  | { kind: 'answer'; verdict: string; provenanceText: string; figures: GenderGapFigures | null }
  | { kind: 'refusal'; verdict: string }
  | { kind: 'unreadable'; heading: string; statement: string };
```

**The verdict is the spine; figures are honest formatting, not re-derivation.** Every number already exists in the payload (`verdict` carries the peer-group **display labels** and the direction word; `gapPct` is pre-formatted; `maleMedian`/`femaleMedian` are `BoundaryMoney`). The UI recomputes nothing (Law 2/8) — it runs `formatMoney(fromBoundaryMoney(field), format)` on already-computed minor units. Because the payload's `peerGroup` carries **codes** while the verdict carries the human labels, the card renders **no** separate structured group-label line; the provenance caption uses only the two counts + `asOf`.

**No whole-group median/spread here (AD-9).** The CAP-5 peer-comparison card already on the page renders the group median and min–max spread. CAP-7 adds only the gender split — duplicating them would fork the ONE median.

**Fail-closed on money.** If currencies are empty/unreadable or either median cannot format, `figures` is `null` and the card degrades to verdict + provenance + copy. The verdict is a complete server-side string (the use-case returns `unavailable`, not a broken sentence, if the domain could not compose it), so it is always safe to show; a raw/bare amount is never printed.

**Component name.** The presentational component is `GenderGapCard` (not `GenderGap`) to avoid colliding with the use-case's `GenderGap` type.

**a11y note.** The `e2e/accessibility.spec.ts` axe job hits the detail route with NO database, so `getEmployee` → `unavailable` short-circuits before any card renders — the gender-gap card is not directly axe-scanned there (same as the peer card). It must be correct by construction/token-conformance; its registers (`surface-card`/`refusal-fill`/caps heading) are already audited via the peer card. The populated detail is exercised by the `browser-db` e2e job.

## Verification

**Commands:**
- `npm run test` -- expected: all green, incl. the new `tests/ui/gender-gap.test.ts` and the untouched suites.
- `npm run typecheck` -- expected: no errors (payload consumed unmodified).
- `npm run lint` -- expected: clean, incl. import-boundary and `no-hex` token zones.
- `npm run tokens:check` -- expected: clean (no new hex; only existing semantic tokens used).
- `npm run test:a11y` -- expected: axe green (the detail route short-circuits before the cards; parity with the peer card).
- `npm run build` -- expected: succeeds; `/employees/[id]` builds clean.

**Manual checks:**
- Direction is legible in grayscale (signed `gapPct` + verdict word); no red/green, no amber.
- The copy button has an accessible name ("Copy answer") and announces via the single live region.
- `git diff --name-only` touches only the three new `src/ui`/`tests/ui` files and `src/app/employees/[id]/page.tsx` — no `src/application`, `src/adapters`, or `prisma`.

## Spec Change Log

_No bad_spec loopback occurred — empty._

## Review Triage Log

### 2026-07-24 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 3: (high 0, medium 0, low 3)
- addressed_findings:
  - none
- notes: Blind Hunter (adversarial-general) + Edge Case Hunter, deduplicated. Edge Case Hunter returned zero findings — it walked every branch (all four `result.kind` arms; `figures` present vs `null` across every money-failure mode — empty currency list, absent code, unsupported exponent, non-canonical `amountMinor`; the `formatPlainDate` null→ISO fallback; each `shortGender`; the page's `options.kind` gate; the page short-circuit vs the component's own `unreadable` arm — no double render, no runtime id collision) and found each reachable boundary explicitly guarded and failing closed. Blind Hunter found **no** correctness, contract, law, accessibility, or fail-closed defect (payload consumed unmodified — all `import type`, no port/adapter/prisma touched; verdict carried byte-for-byte, proven by the weird-string test; money fails closed to `figures: null` through every path; no `Date`/float/hex/`role="alert"`/color-only signal in `src/ui`; distinct heading ids). Rejected (3, all low/cosmetic): (1) the answer card's figures + provenance restate values the `gender-gap-answer` verdict already spells out in prose (`verdict.ts:198` renders both medians, both counts, and the as-of) — real observation, but a deliberate, spec-mandated, app-wide pattern (verdict = the quotable spine for copy-answer; the mono/right-aligned figures serve scannability + the DESIGN numeric-typography rule), identical in shape to the shipped CAP-5 card; the redundancy is cosmetic, not a defect. (2) the test's main fixture `VERDICT` string doesn't match the real composer output — harmless, since the VM must (and is separately proven to) pass ANY string through unmodified; a synthetic fixture is valid and more robust. (3) `GenderGapCard`'s `unreadable` arm is unreachable on this page (the RSC short-circuits `unavailable`/`not-found` before `buildGenderGap`) — intentional totality over the VM union, mirroring CAP-5, where the identical finding was already rejected in the 6-2 review.

## Auto Run Result

Status: **done**

### Summary
Implemented the CAP-7 gender-pay-gap surface on the employee detail page — the answer card, the gender-thin refusal panel, the provenance caption, and the copy-answer affordance — consuming story 8-1's finalized `getGenderGap` payload **unmodified** (Law 7). Within one `(role, level, country)` peer group, an HR manager now sees the male and female salary medians (each with its currency), the signed one-decimal `gapPct` (`8.0%` = men paid more, `-8.7%` = women paid more, `0.0%` = parity), and a "Based on N men and M women as of DATE" caption — or, when either gender has fewer than 5 in-population members, a dignified refusal in the same layout slot (never `role="alert"`, never widening the group) whose verdict names both counts and which gender is short. A ghost copy button copies the ONE server-composed verdict sentence verbatim on both answer and refusal. The UI re-derives no statistic — it only formats the money/date the domain already computed, resolving the group's own currency (AD-6) and failing closed to verdict + provenance + copy when a currency cannot be read. The gender-gap card adds only the gender split; the whole-group median/spread stays with the CAP-5 peer-comparison card already on the page (AD-9). No backend, port, adapter, Server Action, or Prisma change.

### Files changed
- `src/ui/gender-gap-vm.ts` (new) — pure, total `buildGenderGap(result, currencies)` → `GenderGapVM`; selects the arm, formats both medians via the ONE `formatMoney(fromBoundaryMoney(...))` (`CurrencyFormat` resolved by the payload's own `currency`), builds the provenance caption from `maleN`/`femaleN`/`asOf`, appends `%` to the pre-formatted `gapPct`, carries `verdict` byte-for-byte on answer + refusal, and withholds the whole `figures` object (never a partial/bare amount) when any money cannot be read; plus `GENDER_GAP_UNREADABLE_HEADING`/`_STATEMENT`.
- `src/ui/gender-gap.tsx` (new) — presentational server component `GenderGapCard`; answer card (caps heading + copy, verdict, mono right-aligned male-median/female-median/gap rows in a `<dl>`, provenance caption; figures withheld when null), refusal panel (`bg-refusal-fill`, region+heading, never `role="alert"`), and the shared "unreadable" region. No badge, no amber, no color-only signal, semantic tokens only.
- `src/app/employees/[id]/page.tsx` — added the CAP-7 read at the page's existing `today` and the card as a fourth sibling section (`unavailable`/`not-found` → `EmployeeUnavailable`; else `GenderGapCard` from the built VM). Reuses in-scope `deps`/`today`/`options`; no backend/port/adapter/prisma change.
- `tests/ui/gender-gap.test.ts` (new) — 18 unit cases over the builder's whole I/O matrix (Vitest node env), written test-first (red committed before green).

### Review findings breakdown
- **Patches applied:** none.
- **Deferred:** none.
- **Rejected (3, all low/cosmetic):** answer figures/provenance restate the verdict's prose (deliberate, spec-mandated, app-wide verdict+figures+provenance pattern; mirrors shipped CAP-5); the test's main fixture verdict isn't the real composer string (harmless — the VM passes any string through, separately proven); `GenderGapCard`'s `unreadable` arm is unreachable on this page (intentional totality, rejected identically in the 6-2 review).

### Verification performed
- `npm run test -- tests/ui/gender-gap.test.ts` — RED first (`Cannot find package '@/ui/gender-gap-vm'`), then **18/18 GREEN** after the VM + card landed.
- `npm run test` (full) — **1360 passed / 46 files** (1342 prior + 18 new); no regression.
- `npm run typecheck` — clean (required `npx prisma generate` — the worktree ships without the generated Prisma client; no source change).
- `npm run lint` — clean (import-boundary + no-hex held: `src/ui` imports only domain types + pure domain functions).
- `npm run tokens:check` — clean (no new hex; only existing semantic tokens).
- `npm run build` (`next build`) — succeeds; `/employees/[id]` builds clean (needed the documented temporary `turbopack.root` repoint — the worktree's `node_modules` resolves `next` from the parent repo; applied and reverted, no committed config change).
- `git diff --name-only` since baseline touches only the three new files + `page.tsx` (+ this spec) — no `src/application`, `src/adapters`, or `prisma`.
- `npm run test:a11y` — not run: its Playwright webserver runs a fresh `next build` that hits the same worktree `turbopack.root` constraint without a committed config change. Per parity with the shipped peer card, the detail route short-circuits to `unavailable` (no DB) before any card renders, so the gender-gap card isn't directly axe-scanned there; its registers (`surface-card`/`refusal-fill`/caps heading) are already audited via the peer card, and the populated detail is exercised by the `browser-db` e2e job.

### Residual risks
- The gender-gap card's populated answer/refusal render paths are not unit-tested (project constraint: no jsdom/RTL) and not directly axe-scanned; the markup-only `.tsx` sits over a fully unit-tested pure view-model, and its registers are audited elsewhere.
- `test:a11y` was not executed in this environment (Turbopack workspace-root constraint in the worktree, not a defect of this change); `test:coverage`/`test:mutation` were not re-run — this story adds no `src/domain`/`src/application` code, so the floors and mutation scope are unchanged and `src/ui` is outside both gates by configuration.
