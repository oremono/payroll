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

## Modules

- `text.ts` — pure text normalization (`blankToNull`).
- `money.ts` — **the** money type and **the** money formatter (Story 1-4, Law 4 / AD-4). Read the
  next section before using it.

## `money.ts` — the one money primitive

```ts
type Money = { readonly amountMinor: bigint; readonly currency: string };
type CurrencyFormat = { code; symbol; minorUnitExponent; groupingStyle };

formatMoney(money: Money, format: CurrencyFormat): string | null
toBoundaryMoney(money: Money): BoundaryMoney            // amountMinor -> decimal STRING
fromBoundaryMoney(value: BoundaryMoney): Money | null    // canonical form only
divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint | null
```

Four things about it are load-bearing, and each has been got wrong on other projects:

1. **The formatter takes a `CurrencyFormat`, not a currency code.** This layer may import nothing,
   so it cannot look a currency up. The symbol, minor-unit exponent, and grouping style are read
   from the `currency` reference row **at the delivery boundary** and handed in. A call without
   the argument does not compile — that is the Law 4 requirement, asserted by a `@ts-expect-error`
   in `tests/domain/money.test.ts` that `npm run typecheck` would fail on if the call ever became
   legal.

2. **The exponent is always a parameter.** Never `100`, never derived. `JPY` has exponent `0`, and
   it is in the test suite precisely so that a hard-coded `100` cannot pass.

3. **`Intl` is banned here.** `Intl.NumberFormat`'s output depends on the Node ICU build, which
   makes it non-deterministic across environments (Law 6) — and it applies locale conventions this
   product has not chosen. Grouping is hand-rolled: `WESTERN` in threes, `INDIAN` as last-three
   then twos. Render shape is `[-]symbol + grouped-major[.fraction] + ' ' + ISO code`
   (`₹21,50,000 INR`), with the fraction **omitted when the minor remainder is zero** and
   otherwise zero-padded to the exponent.

4. **Everything is total.** A currency mismatch, a negative exponent, a malformed boundary string,
   a zero denominator — each is a `null` return, never a throw. `fromBoundaryMoney` additionally
   rejects anything that is not the canonical decimal form, because `BigInt('')` is `0n`,
   `BigInt(' 1 ')` is `1n`, and `BigInt('0x10')` is `16n`; all three would otherwise become
   plausible salaries.

`divideRoundHalfUp` is the exact-arithmetic seed AD-3 (even-`n` median), AD-5 (distance), and
AD-13 (FX) all build on: it rounds the **magnitude** half-up and reapplies the sign, so
`(-5n, 2n)` is `-3n`. No decimal library is involved — `bigint` is exact.

There is no FX conversion here and there never will be a second formatter.
