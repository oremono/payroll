---
title: 'C4 Model — Salary Management for ACME HR'
status: final
created: '2026-07-17'
updated: '2026-07-17'
companion_to: ./ARCHITECTURE-SPINE.md
---

# C4 Model

Four zoom levels over the system the [spine](./ARCHITECTURE-SPINE.md) governs. The spine is the contract; these are views of it. On any conflict the spine wins.

---

## Level 1 — System context

One user, one system, no integrations. That emptiness is a finding rather than an omission: this product exists to replace a spreadsheet, and it deliberately connects to nothing. No payroll execution (money never moves), no HRIS sync, no market benchmark feed, no notification channel — the product never reaches out, and findings wait for Alice to arrive.

```mermaid
graph TB
  Alice(["<b>Alice</b><br/>ACME HR manager<br/><i>Sole user. Owns how 10,000 people<br/>across 14 countries are paid.</i>"])
  SYS["<b>Salary Management</b><br/><i>Answers questions about how the org<br/>pays people. Never computes by hand.</i>"]
  SHEET[/"<b>Payroll spreadsheet</b><br/><i>CSV export from the Excel<br/>this product replaces</i>"/]

  Alice -->|"Reads answers, records<br/>salary changes · HTTPS"| SYS
  SHEET -->|"Bulk import, per-row<br/>rejection report (CAP-1)"| SYS
  SYS -.->|"Verdict sentences pasted<br/>into Slack by hand"| Alice

  style SYS fill:#1e293b,color:#ffffff
  style Alice fill:#f1f5f9,color:#191c1e
  style SHEET fill:#ffffff,color:#191c1e
```

The dotted line is the product's success criterion, and it is a human path on purpose: Alice copies a sentence and pastes it herself. There is no integration to build, because standing behind the number is the point.

---

## Level 2 — Containers

```mermaid
graph TB
  Alice(["Alice"])

  subgraph VERCEL["Vercel"]
    NEXT["<b>Next.js 16 application</b><br/>TypeScript · React 19 · RSC<br/><i>Serves every surface. Runs the<br/>fairness math in-process.</i>"]
  end

  subgraph NEON["Neon · aws-ap-southeast-1 (Singapore)"]
    PG[("<b>PostgreSQL 18</b><br/><i>employee · salary_record<br/>role · level · country · currency<br/>fx_rate · settings</i>")]
  end

  SEED["<b>Seed script</b><br/>node · seeded PRNG<br/><i>10,000 employees from a<br/>fixed seed (CAP-11)</i>"]

  Alice -->|HTTPS| NEXT
  NEXT -->|"Prisma 7 · SQL<br/><i>rows and sets only —<br/>never a statistic (AD-2)</i>"| PG
  SEED -->|"Prisma 7<br/><i>through the same use-cases;<br/>never a privileged write path</i>"| PG

  style NEXT fill:#1e293b,color:#ffffff
  style PG fill:#334155,color:#ffffff
  style SEED fill:#f1f5f9,color:#191c1e
  style Alice fill:#f1f5f9,color:#191c1e
```

Three containers, and the count is itself a decision. A separate API tier was rejected: two deployables, CORS, duplicated types, and a network hop, for a single-user tool over 10,000 rows.

The seed is drawn as a container rather than a script because it writes production-shaped data through the same validation as the import — AD-6, AD-7, and AD-18 bind it exactly as they bind a form submission.

---

## Level 3 — Components inside the Next.js application

This is the level the paradigm lives at. Everything is arranged around one rule: **dependencies point inward, and the core is pure** (AD-1).

```mermaid
graph RL
  subgraph SHELL["Imperative shell"]
    direction RL
    UI["<b>app/ · ui/</b><br/>RSC surfaces · Server Actions<br/>2 route handlers · components<br/><i>tokens generated from DESIGN.md</i>"]
    ADP["<b>adapters/</b><br/>db (Prisma repositories)<br/>csv (import parse · export render)<br/>clock.ts · prng.ts"]
  end

  subgraph CORE["Functional core"]
    direction RL
    APP["<b>application/</b><br/>use-cases (one per capability)<br/>ports (repository · clock · prng · id)"]
    DOM["<b>domain/</b> — <b>PURE</b><br/>money · statistics · peer-group<br/>outliers · gender-gap · timeline<br/>overdue · totals · verdict<br/><i>no I/O · no clock · no random</i>"]
  end

  UI -->|"calls use-cases<br/>in-process (AD-21)"| APP
  ADP -->|"implements ports"| APP
  APP -->|"calls pure functions"| DOM
  UI -.->|"types only"| DOM

  style DOM fill:#1e293b,color:#ffffff
  style APP fill:#334155,color:#ffffff
  style UI fill:#f8fafc,color:#191c1e
  style ADP fill:#f8fafc,color:#191c1e
```

