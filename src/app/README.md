# `src/app/` — Next.js App Router surfaces

**Allowed imports: `application`, `domain` (types only).**

Route segments, layouts, pages, and the two sanctioned Route Handlers (CAP-1 multipart upload and
CSV export — AD-21). Reads call use-cases directly in-process via Server Components (never `fetch`
to our own origin); mutations go through Server Actions. (AD-21)

Story 1-1 ships only a minimal root `layout.tsx` + placeholder `page.tsx` that boots and builds. The
sidebar IA, header, and global as-of-date control land in **1-6**.
