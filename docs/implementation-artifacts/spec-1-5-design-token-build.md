---
title: 'Story 1-5: Design Token Build'
type: 'feature'
created: '2026-07-19'
status: 'done'
baseline_revision: '45e745ce264eeb66cf6efaef826926ae9ca7a32f'
final_revision: '216ba7e0d8c6051badbbed585040574bab57e1bf' # follow-up review pass; the stamp commit that records it follows
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/docs/implementation-artifacts/epic-1-context.md'
  - '{project-root}/docs/implementation-artifacts/deferred-work.md'
  - '{project-root}/docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/DESIGN.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** AD-15 requires the Tailwind theme to be *generated* from `DESIGN.md` frontmatter so the visual contract and the stylesheet cannot drift, but no generator exists: `src/app/globals.css` is `@import "tailwindcss";` and nothing else, and story 1-6's app shell cannot render a single on-token surface until tokens exist. Two architecture-review findings are open against AD-15 and land here: **F-5** — DESIGN's frontmatter is a *flat* map with `-dark` suffixes, and a literal reading of AD-15 emits `--color-surface-base` and `--color-surface-base-dark` as two unrelated tokens, the exact drift AD-15 exists to prevent; and AD-15's "no hex literal appears in application code" is a prohibition with **no named enforcement** while AD-1 and AD-14 both name lint.

**Approach:** A build step (`npm run tokens:build`) parses `DESIGN.md`'s YAML frontmatter and emits `src/app/tokens.generated.css` — a Tailwind v4 `@theme static` block plus a `prefers-color-scheme: dark` override, so each token has **one name and two values** and no component ever writes `dark:`. The generated file is **committed** and CI proves it is in sync (`tokens:check`, the `prisma migrate diff --exit-code` analogue). Two gates ship with it: a computed **WCAG contrast re-verification** over the ratified pair matrix (DESIGN § Contrast floor: "Any future token change must re-verify the matrix before shipping"), and a **mechanized hex-literal ban** across `src/**`, closing AD-15's unenforced half.

## Boundaries & Constraints

**Always:**
- TDD, red before green, and the failing test and the code that satisfies it in **separate commits** (standing practice, `deferred-work.md`).
- `DESIGN.md` is the single source of visual truth and is **read-only** to this story. No token value is invented, adjusted, renamed, or "fixed" here.
- Every color token is emitted **once**, under its light name. The `-dark` suffix never survives into a token name — it selects the value used inside the dark override block. (Closes F-5.)
- The generator is deterministic and total in the domain sense: same `DESIGN.md` ⇒ byte-identical output; malformed or incomplete input produces a **named, actionable error**, never a partial file.
- Pure transformation logic (frontmatter → CSS string, contrast math) is separated from file I/O so it is unit-testable without touching disk.
- The generator and its tests live in `scripts/` and `tests/tokens/` — **not** in `src/domain`. They are build tooling, not product logic.
- Node 24 runs the script directly via native type-stripping (`node scripts/generate-design-tokens.ts`); no `tsx`/`ts-node`.
- No change to `vitest.config.ts` coverage `include`/thresholds or `stryker.config.json` `mutate` — this story adds no `src/domain` or `src/application` code and must not move those gates.

**Block If:**
- `DESIGN.md` frontmatter holds a color with no `-dark` counterpart (or a `-dark` with no light base) — the pairing rule cannot be applied and DESIGN is not this story's to amend.
- A `{colors.*}` / `{typography.*}` / `{rounded.*}` / `{spacing.*}` reference inside the `components:` block resolves to no token — a source-document defect.
- A pair in the **gated contrast matrix below** falls below its floor. (Verified during planning against the current frontmatter: none does.)

**Never:**
- No `tailwind.config.*` — Tailwind v4 is CSS-first and story 1-1 deliberately shipped none.
- No shadcn/ui install, no `components.json`, no `npx shadcn add`. Copy-in and the re-pointing of its CSS variables onto these tokens is **1-6**.
- No component, no layout, no styling of `page.tsx`/`layout.tsx`, no `body` background. 1-5 ships the token contract; 1-6 is its first consumer.
- No webfont loading (`next/font`, `@font-face`, Google Fonts link). Font **family tokens** are emitted; making Hanken Grotesk and JetBrains Mono actually load is 1-6's shell work.
- No emission of the `components:` block as tokens — component anatomy is not a Tailwind theme namespace. It is *validated* (dangling references) and otherwise left to 1-6.
- No manual theme toggle, no `.dark` class, no `data-theme` attribute, no theme-persistence cookie — none is ratified; system preference only.
- No hand-editing of `src/app/tokens.generated.css`. It carries a "generated — do not edit" header and is reproduced from source by CI.

## I/O & Edge-Case Matrix

