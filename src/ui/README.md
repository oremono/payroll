# `src/ui/` — Components

**Allowed imports: `application`, `domain` (types only).**

Presentational components live here. They render data handed to them; they do not reach into the
database or run domain math themselves beyond consuming domain **types**. No Prisma, no direct I/O.

Design tokens are **generated** from `DESIGN.md` frontmatter (light + `*-dark`) and re-pointed into
shadcn/ui primitives on copy-in — **never hand-authored, no hex literal in `src/`**. (AD-15)

Empty seam in Story 1-1. The token build step lands in **1-5**; shadcn/ui copy-in and the app shell
land in **1-6**.
