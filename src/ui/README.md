# `src/ui/` — Components

**Allowed imports: `application`, `domain` (types only).**

Presentational components live here. They render data handed to them; they do not reach into the
database or run domain math themselves beyond consuming domain **types**. No Prisma, no direct I/O.

## Design tokens (AD-15)

Tokens are **generated**, never hand-authored. `src/app/tokens.generated.css` is emitted from
`DESIGN.md`'s frontmatter by `npm run tokens:build`, imported by `globals.css`, and proven in sync
by `npm run tokens:check` in CI. To change a color, a type style, a radius, or a spacing step: edit
DESIGN.md and rebuild. See `scripts/design-tokens/README.md`.

**One token name, two values.** Every color is emitted once under its light name and re-declared
inside `@media (prefers-color-scheme: dark)`. So a component writes `bg-surface-card`, never
`bg-surface-card dark:bg-surface-card-dark` — there is no `-dark` token to reach for, and no
`dark:` variant belongs anywhere in this layer. Dark mode is system preference only.

Available namespaces: `--color-*` (17 colors), `--text-*` (8 styles, with the v4 `--line-height` /
`--font-weight` / `--letter-spacing` sub-properties), `--font-sans` / `--font-mono`, `--radius`
and `--radius-*`, `--spacing` and `--spacing-*`.

**No color literal in `src/` — in ANY notation.** Hex, `rgb()`/`rgba()`, `hsl()`/`hsla()`,
`hwb()`, `lab()`/`lch()`, `oklab()`/`oklch()` and `color()` are all banned; AD-15's subject is a
color that escaped the token contract, not a color spelled in base 16. Enforced by
`colorLiteralBanConfig` in `eslint.config.mjs` for `.ts`/`.tsx`, and by `tests/tokens/no-hex.test.ts`
for stylesheets (ESLint does not lint CSS). `src/app/tokens.generated.css` is the single sanctioned
exception. `color-mix()` stays legal — it composes existing tokens rather than naming a color.

This matters most at the shadcn/ui copy-in below: shadcn's Tailwind v4 templates ship **oklch**,
not hex, so a hex-only ban would have waved the whole thing through.

Still an empty seam. shadcn/ui copy-in and the app shell land in **1-6** — and that copy-in is the
moment AD-15 is most likely to be violated: shadcn ships its own `--background` / `--foreground` /
`--primary` variables with hard-coded values, and they must be **re-pointed at these tokens**, not
added alongside them. Webfont loading (Hanken Grotesk, JetBrains Mono) is 1-6's too; the family
tokens exist, but until `next/font` is wired the fallback stacks are what renders.
