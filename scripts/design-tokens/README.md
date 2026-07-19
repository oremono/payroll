# `scripts/design-tokens/` — the design-token build

Emits `src/app/tokens.generated.css` from the YAML frontmatter of
`docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/DESIGN.md`. (AD-15)

**This is build tooling, not product logic.** It lives outside `src/`, so the Law-2 purity lint, the
layer-boundary zones, and the `src/domain` coverage / mutation gates do not apply to it. Unlike the
domain it may — and does — **throw**: a malformed DESIGN.md must stop the build loudly, because a
partial or stale token file is worse than no build at all.

## The workflow

```
edit DESIGN.md  →  npm run tokens:build  →  commit both files
```

That is the whole loop. **Never hand-edit `src/app/tokens.generated.css`**, and never hand-author a
token in `globals.css` or a component: the next build erases the edit, and `npm run tokens:check`
rejects it before that.

| Command | What it does |
| --- | --- |
| `npm run tokens:build` | Regenerate `src/app/tokens.generated.css`. Idempotent — a second run leaves `git status` clean. |
| `npm run tokens:check` | Compare instead of write. Exit 0 in sync; **exit 1** on drift, naming the rebuild command. Writes nothing. Runs in CI's `check` job. |
| `npm test` | Runs `tests/tokens/**` — the transform's I/O matrix and shape validation, the WCAG contrast gate, the CLI's drift gate, the lint config's ban matrix, and the CSS-side color ban. |
| `npm run test:tokens` | Playwright, against the built-and-served app: the tokens actually resolve on `:root`, in both color schemes. Runs in CI's `a11y` job. |

Node 24 executes the CLI directly via native type-stripping — no `tsx`, no `ts-node`, no build step
for the build step. That is why these modules import each other with an explicit `.ts` extension
(`allowImportingTsExtensions` in `tsconfig.json`): it is the one specifier form Node's ESM loader
accepts while stripping types in place.

## One token name, two values

DESIGN.md's frontmatter is a **flat** color map with `-dark` suffixes. Read literally that yields two
unrelated tokens per color — `--color-ink` and `--color-ink-dark` — which is exactly the drift AD-15
exists to prevent (architecture-review finding **F-5**).

So the suffix is a **mode selector**, not part of a name. Every color is emitted **once**, under its
light name, inside `@theme static`; the same name is re-declared inside a
`@media (prefers-color-scheme: dark)` block with its `-dark` value:

```css
@theme static      { --color-surface-base: #f8fafc; }
@media (prefers-color-scheme: dark) {
  :root            { --color-surface-base: #0f172a; }
}
```

Tailwind compiles every utility to `var(--color-…)`, so re-pointing the variable re-points the
utility. **No component ever writes a `dark:` variant, and no component ever chooses between two
token names.** Dark mode is system preference only — no toggle, no class hook, no attribute hook, no
persistence cookie is ratified.

`@theme static` (rather than the default) forces Tailwind to emit *all* theme variables, used or
not: the token contract must be observable and overridable before anything consumes it.

## Namespace mapping

| Frontmatter | CSS custom property |
| --- | --- |
| `colors.<name>` / `colors.<name>-dark` | `--color-<name>`, one name, light + dark values |
| `typography.<name>` | `--text-<name>`, plus `--text-<name>--line-height`, `--font-weight`, and `--letter-spacing` where tracked |
| `typography.*.fontFamily` | lifted to `--font-sans` and `--font-mono` — DESIGN binds *all* numerals to the mono face, which is a two-family contract, not eight |
| `rounded.<name>` | `--radius-<name>`; **`DEFAULT` → the bare `--radius`**, which is what the `rounded` utility reads |
| `spacing.unit` | the bare `--spacing` — Tailwind v4's dynamic scale base |
| `spacing.<other>` | `--spacing-<other>` |
| `components.*` | **not emitted.** Component anatomy is not a Tailwind theme namespace; it is *validated* for dangling references and otherwise left to the component work. |

## The validators

Each throws, **naming the section, the key, and what was wrong**, because DESIGN.md is **read-only**
to the token build — a defect there is reported, never repaired. Malformed or incomplete input
produces an actionable error, never a partial file.

Shape first (`validateShape`), before a single declaration is rendered. `design-source.ts` proves
the five sections exist and are mappings; nothing proves their CONTENTS, and **YAML does not
typecheck**, so the `DesignFrontmatter` type is a claim about the document rather than a guarantee:

1. **Colors** — every value, light and dark alike, a **six-digit hex string** (`#rrggbb`).
   Shorthand is rejected rather than expanded (the contrast gate reads that form only, and a token
   spelled two ways drifts). This catches the commonest authoring slip of all: an **unquoted** hex
   in YAML — `surface-base: #f8fafc` — is read as a **comment**, and the value silently becomes
   `null`. It also closes a real injection: a value like `red; } body { display:none` would have
   closed the `@theme` block early and written a rule into the app's global stylesheet.
2. **Typography** — each style a mapping whose `fontFamily`, `fontSize`, `fontWeight` and
   `lineHeight` are present strings (`letterSpacing` optional, a string where present). A missing
   one used to emit `--text-body-md--line-height: undefined;` with no error at all.
