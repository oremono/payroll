---
name: 'Version & Technology Reality Check — ARCHITECTURE-SPINE.md'
type: review
target: ../ARCHITECTURE-SPINE.md
scope: 'Stack table + every named technology in the spine'
method: 'independent web verification (WebSearch/WebFetch), July 2026'
reviewed: '2026-07-17'
verdict: 'Stack is materially accurate; one stale default (Neon/Postgres), three unpinned entries'
---

# Version & Technology Reality Check

Every version in the Stack table was checked against upstream release data as of **2026-07-17**. Nothing was accepted from assertion.

## Verdict

Seven of eight version pins are correct and current. The one entry the author flagged as unverified — **Postgres 17 on Neon** — is the one that is out of date: Neon's default moved to **Postgres 18** on 2026-06-05. No named technology is dead, no version is fabricated, and the shadcn/ui compatibility claim holds. The remaining defects are unpinned entries, not wrong ones.

## Findings

### F-1 — Neon's default Postgres is 18, not 17 — MEDIUM

- **Claimed:** Stack table `PostgreSQL (Neon serverless) | 17`; the Containers diagram hard-codes `PostgreSQL 17`.
- **Reality:** Neon's changelog of **2026-06-05** states verbatim: *"Postgres 18 is now the default for newly created Neon projects."* Postgres 18 reached GA on Neon with preview limitations lifted and is fully supported for production workloads. Neon continues to support 14, 15, 16, and 17.
- **Assessment:** Not broken — PG 17 remains selectable, so the pin is *buildable*. But the table reads as a statement of what Neon serves, and that is no longer true. A `prisma migrate dev` against a freshly created Neon project in July 2026 lands on **18**, not 17, unless the version is explicitly chosen at project-creation time. That mismatch is silent: local, preview-per-PR, and production branches could each end up on a different major depending on when they were created.
- **Impact on this architecture:** low blast radius by design. AD-2 forbids the database from computing any domain statistic (no `percentile_cont`, no `AVG`, no window functions), so the spine deliberately uses almost none of the surface area where a Postgres major version could change an answer. This is the AD-2 discipline paying off — a version drift that would be a correctness risk in a SQL-computing design is close to inert here.
- **Fix:** either pin 18 (the default, and the version a July 2026 practitioner gets by default) or keep 17 and state it as a *deliberate* choice with the project-creation step that enforces it. Do not leave it as a bare `17` that a reader will assume is the default. Whichever is chosen, add it to the Deployment table so all three environments provably agree.

### F-2 — Three Stack entries carry no version — MEDIUM

- `shadcn/ui | current (copy-in)` — "current" is not a pin. shadcn/ui is copy-in source, not a dependency, so it has no lockfile entry and *nothing* records what was copied. Two stories scaffolded a month apart get different component source with no diff trail. This is the entry most in need of a pin precisely because the package manager will not pin it for you: record the CLI version and the date of the copy.
- `Playwright | current *[ASSUMPTION]*` — honestly flagged, still unresolved. Playwright is not mentioned anywhere else in the spine; the Source tree's `tests/` is explicitly domain unit tests, "no DB, no clock, no network." Either an E2E tier exists and needs a pin plus a home in the source tree, or Playwright should be cut from the Stack table and deferred. Right now it is a dangling assumption.
- `TypeScript | 5.x (strict)` — a range, not a pin. Tolerable (`strict` is the load-bearing part), but `5.x` spans years of behavior. Prefer an exact minor.

### F-3 — Node 24's Active LTS window closes in 3 months — LOW

- **Verified:** Node 24 **is** the correct Active LTS pin today. Node 22 is in Maintenance; Node 26 is still Current, not LTS.
- **But:** Node 24 Active LTS ends **2026-10-20** (→ Maintenance until 2028-04-30), when Node 26 promotes to LTS. The pin is right and will stay *supported* for years, but "24 LTS" means something different after October. Worth a dated note so the next reader knows the pin was correct as of July 2026 rather than eternally.

## Verified — no action

| Entry | Claimed | Verified as of 2026-07-17 | Status |
| --- | --- | --- | --- |
| Next.js (App Router) | 16.2.10 | 16.2.10, released 2026-07-01, current stable/LTS. 16.3 exists in **preview** only (announced 2026-06-25) — correctly not adopted. | Correct |
| React | 19.2.7 | 19.2.7 is current stable (published ~June 2026). | Correct |
| Node.js | 24 LTS | Active LTS. See F-3 for the October transition. | Correct |
| Prisma ORM | 7.8.0 | 7.8.0 is the current stable on npm. Prisma 7 dropped the Rust query engine for a TypeScript runtime. | Correct |
| Tailwind CSS | 4.3.2 | 4.3.2, released 2026-06-29, current stable. | Correct |
| Vitest | 4.1.10 | 4.1.10, published 2026-07-06 — current, and only days old at time of writing. | Correct |
| shadcn/ui | real / current / compatible | Real and maintained. All components updated for Tailwind v4 **and** React 19; CLI initializes v4 projects; documented install path for Next.js 16 App Router + Server Components. Compatibility claim **holds on all three axes**. | Correct (but unpinned — F-2) |

### Deprecations and successors — none found

No entry in this stack is deprecated, abandoned, or has a successor a July 2026 practitioner would reach for instead. Specifically checked:

- **Prisma 7** is the current major and the post-Rust rewrite — this is the modern choice, not the legacy one. No migration pressure toward Drizzle or Kysely is implied by anything in the spine.
- **shadcn/ui** has not been superseded; the copy-in model is intact.
- **Vitest 4** is current; no successor.
- **Next.js App Router** remains the supported paradigm at 16.x. Pages Router is not implied anywhere.

### Note on React security

React 19.2.x received critical patches in January 2026 (CVE-2025-55182 "React2Shell" and related). The pinned **19.2.7 is above the patched floor** — no exposure. Flagged only so the pin is not casually rolled *backward* during dependency resolution.

## Recommended edits

1. **Resolve F-1.** Change `17` → `18` in the Stack table *and* the Containers diagram, or keep 17 and mark it deliberate with the enforcing project-creation step. Add the Postgres major to the Deployment & environments table so local / preview / production cannot silently diverge.
2. **Pin shadcn/ui** to a CLI version + copy date. Copy-in means the lockfile will not do this for you.
3. **Resolve Playwright.** Pin it and give it a home in the source tree, or move it to Deferred. Do not ship a Stack row marked `[ASSUMPTION]`.
4. **Pin TypeScript** to an exact minor.
5. **Date the stack.** Add "versions verified 2026-07-17" to the Stack section. Every row above is a point-in-time fact, and F-3 is already three months from changing meaning.
