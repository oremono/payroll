# `src/app/` — Next.js App Router surfaces

**Allowed imports: `application`, `domain` (types only), `ui`, `adapters` (composition root
only).**

Two edges extend the base matrix, recorded in story 1-2's review: `app → ui` (pages render
components) and `app → adapters` (this layer is the **composition root** — Server Components /
Server Actions construct adapters and inject them into use-cases; nothing else wires the shell).

Route segments, layouts, pages, and the two sanctioned Route Handlers (CAP-1 multipart upload and
CSV export — AD-21). Reads call use-cases directly in-process via Server Components (never `fetch`
to our own origin); mutations go through Server Actions. (AD-21)

Story 1-1 ships only a minimal root `layout.tsx` + placeholder `page.tsx` that boots and builds. The
sidebar IA, header, and global as-of-date control land in **1-6**.
