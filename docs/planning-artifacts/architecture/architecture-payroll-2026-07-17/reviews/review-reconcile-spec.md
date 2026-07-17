# Review — SPEC ↔ Architecture Spine reconciliation

- **Reviewed:** `docs/specs/spec-payroll/SPEC.md` against `docs/planning-artifacts/architecture/architecture-payroll-2026-07-17/ARCHITECTURE-SPINE.md`
- **Date:** 2026-07-17
- **Scope:** what did *not* land. Nothing here restates what the spine got right.

---

## Critical

### F-1 — AD-5's outlier test is direction-agnostic in prose and one-directional in its rule

**SPEC:** Constraint — *"Being underpaid and being overpaid are the same finding: outlier detection is symmetric and direction-agnostic."* CAP-6 success — *"differs from their peer median by more than a threshold percentage — in either direction, one finding."*

**Spine (AD-5):** *"distance = `(salary − median) / median`, rounded half-up to one decimal place. The outlier flag tests that rounded value with a strict `>` against the threshold."*

The formula is **signed**. `(salary − median) / median` for an underpaid employee is negative; a strict `>` against `+20` never fires. Read literally, AD-5 flags only the overpaid — an exact inversion of the SPEC's symmetry constraint, and it silently kills half of CAP-6's success criterion and half of the planted outliers CAP-11 exists to exercise.

The magnitude (`|distance|`) is what must be compared; the sign is display-only (`above` / `below` in the badge). AD-5 never says `abs`, never says magnitude, and never mentions the negative direction at all. Because the badge copy in AD-5's own rationale reads *"20.0% above median"*, the omission is easy to read as intentional rather than as a slip.

Secondary defect inside the same rule: **half-up rounding is undefined on negatives** in most people's hands. `−20.05` → `−20.1` (half-up = away from zero) or `−20.0` (half-up = toward +∞)? AD-5's whole purpose is that "the number shown is the number judged" — two units picking different conventions reproduce the exact divergence AD-5 was written to prevent, but only on the underpaid side, where it is least likely to be noticed.

**Fix:** state the rule over magnitude — `distancePct = round1(|salary − median| / median × 100)`, flag when `distancePct > threshold`, carry the direction as a separate `above | below` discriminant that is never consulted by the flag.

---

## High

### F-2 — AD-8 architects for a case the SPEC forbids: retroactive correction

**SPEC:** Constraint — *"No salary is ever overwritten. Salary is an append-only effective-dated series. No future-dating, no scheduled changes, no approval workflow, **no retroactive correction**."*

**Spine (AD-8):** *"Prevents: two records sharing an `effective_from` (**the correction case in EXPERIENCE.md Flow 3**) resolving differently between queries."*

The spine imports a correction flow from EXPERIENCE.md and builds a `seq` tie-break to make it resolve deterministically. That is a real mechanism serving a case the SPEC lists in its **constraints** as out of bounds. The AD does not flag the conflict, does not note that EXPERIENCE.md diverges from the SPEC here, and does not say the SPEC wins.

The tie-break itself is defensible on other grounds (a data-entry duplicate, a seeded collision) and should probably survive — but it must be re-justified on a ground the SPEC permits, and the "correction" framing removed. Otherwise a downstream story reads AD-8 as licence to ship a correction UI, which the SPEC excludes.

**Also:** this is an unresolved SPEC↔EXPERIENCE.md contradiction that the spine had the chance to settle (it explicitly "settles Note 5") and instead settled *in the wrong direction*. The spine settles EXPERIENCE.md notes 1–5 elsewhere; there is no precedent set anywhere in the document for the SPEC losing to a companion.

### F-3 — The append-only guarantee has no AD

**SPEC:** *"No salary is ever overwritten. Salary is an append-only effective-dated series."* This is the load-bearing integrity claim behind CAP-3 (*"Prior records remain readable and unmodified"*) and CAP-4.

**Spine:** No AD asserts it. AD-6 mentions it in passing (*"An append-only series must carry its own currency"*) and AD-8 assumes it, but nothing states the rule, nothing enforces it, and nothing appears in the Consistency Conventions table. `salary_record` is a Prisma model like any other — `prisma.salaryRecord.update()` and `.delete()` compile, typecheck, pass lint, and pass every domain unit test, because the domain is pure and never sees the write.