`toThemeCss(frontmatter)` — the pure transform. Errors are thrown by the generator CLI (build tooling, not `src/domain`), so this table's error column names the thrown message.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Paired color | `surface-base: '#f8fafc'`, `surface-base-dark: '#0f172a'` | `--color-surface-base: #f8fafc;` inside `@theme static`, and `--color-surface-base: #0f172a;` inside the dark block. One name, two values. | No error expected |
| Light color with no dark pair | `surface-base` present, `surface-base-dark` absent | — | Throws, naming `surface-base` and the missing key |
| Orphan `-dark` key | `foo-dark` present, `foo` absent | — | Throws, naming `foo-dark` |
| Typography style | `body-md: {Hanken Grotesk, 14px, '400', 20px}` | `--text-body-md: 14px;` + `--text-body-md--line-height: 20px;` + `--text-body-md--font-weight: 400;` | No error expected |
| Typography with tracking | `label-caps` (letterSpacing `0.05em`) | additionally `--text-label-caps--letter-spacing: 0.05em;` | No error expected |
| Font families | `Hanken Grotesk` / `JetBrains Mono` across the typography block | `--font-sans` and `--font-mono` emitted once each, with fallback stacks | No error expected |
| Radius, incl. `DEFAULT` | `rounded: {sm, DEFAULT, md, lg, xl, full}` | `--radius-sm`, `--radius`, `--radius-md`, `--radius-lg`, `--radius-xl`, `--radius-full` — `DEFAULT` maps to the bare `--radius` | No error expected |
| Spacing base + named | `spacing.unit: 4px`, `gutter: 12px` | `--spacing: 4px;` (the v4 dynamic scale) plus `--spacing-gutter`, `--spacing-container-margin`, `--spacing-cell-padding-v`, `--spacing-cell-padding-h` | No error expected |
| Dangling component reference | `components.button-primary.background: '{colors.nope}'` | — | Throws, naming the component key and the unresolved reference |
| Determinism | same frontmatter, two invocations | byte-identical output, tokens in a stable declared order | No error expected |
| Drift check, in sync | committed file == generated output | `tokens:check` exits 0 | No error expected |
| Drift check, stale | `DESIGN.md` edited, file not rebuilt | `tokens:check` exits non-zero naming the file and `npm run tokens:build` | Exit code 1, no file written |
| Contrast, gated pair | `ink-faint` on `surface-tint` | 5.28:1 — passes the 4.5 floor | No error expected |
| Contrast, hypothetical failure | any gated pair below its floor | test fails naming both tokens, the computed ratio, and the floor | Test failure |

</intent-contract>

## Code Map

- `docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/DESIGN.md` -- **read only, never edited.** Source of truth. `colors` (17 light + 17 `-dark`), `typography` (8 styles), `rounded` (6), `spacing` (5), `components` (10, reference-only).
- `scripts/design-tokens/to-css.ts` -- **new.** Pure: frontmatter object → CSS string. Holds the pairing rule, the namespace mapping, and the validators.
- `scripts/design-tokens/contrast.ts` -- **new.** Pure WCAG 2.x relative-luminance + contrast-ratio math over hex.
- `scripts/design-tokens/cli.ts` -- **new (review 2026-07-19).** The CLI's DECISIONS with its effects handed in: argv, in-sync / drift / never-generated, exit codes. Extracted so the drift gate acceptance criterion 1 is written about is itself testable.
- `scripts/generate-design-tokens.ts` -- **new.** The CLI entry: reads `DESIGN.md`, parses YAML frontmatter, writes `src/app/tokens.generated.css`; `--check` compares instead of writing. Wiring only — `node:fs`, `console`, `process`.
- `src/app/tokens.generated.css` -- **new, generated, committed.** The only file in `src/` permitted to contain hex.
- `src/app/globals.css` -- add `@import "./tokens.generated.css";` after the Tailwind import; replace the "theme is intentionally EMPTY" comment with the generated-token contract.
- `tests/tokens/{to-css,contrast,no-hex}.test.ts` -- **new.** Matrix coverage plus frontmatter shape validation, the gated contrast matrix, and the CSS-side color ban (its scanner and pattern tested against fixture trees).
- `tests/tokens/eslint-config.test.ts` -- **new (review 2026-07-19).** Runs the real `eslint.config.mjs` through `ESLint.lintText` and pins the whole ban matrix: colors rejected in `src/**` and accepted in `scripts/`+`tests/`, `Math.random` accepted in `prng.ts` and rejected everywhere else.
- `tests/tokens/token-cli.test.ts` -- **new (review 2026-07-19).** Every branch of the drift gate.
- `e2e/tokens.spec.ts` -- **new.** Proves the tokens survive `next build` and reach the browser as real custom properties.
- `eslint.config.mjs` -- add a `colorLiteralBanConfig` block scoped to `src/**` plus a `prngExemptionConfig` block for `src/adapters/prng.ts`, alongside the existing `purityConfig` / `randomnessBanConfig` blocks. Four blocks now share `no-restricted-syntax`; entries REPLACE rather than merge, so ordering is load-bearing.
- `src/app/page.tsx` -- dress the scaffold page in token utilities, so the e2e can assert that a utility READS a token rather than only that the variable exists.
- `package.json` -- `tokens:build`, `tokens:check`, `test:tokens` scripts; `yaml` devDependency.
- `.github/workflows/ci.yml` -- `tokens:check` in the `check` job; `test:tokens` in the `a11y` job (which already builds and serves the app).
- `src/ui/README.md`, `src/app/README.md` -- currently say tokens land in 1-5; update to describe the shipped contract.
- `src/domain/money.ts` + `tests/domain/money.test.ts` -- **read only.** Copy their JSDoc law-citation style and one-behaviour-per-`it` test style.

## Tasks & Acceptance

