# `src/adapters/` — Imperative shell

**Allowed imports: `application`, `domain`** (and other `src/adapters/**` modules).

This is the only layer that touches the outside world: the database, the filesystem, the clock, and
randomness. Adapters implement the ports declared in `src/application/ports/` and are the place —
the **only** place — where side effects live.

- `db/` — Prisma client + repository implementations (from Story 1-3 onward).
- `csv/` — import parse / export render (Epic 2).
- `clock.ts` — **the only `Date.now()` / `new Date()` in the entire codebase.** (Law 6 / AD-11)
- `prng.ts` — **the only source of randomness in the entire codebase.** `Math.random` is banned
  repo-wide; the seed draws from an injected seeded PRNG. (Law: Testing / AD-14)

Adapters throw; the shell maps thrown errors to HTTP. Domain functions never throw — that
asymmetry is deliberate.

> `clock.ts` and `prng.ts` exist here as **seams** in Story 1-1 (stubs that throw "not implemented");
> they are wired up in the stories that need them. Nothing else in the tree may reach for a clock or
> a random source — it must go through these.