Compare the treatment of the *other* two structural guarantees: purity gets AD-1 with a CI-enforced import-boundary lint; determinism gets AD-11 plus a repo-wide clock ban; randomness gets AD-14 plus a `Math.random` lint ban. The SPEC's third structural guarantee — immutability of the salary series — gets nothing. The asymmetry looks like an oversight rather than a judgement, because the spine's own stated method is to give each invariant a mechanical enforcement point.

**Fix:** an AD stating that `salary_record` admits `INSERT` only — no `UPDATE`, no `DELETE` — enforced at the repository port (no update/delete method exists on the interface) and ideally at the database (revoked grants or a rule/trigger).

### F-4 — "No future-dating" is dropped entirely

**SPEC:** Constraint — *"No future-dating, no scheduled changes."*

**Spine:** Silent. AD-8/AD-11 resolve current salary as *"the record with the greatest `(effective_from, seq)` where `effective_from ≤ as-of date`"* — which *tolerates* future-dated rows by ignoring them until they mature. That is precisely a scheduled change: write `effective_from = 2027-01-01` today, and the system enacts it on that date with no further action. The SPEC bans exactly this, and the read model as specified implements it.

The ban is a **write-time validation** (`effective_from ≤ as-of date` on the insert path, for CAP-3 and CAP-1 both) and the spine assigns it to no AD, no use-case, and no convention. Note this also interacts with CAP-11: nothing stops the seed generator emitting future-dated records.

---

## Medium

### F-5 — AD-5's rounding contradicts CAP-6's threshold semantics in the band it claims to settle

**SPEC (CAP-6):** *"Employees whose salary differs from their peer median by more than a threshold percentage… the boundary is exact: 19.9% does not flag, 20.1% does."*

**Spine (AD-5):** rounds to one decimal *before* testing, so the judged value is `round1(d)`.

