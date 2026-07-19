# `src/app/` — Next.js App Router surfaces

**Allowed imports: `application`, `domain` (types only), `ui`, `adapters` (composition root
only).**

Two edges extend the base matrix, recorded in story 1-2's review: `app → ui` (pages render
components) and `app → adapters` (this layer is the **composition root** — Server Components /
Server Actions construct adapters and inject them into use-cases; nothing else wires the shell).

Route segments, layouts, pages, and the two sanctioned Route Handlers (CAP-1 multipart upload and
CSV export — AD-21). Reads call use-cases directly in-process via Server Components (never `fetch`
to our own origin); mutations go through Server Actions. (AD-21)

## Stylesheets

- `globals.css` — the only stylesheet `layout.tsx` imports. It pulls in Tailwind and then the
  generated theme. **Author no token here.**
- `tokens.generated.css` — **generated, committed, do not edit.** Emitted from `DESIGN.md`'s
  frontmatter by `npm run tokens:build` (AD-15); `npm run tokens:check` fails CI on drift. It is the
  one file in `src/` permitted to contain a color literal. See `scripts/design-tokens/README.md`
  for the namespace mapping and the one-name-two-values rule.

  Since story 1-6 it also carries the page CANVAS in an `@layer base` block — `color-scheme: light
  dark` on `:root` and `background-color` / `color` on `body`, both as token **references**. Without
  them, OS dark mode painted a dark app inside a UA-white page and native controls (the as-of date
  picker) rendered light-on-dark. `@layer base` so every utility outranks it: this is only ever the
  floor.

## The shell (story 1-6)

`layout.tsx` is the composition root and the only place that constructs an adapter. It renders, in
DOM order: the live region (`<Announcer>`) → `<SkipLink>` → `<SidebarNav>` → `<AppHeader>` →
`<main id="main-content" tabIndex={-1}>`.

**`await connection()` comes before the clock read, and the order is load-bearing.** Without it,
Next evaluates `systemClock.todayUtc()` at BUILD time and bakes the build date into a static
prerender, so "today" would silently be the day the app was deployed for as long as that deployment
lived. `connection()` moves the read to request time. It also makes the render dynamic, which is
what lets `useSearchParams()` inside the as-of control resolve without a Suspense boundary — all
routes therefore report as `ƒ (Dynamic)` in the build output, by design and not by accident.

`main` carries `tabIndex={-1}` so the skip link moves FOCUS into it rather than merely scrolling to
it. Without that the bypass is cosmetic: the next Tab would start from the top of the document
again.

### The seven routes

`/`, `/employees`, `/gender-insights`, `/payroll-totals`, `/overdue`, `/import`, `/settings` —
placeholders, carrying the ratified first-run statements and nothing invented beyond them. No
database read, no Prisma import, no Server Action, no Route Handler, no use-case.

Home is the exception, in one respect: it echoes the resolved as-of date **server-side** from
`searchParams`, through the same `resolveAsOf` policy the header uses. That echo is what makes
recompute observable rather than merely claimed — the header's control is a client component reading
the URL, so on its own it could show a new date while nothing had actually been recomputed.
`e2e/shell.spec.ts` asserts on that element for exactly this reason.

### The as-of date is a URL search param

`?asOf=YYYY-MM-DD`, resolved at the delivery boundary by `src/application/as-of.ts`. It follows from
constraints already ratified — reads are Server Components calling inward in-process (AD-21), and
determinism (AD-11 / AD-19) wants the as-of date visible in the address bar so a view is
reproducible and shareable. `resolveAsOf` is TOTAL: an absent, malformed, impossible, future, or
repeated param resolves to today. **There is deliberately no error surface for a bad as-of date**,
and the fallback is never silent — the header and the page both show the date that was actually
used.

A same-route param change re-renders the page but does not remount the layout, which is what keeps
the live region a stable DOM node across a recompute (AD-20).
