---
title: 'Rubric review — ARCHITECTURE-SPINE.md (Salary Management for ACME HR)'
target: ../ARCHITECTURE-SPINE.md
spec: ../../../../specs/spec-payroll/SPEC.md
reviewer: adversarial rubric pass
date: 2026-07-17
verdict: REVISE — strong on fairness math, holed on the delivery boundary and on two ADs whose rules are literally wrong
---

# Rubric review — Architecture Spine

Judged against the good-spine checklist. Findings only. Severity: critical / high / medium / low.

---

## 1. Does it fix the real divergence points for the level below, and miss none?

It fixes the sharp ones in the fairness math (median definition, SQL-vs-code statistics, money representation, as-of parameterization, tie-break). Those are genuinely the highest-value divergences in this SPEC, and AD-2/AD-3/AD-4/AD-8/AD-11 are the best work in the document.

It misses several that are just as forkable.

### F1 — AD-5's rule does not flag underpaid employees at all *(critical)*

AD-5: "distance = `(salary − median) / median`, rounded half-up to one decimal place. The outlier flag tests that *rounded* value with a strict `>` against the threshold."

`distance` is signed — AD-5 itself, and the badge copy it cites (`20.0% above median`), and EXPERIENCE.md Flow 1 (`Michael Chang −25.2% below`) all treat it as signed. A strict `>` of a signed value against a positive threshold evaluates `−25.2 > 20` → false. Read literally, the rule implements a one-sided over-paid detector.

This directly contradicts SPEC's Constraints ("Being underpaid and being overpaid are the same finding: outlier detection is symmetric and direction-agnostic") and CAP-6's success criterion ("in either direction, one finding"). The rule must be `abs(rounded) > threshold`, and the AD must then say which value is displayed (signed) versus which is judged (absolute) — because AD-5's own closing line, "The number shown is the number judged," becomes false the moment the judged value is an absolute and the shown value is signed.

This is not pedantry: AD-5 is the one AD that a feature author will copy verbatim into `outliers.ts`.

### F2 — AD-5 does not say what unit is rounded, and half-up is asymmetric across zero *(high)*

Two compounding defects in the same rule:

- **Unit is unstated.** `(salary − median) / median` is a *ratio* (`0.2036`). "Rounded half-up to one decimal place" applied to a ratio yields `0.2`; applied to the percentage (`20.36`) it yields `20.4`. One unit builds a 1-dp ratio and every badge reads `20.0%`; another builds a 1-dp percent. Both are faithful to the letter of AD-5. This is exactly the class of divergence AD-3 was written to kill for the median, left open one AD later.
- **"Half-up" is direction-dependent.** Half-up conventionally means toward +∞. `−20.05` → `−20.0` (no flag); `+20.05` → `+20.1` (flag). An underpaid employee and an overpaid employee at the identical magnitude resolve differently — breaking the symmetry constraint at the exact boundary the SPEC bothered to fix. The rule needs half-away-from-zero, or rounding applied to the magnitude.

### F3 — The delivery boundary is silent: RSC direct-call vs route handler vs server action *(high)*

The container diagram says `RSC surfaces · route handlers`, and AD-1 says adapters reach the domain through ports. Nothing says **how a surface invokes a use-case**. Three live options, all compatible with every AD in the document:

- a Server Component calls the use-case in-process;
- a route handler exposes JSON and the client fetches it;
- a Server Action mutates.

Home (read), Import (file upload + partial-row report), Record-a-change (mutation, `Enter` saves), Settings threshold Apply, and three CSV exports will each independently pick one. Two features shipping different invocation conventions is the textbook initiative-level divergence, and the initiative is the only altitude that can own it. AD-4 even legislates JSON payloads ("no bare amount crosses any boundary — including JSON payloads") without ever deciding whether there *is* a JSON boundary.

Not decided, not deferred, not an open question. Silent.

### F4 — CAP-1 import: `effective_from` of an imported salary, and re-import semantics, are both undecided *(high)*

