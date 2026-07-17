# `src/application/` — Use-cases and ports

**Allowed imports: `domain` only** (plus other modules within `src/application/**`).

No Prisma, no Next, no adapters. The application layer orchestrates domain logic and declares the
**ports** (interfaces) that adapters implement — it depends on abstractions, never on concrete I/O.
Like the domain, this layer takes the as-of date / threshold as explicit arguments and never calls
`Date.now()` or reads a timezone. (Law 6 / AD-11)

Sub-directories:

- `ports/` — repository, clock, prng, id interfaces. Adapters reach the domain **only** through
  these ports. (AD-1)
- `use-cases/` — one per capability (populated by later stories).

Every computed answer leaves this layer as a discriminated union carrying its receipts —
`{ kind: 'answer', … } | { kind: 'refusal', reason, counts }`. (Law 8 / AD-20)

> Populated by later capability stories. Mechanical import-boundary enforcement is Story **1-2**.