Read the arrows: nothing points *out* of `domain/`. That is enforced by an import-boundary lint rule in CI rather than by convention, because the failure it prevents — a component importing `PrismaClient`, or a use-case calling `new Date()` — compiles cleanly and passes review.

`clock.ts` is worth naming individually. It is the only `Date.now()` in the codebase. Everything else receives the as-of date as a required argument (AD-11), which is what makes "the same question asked twice returns the same answer" a structural property rather than a good intention.

---

## Level 4 — How one answer is computed

The peer-comparison card (CAP-5), traced end to end. Every other computed surface follows the same path.

```mermaid
sequenceDiagram
  autonumber
  participant A as Alice
  participant R as RSC surface
  participant C as clock port
  participant U as use-case
  participant P as repository (Prisma)
  participant D as domain (pure)

  A->>R: opens Priya Nair's detail
  R->>C: today (UTC) — default only
  C-->>R: 2026-07-16
  Note over R: as-of date and threshold are<br/>resolved HERE and passed inward.<br/>Nothing downstream reads them. (AD-11, AD-19)
  R->>U: peerComparison(employeeId, asOf)
  U->>P: employee + salary records for (role, level, country)
  P-->>U: rows — no median, no count (AD-2)
  U->>D: compare(employee, candidates, asOf)
  Note over D: as-of population filter (AD-16)<br/>current salary per (effective_from, seq) (AD-8)<br/>n = cardinality of that exact set
  alt n ≥ 5
    Note over D: median (AD-3) · spread min–max (AD-9)<br/>distance: magnitude rounded, sign reapplied (AD-5)
    D-->>U: { kind: 'answer', median, spread, n, asOf,<br/>currency, verdictSentence }
  else n < 5
    D-->>U: { kind: 'refusal', reason: 'peer group too small', n }
  end
  U-->>R: payload carries its receipts (AD-20)
  R-->>A: card renders answer or refusal —<br/>same slot, same dignity
```

Three properties fall out of this shape, and each maps to a promise the product makes to Alice.

**The refusal is a return value, not an exception.** It travels the same path as an answer and lands in the same layout slot. EXPERIENCE.md's wager is that honest refusal is the trust-building moment; an exception would route it to an error style and break the wager at the architecture level.

**The receipts cannot be separated from the number.** The payload carries the group definition, `n`, the as-of date, the currency, and the verdict sentence as one object (AD-20). A caption composed independently in a React component could drift from the figure above it; this one cannot. It is also why copy-answer and the card are guaranteed to say the same thing — one function composes the sentence, and both consume it unmodified.

**Nothing below the boundary can read a clock.** The as-of date enters once, at the top, as a default. Wind it back and every figure recomputes to what it was — not approximately, exactly.

---

## Deployment

```mermaid
graph TB
  subgraph PROD["Production"]
    V1["Vercel<br/><i>Next.js 16</i>"] --> N1[("Neon primary<br/><i>Postgres 18 · ap-southeast-1</i>")]
  end
  subgraph PREV["Preview — per PR"]
    V2["Vercel preview"] --> N2[("Neon branch<br/><i>inherits parent major</i>")]
  end
  subgraph LOCAL["Local"]
    V3["next dev"] --> N3[("Neon branch or<br/>local Postgres 18")]
  end

  CI["CI<br/><i>lint · typecheck · unit tests<br/>import boundaries · axe</i>"] -->|"prisma migrate deploy<br/>at build"| PROD
  CI --> PREV

  style V1 fill:#1e293b,color:#ffffff
  style N1 fill:#334155,color:#ffffff
```

Postgres major is pinned to 18 in all three environments — a Neon branch inherits its parent's major, and local must match, or a query behaves differently in the one place nobody looks. Region is `aws-ap-southeast-1` (Singapore) — Neon has no India region; synthetic data (AD-14) imposes no residency constraint, so Singapore (nearest region) is used.

No staging tier: one user, no real data, no auth (a SPEC non-goal, and the one deferral that must flip before this touches a real salary record). **Seeding is never a deploy side effect** — it is an explicit command, always.