CAP-1 imports "employees **and their current salaries**". Nothing in the spine says what `effective_from` an imported salary record gets. The candidates — a spreadsheet column, the employee's `hire_date`, or "today" — are not equivalent, and the third *reads the wall clock*, colliding head-on with AD-11 and with AD-8's `(effective_from, seq)` resolution. One unit imports with hire_date and the timeline reads sensibly; another stamps today and every imported employee looks like they got a raise on import day. AD-6 and AD-7 govern the import row's currency and country but not the one field that makes the record resolvable.

Compounding: EXPERIENCE.md Flow 4 step 4 has Alice **re-import corrected rows**. Whether a re-imported row upserts the employee, appends a second salary record, or creates a duplicate person is undecided. AD-10 makes `employee.id` an opaque surrogate never derived from name — which *removes* the only natural key an importer could match on, and then declines to supply a replacement. One unit dedupes on name+country, another creates 58 duplicate people.

Also: the source tree silently decides the format is CSV (`adapters/csv/`) while SPEC and EXPERIENCE both say "spreadsheet" and Flow 4 says "uploads the payroll spreadsheet." If XLSX is out, an AD or a Deferred line should say so; a directory name is not a decision.

### F5 — AD-13 does not fix the order of operations for CAP-9, and leaves the rate's own numeric type open *(high)*

AD-13 pins *which* rate is used and makes provenance travel with the payload. It does not fix **how the conversion is applied**, and CAP-9 is the one capability where that changes the answer:

- **convert-then-sum** (convert each of ~10,000 salaries to the target minor unit, rounding each, then add) vs **sum-then-convert** (sum per currency, convert each country total once) produce different org-wide totals. At 10,000 rows the accumulated rounding difference is not academic, and both are defensible readings.
- **`rate`'s type and precision are unspecified.** AD-4 bans `number`/float for money and mandates integer minor units precisely because float drift makes figures irreproducible — and then AD-13 introduces a `rate` column with no type, no scale, and no rounding mode for the product. A `DOUBLE PRECISION` rate re-admits exactly the drift AD-4 exists to exclude, through the back door.
- **No rate → what?** "the latest rate set whose `pinned_on ≤ as-of date`" has no defined behavior when the as-of date is wound back before the earliest pinned rate. EXPERIENCE.md makes winding the as-of date back a first-class global control on every surface, so this state is reachable by design. One unit throws, another falls back to the nearest rate (silently breaking determinism), a third returns a refusal. The spine has a perfectly good refusal convention available and does not reach for it here.

### F6 — AD-1 and AD-14 delegate their enforcement to a CI that the spine never establishes *(medium)*

AD-1's rule is "Enforced by an import-boundary lint rule in CI, not by convention." AD-14's is "`Math.random` is banned repo-wide by lint." Both ADs stake their enforceability on lint-in-CI. The spine has a Stack table, a Deployment & environments table, and a source tree — and no CI anywhere. No provider, no pipeline, no gate, no statement that `prisma migrate deploy` on Vercel build is the only automation. The two ADs that explicitly claim to be *mechanical* rather than conventional are, as the document stands, conventional. Either name the enforcement surface or stop claiming mechanical enforcement.

---

## 2. Is every AD's Rule enforceable, and does it prevent its stated divergence?

Mostly yes — AD-2, AD-3, AD-4, AD-8, AD-11, AD-12 are crisp, testable, and actually close their stated fork. Exceptions:

- **AD-5** — enforceable but *wrong* (F1), and under-specified (F2). It does not prevent its stated divergence; it introduces one.
- **AD-13** — under-determined (F5). Its stated prevention ("a converted figure reaching the screen without its receipts") is achieved; the larger divergence it sits next to is not addressed.
- **AD-15 — the rule is a wish** *(medium)*. "The Tailwind theme is generated from `DESIGN.md`'s frontmatter by a build step. No hex literal appears in a component." The first half is a mechanism. The second half is a prohibition with no named enforcement — conspicuous, because AD-1 and AD-14 both bother to name lint. Worse, the Stack adopts **shadcn/ui (copy-in)**, whose components arrive carrying their own color conventions and CSS variables. The spine adopts a component library that ships the exact thing AD-15 bans and never says how the two reconcile. As written, AD-15 will be violated by the first `npx shadcn add`.
- **AD-7** — enforceable, correct, and a genuinely good catch (it closes a hole the SPEC left). No finding.
- **AD-2's "no count"** *(medium)* — "the database ... computes no median, spread, distance, gap, total, or **count** that reaches a user as a domain value." A 10,000-row directory with pagination needs `COUNT(*)`, and Home's "10,000 headcount" is a count reaching a user. Is a headcount a "domain value"? The rule turns on an undefined term, and the answer decides whether the directory can paginate in SQL at all. This collides directly with the Deferred pagination item (see §3).