**Execution:**
- [x] `tests/tokens/to-css.test.ts` -- write the failing suite covering every I/O matrix row of the pure transform, including both pairing-error cases and the dangling-reference case -- Law 1: red lands, and is committed, before `to-css.ts` exists.
- [x] `scripts/design-tokens/to-css.ts` -- implement the transform: `@theme static` block, `@media (prefers-color-scheme: dark)` override, the four namespace mappings, and the three validators -- green in a separate commit.
- [x] `tests/tokens/contrast.test.ts` -- write the failing suite: the contrast function against known reference ratios, then the **gated matrix** asserted over the real `DESIGN.md` values -- DESIGN commits that any token change re-verifies the matrix before shipping; this is that gate.
- [x] `scripts/design-tokens/contrast.ts` -- implement relative luminance and contrast ratio -- green in a separate commit.
- [x] `scripts/generate-design-tokens.ts` + `package.json` -- the CLI with `--check`, the `tokens:build` / `tokens:check` / `test:tokens` scripts, and the `yaml` devDependency -- reference values must reach every environment by regeneration, and drift must be a build failure, not a review nicety.
- [x] `src/app/tokens.generated.css` -- generate and commit -- the artifact `next build` consumes; committed rather than gitignored so `next dev`, `next build`, and Playwright need no pre-step and a token change is visible in review.
- [x] `src/app/globals.css` -- import the generated file; rewrite the stale "theme is intentionally EMPTY / 1-5 will fill it" header -- 1-1 left this note addressed to this story.
- [x] `tests/tokens/no-hex.test.ts` -- assert no `.css` file under `src/` other than `tokens.generated.css` contains a hex literal -- ESLint does not lint CSS, so the ban needs this second half to be real.
- [x] `eslint.config.mjs` -- add the `src/**` hex-literal ban via `no-restricted-syntax` -- closes AD-15's unnamed enforcement (review-rubric F, "the rule is a wish").
- [x] `e2e/tokens.spec.ts` -- assert `getComputedStyle(document.documentElement)` exposes representative tokens on the built-and-served app, and that the dark override applies under an emulated dark color scheme -- proves the pipeline end-to-end, not just the string.
- [x] `.github/workflows/ci.yml` -- wire `tokens:check` into `check` and `test:tokens` into `a11y` -- a generated artifact with no CI gate drifts.
- [x] `src/ui/README.md`, `src/app/README.md`, `scripts/design-tokens/README.md` -- document the token contract, the one-name-two-values rule, and the "edit DESIGN.md, run tokens:build" workflow -- the next agent must not hand-author a token or re-litigate the vehicle.
- [x] `docs/implementation-artifacts/deferred-work.md` -- append the items named in Design Notes -- append-only ledger.
- [x] `docs/implementation-artifacts/sprint-status.yaml` -- set `1-5-design-token-build` to its new status.

**Acceptance Criteria:**
- Given the committed `src/app/tokens.generated.css`, when `npm run tokens:check` runs, then it exits 0; and given `DESIGN.md` is then modified, when it runs again, then it exits non-zero and names the rebuild command.
- Given the generated file, when it is inspected, then **no token name ends in `-dark`**, every one of the 17 colors appears exactly twice (once per mode), and the file carries a generated-do-not-edit header naming its source.
- Given `npm test`, when the contrast suite runs, then every pair in the gated matrix meets its floor, and the reported minima are **5.28:1 (light: `ink-faint` on `surface-tint`) and 4.72:1 (dark: `ink-faint` on `surface-tint`)** — the exact worst pairs DESIGN § Contrast floor records, proving the gate reproduces DESIGN's own verification rather than a weaker one.
- Given a `.ts`/`.tsx` file under `src/` containing a color literal in ANY notation (hex, `rgb`, `hsl`, `hwb`, `lab`, `lch`, `oklab`, `oklch`, `color()`), when `npm run lint` runs, then it fails naming the AD-15 rule; and given the same string in `scripts/` or `tests/`, then lint passes — the ban is scoped to application code.
- Given `npm run build`, when it completes, then Tailwind compiles `globals.css` including the generated import with no CSS error, and `npm run test:tokens` finds `--color-surface-base` resolving to the light value by default and to the dark value under an emulated `prefers-color-scheme: dark`.
- Given the full repo, when `npm run lint`, `npm run typecheck`, `npm run test:coverage`, and `npm run test:mutation` run, then all pass with the `src/domain` coverage and mutation gates unchanged at 100%.
- Given `git log` for this story, when the commit sequence is read, then each failing-test commit precedes the commit making it pass.

## Spec Change Log

## Review Triage Log

