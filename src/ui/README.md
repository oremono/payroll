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

This matters most at the shadcn/ui copy-in, whenever it happens: shadcn ships its own
`--background` / `--foreground` / `--primary` variables with hard-coded values, and they must be
**re-pointed at these tokens**, not added alongside them.

**No `dark:` variant — and now it is a gate, not a wish.** Story 1-6 added the ban to
`eslint.config.mjs`, in the shared `TOKEN_CONTRACT_BAN_SELECTORS` list that all three `src/**`
blocks spread, so it holds in a component, in the pure core, and in the PRNG port alike.
`tests/tokens/eslint-config.test.ts` pins every one of those intersections, because flat-config rule
entries **replace rather than merge** and a narrower block that forgets a selector revokes it
silently.

## Webfonts

Loaded, as of story 1-6. `@fontsource/hanken-grotesk` and `@fontsource/jetbrains-mono` (both
`5.3.0`, static packages) are imported in `src/app/layout.tsx` — only the weights DESIGN uses:
sans 400/600/700, mono 400/500/600.

**Fontsource, not `next/font`.** `next/font` mints a generated family name
(`__Hanken_Grotesk_1a2b3c`), but `--font-sans` / `--font-mono` are generated from DESIGN.md and
drift-gated, so naming it would mean hand-authoring a token or amending the single source of visual
truth. These packages declare the **literal** families `'Hanken Grotesk'` and `'JetBrains Mono'`,
which the generated stacks already name first — so nothing about the token contract changes; the
fallback simply stops being what renders.

## The shell (story 1-6)

| File | What it owns |
| --- | --- |
| `nav-items.ts` | The seven destinations as DATA, plus `isActiveNavItem` and `pageTitleFor`. Framework-free, so the IA is unit-testable without a DOM. |
| `skip-link.tsx` | The bypass link. FIRST in DOM order, ahead of the sidebar's seven links — the only position that makes it a bypass. |
| `announcer.tsx` | The ONE app-level `aria-live="polite"` region, plus `useAnnounce()`. |
| `sidebar-nav.tsx` | The fixed 256px nav. `aria-current="page"` via `usePathname()`; Settings pinned bottom. |
| `app-header.tsx` | The fixed 64px header: the page `<h1>` and the as-of control. |
| `as-of-control.tsx` | The named button, the popover, the native date input, and the URL push. |

Three rules the shell establishes, which every later surface inherits:

- **The as-of date lives in the URL** (`?asOf=YYYY-MM-DD`), resolved through `resolveAsOf` at the
  delivery boundary. A bookmarked URL reproduces a view exactly.
- **The live region is never remounted.** It is mounted once in the root layout, above every
  surface. A live region announces its *changes*; a region that is itself replaced has no previous
  content to differ from and most screen readers say nothing at all — so a region rendered inside
  the surface it reports on would be silent in exactly the case it exists for. (AD-20)
- **Form controls sit on `surface-card`.** Not decoration: `input-border` measures 3.09:1 on card
  but 2.96:1 on `surface-base` and 2.82:1 on `surface-tint`, both below DESIGN's own 3:1 non-text
  floor. See `deferred-work.md`.

**No shadcn/ui, and no `@radix-ui`, `react-day-picker`, `date-fns`, `clsx`, `class-variance-
authority`, `tailwind-merge`, or `lucide-react`.** The only primitive the shell needed was a date
picker, and shadcn's is five runtime dependencies whose Tailwind v4 templates ship `oklch` literals,
a second set of variable names with hard-coded values, and a `.dark` class block — three
simultaneous AD-15 violations. A native `<input type="date">` inside a hand-built popover is fully
keyboard-accessible, inherits `color-scheme`, adds nothing, and violates nothing. The copy-in and
its token re-pointing obligation move to the first capability form that needs a primitive the shell
does not build; it is recorded in `deferred-work.md`, not dropped.

## May `ui` call a domain or application FUNCTION, or only import types?

**Pure functions, yes. Use-cases, repositories, and adapters, no.** `as-of-control.tsx` calls
`resolveAsOf` (application) and `formatPlainDate` / `plainDateToIso` (domain) at runtime, because it
must turn a URL param into a displayed date on the client, where no server render is available to do
it. All three are pure, total, and clock-free, so calling them adds no I/O, no non-determinism, and
no coupling to infrastructure.

What stays banned is the other thing the boundary rule is actually protecting against: a component
reaching for a use-case, a repository port, or anything under `src/adapters/**`. The ESLint zone
message still says "types only, by convention" and is still not mechanically enforced — recorded in
`deferred-work.md` since the 1-2 review, and re-recorded by 1-6 now that a real call site exists.