3. **Radii and spacing** — every value a string, and the two BARE keys present: `rounded.DEFAULT`
   and `spacing.unit`. Missing, each silently emitted nothing and took a whole family of utilities
   down with it — the `rounded` utility, and the entire numeric spacing scale.
4. **Component anatomy** — every value a string, so the reference scan below can name the component
   and the key instead of raising `TypeError: value.matchAll is not a function`.

Then the value-level rules:

5. **Unpaired color**, either direction. A light color with no `-dark` counterpart would render
   identically in both modes (a silent contrast failure); an orphan `-dark` key is a value nothing
   can reach.
6. **Font families.** Exactly one proportional and one monospaced family, classified by name. A
   third face, or a rename, fails by name rather than being silently dropped.
7. **Dangling `{namespace.key}` reference** inside `components:`. Never emitted, but read as a
   checksum over the rest of the frontmatter — a dangling reference would otherwise surface only
   when someone hand-built the component months later.

## The two halves of the AD-15 ban

The prohibition is on a **color literal in any notation**, not on hex: AD-15's subject is a color
that escaped the token contract, and shadcn/ui's Tailwind v4 templates — the story-1-6 copy-in that
`deferred-work.md` names as the likeliest violation — ship **oklch**, not hex.

| Half | Where | What it covers |
| --- | --- | --- |
| `colorLiteralBanConfig` in `eslint.config.mjs` | `src/**` `.ts`/`.tsx`/… | hex (3/4/6/8-digit) and `rgb`/`rgba`/`hsl`/`hsla`/`hwb`/`lab`/`lch`/`oklab`/`oklch`/`color()`, in string literals **and** template literals |
| `tests/tokens/no-hex.test.ts` | every stylesheet under `src/` (`.css`, `.scss`, `.sass`, `.less`, `.pcss`, `.styl`) | the same notations — ESLint cannot lint CSS |

`src/app/tokens.generated.css` is the single sanctioned exception, and *that* is asserted rather
than assumed. `color-mix()` stays legal: it composes existing tokens rather than naming a color.

`eslint.config.mjs` now has **four** blocks setting `no-restricted-syntax`. Flat-config rule entries
**replace rather than merge** — a narrower block that forgets a selector silently REVOKES it. That
is how the AD-14 PRNG exemption was once lost. `tests/tokens/eslint-config.test.ts` pins every
intersection by running the real config through `ESLint.lintText`; read the layering note at the top
of `eslint.config.mjs` before touching any of those blocks.

### The known false positive, and its escape hatch

`#feed`, `#face`, `#dad`, `#beef`, `#decade` are all valid hex spellings **and** valid fragment
identifiers, so `<a href="#feed">` and `querySelector('#beef')` are rejected. The two are not
separable syntactically, and contorting the selector to guess intent would cost the ban its teeth —
so this is an **accepted, tested edge**. Renaming the anchor is usually the better fix; where it is
not, silence that one line with a reason:

```tsx
// eslint-disable-next-line no-restricted-syntax -- fragment identifier, not a color.
<a href="#feed">…</a>
```

## Why the output is committed

The Prisma client is gitignored and regenerated in `postinstall`; this artifact goes the other way
deliberately. It is **one small file** that `next dev`, `next build`, and Playwright all need present
with no pre-step, and whose every change is exactly what a human reviewer should see in a diff — a
token moving is a visual-contract change, not noise.

Drift is caught the way schema drift is: an `--exit-code` check in CI, the direct analogue of
`prisma migrate diff --exit-code`. Generation is **deliberately not wired into `prebuild`** — a build
that silently regenerated the file would make the drift gate unfalsifiable.

## The contrast gate

`contrast.ts` implements WCAG 2.x relative luminance and contrast ratio;
`tests/tokens/contrast.test.ts` re-derives the ratified pair matrix from the frontmatter on every
run. DESIGN.md § Contrast floor commits that "any future token change must re-verify the matrix
before shipping" — this is that verification, and it reproduces DESIGN's own recorded worst pairs
exactly: **5.28:1 light** and **4.72:1 dark**, both `ink-faint` on `surface-tint`.

Gated pairs are the ones the story ratifies, not every combination the palette admits.
`border-hairline` and `border-strong` are excluded (DESIGN scopes them to decorative rules and table
dividers). `input-border` is gated only on `surface-card`, the surface forms actually sit on — see
`docs/implementation-artifacts/deferred-work.md` for the two pairs that fall short of DESIGN's own
stated 3:1 and why they are recorded rather than gated.

## Files

| File | Purity |
| --- | --- |
| `to-css.ts` | **Pure.** Frontmatter object → the whole CSS file, header included. Holds the pairing rule, the namespace mapping, and the validators. |
| `contrast.ts` | **Pure.** WCAG luminance + ratio over `#rrggbb`. |
| `design-source.ts` | The seam. `parseDesignFrontmatter` is pure; `readDesignFrontmatter` is the single filesystem read. |
| `cli.ts` | The shell's **decisions**: argv, in-sync / drift / never-generated, exit codes. Effects are parameters, so the drift gate is testable. |
| `../generate-design-tokens.ts` | Wiring only — `node:fs`, `console`, `process`. Nothing left to get wrong. |