### 2026-07-19 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 1, medium 4, low 2)
- defer: 6: (high 0, medium 3, low 3)
- reject: 5: (high 0, medium 0, low 5)
- addressed_findings:
  - `[high]` `[patch]` The new color-literal ESLint block silently **revoked the AD-14 PRNG
    exemption**. `randomnessBanConfig` carries `ignores: ['src/adapters/prng.ts']`, but the new
    block matched `src/**` (which includes `prng.ts`), re-declared the randomness selector, and
    carried no `ignores` — and flat-config rule entries REPLACE rather than merge. Verified: a
    `Math.random` call in `prng.ts` errored. Green today only because `prng.ts` is still a throwing
    stub; story 1-12's seeded PRNG — the file's entire reason to exist — would have hit it. Fixed
    with a fourth, narrower `prngExemptionConfig` block carrying the color selectors and omitting
    only the randomness one, so the exemption is randomness-scoped and does not trade a color hole
    for it. Both directions now pinned by test and re-proven by hand.
  - `[medium]` `[patch]` The generator validated the pairing rule and the component references but
    never the **shape of the values it emits**, so malformed input shipped a silently-broken
    stylesheet instead of the "named, actionable error" the intent contract requires. Six modes
    reproduced by execution: a typography style missing `lineHeight` emitted
    `--text-body-md--line-height: undefined;`; a null color value emitted `--color-ink: null;`
    (the realistic slip — an **unquoted** hex in YAML is a comment, so `surface-base: #f8fafc`
    parses as null); the same for a null `-dark` value; a non-string `components:` value threw an
    unnamed `TypeError: value.matchAll is not a function`; a non-color value injected raw CSS,
    closing the `@theme` block early; and a missing `rounded.DEFAULT` / `spacing.unit` silently
    dropped the bare `--radius` / `--spacing`, killing the `rounded` utility and the whole numeric
    spacing scale. Closed by a `validateShape` pass that runs before any declaration is rendered,
    with 19 tests.
  - `[medium]` `[patch]` The ban was spelled as a **hex** ban, so every other color notation
    escaped it — including the exact threat this story's own ledger names as highest-risk.
    Verified: `oklch(0.7 0.1 20)` linted clean in `src/**`, as did `rgb()`/`hsl()`, on both the
    ESLint and the CSS side. shadcn/ui's Tailwind v4 templates ship **oklch**, not hex, so the gate
    built to survive the 1-6 copy-in would not have fired on it. Widened both halves to the full
    CSS color-function set; `color-mix()` deliberately stays legal because it composes tokens.
  - `[medium]` `[patch]` **Both headline gates were themselves untested.** The ESLint ban landed
    with no red commit — the one artifact in the story without a RED→GREEN pair — and the
    finding above is precisely the regression such a test would have caught. Separately
    `generate-design-tokens.ts`, the prover the whole "CI proves it is in sync" claim rests on, had
    zero tests: an inverted comparison would have made `tokens:check` exit 0 forever and pass every
    gate in the repo. Added 29 tests linting strings through the real config and 17 covering the
    CLI's in-sync / drift / never-generated / write paths, the latter requiring a small seam
    (decision logic extracted to `cli.ts`, returning an exit code instead of calling `process.exit`).
  - `[medium]` `[patch]` `e2e/tokens.spec.ts` proved the custom properties **existed**, not that any
    Tailwind utility read them — every assertion read a property off `:root` and nothing rendered an
    element. The two specially-spelled keys (`DEFAULT → --radius`, `unit → --spacing`) were
    justified in three places by claims about what `rounded` and the v4 dynamic scale actually
    consume, and neither claim was tested. Now renders elements and asserts computed styles:
    `border-radius: 4px` proves `rounded` reads the bare `--radius`, and `padding: 12px` proves
    `p-3` is 3 × the bare `--spacing`.
  - `[low]` `[patch]` The color ban false-positives on fragment identifiers — `<a href="#feed">`
    was rejected with the design-token message, and `#feed`/`#face`/`#dad`/`#decade` are not
    syntactically separable from colors. The selector was deliberately left uncontorted; the
    boundary is now pinned by test as a known edge, with the `eslint-disable-next-line` escape
    hatch spelled out in the rule message itself.
  - `[low]` `[patch]` The CSS-side scanner had two structural holes: it skipped **any** directory
    named `generated` at any depth rather than the one Prisma path its comment claimed, and it
    matched only `*.css`, so a `.scss`/`.sass`/`.less` under `src/` was invisible to both halves of
    AD-15. Both proven red against fixture trees before the fix.

### 2026-07-19 — Review pass (follow-up)

- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 2, low 8)
- defer: 4: (high 0, medium 2, low 2)
- reject: 11: (high 0, medium 0, low 11)
- addressed_findings:
  - `[medium]` `[patch]` The previous pass's injection fix **covered one namespace out of four**.
    `validateColors` enforced a six-digit hex, but `validateTypography` and `validateScale` checked
    only `typeof value === 'string'`, so every non-color value still reached `declaration()`
    unescaped. Reproduced by execution: `fontSize: '14px; } body { display: none'` and
    `rounded.sm: '2px; } html { visibility: hidden'` generated, with no error, declarations that
    close the `@theme` block early and write two real rules into the application's global
    stylesheet — precisely the mode the last pass recorded as closed. The same held for
    `fontFamily`, interpolated inside single quotes at `--font-sans`, where a family name containing
    `'` escapes the quoting, and for token **keys**, which are interpolated straight into a
    custom-property name. Closed with `CSS_SAFE_VALUE` + `TOKEN_KEY` guards applied across
    `typography`, `rounded` and `spacing` (keys and values, including the empty-value case), plus an
    empty-`colors:` guard. 17 new tests; the injection strings above are now fixtures.
  - `[medium]` `[patch]` The **contrast gate rounded before comparing**, making it 0.005 more
    permissive than WCAG. `ratio()` returned `round2(contrastRatio(…))` and the floor assertions
    consumed that rounded value, so a true 4.4951:1 rounded to 4.5 and cleared
    `toBeGreaterThanOrEqual(4.5)` (verified in node); 2.9951:1 likewise cleared the 3:1 non-text
    floor. The story's central accessibility claim is that DESIGN's "verified by computation"
    promise is now an actual computation, and the computation was weaker than the standard. Split
    into `measuredRatio` (unrounded, what the floors read) and `ratio` (rounded, what reproduces
    DESIGN's published figures and what the failure message prints).
  - `[low]` `[patch]` `process.exit()` in the generator CLI could **truncate the drift message it
    had just written**. Node's console writes to a pipe — what CI gives you — asynchronously, and
    `process.exit()` does not flush; the `--check` gate would show a red step with no explanation,
    the one moment the message matters. Changed to `process.exitCode`. Verified end-to-end by
    forcing real drift and capturing through a pipe: exit 1, full message intact.
  - `[low]` `[patch]` `readCommitted` caught **every** error and flattened it to `null`, so EACCES,
    EISDIR or EIO were reported as "the file has never been generated — run `npm run tokens:build`",
    sending the reader to a command that cannot help. Now only ENOENT flattens; everything else
    propagates with its own message.
  - `[low]` `[patch]` Two reader diagnostics pointed away from the defect: a UTF-8 BOM (invisible in
    every editor) pushed the opening fence off position 0 and reported "no YAML frontmatter found"
    against a document whose fence is plainly there, and invalid YAML surfaced as a raw
    `YAMLParseError` naming a line and column in a string the reader never saw. BOM is now stripped;
    the parse error is restated against DESIGN.md, keeping the parser's own diagnosis.
  - `[low]` `[patch]` The test that **names F-5** was a pure negative with no positive control.
    `expect(tokenValue('--color-surface-base-dark')).toBe('')` returns `''` both when the generator
    correctly emitted no `-dark` token and when `tokens.generated.css` failed to load at all — drop
    the `@import` from `globals.css` and the story's headline architectural assertion still passes
    green. Paired with positive assertions that the light names DO resolve, in the same test body.
  - `[low]` `[patch]` The CI a11y job ran `test:a11y` and `test:tokens` as two separate Playwright
    invocations. `reuseExistingServer` is false in CI, so each started its own webServer — **two
    full `next build`s** inside a 15-minute budget, contradicting the step comment's own rationale
    ("this is the job that already builds and serves the app"). Collapsed into one `test:browser`
    script over both specs; verified locally, 12 tests, one build.
  - `[low]` `[patch]` `fixtureTree` created temp directories with `mkdtempSync` and never removed
    them — roughly a dozen orphaned `no-hex-*` trees per `npm test` run. Harmless on a laptop, an
    eventual ENOSPC on a long-lived runner or a small tmpfs, surfacing far from its cause. Now
    registered for removal with `onTestFinished`.
  - `[low]` `[patch]` `final_revision` was a 7-character abbreviation where `baseline_revision` is a
    full 40-character SHA, degrading machine-readable provenance to a human hint. Now a full SHA.

## Design Notes

**One name, two values — the F-5 fix.** Tailwind v4 emits theme entries as CSS custom properties on `:root`, and every utility is `var(--color-…)`. So re-declaring the same variable inside a dark block re-points every utility with no `dark:` variant and no second token:

```css
@theme static {
  --color-surface-base: #f8fafc;
  --color-ink: #191c1e;
}
@media (prefers-color-scheme: dark) {
  :root { --color-surface-base: #0f172a; --color-ink: #e2e8f0; }
}
```

`static` (not the default) forces Tailwind to emit **all** theme variables, used or not — the token contract must be observable and overridable even before 1-6 consumes it. System preference only: no toggle is ratified, and a class-based hook would be speculative surface.

**Namespace mapping.** `colors.*` → `--color-*`; `typography.*` → `--text-*` with the v4 `--text-x--line-height` / `--font-weight` / `--letter-spacing` sub-properties; `rounded.*` → `--radius-*` with `DEFAULT` → bare `--radius`; `spacing.unit` → `--spacing` (the v4 dynamic scale base) and the four named spacings → `--spacing-*`. Font families are lifted from the typography block into `--font-sans` (Hanken Grotesk) and `--font-mono` (JetBrains Mono) — DESIGN's binding rule is that *all* numerals are mono, which is a two-family contract, not eight.

**Gated contrast matrix** (both modes, computed from the frontmatter at test time):
- **≥ 4.5:1** — `{ink, ink-muted, ink-faint, primary, accent-indigo}` × `{surface-base, surface-card, surface-tint}`; `primary-foreground` on `primary`; `amber-badge-text` on `amber-badge-bg`.
- **≥ 3:1** (non-text UI) — `secondary` (chart fill, "never a text color") × the three surfaces; `input-border` on `surface-card`.
- **Deliberately excluded:** `border-hairline` and `border-strong`, which DESIGN scopes to decorative rules and table dividers, not to UI components requiring identification.

**Committed, not gitignored.** This departs from the Prisma-client precedent (gitignored, regenerated in `postinstall`) on purpose: that artifact is thousands of files of noise, this is one small file that `next dev`, `next build`, and Playwright all need present with no pre-step, and whose every change is exactly what a human reviewer should see. Drift is caught the way schema drift is — an `--exit-code` check in CI. Correspondingly, the generator is **not** wired into `prebuild`: a build that silently regenerates would make the drift gate unfalsifiable.

**New deferred items to record** (do not resolve here): `input-border` on `surface-base` (2.96:1) and on `surface-tint` (2.82:1) fall **below** DESIGN's own stated 3:1 floor for input borders — no ratified surface places an input on either (forms sit on `surface-card`, 3.09:1), so the gated matrix asserts only the pair that occurs, but the token is one shade too light if that ever changes; the dark set remains flagged **provisional** in DESIGN pending verification against real renders, and nothing in this story can clear that flag; and shadcn/ui's own CSS variables must be re-pointed at these tokens on copy-in in 1-6, which is the moment AD-15 is most likely to be violated (review-rubric: "AD-15 will be violated by the first `npx shadcn add`").

## Verification

**Commands:**
- `npm run tokens:build` -- expected: writes `src/app/tokens.generated.css`; a second run leaves `git status` clean
- `npm run tokens:check` -- expected: exit 0 in sync; exit 1 with a named rebuild instruction after touching `DESIGN.md`
- `npm run lint` -- expected: exit 0; and a temporary hex literal added to a `src/**/*.ts` file makes it exit non-zero (revert after proving it)
- `npm run typecheck` -- expected: exit 0
- `npm test` / `npm run test:coverage` -- expected: all pass; `src/domain/**` still 100/100/100/100
- `npm run test:mutation` -- expected: Stryker still 100%, zero survivors (this story adds no domain code)
- `npm run build` -- expected: exit 0, Tailwind compiles the generated import
- `npm run test:tokens` -- expected: tokens resolve in the browser in both color schemes
- `npx playwright test e2e/accessibility.spec.ts` -- expected: still green (regression check; `/` is unstyled here)

**Manual checks (if no CLI):**
- Read `src/app/tokens.generated.css` end to end: confirm the do-not-edit header, that no token name ends in `-dark`, and that the dark block re-declares exactly the same 17 names the `@theme` block declares.
</content>

## Auto Run Result

Status: `done`

### Implemented change

The AD-15 token build, plus the three gates that make it more than a convention. `npm run tokens:build`
parses `DESIGN.md`'s YAML frontmatter and emits `src/app/tokens.generated.css` — a Tailwind v4
`@theme static` block followed by a `prefers-color-scheme: dark` override that re-declares the same
names. That pairing is the substance of the story: **one token name, two values**. DESIGN's flat
`-dark` suffix map never becomes a second set of tokens, so a component writes `bg-surface-card` and
is correct in both modes, and no `dark:` variant belongs anywhere in the codebase. This closes
architecture review finding **F-5**, which observed that a literal reading of AD-15 emits
`--color-surface-base` and `--color-surface-base-dark` as two unrelated tokens — the exact drift
AD-15 exists to prevent.

Three gates ship with it. **Drift:** the generated file is committed and `npm run tokens:check`
fails CI when it and DESIGN.md disagree — the direct analogue of `prisma migrate diff --exit-code`.
Generation is deliberately *not* wired into `prebuild`, because a build that silently regenerated
would make the gate unfalsifiable. **Contrast:** DESIGN § Contrast floor promises that "any future
token change must re-verify the matrix before shipping" and gave that promise nowhere to live;
`tests/tokens/contrast.test.ts` now computes the full ink × surface matrix in both modes and
reproduces DESIGN's own stated minima exactly — 5.28:1 light and 4.72:1 dark, both `ink-faint` on
`surface-tint`. **Enforcement:** AD-15's "no hex literal appears in application code" was, in the
architecture rubric's words, "a prohibition with no named enforcement" while AD-1 and AD-14 both
name lint. It is now mechanized in `eslint.config.mjs` for `.ts`/`.tsx` and in
`tests/tokens/no-hex.test.ts` for stylesheets (ESLint does not lint CSS), across hex *and* every
other CSS color notation.

### Files changed

- `scripts/design-tokens/{to-css,contrast,design-source,cli}.ts` — the pure transform, WCAG math,
  DESIGN.md reader, and the CLI's decision logic.
- `scripts/generate-design-tokens.ts` — the CLI entry point; `--check` compares and writes nothing.
- `src/app/tokens.generated.css` — generated, committed, do-not-edit. 17 colors × 2 modes, 8 type
  styles, 6 radii, 5 spacings.
- `src/app/globals.css`, `src/app/page.tsx` — imports the generated theme; the scaffold page now
  wears token utilities so the e2e gate can prove utilities actually read the tokens.
- `eslint.config.mjs` — `colorLiteralBanConfig` + `prngExemptionConfig`, and a layering note on the
  flat-config replace-not-merge trap now that four blocks share `no-restricted-syntax`.
- `tests/tokens/{to-css,contrast,design-source,no-hex,eslint-config,token-cli}.test.ts` — 260 unit
  tests total across the repo.
- `e2e/tokens.spec.ts` — 11 assertions on the built-and-served app, both color schemes.
- `.github/workflows/ci.yml` — `tokens:check` in `check`, `test:tokens` in `a11y`.
- `package.json` / `tsconfig.json` — three scripts, the `yaml` devDependency,
  `allowImportingTsExtensions`.
- `scripts/design-tokens/README.md`, `src/ui/README.md`, `src/app/README.md` — the token contract.
- `docs/implementation-artifacts/{deferred-work.md,sprint-status.yaml}` — ledger and status.

### Review findings

Two independent reviewers (adversarial + edge-case) over the full diff. **7 patches applied, 6
deferred, 5 rejected; no intent gaps and no spec defects** — the specification held, and every
finding was implementation-level. Full breakdown in the Review Triage Log above.

The consequential find is one both reviewers reached independently: the new lint block **silently
revoked the AD-14 PRNG exemption**, because ESLint flat-config rule entries replace rather than
merge. It was invisible — every gate green — only because `src/adapters/prng.ts` is still a throwing
stub. The file whose entire purpose is to be the one sanctioned `Math.random` site could no longer
contain `Math.random`, and story 1-12 would have collided with it. The second theme is that the
generator validated *structure* (pairing, references) but never the *shape of the values it emits*,
so an unquoted hex in DESIGN.md — a comment in YAML, hence `null` — would have shipped
`--color-ink: null;` with no error at all.

Follow-up review recommended: **true.** Not for patch volume alone. Three of the seven changed
behaviour rather than tidying it: a fourth ESLint config block re-layers a rule three others already
share and ordering is load-bearing; the generator gained a rejection path that every future
DESIGN.md edit now passes through; and `page.tsx` — a production surface — was dressed in token
utilities to make the e2e gate meaningful. Each is small; together they are the kind of change worth
a second pair of eyes.

### Verification performed

Every gate was run by the orchestrator after the patches, not merely reported by the implementer.

| Command | Exit | Result |
| --- | --- | --- |
| `npm run lint` | 0 | clean |
| `npm run typecheck` | 0 | clean |
| `npm test` | 0 | 260 tests / 8 files |
| `npm run test:coverage` | 0 | `src/domain/**` 100% statements, branches, functions, lines — unchanged |
| `npm run test:mutation` | 0 | score 100.00; 105 killed, 4 timeout, **0 survived** |
| `npm run tokens:check` | 0 | in sync |
| `npm run build` | 0 | Tailwind compiled the generated import, no CSS error |
| `npm run test:tokens` | 0 | 11 passed, light + emulated dark |
| `npm run test:a11y` | 0 | axe clean |

Independently confirmed beyond the suite, by direct probe rather than by report:

- **The drift gate actually fires.** An earlier probe that merely appended a newline to DESIGN.md
  did *not* trip it — correctly, since the generator reads only frontmatter; that probe was invalid,
  not the gate. Re-run by changing a real token value (`surface-base` `#f8fafc` → `#f8fafb`):
  exit **1**, naming the file and `npm run tokens:build`, writing nothing. DESIGN.md restored and
  confirmed byte-identical by `sha256sum`, with a clean tree afterward.
- **The artifact has the shape the ACs claim.** Zero token names end in `-dark`; exactly 17 distinct
  `--color-*` names, each declared exactly twice (34 declarations).
- **The color ban is scoped correctly and fires on the right things.** A hex literal errors in
  `src/**` and lints clean in `scripts/` and `tests/`. `oklch(…)` now errors in `src/**` — it did
  not before the patch. `Math.random` in `prng.ts` lints clean while a color literal there still
  errors, proving the restored exemption is randomness-scoped.
- **The generator's new validators reject what they claim to.** All six malformed-input modes were
  reproduced by execution before the fix and confirmed to throw named errors after.

### Residual risks

- **The six deferred findings are open**, three of them medium. The sharpest is that DESIGN.md's
  border tokens sit at 1.11–1.23:1 against their surfaces while `components:` makes them the
  boundaries of interactive controls, which WCAG 2.2 SC 1.4.11 puts at 3:1 — the same class of
  source-document defect as the already-recorded `input-border` shortfall, and story 1-6 renders the
  first real button.
- **The contrast gate enumerates rather than enforces completeness.** A color added to DESIGN.md
  ships with no contrast assertion and nothing fails to prompt one, which does not honor DESIGN's
  "any future token change must re-verify the matrix". Recorded; cheap to close.
- **The dark set remains `[ASSUMPTION]`-flagged in DESIGN.md** — derived by inversion, never mocked.
  This story proves it meets the floor *by computation*, which is exactly what DESIGN already
  claimed and strictly weaker than "it looks right". Those values are now live in every environment.
- **No webfont is loaded.** `--font-sans` / `--font-mono` are emitted, but until 1-6 wires
  `next/font` the fallback stacks are what renders — so DESIGN's binding "all numerals are
  monospaced" rule is satisfied generically, not in the intended faces.
- **shadcn/ui copy-in in 1-6 is the next real test of AD-15.** The ban now covers oklch, which is
  what shadcn v4 actually ships, but the primitives must be *re-pointed* at these tokens rather than
  added alongside them, and their `.dark` class block dropped in favour of `prefers-color-scheme`.
- **The branch is unmerged and sits on top of story 1-4's unmerged branch.** `story/1-5-…` was cut
  from `story/1-4-…` (master + 1-4) rather than from `master`, so 1-4's commit rides along in this
  branch. Nothing is lost, but the two must be merged in order.

---

## Auto Run Result — follow-up review pass (2026-07-19)

A second, independent review of the same diff (`45e745ce..HEAD`), run because the prior pass set
`followup_review_recommended: true`. No code was re-derived: **0 intent gaps, 0 spec defects.** The
specification held a second time; every finding was again implementation-level.

**10 patches applied, 4 deferred, 11 rejected.**

### What the second pass caught that the first did not

Two findings matter, and both are cases where the *previous pass's own fix* was narrower than its
record claimed:

1. **The injection fix covered one namespace out of four.** The first pass recorded "a non-color
   value injected raw CSS, closing the `@theme` block early" as closed. It was closed for `colors`,
   which gained a hex regex. `typography`, `rounded` and `spacing` kept a bare `typeof === 'string'`
   check, so `fontSize: '14px; } body { display: none'` still generated — silently — a declaration
   that closes the theme block and writes a real rule into the app's global stylesheet. Reproduced
   by execution before the fix. Token *keys* had the mirror-image hole.

2. **The accessibility gate was weaker than the standard it enforces.** The contrast floors compared
   a value already rounded to two decimals, so a true 4.4951:1 cleared the 4.5:1 floor. The story's
   headline claim is that DESIGN's "verified by computation" promise became a real computation; the
   computation was 0.005 permissive. Rounding now lives in the failure *message* only.

A third is worth naming because it is a category, not a bug: the test that **names F-5** — the
story's central architectural finding — was a pure negative (`expect(…'-dark').toBe('')`) that would
pass just as green if the stylesheet never loaded at all. It now carries a positive control.

### Files changed in this pass

| File | Change |
| --- | --- |
| `scripts/design-tokens/to-css.ts` | `CSS_SAFE_VALUE` / `TOKEN_KEY` guards over typography, rounded, spacing (keys and values); empty-value and empty-`colors:` guards |
| `scripts/design-tokens/design-source.ts` | Strip UTF-8 BOM; restate YAML parse failures against DESIGN.md |
| `scripts/generate-design-tokens.ts` | `process.exitCode` instead of `process.exit()`; `readCommitted` flattens ENOENT only |
| `tests/tokens/contrast.test.ts` | `measuredRatio` (unrounded) judges the floors; `ratio` (rounded) reproduces DESIGN's figures |
| `tests/tokens/to-css.test.ts` | +17 tests over value/key safety, including the reproduced injection strings |
| `tests/tokens/design-source.test.ts` | +2 tests over BOM and YAML-error diagnostics |
| `tests/tokens/no-hex.test.ts` | `onTestFinished` removes fixture temp trees |
| `e2e/tokens.spec.ts` | Positive control in the F-5 test |
| `.github/workflows/ci.yml`, `package.json` | One `test:browser` invocation for both specs — was two full `next build`s |

### Verification performed

Every gate re-run by the orchestrator after the patches.

| Command | Exit | Result |
| --- | --- | --- |
| `npm run lint` | 0 | clean |
| `npm run typecheck` | 0 | clean |
| `npm test` | 0 | **277** tests / 8 files (was 260) |
| `npm run test:coverage` | 0 | `src/domain/**` 100% statements, branches, functions, lines — unchanged |
| `npm run test:mutation` | 0 | score 100.00; 105 killed, 4 timeout, **0 survived** — unchanged |
| `npm run tokens:check` | 0 | in sync |
| `npm run build` | 0 | compiled, 2 static routes |
| `npm run test:browser` | 0 | **12 passed** in one invocation / one build (a11y + tokens) |

Confirmed by direct probe rather than by report:

- **The drift gate's message survives a pipe.** Real drift forced by appending to the generated
  file, output captured through a pipe: exit **1**, full two-line message intact — the failure mode
  `process.exit()` would have produced (red step, no text) does not occur. Generated file restored
  and confirmed by `git diff --stat`.
- **The injection strings are now fixtures.** Every value that previously escaped its declaration
  (`;`, `}`, comment delimiters, newlines, quotes, the `--font-sans` apostrophe escape) throws a
  named error naming the section, the key and the reason.
- **The rounding change is load-bearing, not cosmetic.** Verified in node that 4.4951 rounds to 4.5
  and cleared the old assertion; it fails the new one.

### Follow-up review recommendation

**false.** The ten patches are narrower and more localized than the previous pass's: no new config
block, no new production surface, no re-layered rule ordering. Eight are diagnostics, cleanup, or
test-strengthening with no runtime effect on the artifact; the two consequential ones (value
validation, contrast rounding) both *tighten* an existing gate along a path that is now directly
tested, and neither changes the generated output — `tokens:check` reports the artifact byte-identical
before and after. Two independent passes have now found zero intent gaps and zero spec defects.

### Residual risks (this pass)

- **Four new deferred findings**, two of them medium, recorded in `deferred-work.md` as new entries.
  The sharpest is that dark mode currently paints `main` dark inside a **UA-white canvas** — nothing
  declares `color-scheme` and nothing paints `body`. It is genuinely 1-6's (the intent contract
  scopes body/layout styling out of 1-5), but it means the dark theme is not actually viewable
  end-to-end today, and the token e2e asserts computed styles on `main` without observing the canvas
  behind it.
- **The "no `dark:` variant" rule is still prose only.** It is stated in five places and enforced
  nowhere — the same unenforced-prohibition shape this story exists to fix, one level up. Story
  1-6's shadcn copy-in ships `dark:` variants by default and would pass every gate.
- **The color ban still misses named colors** (`red`, `white`) and anything outside `src/**`.
  Both are real holes in AD-15's mechanization, both recorded, neither closable here without
  scope expansion.