---

## 3. Could anything under Deferred let two units diverge?

### F7 — "Employee country change / relocation" is deferred, but CAP-2 already binds it *(high)*

The Deferred entry reads: "no capability requires it. AD-6's write-time currency check holds while country is effectively immutable."

CAP-2's intent is "create **and edit** an employee record individually," and its success criterion names country among the persisted fields. Country is editable *today*, in a bound capability, in the "Employee form" EXPERIENCE.md specifies. The premise "country is effectively immutable" is asserted by the spine, not established by the SPEC — and AD-6 depends on it. So:

- one unit lets the employee form edit country (CAP-2, read literally), silently orphaning every historical `salary_record.currency_code` from AD-6's validation invariant and moving the employee into a peer group whose currency their history does not match;
- another blocks or greys the country field on edit.

Both are defensible from the documents. This is a real divergence, inside a bound capability, deferred on a premise the spine invented. Either AD-6 gets a clause ("country is immutable after creation; the employee form does not expose it on edit"), or the deferral is unsound.

### F8 — "CSV export column layouts" defers the money-cell encoding that AD-4 makes non-obvious *(medium)*

The deferral says "AD-4 and AD-13 already constrain the cells; the layout is a story decision." AD-4 constrains them in a way that makes the encoding *harder*, not settled: "no bare amount crosses any boundary — **including CSV columns**." So a money cell may not be `2340000`. It must be… `2340000 INR`? `₹23,40,000`? Two columns (`amount_minor`, `currency`)? Three surfaces export (Findings, Overdue, Payroll Totals) across three stories. They will not pick the same one, and AD-4's prohibition is what guarantees they have to pick. Column *selection* is fairly a story call; the money-cell encoding is a cross-cutting convention and belongs in the Consistency Conventions table next to the formatter rule.

### F9 — "Pagination strategy" is deferred as "not a divergence risk" while AD-2 makes it one *(medium)*

Cursor-vs-offset is indeed a story call in isolation. It is not in isolation here: offset pagination wants `LIMIT/OFFSET` plus `COUNT(*)`, and AD-2 forbids the DB computing a "count that reaches a user as a domain value" (F6). The deferral and the AD point in opposite directions and neither acknowledges the other. Resolve AD-2's scope ("domain value" = a fairness statistic; row counts and set cardinality for paging are not) and the deferral becomes sound.

- **"Authentication and permissions"**, **"Caching / read models"**, **"Observability, rate limiting, backup/restore"** — all correctly deferred with a revisit trigger. No finding. The auth entry in particular is well-handled: it names the exact condition (the HR *team* becomes a user) that the SPEC's own Assumptions section flags.

---

## 4. Does it cover the driving spec's capabilities?

CAP-1..CAP-11 all appear in the Capability → Architecture Map, all bind to a home and at least one AD. Coverage is real, not decorative. Two gaps:

### F10 — The SPEC's testing constraint has no AD *(medium)*

SPEC Constraints, last line: "Core logic — peer grouping, medians, outliers, gap, thresholds, currency isolation — is covered by unit tests that are fast and deterministic: fixed seed, no dependence on the wall clock." This is a hard constraint of the contract, at the same level as "no comparison crosses a currency" (AD-6) and "the as-of date is supplied" (AD-11) — both of which got ADs.

It gets: a `tests/` line in the source tree with a comment, and a Stack row. AD-1 and AD-11 make fast deterministic tests *possible*; nothing makes them *required*, names the coverage obligation, or fixes the seam (does a use-case test get a fake repository port? is there a fixture convention?). Meanwhile **Playwright sits in the Stack marked `[ASSUMPTION]`** — an unresolved assumption living in a decided table, with no Open Questions section anywhere in the spine to hold it (see F12).

### F11 — CAP-10's row in the map under-cites *(low)*

