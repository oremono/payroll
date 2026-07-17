# `src/domain/` — Pure functional core

**Allowed imports: nothing outside `src/domain/**`.**

No Prisma, no Next, no `Date`, no `Math.random`, no `fs`, no env, no network — no I/O of any
kind. Every function here is **pure and total**: same inputs ⇒ same output, and it never throws
(rejections and refusals are return values, never exceptions).

- The as-of date and (where relevant) the threshold arrive as **explicit arguments** — this layer
  never asks what "now" is. (Law 6 / AD-11, AD-19)
- There is exactly **one** of each canonical calculation (median, current-salary resolver, verdict
  sentence, …); never write a second.

Dependencies point strictly inward: `domain ← application ← adapters/ui`. This layer is the
innermost ring and depends on no other layer. (Law 2 / AD-1)

> The ESLint import-boundary rule that mechanically enforces this lands in Story **1-2**. Until then
> this README is the contract.
