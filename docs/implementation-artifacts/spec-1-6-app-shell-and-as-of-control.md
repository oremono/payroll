---
title: 'Story 1-6: App Shell and As-Of Control'
type: 'feature'
created: '2026-07-19'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/docs/implementation-artifacts/epic-1-context.md'
  - '{project-root}/docs/implementation-artifacts/deferred-work.md'
  - '{project-root}/docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/DESIGN.md'
  - '{project-root}/docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/EXPERIENCE.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Epic 1's closing promise is that "a person can open the deployed app and see the shell", and today `/` is a single unstyled placeholder: no sidebar, no header, no navigation, no as-of control, no landmarks, no skip link. Four Epic-1 obligations are stranded with it — `src/adapters/clock.ts` still throws (AD-11's clock port has no implementation and no consumer), the webfonts DESIGN binds all numerals to are never loaded so `--font-sans`/`--font-mono` render fallbacks, nothing declares `color-scheme` or paints the page canvas so OS dark mode renders a dark island inside a UA-white page, and the "no component ever writes `dark:`" rule is prose in five files and a gate in none.

**Approach:** Build the shell in the root layout — fixed 256px sidebar, fixed 64px header, fluid `main` — over seven placeholder routes, all of it on generated tokens with hand-built primitives and **no shadcn/ui copy-in**. The as-of date lives in the URL search param `asOf`, resolved at the delivery boundary against a real clock port (UTC today) into a plain-date value object, so every surface from here on receives it as a parameter and a bookmarked URL reproduces a view exactly. Changing it pushes a new param inside a transition and announces through a single app-level `aria-live="polite"` region owned by the layout, which is therefore never remounted by the change it reports.

## Boundaries & Constraints

**Always:**
- TDD, red before green, with the failing test and the code that satisfies it in **separate commits** (standing practice, `deferred-work.md`).
- `DESIGN.md` is read-only. No token value is invented, adjusted, or renamed here, and `src/app/tokens.generated.css` is never hand-edited — `npm run tokens:check` must stay green with zero regeneration.
- Every color, size, radius, and type step comes from a token utility (`bg-surface-card`, `text-ink-muted`, `text-number-sm`, `rounded`, `p-container-margin`, `w-64`, `h-16`). No color literal in ANY notation reaches `src/**`, and **no `dark:` variant appears anywhere** — one token name, two values (F-5).
- The as-of date is a **plain-date value object**, never a JS `Date`, never a timestamp, and "today" is the current date in **UTC** obtained only through the clock adapter. `src/domain/**` and `src/application/**` stay free of `Date`, `Date.now`, and any timezone read (AD-11, Law 6).
- Domain and application functions are **total**: a malformed or out-of-range `asOf` param resolves to today, it never throws and never renders an error surface.
- Every form control sits on `surface-card`, which is the one surface where `input-border` clears DESIGN's 3:1 floor (3.09:1; it is 2.96:1 on `surface-base` and 2.82:1 on `surface-tint` — recorded in `deferred-work.md`).
- Exact label strings, in exact order: `Home`, `Employees`, `Gender Insights`, `Payroll Totals`, `Overdue for Review`, `Import`, `Settings` — Settings pinned to the bottom of the sidebar.
- Spec vocabulary verbatim (`as-of date`, `overdue`, `refusal`, `threshold`). `snapshot`, "Snapshot Date", `compaRatio`, `payBand` are banned in code and copy.
- WCAG 2.2 AA is the floor: `nav`/`main` landmarks, a skip-to-content link that precedes the sidebar in DOM order, `aria-current="page"` on the active item, the as-of control as a single named button with visible text and an accessible name, its calendar glyph `aria-hidden`, and axe green on **every** route.
- New source files are kebab-case (`as-of-control.tsx`), types `PascalCase`.

**Block If:**
- A ratified layout would place a form control on `surface-base` or `surface-tint` — that needs a darker `input-border` in `DESIGN.md`, which this story may not amend.
- Any pair in `tests/tokens/contrast.test.ts`'s gated matrix falls below its floor, or `npm run tokens:check` reports drift that is not explained by an intentional DESIGN.md change (there are none here).
- The seven routes above prove insufficient — i.e. a sidebar destination is required that no planning artifact names.

**Never:**
- No `npx shadcn add`, no `components.json`, no `@radix-ui/*`, `react-day-picker`, `date-fns`, `class-variance-authority`, `clsx`, `tailwind-merge`, or `lucide-react`. The picker is a native `<input type="date">` inside a hand-built popover; shadcn copy-in and its token re-pointing move to the first capability form that needs a primitive this story does not build.
- No `next/font`. It generates its own family names (`__Hanken_Grotesk_xxxx`), which `--font-sans`/`--font-mono` — generated from DESIGN.md and drift-gated — cannot name without hand-authoring a token.
- No capability content: no database read, no Prisma import, no Server Action, no Route Handler, no `src/application/use-cases/`, no repository port. Placeholder pages only.
- No `/`-focuses-search shortcut — no search field exists to focus until the Employees capability lands.
- No manual dark-mode toggle, no `.dark` class, no `data-theme`, no theme cookie. System preference only.
- No notification affordance of any kind, no red/green semantics, no shadow, no spinner or progress theater, no celebration copy, no pill radius.
- No jsdom, no `@testing-library/*`, no browser-mode vitest project. Pure logic is unit-tested in the existing node suite; rendered behaviour is tested in Playwright.
- No change to `vitest.config.ts` coverage thresholds or `stryker.config.json` `mutate` globs. New `src/domain` code meets the standing 100% coverage and 100% mutation gates as-is.

## I/O & Edge-Case Matrix

`parsePlainDate` / `formatPlainDate` (`src/domain/plain-date.ts`, pure and total), `resolveAsOf(param, today)` (`src/application/as-of.ts`, pure and total), `toUtcPlainDate(epochMs)` (`src/adapters/clock.ts`).

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No param | `resolveAsOf(undefined, 2026-07-16)` | `2026-07-16` — today is the default | No error expected |
| Valid past date | `resolveAsOf('2026-05-12', 2026-07-16)` | `2026-05-12` | No error expected |
| As-of equals today | `resolveAsOf('2026-07-16', 2026-07-16)` | `2026-07-16` | No error expected |
| Future date | `resolveAsOf('2026-07-17', 2026-07-16)` | `2026-07-16` — a future as-of is meaningless, silently clamped to today | No error expected |
| Wrong shape | `'12-05-2026'`, `'2026-5-12'`, `'2026-05-12T00:00:00Z'`, `''` | today | Returns today; never throws |
| Impossible calendar date | `'2026-02-30'`, `'2026-13-01'`, `'2026-00-10'` | today | Returns today; never throws |
| Leap day, valid | `parsePlainDate('2024-02-29')` | a `PlainDate` | No error expected |
| Leap day, invalid year | `parsePlainDate('2026-02-29')` | `null` | Returns `null`; never throws |
| Repeated param | `?asOf=2026-05-12&asOf=2026-01-01` (array reaches the boundary) | today — an ambiguous param is not a date | Returns today |
| Display format | `formatPlainDate(2026-07-16)` | `'16 Jul 2026'` — zero-padded day, three-letter month | No error expected |
| Display format, single digit | `formatPlainDate(2026-07-01)` | `'01 Jul 2026'` | No error expected |
| Clock, mid-day | `toUtcPlainDate(1752624000000)` | the UTC calendar date of that instant | No error expected |
| Clock, last ms of a UTC day | `toUtcPlainDate` at `…T23:59:59.999Z` | still that UTC date — no local-timezone shift | No error expected |
| Active nav item | `isActiveNavItem('/employees', '/employees')` | `true` | No error expected |
| Non-active nav item | `isActiveNavItem('/employees', '/')` | `false` — exact match only, `/` is not a prefix of everything | No error expected |

</intent-contract>

## Code Map

- `src/app/layout.tsx` -- the composition root. Calls `await connection()` then the clock adapter, renders `<Announcer>` → skip link → `<SidebarNav>` → `<AppHeader today>` → `<main id="main-content">`. Currently a bare `<html><body>{children}</body></html>`.
- `src/app/globals.css` -- add an `@layer base` block: `color-scheme: light dark` on `:root` and the canvas (`background-color: var(--color-surface-base)`, `color: var(--color-ink)`) on `body`. Token **references** only; authoring a token here is forbidden.
- `src/app/page.tsx` -- becomes the Home placeholder. Keeps a `bg-surface-card rounded p-3 text-body-md` paragraph, because `e2e/tokens.spec.ts` reads computed styles off `main p`.
- `src/app/{employees,gender-insights,payroll-totals,overdue,import,settings}/page.tsx` -- **new**, six placeholder routes.
- `src/domain/plain-date.ts` -- **new, pure.** `PlainDate` type, `parsePlainDate`, `formatPlainDate`, `plainDateToIso`, `comparePlainDate`. Held to 100% coverage and 100% mutation score. Copy `money.ts`'s JSDoc law-citation style.
- `src/application/ports/clock.ts` -- **new.** The `Clock` port (`todayUtc(): PlainDate`) AD-11 has been promising since 1-1. First declaration in this directory.
- `src/application/as-of.ts` -- **new, pure.** `resolveAsOf(param, today)` — the whole boundary policy in one total function.
- `src/adapters/clock.ts` -- replace the throwing stub with `toUtcPlainDate(epochMs)` (pure, exported for test) and `systemClock: Clock`. The only `Date` read in the codebase.
- `src/ui/nav-items.ts` -- **new.** The seven `{href, label}` items in order, plus `isActiveNavItem`. Pure, unit-tested.
- `src/ui/sidebar-nav.tsx` -- **new, client.** 256px `<nav aria-label="Primary">`, `aria-current="page"` via `usePathname()`, Settings pinned bottom, brand block that is **not** a heading.
- `src/ui/app-header.tsx` -- **new, client.** 64px header: the page `<h1>` (title derived from `nav-items`) on the left, `<AsOfControl>` right-aligned.
- `src/ui/as-of-control.tsx` -- **new, client.** The named button, the popover, the native date input, `router.push` inside `startTransition`, and the announcement call.
- `src/ui/announcer.tsx` -- **new, client.** Context provider rendering the single app-level `aria-live="polite" aria-atomic="true"` region. Mounted once in the layout, never remounted by an as-of change.
- `src/ui/skip-link.tsx` -- **new.** Visually hidden until focused; targets `#main-content`.
- `eslint.config.mjs` -- add a `dark:` variant selector to the shared color-ban selector list so **all four** blocks that spread it inherit it (flat-config entries replace, they do not merge — see the file's own layering note).
- `tests/domain/plain-date.test.ts`, `tests/application/as-of.test.ts`, `tests/adapters/clock.test.ts`, `tests/ui/nav-items.test.ts` -- **new.** The I/O matrix, red first.
- `tests/tokens/eslint-config.test.ts` -- extend: a `dark:` class string is rejected in `src/**` and accepted in `scripts/`/`tests/`.
- `e2e/shell.spec.ts` -- **new.** Landmarks, skip link, `aria-current` across routes, the as-of round trip, live-region stability, focus return.
- `e2e/accessibility.spec.ts` -- parametrize the axe pass over all seven routes.
- `e2e/tokens.spec.ts` -- retarget the three assertions the shell moves: `main` padding is now 24px (`p-container-margin`), the mono assertion reads the header's as-of `<time>` (there is no numeral inside `main` any more), and a new assertion proves the canvas (`body`) repaints under dark. The `h1` assertions keep passing **only if** the header's page-title `h1` carries `text-headline-lg` — it is the first `h1` in DOM order, and the sidebar brand is deliberately not a heading.
- `package.json` -- `@fontsource/hanken-grotesk` + `@fontsource/jetbrains-mono` (both `5.3.0`, static packages that declare the **real** family names, so the generated font stacks resolve unchanged); add `e2e/shell.spec.ts` to `test:browser`.
- `src/ui/README.md`, `src/app/README.md` -- drop the "empty seam / lands in 1-6" language; record the shell contract and the no-shadcn decision.
- `docs/implementation-artifacts/{deferred-work.md,sprint-status.yaml}` -- ledger entries and status.

## Tasks & Acceptance

**Execution:**
- [ ] `tests/domain/plain-date.test.ts` -- failing suite over every plain-date row of the I/O matrix (parse shapes, impossible dates, leap years, format padding, compare) -- Law 1: red is committed before `plain-date.ts` exists.
- [ ] `src/domain/plain-date.ts` -- implement the value object and its four total functions -- green in a separate commit; must reach 100% coverage and survive Stryker.
- [ ] `tests/application/as-of.test.ts` + `src/application/ports/clock.ts` + `src/application/as-of.ts` -- red then green: the resolution policy (missing, valid, future-clamped, malformed, array) and the `Clock` port AD-11 has owed since 1-1.
- [ ] `tests/adapters/clock.test.ts` + `src/adapters/clock.ts` -- red then green: `toUtcPlainDate` against fixed epoch values including a UTC day boundary; `systemClock` implements `Clock`. Deterministic — the test never reads the real clock. An adapter is production code and Law 1 binds it (1-3's recorded lesson).
- [ ] `tests/ui/nav-items.test.ts` + `src/ui/nav-items.ts` -- red then green: the seven items in order with exact labels, Settings last, and exact-match `isActiveNavItem`.
- [ ] `tests/tokens/eslint-config.test.ts` + `eslint.config.mjs` -- red then green: the `dark:` ban. Add the selector to the **shared** list so `colorLiteralBanConfig`, `prngExemptionConfig` and `purityConfig` all carry it -- closes the last unenforced prohibition in the token contract, and this is the exact block layering that silently revoked the PRNG exemption in 1-5.
- [ ] `package.json` -- add the two Fontsource dependencies and import the needed weights in `layout.tsx` (sans 400/600/700, mono 400/500/600) -- DESIGN binds all numerals to JetBrains Mono; a fallback satisfies the monospacing but not the identity.
- [ ] `src/app/globals.css` -- `color-scheme: light dark` and the body canvas -- without both, OS dark mode paints `main` dark inside a UA-white page and native controls render light-on-dark (`deferred-work.md`, 1-5 follow-up review).
- [ ] `src/ui/announcer.tsx`, `src/ui/skip-link.tsx`, `src/ui/sidebar-nav.tsx`, `src/ui/app-header.tsx`, `src/ui/as-of-control.tsx` -- the shell primitives, hand-built on tokens.
- [ ] `src/app/layout.tsx` -- compose them; `await connection()` before the clock read so "today" is per-request and never baked into a prerender.
- [ ] `src/app/page.tsx` + the six new `page.tsx` files -- the placeholder routes. Data surfaces (Home, Employees, Gender Insights, Payroll Totals, Overdue for Review) carry the ratified first-run statement `No employees yet. Import a spreadsheet to begin.`; Home additionally echoes the resolved as-of date server-side from `searchParams`, which is what makes recompute observable. Import carries `Bulk import is not available yet.` and Settings carries `Settings are not available yet.` — statements, never celebrations, and no invented capability copy beyond these.
- [ ] `e2e/shell.spec.ts` -- the browser-level gate: landmarks, skip link reachable by Tab from page start, `aria-current="page"` follows navigation, the as-of button's accessible name, the picker round trip (open → set → URL param → server-rendered echo changes → announcement text lands in the live region), the live region is the **same DOM node** before and after, Esc closes and returns focus to the button.
- [ ] `e2e/accessibility.spec.ts` -- run axe over all seven routes, in both color schemes.
- [ ] `e2e/tokens.spec.ts` -- retarget the three assertions the shell moves and assert the canvas repaints under dark.
- [ ] `package.json`, `.github/workflows/ci.yml` -- add `e2e/shell.spec.ts` to `test:browser` (the a11y job already builds and serves; a second Playwright invocation would cost a second `next build`).
- [ ] `src/ui/README.md`, `src/app/README.md` -- record the shell contract, the no-shadcn decision, and the `dark:` gate.
- [ ] `docs/implementation-artifacts/deferred-work.md` -- append the items named in Design Notes; mark the shadcn re-entry as moved.
- [ ] `docs/implementation-artifacts/sprint-status.yaml` -- set `1-6-app-shell-and-as-of-control` to its new status.

**Acceptance Criteria:**
- Given any of the seven routes, when it loads, then exactly one `<nav>` and one `<main>` landmark exist, the first Tab-focusable element is the skip link targeting `#main-content`, and the sidebar item matching the current path — and only that one — carries `aria-current="page"`.
- Given the header, when a screen reader reads the as-of control, then it is a single button whose accessible name contains both the as-of date and the action (e.g. `As of 16 Jul 2026 — change as-of date`), its calendar glyph is `aria-hidden`, and the visible text is the same date in the mono numeral style.
- Given `/` with no `asOf` param, when it renders, then the control and the page echo today's UTC date; and given `/?asOf=2026-05-12`, then both show `12 May 2026` — a bookmarked URL reproduces the view.
- Given the as-of picker is open, when a date is chosen, then the URL gains `asOf=YYYY-MM-DD`, the server-rendered echo changes without a full page load, the live region receives `Findings updated as of 12 May 2026`, and the live region element is the **same node** it was before the change; and when Esc is pressed, then the popover closes and focus returns to the as-of button.
- Given a hostile or stale URL (`?asOf=2026-02-30`, `?asOf=tomorrow`, `?asOf=` repeated), when the page renders, then it falls back to today, renders normally, and logs no error.
- Given `npm run build`, when the app is served and axe runs over all seven routes in both light and dark schemes, then there are zero violations, and `body`'s computed background is the dark surface token under an emulated dark scheme.
- Given a component file under `src/**` containing a `dark:` utility or a color literal in any notation, when `npm run lint` runs, then it fails naming the rule; and given the same string in `scripts/` or `tests/`, then lint passes.
- Given the full repo, when `npm run lint`, `npm run typecheck`, `npm run tokens:check`, `npm run test:coverage`, `npm run test:mutation`, and `npm run test:browser` run, then all pass with `src/domain/**` still at 100% coverage and a 100% mutation score, and `tokens.generated.css` byte-identical.
- Given `git log` for this story, when the commit sequence is read, then each failing-test commit precedes the commit making it pass.

## Spec Change Log

## Review Triage Log

## Design Notes

**Where the as-of date lives — the one architectural decision here.** Nothing in the spine or the UX docs settles it; `review-reconcile-ux.md` flags exactly this as "a whole-app structural decision, not a component detail" that "belongs in the spine" and never landed there. This story rules: **a URL search param, `?asOf=YYYY-MM-DD`, resolved server-side at the delivery boundary.** It follows from constraints already ratified — reads are Server Components calling inward in-process (AD-21), exactly two Route Handlers will ever exist so an API is off the table, and determinism (AD-11/AD-19) wants the as-of visible in the address bar so a view is reproducible and shareable. The known hazard the same review names is that the naive reading re-suspends every surface on change; the mitigation is the shape it prescribes:

```tsx
// as-of-control.tsx (client)
const [isPending, startTransition] = useTransition();
startTransition(() => {
  router.push(`${pathname}?asOf=${iso}`);   // same route ⇒ layout instance preserved
  announce(`Findings updated as of ${formatPlainDate(next)}`);
});
```

The layout is not remounted by a same-route param change, so the live region rendered there is a stable node — which is the whole point of AD-20's "not remounted by an as-of or threshold change". Values swap in place; no surface returns to skeleton.

**Why no shadcn/ui.** The only primitive this story needs is a date picker. shadcn's is `react-day-picker` + `popover` + `button` — five new runtime dependencies whose Tailwind v4 templates ship `oklch` literals, a second set of variable names (`--background`, `--primary`, `--ring`) with hard-coded values, and a `.dark` class block: three simultaneous AD-15 violations, which `deferred-work.md` already predicts as "where AD-15 is most likely to be violated". A native `<input type="date">` inside a hand-built popover is fully keyboard-accessible, inherits `color-scheme`, adds nothing, and violates nothing. The copy-in and its re-pointing obligation move to the first capability form that needs a primitive we do not build — recorded, not dropped.

**Why Fontsource and not `next/font`.** `next/font` mints a generated family name (`__Hanken_Grotesk_1a2b3c`), but `--font-sans`/`--font-mono` are generated from DESIGN.md and drift-gated, so naming it would mean hand-authoring a token or amending the single source of visual truth. `@fontsource/hanken-grotesk` and `@fontsource/jetbrains-mono` self-host `@font-face` rules declaring the **literal** families `'Hanken Grotesk'` and `'JetBrains Mono'`, which the existing stacks already name first. Nothing about the token contract changes; the fallback simply stops being what renders.

**Inputs live on `surface-card`.** Not decoration: `input-border` measures 3.09:1 on `surface-card` but 2.96:1 on `surface-base` and 2.82:1 on `surface-tint`, both below DESIGN's own 3:1 non-text floor. Putting the as-of picker's panel on `surface-card` keeps this story inside the floor without amending a document it may not amend.

**New deferred items to record** (do not resolve here): the shadcn copy-in and its token re-pointing now re-enter at the first capability form, not here; `ui → application` types-only remains mechanically unenforced (no such import exists in this story, so there is still nothing to enforce against); named CSS colors (`red`, `white`) still escape both halves of the color ban; the dark token set's `[ASSUMPTION]` flag can now be assessed against a real render for the first time, and whether it clears is a `DESIGN.md` change this story cannot make; and the `/`-focuses-search shortcut is deferred to the first surface with a search field.

## Verification

**Commands:**
- `npm run lint` -- expected: exit 0; a `dark:bg-surface-card` string added temporarily to a `src/ui/*.tsx` file makes it exit non-zero naming the rule (revert after proving it)
- `npm run typecheck` -- expected: exit 0
- `npm run tokens:check` -- expected: exit 0, byte-identical (this story changes no token)
- `npm test` / `npm run test:coverage` -- expected: all pass; `src/domain/**` still 100/100/100/100, `src/application/**` above 90
- `npm run test:mutation` -- expected: Stryker 100%, zero survivors, now including `src/domain/plain-date.ts`
- `npm run build` -- expected: exit 0; routes report as dynamic (the clock read is per-request, by design)
- `npm run test:browser` -- expected: accessibility, tokens, and shell specs all green in one invocation
- `npm run test:integration` -- expected: unchanged and green (this story touches no persistence)

**Manual checks (if no CLI):**
- With the OS in dark mode, load `/` and confirm the **whole page** is dark — canvas, scrollbars, and the native date picker included — not a dark panel on a white page.
- Tab from a fresh page load: the skip link must be the first stop and must move focus into `main`. Then Tab to the as-of button, press Enter, choose a date with the keyboard alone, and confirm focus returns to the button.