CAP-10 Overdue → "Governed by AD-11". Overdue means "employees whose *most recent salary record* predates a period" — that is AD-8's `(effective_from, seq)` resolution, same as CAP-3/CAP-4. If AD-8 isn't cited, a unit will write a second "latest record" resolver in `overdue.ts`, which is precisely the fork AD-8 exists to prevent. Cite AD-8.

---

## 5. Is every dimension the altitude owns decided, deferred, or an open question?

The operational envelope is **the spine's strongest section relative to typical practice** — Deployment & environments is a real table with a per-environment migration and seed policy, and "No staging tier" is an explicit decision with a reason. Credit where due; that dimension is not silent.

Silent or half-silent dimensions:

- **Delivery/invocation boundary** — F3. Silent. The largest hole in the document.
- **CI / enforcement surface** — F6. Silent, and two ADs depend on it.
- **Testing strategy** — F10. A source-tree comment is not a decision.

### F12 — There is no Open Questions section *(medium)*

Every dimension is either decided or deferred; nothing is allowed to be *unresolved*. But the document contains at least two live `[ASSUMPTION]` markers (Playwright in the Stack; and it inherits EXPERIENCE.md's open items) with no section to hold them. The checklist's third state doesn't exist in this spine, so unresolved things get quietly filed as decided (Playwright) or as deferred (F7's country-change, which is not deferrable). Add the section; move Playwright into it.

### F13 — Production's Seed policy reads as "one-time, explicit" for a 10,000-person fake population *(medium)*

The deploy table's Seed column: Local → `npm run seed`; Preview → manual; **Production → one-time, explicit**. The only seed the spine defines is `prisma/seed.ts`, which is CAP-11: 10,000 synthetic employees with planted outliers. So the table says production gets seeded with the fake demo population, once.

That may well be intended — SPEC's success signal is "demonstrable end to end," the Deferred section notes "no real data," and this is a demonstrator. But the table doesn't say so, and it conflates two different things that both currently live in `seed.ts`:

- **Reference data** (role, level, country, currency, `fx_rate`, `settings.outlier_threshold_pct` default) — required for the app to function *at all*, in every environment, forever. SPEC: "Role and level are seeded reference tables."
- **The CAP-11 demo population** — required only for the demo.