AD-5 justifies itself on the two anchors the SPEC fixes (19.9 → no, 20.1 → yes) and on the point it leaves undefined (exactly 20.0). Both are fine. But rounding-before-testing also silently reassigns a band the SPEC *does* define: a true distance of **20.04%** "differs from the median by more than 20%" — the SPEC's actual rule — yet rounds to `20.0` and, by AD-5's own "exactly 20.0 does not flag", is suppressed. Symmetrically, 19.96% is not more than 20% but rounds to 20.0 and is likewise not flagged (harmless here, but only by luck of AD-5's tie choice).

So AD-5 trades a *defined* semantic (`d > threshold`) for display reproducibility, and presents the trade as if it only touched the undefined point. The trade may well be right — "the number shown is the number judged" is a genuine product value, and the affected band is 0.05% wide — but it is a **deviation from a stated SPEC success criterion** and must be recorded as one, not smuggled in as a clarification. If it is not acceptable, the alternative is to judge the unrounded value and display more precision.

### F-6 — CAP-9's "per-country totals, no conversion" has no owner

**SPEC (CAP-9):** *"Per-country totals report in local currency **with no conversion**. Any org-wide total that spans currencies displays the conversion rate used and the date it was pinned to."*

**Spine (AD-13):** covers only the second sentence — pinned rates, rate + `pinned_on` in the domain payload. The first sentence — that a single-country total must *never* pass through FX at all — is stated nowhere. Nothing prevents `domain/totals` normalising every country to a display currency and then presenting the per-country rows out of the converted set, which would satisfy AD-13 (the rate travels, the caption is honest) while violating CAP-9.

Related and also unstated: the constraint *"Currency conversion appears only in aggregate totals spanning countries, **never in a comparison between people**."* The spine argues currency isolation holds *structurally* because country is part of peer identity (AD-6) — true for peer comparison, but it is an argument, not a rule, and it does not stop a future story converting in CAP-5/CAP-6/CAP-7 output. AD-13 is the natural place to state that the FX port is reachable from `domain/totals` and from nowhere else — the same mechanical-enforcement move AD-1 and AD-14 make elsewhere.

### F-7 — CAP-11's real acceptance criterion is delegated to "addendum parameters" and never bound

**SPEC (CAP-11):** reproducibility is one clause of the success criterion. The rest is structural: the population *must* contain peer groups that support comparison, peer groups too thin to (exercising CAP-5's refusal), employees far from their medians (CAP-6), peer groups with a within-group gender gap **and enough of both genders to report it** (CAP-7), and gender clustering across levels (CAP-8).

**Spine:** AD-14 covers reproducibility only ("Prevents: an irreproducible 10,000-person population"). The structural obligations are pushed to *"per the addendum's distribution parameters"* and the map row (`CAP-11 → prisma/seed.ts`). But a log-normal draw with the right parameters does not *guarantee* a thin cell, a planted outlier, or a ≥5/≥5 gender cell in any given group — those are drawn, not planted, and the SPEC's own success statement says *planted* (*"a planted outlier is surfaced without being searched for"*).

Without an AD, nothing asserts the seed's output is *verified* against the five shapes, so the demo can fail exactly the way the Success signal names. The tests directory is scoped *"domain unit tests: no DB, no clock, no network"* — which structurally excludes a check on the seeded population.

### F-8 — Whether the subject is a member of their own peer group is never settled

**SPEC (CAP-5):** *"For a peer group of 5 or more, the view reports the group median, spread, and this employee's distance from the median."* CAP-7: *"a peer group holding 5 or more of each gender."*

The spine defines peer identity as `(role, level, country)` derived at read time, and defines the median (AD-3), spread (AD-9), and distance (AD-5) — but never says whether the employee being compared is inside the set those are computed over. It changes the answer at n=5 (self-inclusion drags the median toward the subject, damping their own distance — precisely the outlier case CAP-6 cares about), and it changes whether `n ≥ 5` counts the subject, which shifts the exact refusal boundary the SPEC's success signal calls out.

This is the same class of divergence AD-3 exists to prevent (two units, same peer group, different median), left open. Inclusion is the conventional and probably correct answer — say so.

### F-9 — Threshold as ambient mutable state, against "the same question asked twice returns the same answer"

**SPEC:** *"The same question asked twice returns the same answer. Every answer is a function of the data and an as-of date, never of the moment it was asked."*

**Spine (Config convention):** *"Threshold is persisted data (single-row `settings`), not env."* AD-12 correctly frames findings as a pure function of `data + threshold + as-of date` — but a single mutable global row read at request time makes the threshold an *ambient* input, not a supplied one. Wind the as-of date back to last week after someone moved the threshold to 15% and you get an answer that never existed; the historical question is not reproducible.

AD-11 gives the as-of date the full treatment (required explicit argument, clock is a port, "today" is a boundary default). The threshold gets none of it, despite being the SPEC's other named reproducibility parameter. The cheap fix is symmetry: threshold is a required explicit argument to the domain, with the `settings` row supplying the default at the same boundary the clock supplies today's date.

---

## Low

### F-10 — CAP-4's timeline vs the as-of parameter

CAP-4: *"**Every** salary record for that employee is listed with its effective date and its currency, ordered in time."* AD-11 makes as-of a required argument of every domain function, and `domain/timeline.ts` is mapped to AD-8 + AD-11. It is unstated whether the timeline is filtered to `effective_from ≤ asOf` (consistent with the as-of model, inconsistent with "every record") or unfiltered with as-of used only to mark which record is current (consistent with CAP-4). Cheap to settle; ambiguous as written. Moot for F-4's sake only if future-dating is actually blocked at write time.

### F-11 — AD-4's `bigint` vs "no bare amount crosses any boundary — including JSON payloads"

`{ amountMinor: bigint }` does not survive `JSON.stringify`, nor the RSC serialisation boundary the spine's Next.js/RSC container diagram depends on. AD-4's rule is right; its chosen carrier type contradicts the boundary the rule is written to police, so the first developer to hit `TypeError: Do not know how to serialize a BigInt` will fix it locally — most likely by reaching for `number`, which is the exact failure AD-4 prevents. Name the wire encoding (minor units as a string) in the AD.
