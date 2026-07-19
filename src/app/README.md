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

Story 1-1 ships only a minimal root `layout.tsx` + placeholder `page.tsx` that boots and builds. The
sidebar IA, header, global as-of-date control, and webfont loading land in **1-6**.