Whether reference tables ship in migrations or in the seed script is undecided, and it decides whether a fresh production deploy with no seed run is a working empty app (EXPERIENCE.md's first-run state, pointing at Import) or a broken one where the employee form has no selectable roles. Two units, two answers.

### F14 — "Today" has no timezone, and AD-11 hands the question off without answering it *(medium)*

AD-11: "The clock is a port implemented in the shell, and supplies 'today' only as a *default* at the HTTP/RSC boundary." Consistency Conventions: dates are "calendar dates (`DATE`), never timestamps — no timezone, no instant."

Converting an instant to a calendar date *requires* a timezone. The spine bans the timezone from the domain (correct) and then never says which zone the shell uses to compute the default. Server UTC vs the browser's zone differ for up to ~14 hours a day; Alice recording a raise at 4:50pm IST (EXPERIENCE.md Flow 3) gets a default `effective_from` of *tomorrow* under a naive UTC read — in a product whose SPEC bans future-dating outright. One decision line closes it.

---

## 6. Is the seed minimal, or has structure the code should own crept in?

Crept in. The layering table (§ Design Paradigm) plus AD-1 already fix the only structural divergence that matters: which layer may depend on which. Everything below is the code's business.

### F15 — The source tree legislates per-capability filenames and use-case granularity *(medium)*

```
domain/
  outliers.ts    #   CAP-6
  gender-gap.ts  #   CAP-7, CAP-8
  overdue.ts     #   CAP-10
  totals.ts      #   CAP-9
application/
  use-cases/     #   one per capability
```

`money.ts`, `statistics.ts`, and `peer-group.ts` earn their place — AD-3 names `src/domain/statistics.ts` as the single home of the one canonical median, so that path is load-bearing and must be in the spine. The rest is not: nothing diverges if outlier logic lives in `statistics.ts` or if gender-gap splits into two modules. "One use-case per capability" is a file-granularity decree that will be wrong the first time CAP-7 and CAP-8 want to share a query. Cut to the layer namespaces plus the AD-pinned paths.

### F16 — The Stack pins patch versions *(low)*

`Next.js 16.2.10`, `React 19.2.7`, `Prisma 7.8.0`, `Tailwind 4.3.2`, `Vitest 4.1.10`. Patch precision is the lockfile's job. The spine's interest is the major line (Next 16 App Router, React 19, Prisma 7, Tailwind 4), because that's what a feature author's assumptions bind to. Pinning `16.2.10` here means the spine is stale — and needs an edit and a status bump — the day someone runs `npm update`.

---

## 7. Does any AD state rationale rather than a rule?

Yes — four Rules carry argumentation that the `.memlog.md` already holds. The `Prevents:` field exists precisely so the `Rule:` field can be a constraint and nothing else; these ADs use both.

### F17 — Rationale inside Rule bodies *(medium)*

- **AD-10** — "…**UUIDv7 over v4 for index locality; over `BIGSERIAL` because the id appears in URLs and a sequential id leaks headcount.**" Two rejected alternatives and their justifications. The rule is the first sentence. Everything after "never derived from name" is memlog.
- **AD-12** — "…**(Cost accepted: a ~10,000-row read per sweep — trivial at this size, and correctness outranks it.)**" A cost-benefit argument. Not a constraint; nothing can violate it.
- **AD-9** — "Not IQR, not standard deviation, not percentile rank — **this adopts the SPEC's own stated reasoning for rejecting those at `n = 5–10`.**" The prohibitions are rule; the citation of the SPEC's reasoning is memlog.
- **AD-8** — "`created_at` is explicitly rejected as a tie-break: **it reads the wall clock, which AD-11 forbids.**" The rejection is a rule (usefully, since `created_at` is the obvious wrong answer); the *because* is memlog.

Lower-grade but same class: the **Design Paradigm** section opens with three sentences arguing *why* functional-core-imperative-shell was chosen ("The SPEC already demands what this paradigm supplies for free…"). The memlog already carries this verbatim, including the rejected alternatives (layered CRUD, DDD+event-sourcing). The spine needs the layering table and the dependency rule; the argument for them is already recorded where it belongs.

---

## Summary of findings

| # | Severity | Finding |
|---|---|---|
| F1 | critical | AD-5's strict `>` on a signed distance never flags underpaid employees — contradicts CAP-6 and the symmetry constraint |
| F2 | high | AD-5 doesn't say whether the rounded unit is ratio or percent; "half-up" breaks symmetry across zero at the boundary |
| F3 | high | Delivery boundary (RSC direct-call vs route handler vs server action) is entirely silent |
| F4 | high | CAP-1: imported salary's `effective_from` undecided (and clock-tempting); re-import identity/upsert undecided; CSV-vs-XLSX decided only by a directory name |
| F5 | high | AD-13 leaves convert-then-sum vs sum-then-convert, the rate's numeric type/precision, and the no-rate-at-as-of case all open |
| F7 | high | "Country change" is deferred on an invented immutability premise while CAP-2 already exposes country on edit |
| F6 | medium | AD-1 and AD-14 claim mechanical lint-in-CI enforcement; the spine never establishes CI |
| F8 | medium | Deferred CSV layouts leave the money-cell encoding AD-4 makes mandatory-but-unspecified |
| F9 | medium | Deferred pagination collides with AD-2's ban on DB counts; "domain value" is undefined |
| F10 | medium | The SPEC's fast/deterministic unit-test constraint has no AD |
| F12 | medium | No Open Questions section; `[ASSUMPTION]` items are filed as decided |
| F13 | medium | Production Seed policy conflates reference data with the CAP-11 demo population |
| F14 | medium | No timezone decided for the shell's "today" default; conflicts with the future-dating ban |
| F15 | medium | Source tree legislates per-capability filenames and "one use-case per capability" |
| F17 | medium | Rationale in Rule bodies: AD-8, AD-9, AD-10, AD-12 (+ Design Paradigm prose) — all already in memlog |
| F11 | low | CAP-10's map row cites AD-11 but not AD-8, inviting a second "latest record" resolver |
| F16 | low | Stack pins patch versions; lockfile territory |
