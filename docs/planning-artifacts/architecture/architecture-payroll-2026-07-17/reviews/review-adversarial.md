---
title: 'Adversarial review — Architecture Spine, Salary Management for ACME HR'
type: review
method: adversarial-divergence-hunt
target: ../ARCHITECTURE-SPINE.md
against:
  - ../../../../specs/spec-payroll/SPEC.md
  - ../../../ux-designs/ux-payroll-2026-07-16/EXPERIENCE.md
  - ../../../briefs/brief-payroll-2026-07-16/addendum.md
status: draft
created: '2026-07-17'
---

# Adversarial review — Architecture Spine

## Method and verdict

The spine's job is to make independently-built units one level down compose without negotiation. The test applied here is the only one that matters: **construct pairs of features that each obey every AD to the letter and still build incompatibly.** A pair that survives is a hole; the AD set is not yet load-bearing there.

Eighteen such pairs were constructed. Five are critical. One (F1) is not a hole but a defect: **AD-5 as written cannot flag an underpaid employee**, contradicting a SPEC constraint and an EXPERIENCE.md worked example, in the very AD authored to prevent that class of divergence.

The dominant structural finding is that **the spine specifies how every number is computed and never specifies over what set.** AD-3 fixes the median algorithm; nothing fixes the population it medians. AD-11 mandates the as-of date be a parameter and never says what it filters. Six independent findings below (F2, F3, F5, F7, F13, F18) are instances of that single missing AD.

---

## F1 — CRITICAL — AD-5's flag test never fires for an underpaid employee

**Pair:** `domain/outliers.ts` built by the CAP-6 story ("literal reader") vs. the CAP-11 seed-verification unit / any second implementer ("symmetry reader").

**AD-5, verbatim:** *"distance = `(salary − median) / median`, rounded half-up to one decimal place. The outlier flag tests that *rounded* value with a strict `>` against the threshold."*

Distance is signed — AD-5 defines it as `(salary − median) / median` with no absolute value, and EXPERIENCE.md requires the sign (`{components.outlier-badge}` "always states direction in words", Flow 1 lists "Michael Chang −25.2% below"). So *that rounded value* is `−25.2`.

**How both obey:**
- **Literal reader** implements exactly what AD-5 says: `flag = roundHalfUp(distance, 1) > threshold`. `−25.2 > 20` → `false`. Michael Chang is not an outlier. This unit obeys AD-2, AD-3, AD-5, AD-12 to the letter and passes any test written from AD-5.
- **Symmetry reader** implements `flag = Math.abs(roundHalfUp(distance, 1)) > threshold`, citing SPEC Constraints ("Being underpaid and being overpaid are the same finding: outlier detection is symmetric and direction-agnostic") and CAP-6 ("in either direction, one finding"). Also fully obedient — AD-5 says the flag tests the rounded value; it does not say the comparison is signed.

**Divergent outcome:** the literal build's Home findings region shows 2 of the 4 findings in EXPERIENCE.md Flow 1 step 3 — Sarah Jenkins +28.4% and David O'Connor +26.1% survive; Michael Chang −25.2% and Aisha Patel −24.8% vanish. The seed's planted below-median outliers (addendum: "a few individuals well above and below their peer median") are invisible. The SPEC's success signal ("a planted outlier is surfaced without being searched for") passes for half the population and silently fails for the other half — the underpaid half, which is the half the product exists for. Nothing in CI catches it: both builds are green against their own reading.

**Close it:** AD-5's rule must read `flag = |roundHalfUp(distance, 1)| > threshold`, and must state that the *sign is preserved for display and discarded for the test*. One word, but it is the word.

**Riding on the same AD (also unclosed):** "rounded half-up" is unambiguous only for positive values. AD-3's median rounds positive money, so it is safe. AD-5's distance is signed, so `−20.05` → `−20.1` (half-away-from-zero) or `−20.0` (half-up toward +∞) is a coin flip. Pair: the findings row badge vs. the findings CSV export (EXPERIENCE.md mandates both, "exports the visible list"). At exactly `−20.05` raw, one shows `−20.1%` and flags, the other shows `−20.0%` and does not — on the same screen, from the same request. AD-5 must name the tie mode explicitly (half-away-from-zero, given symmetry).

---

## F2 — CRITICAL — The as-of population is undefined: two obedient units select different peer groups

**Pair:** `use-cases/peer-comparison` (CAP-5, employee detail card) vs. `use-cases/outlier-sweep` (CAP-6, Home findings).

**How both obey:** a peer group is `(role, level, country)` "derived at read time" (Structural Seed). AD-2 permits the DB to "select sets". No AD says whether a peer group is *employees matching the triple* or *as-of salaries of employees matching the triple*.
- **CAP-5 unit** reads the spine's own sentence — a peer group is `(role, level, country)` — and builds the group from the `employee` table. `n` = 6. It then medians the salaries it has: 4 of them (two members' only salary records post-date the as-of date, or they were created via CAP-2's Add-employee form and have none — see F4). AD-3 is obeyed exactly: sort 4 values ascending, even n, mean the middle two.
- **CAP-6 unit** reads AD-12's only hint — *"the sweep loads the as-of current-salary set"* — and builds groups from salary rows. `n` = 4.

Both obey AD-1..AD-15 without exception. AD-12 is an anti-caching rule, not a set definition; it is the only sentence in the spine that touches this, and it touches it by accident and only for CAP-6.

**Divergent outcome, concretely:** peer group *Software Engineer · L4 · India*, 6 employees, 4 with an as-of salary.
- Home (CAP-6): 4 < 5 → an inline refusal row, "only 4 peers, too few to compare fairly."
- Priya's detail (CAP-5): "Based on 6 peers as of 16 Jul 2026", peer median ₹23,40,000 INR, "8% under her peer median."

The same group, same request, same as-of date, is simultaneously refused and answered. Worse, the answered version prints `n = 6` over a median of 4 — **the exact "median of one dressed as an answer" failure the n≥5 refusal exists to prevent, reached while obeying every AD.** And EXPERIENCE.md Flow 1 → Flow 2 routes Alice from a findings row straight to the detail page; the handoff shows her two different numbers for one question, which is the precise trust failure ("answers are inconsistent, inconsistent answers stop being trusted" — SPEC Why) the product was built to kill.

**Close it:** a new AD owning the as-of population. It must define, as one named domain concept consumed by CAP-5/6/7/8/9/10 alike:
1. Membership of a peer group = employees matching the triple **who have a current salary at the as-of date** (recommended — it is the only definition under which `n` and the median are computed over the same set, which is what "Based on n peers" claims).
2. Therefore an employee with no as-of salary is in no peer group and appears in no `n`.
3. Whether `hire_date > asOf` excludes an employee (see F13).

---

## F3 — CRITICAL — The gender-gap gate and the gender-gap median can select different sets

**Pair:** the CAP-7 refusal gate vs. the CAP-7 median computation — buildable as two units, and *guaranteed* to diverge if F2 is closed only for CAP-5/6.

**How both obey:** CAP-7 requires "a peer group holding 5 or more of each gender". The gate counts genders; `gender` is an `employee` column, so counting it from `employee` rows is the natural read and no AD forbids it. The medians must come from salaries. AD-3 governs the median; nothing governs either set.

**Divergent outcome:** group with 5 FEMALE (one of whom has no as-of salary record) and 8 MALE. Gate: `5 ≥ 5` → pass, no refusal. Median: computed over 4 female salaries. The card reports a female median derived from 4 people while the refusal panel it suppressed exists precisely to stop that. EXPERIENCE.md's refusal copy — "3 FEMALE and 8 MALE; a gap needs 5 of each" — is now a sentence the product will print with numbers that mean two different things depending on which unit produced them.

**Close it:** same AD as F2, applied explicitly to the gender sub-counts: **the counts in every refusal sentence must be counts of the set the median would be computed over, not counts of employees.** State it once, bind it to CAP-5 and CAP-7.

---

## F4 — CRITICAL — CAP-2 creates employees with no salary; the ER model says that cannot exist

**Pair:** `use-cases/create-employee` (CAP-2 / EXPERIENCE.md screen-11 Add-employee panel) vs. `prisma/schema.prisma` + `use-cases/import` (CAP-1).

**How both obey:**
- **Add-employee unit** implements EXPERIENCE.md's Employee form verbatim: *"Fields: name, role, level, country, gender (`MALE`/`FEMALE`), hire date."* No salary field. SPEC CAP-2's success criterion lists exactly those five attributes and no salary. The unit obeys AD-6, AD-10, AD-11 fully. It writes an employee with **zero** salary records.
- **Schema unit** implements the spine's ER diagram verbatim: `EMPLOYEE ||--|{ SALARY_RECORD : "has timeline"` — one-or-more, mandatory. CAP-1 ("employees **and their current salaries**") and the seed both satisfy it naturally.

**Divergent outcome:** either the schema enforces `||--|{` (via a deferred constraint or an application invariant) and CAP-2's Add-employee flow — a first-class capability with its own designed surface — cannot save, discovered at integration; **or** it does not, in which case zero-salary employees are a permanent population and F2, F3, F5, F13, F18 all detonate at once on real data. There is no third option and no AD picks one. The ER diagram asserts a cardinality that CAP-2's own UX contradicts, and no AD owns the contradiction.

Downstream consequence worth naming: if a later unit "fixes" this by writing a zero-amount salary record at creation (fully AD-4 compliant — `{ amountMinor: 0n, currency: 'INR' }` is legal money), a thin peer group's median can be `0`, and AD-5's `distance = (salary − median) / median` divides by zero. AD-5 states no guard, and the Consistency Conventions declare domain functions **total** — they do not throw. `Infinity`/`NaN` then flows into `roundHalfUp` and onto Alice's screen.

**Close it:** an AD stating whether an employee may exist without a salary record, and if yes (recommended — CAP-2 requires it) that they are excluded from every computed set (F2) and rendered on the detail page as an explicit "no salary recorded as of …" state, never as zero. Then relax the ER cardinality to `||--o{` so the diagram stops lying. Additionally: AD-5 must state that a median of zero is not a divisible denominator, or the AD in F2 must make it unreachable.

---

## F5 — CRITICAL — Is the subject counted in their own peer group?

**Pair:** `use-cases/peer-comparison` (CAP-5) vs. `domain/outliers.ts` (CAP-6).

**How both obey:** SPEC CAP-5: "the view reports the group median, spread, and **this employee's distance from the median**." SPEC CAP-6: "Employees whose salary differs from **their peer median**". AD-3 fixes *how* to median; AD-5 fixes *how* to compare. Neither says whether the subject is a member of the set being medianed. "Peer" in plain English means *another person*; "peer group" in the spine means a `(role, level, country)` cell that plainly contains the subject.

- **Inclusive unit:** median over all members including the subject. `n = 5`. Obeys everything.
- **Leave-one-out unit:** peers = the other members; median over 4. Equally obedient — and arguably more faithful to CAP-7's stated fear of "comparing against a median of one", and to the word *peers*.

**Divergent outcome:** group of exactly 5, salaries `[100, 100, 100, 100, 200]` (minor units elided).
- Inclusive, subject = the 200: `n = 5 ≥ 5` → answer. median = 100. distance = +100.0% → flagged.
- Leave-one-out, subject = the 200: peers = `[100,100,100,100]`, `n = 4 < 5` → **refusal**. Sarah is not comparable and never appears in the findings list at all.

So a 5-person group answers on one build and refuses on the other, and the org's planted outliers in exactly-5 cells (the addendum deliberately engineers thin cells) appear or vanish wholesale. Even where both answer, the numbers differ: a 9-person group's inclusive median ≠ its leave-one-out median for the subject whenever the subject is at or adjacent to the middle — Flow 2's quotable sentence ("₹23,40,000 INR, based on 9 peers") is a different number and a different count on the two builds, and Alice pastes it into Slack and stands behind it.

Note the copy is already ambiguous in the same way: **"Based on 9 peers"** — 9 including Priya, or Priya plus 9? The refusal copy "only 3 peers. This peer group has 3 people" (EXPERIENCE.md) equates the two, implying inclusive — but that is UX prose settling a math question by accident, which is exactly what a spine is for.

**Close it:** an AD: *the subject is a member of their own peer group; `n` includes them; the median is computed over the set including them; "Based on n peers" means n group members inclusive.* One sentence, and it also fixes the copy.

---

## F6 — HIGH — AD-10 (UUIDv7, clock-derived) and AD-14 (nothing is unseeded) collide head-on

**Pair:** `adapters/uuid` per AD-10 vs. `prisma/seed.ts` per AD-14.

**How both obey:**
- **AD-10** mandates `employee.id` is a **UUIDv7**, "generated in the shell", chosen explicitly "over v4 for index locality". UUIDv7's index locality comes from one place: **it embeds a Unix millisecond timestamp in its high bits.** A conformant generator reads the wall clock. AD-11 permits this — its clock ban is scoped to `src/domain/**` and `src/application/**`, and AD-1's is scoped to `src/domain/**`. `adapters/` is where the clock is *supposed* to live.
- **AD-14** mandates the seed be reproducible from a fixed seed, with `Math.random` banned repo-wide. It constrains the PRNG stream — the *values* — and says nothing about identifiers.

Both obeyed. Neither AD mentions the other. The Capability map binds CAP-11 to AD-14, AD-4, and the addendum — not AD-10.

**Divergent outcome:** `npm run seed` twice → 10,000 employees with identical names, roles, levels, countries, genders, hire dates and salaries, and **10,000 different ids**, in a different sortable order. CAP-11's acceptance criterion is "a single command produces 10,000 employees from a fixed seed, **reproducibly**" — this fails on the literal reading. Concretely: every Playwright fixture pinning `/employees/{id}` breaks on reseed; any unit that leans on AD-10's advertised sortability (the "index locality" the AD sells) — a directory default order, a stable tie-break — produces a different page 1 on every run; and a reviewer diffing two seeded databases to verify the planted outliers cannot.

**Close it:** AD-10 and AD-14 must be reconciled in one of two ways, explicitly: (a) the id generator is a **port** like the PRNG and clock, and the seed injects a deterministic UUIDv7 generator driven by a fixed synthetic timestamp base plus the seeded stream — reproducible *and* v7-shaped; or (b) AD-14's reproducibility is explicitly narrowed to "all attributes and salaries", with ids exempt, and AD-10 gains a note that ids are not stable across seeds so no test may pin one. (a) is cheap and strictly better.

---

## F7 — HIGH — CAP-10 overdue: four unclosed forks in one capability

`domain/overdue.ts` is governed by **AD-11 alone**. AD-11 constrains *plumbing* (as-of must be an argument) and says nothing about *semantics*. Four obedient divergences:

**7a — as-of vs today.** Pair: `use-cases/overdue-list` (the Overdue surface) vs. `use-cases/home-overdue-summary` (the Home count — EXPERIENCE.md mandates *both* placements). Both take `asOf` as a required argument, obeying AD-11 to the letter. The Home unit then computes `cutoff = today − 1y` because EXPERIENCE.md's own copy says "41 people are **currently** overdue" — and it never uses the `asOf` it dutifully accepted. AD-11 forbids *reading* the clock in application code, not *ignoring* the parameter. **Divergence:** Alice winds the as-of date back to 12 May 2026; Home still says 41, the surface says 63; clicking the "41 people overdue" link lands her on a list of 63. EXPERIENCE.md's Wound-back state ("every figure recomputes") and Trust & Provenance ("winding the as-of date back reproduces yesterday's answer exactly") are both violated by an AD-11-compliant unit.

**7b — the cutoff's inclusivity.** Pair: the preset-chip path vs. the custom-date path (EXPERIENCE.md gives the control both shapes: "1y / 18mo / 2y / 3y, plus a custom date field"). SPEC CAP-10: "employees whose most recent salary record **predates** it". Chips-unit: `latest.effective_from < asOf − 1y`. Custom-date-unit: the user supplies the cutoff directly and it uses `≤` ("on or before", matching CAP-3's own phrasing elsewhere in the SPEC). **Divergence:** on 16 Jul 2026, an employee whose last record is dated exactly 16 Jul 2025 is overdue via the custom field and not overdue via the 1y chip — two controls on one screen, same intended period, different answer. AD-5 fixes strictness for the outlier boundary only; the overdue boundary has no AD.

**7c — the hire record.** CAP-10's *intent*: "employees who have not had a **salary change** in a given period." A hire is not a change. EXPERIENCE.md makes `(Hire)` a **derived** label ("Timeline % change and `(Hire)` label are derived, not stored") — so any unit can derive it, and two will read the criterion differently: unit A lists an employee whose only record is their hire (their most recent record predates the period — CAP-10's *success* criterion, met); unit B excludes them (they never had a change to be overdue on — CAP-10's *intent*, met). **Divergence:** across a 10,000-person seed with a realistic hire-date spread, "everyone hired more than a year ago with one record" is hundreds of people. Home's overdue card reads 41 on one build and ~800 on the other. Both are defensible; neither is chosen.

**7d — zero records.** An employee with no salary record (F4) has no "most recent record". `!exists → overdue` vs. `!exists → excluded`; and CAP-10's "listed **with the date of that record**" has no date to render.

**Close it:** one AD for CAP-10 fixing: cutoff is derived from the **as-of date**, never the clock (both placements, and the Home card's copy must lose the word "currently"); the comparison operator and its boundary, stated as AD-5 states its own; whether a hire-only record satisfies "has not had a salary change"; and the zero-record case.

---

## F8 — HIGH — AD-11's clock ban stops at `src/ui`; server and client default to different days

**Pair:** `adapters/clock.ts` (the "only `Date.now()` in the codebase", per the source tree) + the Home RSC page vs. the `{components.as-of-control}` client component in the header.

**How both obey:** AD-11's rule bans clock reads under `src/domain/**` and `src/application/**` — *only there*. AD-1's ban is narrower still (`src/domain/**`). The header as-of control is `src/ui` — EXPERIENCE.md requires it on every screen, defaulting to today, with a date picker. A date picker client component that defaults its display and its calendar's "today" highlight to `new Date()` violates no AD. Meanwhile the server defaults `asOf = clock.today()` at the RSC boundary, exactly as AD-11 instructs. **Which timezone is "today" is named nowhere** — AD-11 in fact forbids domain and application from "reading a timezone", pushing the decision into a port whose contract no AD writes, and the deployment table puts the server on Vercel (UTC).

**Divergent outcome:** Alice is in IST (the worked examples are ₹/INR; ACME spans 14 countries). Between 00:00 and 05:30 IST, the header reads **"As of 17 Jul 2026"** while every figure on the page was computed for **16 Jul 2026**. The as-of control is described in EXPERIENCE.md as "both a control and ambient provenance" — the provenance is now wrong, silently, for 5.5 hours a day, on the one component whose entire job is to make the determinism promise visible. And the `aria-live` announcement ("Findings updated as of …") announces the wrong date to a screen reader.

**Close it:** extend AD-11's ban to `src/ui/**` and `src/app/**` with a single named exception — the clock port — and require the AD to name the timezone in which "today" is resolved (a fixed configured zone, not the browser's, or the determinism promise is per-viewer). The lint rule of AD-1 should enforce the widened ban.

---

## F9 — HIGH — AD-13's "rate set" does not exist in AD-13's schema, and no target currency is named

**Pair:** `domain/totals.ts` + `use-cases/payroll-totals` (CAP-9) vs. the seed's FX unit (CAP-11 must seed rates for the 14-country demo to have an org total at all).

**How both obey:** AD-13's rule says *"A conversion uses the latest rate **set** whose `pinned_on ≤ as-of date`"*, over a schema it defines in the same sentence as `fx_rate (from_currency, to_currency, rate, pinned_on)` — **which has no set identity.** Two readings, both literal:
- **Per-pair unit:** for each currency pair, take the row with `max(pinned_on) ≤ asOf`. Obeys AD-13 word for word ("the latest rate whose pinned_on ≤ as-of").
- **Whole-table unit:** compute `D = max(pinned_on ≤ asOf)` across the table, use only rows at `pinned_on = D`. Also obeys AD-13 word for word, treating "set" as the operative noun.

Nothing forbids the seed from pinning USD/EUR/GBP on 01 Jul and INR on 03 Jul — it is the realistic case, and no AD says rates arrive in complete sets.

**Divergent outcome:** as-of 16 Jul. Per-pair unit converts INR at the 03 Jul rate and EUR at the 01 Jul rate, then stamps the payload with… which `pinned_on`? EXPERIENCE.md's caption is singular — "converted at rates pinned 01 Jul 2026" — so the total is a blend of two dates displayed under one. **AD-13's stated purpose ("the number and its provenance are one object and cannot be separated by a careless render") is defeated while AD-13 is obeyed**, because the payload carries *a* pinned_on that is not the pinned_on of every rate in the number. The whole-table unit, on the same data, finds no complete set at any single date and either produces a total missing India or produces nothing.

**Second fork, same AD:** the org-wide total's **target currency is named nowhere** — not in AD-13, not in the SPEC, not in EXPERIENCE.md (Flow 1: "total payroll with its pinned-rate caption", no currency). The Home landscape metric and the Payroll Totals surface are two units; one picks USD, one picks the currency of the largest country. Two totals, both correct, both captioned, different numbers.

**Close it:** AD-13 must either give `fx_rate` a real set identity (`rate_set(id, pinned_on)` + `fx_rate(set_id, from, to, rate)`, with a completeness check at read time — a total that cannot cover every currency in scope is a **refusal**, not a partial) or drop the word "set" and mandate that the payload carries the pinned date **per pair**, with the caption obligated to show a range or the oldest. It must also name the org-wide target currency as configured data, not a unit's choice.

---

## F10 — HIGH — Refusal rows in the findings list: per group or per employee, and how many?

**Pair:** `domain/outliers.ts` (CAP-6, AD-12) vs. the Home findings-region component — or, equivalently, two readings of AD-12 by two implementers.

**How both obey:** AD-12 says the sweep computes findings per request and enforces "EXPERIENCE.md's contract that the findings list is a pure function of data + threshold + as-of date". EXPERIENCE.md: *"Refusal-worthy groups appear inline as refusal rows, never silently omitted."* Its worked example row names a **person**: *"Elena Rossi — only 3 peers, too few to compare fairly."* So:
- **Per-group unit:** one refusal row per thin `(role, level, country)` cell. Row identity = the group.
- **Per-employee unit:** one refusal row per employee in a thin cell — matching EXPERIENCE.md's own example, which is an employee-named row. Row identity = the person.

Both obey AD-12 and the refusal convention exactly. Neither is chosen anywhere.

**Divergent outcome:** the addendum's own sizing — "~25 roles × 6 levels × 8 countries = 1,200 cells for 10,000 employees, averaging ~8 per cell. **The average lies — the distribution will be lumpy, and unplanned cells of one will occur unless density is deliberately engineered.**" Assume a conservative 15% of cells fall under 5. Per-group build: **~180 refusal rows** under 4 findings. Per-employee build: those cells hold ~400 people → **~400 refusal rows**. Flow 1's climax — "She reaches the end of the list… nothing else is flagged" — is unreachable in both, and the sweep, the product's reason to exist, becomes a wall of "we don't know" that Alice scrolls past. The spine never notices because it treats the findings list as a math object and EXPERIENCE.md's example as prose.

**Close it:** an AD deciding the findings row's identity (per employee, to match the outlier rows it sits among) **and** bounding refusal rows to something Alice can reach the end of. The honest options: refusal rows appear only for groups containing a member whose distance would flag were the group large enough (impossible — no median exists), or refusals are a separate collapsed region with a count ("18 groups too thin to judge — 41 people"), or thin-cell refusals are surfaced only on the employee detail (CAP-5's actual home) and Home carries a count. This is a real decision the spine must make, not defer — it changes what CAP-6 returns.

---

## F11 — HIGH — AD-6's validation has no owner, and the Capability map exempts the seed from it

**Pair:** `use-cases/import` (CAP-1, bound to AD-4/AD-6/AD-7) vs. `prisma/seed.ts` (CAP-11, bound to **AD-14, AD-4, and the addendum only** — the Capability → Architecture Map lists neither AD-6 nor AD-7).

**How both obey:** AD-6's rule — *"`salary_record.currency_code` is written from the employee's country via the country reference table at write time, and validated to equal it"* — never says **where** that validation lives. Not a DB constraint (none is specified, and AD-2 makes the DB deliberately dumb). Not the domain (AD-1: no I/O, and the country table is I/O). So it lives in the application layer — which the seed, writing 10,000 rows straight through Prisma per the Containers diagram (`SEED -->|Prisma| PG`), does not pass through. The seed obeys every AD it is bound to.

**Divergent outcome:** a seed that assigns currency by role-base-multiplier logic, or that fat-fingers one country's mapping, writes salary records whose `currency_code` disagrees with the country table. Nothing rejects it. Then the SPEC's load-bearing structural claim — *"No comparison crosses a currency. Because country is part of peer identity, this holds **structurally rather than by discipline**"* — is false. A single Indian peer group holds INR and USD rows. `domain/statistics.ts` receives them, and per the Consistency Conventions **domain functions are total — they do not throw** — so it sorts `amountMinor` across currencies and returns a median of mixed money. AD-4 is obeyed the whole way (every value has its currency attached); no invariant fires; Alice reads a peer median that is arithmetic on two currencies, with a currency label on it.

**Close it:** AD-6 must name the enforcement point and make it un-bypassable — a **database check/FK** (`salary_record.currency_code` derived via a FK path through `employee.country → country.currency_code`, or a trigger/generated column), not an application-layer check. This does not violate AD-2: AD-2 forbids the DB *computing a domain statistic*, not enforcing referential truth. Additionally, `domain/statistics.ts` must be given a total, non-throwing response to a mixed-currency set — a refusal, per the refusal convention — because "it cannot happen" is exactly the assumption the seed disproves. And the Capability map must bind CAP-11 to AD-6 and AD-7.

---

## F12 — MEDIUM-HIGH — AD-4 mandates a currency exponent that the schema lacks, and AD-1 makes the formatter homeless

**Pair:** the `ui/` money component vs. `adapters/csv` (export).

**How both obey:** AD-4: *"The minor-unit exponent comes from the **currency reference table**, never from a hard-coded 100."* The ER diagram's `CURRENCY` entity carries **no attributes** — no exponent column is specified anywhere. Meanwhile the Consistency Conventions say money is *"Rendered only through one formatter that requires both"* (amount + currency) — but a formatter that needs the exponent needs the table, i.e. I/O, so it cannot live in `src/domain/**` (AD-1). And AD-1's dependency table says UI may depend on `domain` **types only** — so the UI cannot import a domain formatter *function* at all. The formatter is homeless: too impure for domain, too value-shaped for the UI's types-only edge.
- **UI unit** resolves it by taking a pure `formatMoney(money, exponent)` and threading `exponent` from the server as a prop — or, where no prop arrives, falling back to `Intl.NumberFormat(locale, {style:'currency', currency})`, which knows from CLDR that JPY has exponent 0. Legal: no hex, no hard-coded 100, currency required.
- **CSV unit** reads the exponent from the currency table via the repository. Legal, and literally what AD-4 says.

**Divergent outcome:** the currency table has no exponent column (nothing mandates one), so a story seeds it with a default of 2, or omits it and the adapter defaults to 2. A JPY salary of 5,000,000 yen renders **¥5,000,000** on screen (Intl, exponent 0) and **50000.00** in the export (table, exponent 2) — a 100× discrepancy in the artifact Alice sends to Finance. AD-4's stated purpose is precisely "a unit assuming two decimals everywhere, mis-rendering JPY."

**Close it:** add `currency.minor_unit_exponent` to the ER model as a required column; state that `Intl`'s currency knowledge is banned as a source of the exponent (it is a second reference table); and resolve AD-1's contradiction by declaring the formatter a **pure domain function** that takes the exponent as an argument, with the UI permitted to import pure domain functions (not just types) — or by amending the dependency table to say so.

---

## F13 — MEDIUM-HIGH — Headcount and CAP-8 counts: is the population as-of-dated at all?

**Pair:** `use-cases/home-landscape` (headcount "10,000", "14 countries", the gender-by-level pulse) vs. `domain/gender-gap.ts` hosting CAP-8 (Gender Insights — which EXPERIENCE.md declares **"the drill-down for the Home pulse"**).

**How both obey:** `employee` is not effective-dated: it has `hire_date` and no termination. AD-11 requires as-of as a *required argument* to every domain and application function — and requires nothing of what it filters. Level is not effective-dated either, so CAP-8's counts arguably do not depend on as-of at all.
- **Home unit:** headcount = `employee` count; accepts `asOf`, uses it for the payroll metric, ignores it for headcount. Obedient.
- **Gender Insights unit:** counts employees with an as-of current salary (following AD-12's "as-of current-salary set" precedent, or F2's close), or filters `hire_date ≤ asOf` reasoning that EXPERIENCE.md promises "winding the as-of date back **reproduces yesterday's answer exactly**" and yesterday's org did not contain tomorrow's hires. Equally obedient.

**Divergent outcome:** wound back to 01 Jan 2026, Home's pulse shows 10,000 across levels and Gender Insights — its own drill-down, one click away — shows 9,240. Neither is wrong; the two are just answering different questions with the same title. And on the peer-comparison path the same fork is worse: an employee hired 10 Jul 2026, viewed as-of 01 Jan 2026, is either absent from her peer group (`hire_date > asOf`) or present in `n` with no salary to median (F2). **AD-11 mandates the parameter and mandates nothing about the population, which is the half that matters.**

**Close it:** the F2 AD must state whether `hire_date > asOf` excludes an employee from every set (recommended: yes — it is the only reading under which the determinism promise's own words hold) and whether CAP-8's counts are as-of-scoped. If a count is genuinely as-of-invariant, the AD should say so explicitly rather than leave two units to guess.

---

## F14 — MEDIUM — AD-2 forbids the DB computing a `count`; pagination and headcount need one

**Pair:** `use-cases/employee-directory` (paginated per the Deferred section) vs. `use-cases/home-landscape`.

**How both obey:** AD-2, verbatim: *"It computes no median, spread, distance, gap, total, or **count** that reaches a user as a domain value."* EXPERIENCE.md bans infinite scroll and mandates pagination; a paginated table shows "1–50 of 10,000" — a count reaching a user. `n` in "Based on 9 peers" is a count reaching a user. Headcount is a count reaching a user.
- **Strict unit** obeys AD-2: loads all 10,000 rows into the process and counts in `src/domain/`. Correct, and it defeats the point of pagination on the one surface the Deferred section says is paginated.
- **Pragmatic unit** reads AD-2's *"Prevents"* clause (which is about `percentile_cont` vs. a hand-written median) and treats a pagination total as infrastructure, not "a domain value". `SELECT count(*)`. Also defensible.

**Divergent outcome:** two directory implementations with a 200× difference in read volume, and — more sharply — the two disagree about whether `n` may come from SQL. If the peer-comparison unit takes `n` from a `COUNT(*)` while the median comes from loaded rows, F2's split is now *guaranteed* rather than merely possible: the count and the median come from two different queries and can select two different sets by construction.

**Close it:** AD-2 should be tightened, not loosened: keep the ban on statistics, and add that **`n` and any count that annotates a computed statistic must be the cardinality of the exact in-memory set the statistic was computed over** — never a separate query. Then explicitly exempt pagination totals and landscape counts as non-annotating, or the AD forbids the architecture it prescribes.

---

## F15 — MEDIUM — `bigint` cannot cross the boundary AD-4 says it must cross

**Pair:** an `app/` RSC surface vs. a route handler / `adapters/csv`.

**How both obey:** AD-4: *"every monetary value is `{ amountMinor: bigint, currency: string }`. No `number`, no float, no bare amount crosses any boundary — **including JSON payloads, CSV columns, and React props**."* React 19's RSC serializer handles `bigint`; **`JSON.stringify` throws on it.** So the RSC unit passes `{ amountMinor: 2340000n, currency: 'INR' }` as a prop, fully compliant. The route handler backing the CSV export must encode *something*, and AD-4 names no wire encoding.
- **Unit A** serializes as a decimal string: `{"amountMinor":"2340000","currency":"INR"}` — no `number`, no float. Compliant.
- **Unit B** serializes as a JSON number: `{"amountMinor":2340000,"currency":"INR"}` — lossless below 2^53, so it works, ships, and passes every test at ACME's amounts. AD-4 forbids a "bare amount", and this amount is not bare — it has its currency. Arguably compliant.

**Divergent outcome:** two wire shapes for the one type the whole spine hangs on. A client component consuming both parses `"2340000"` as a string in one path and a number in the other; `BigInt(value)` works for both, `value + 0n` works for neither consistently, and the CSV column reads `2340000` from one adapter and `"2340000"` (quoted) from the other. AD-4's absolutism ("no `number` crosses any boundary") does not survive contact with `JSON.stringify` and therefore gets reinterpreted, per unit, in private.

**Close it:** AD-4 must name the wire encoding explicitly — `amountMinor` is a **decimal string** in every JSON payload and CSV cell, decoded to `bigint` at the boundary by one shared codec — and name the one module that owns encode/decode.

---

## F16 — MEDIUM — Findings order and directory pagination sit on a non-total order over non-unique names

**Pair:** the Home findings list vs. its CSV export ("exports the **visible** list" — EXPERIENCE.md); and `use-cases/employee-directory` vs. itself across pages.

**How both obey:** no AD orders anything except AD-8's `(effective_from, seq)` for timelines. The Deferred section explicitly waves this off: *"Pagination strategy for the 10,000-row directory — … page size and cursor-vs-offset is a story-level call, **not a divergence risk**."* It is a divergence risk, and AD-10 is what makes it one: AD-10 declares names non-identifying *because they collide across 10,000 people* ("name-as-key collisions across 10,000 people"), while EXPERIENCE.md's directory is name-ordered and name-searched.

**Divergent outcome:** `ORDER BY name` over 10,000 rows containing two "David Chen" — Postgres's sort is not stable across plans, so an `OFFSET 50 LIMIT 50` page boundary landing between the two Davids shows one of them **twice** on consecutive pages and **drops a third employee entirely**. The dropped employee is silently absent from the directory. Separately, the findings list ordered by `|distance|` desc ties at exactly +28.4% between two employees, and the export (ordered by name, or by whatever the CSV adapter picks) is not "the visible list" the AD requires it to be.

**Close it:** an AD requiring every user-visible ordering to be **total**, with `employee.id` (AD-10's UUIDv7, sortable by design) as the final tie-break — and fixing the findings order (`|distance|` desc, then id) so the list and its export are the same list. Remove the false reassurance from the Deferred section.

---

## F17 — MEDIUM — CAP-2 can change country; AD-6 assumes it cannot, and the Deferred section asserts it does not happen

**Pair:** `use-cases/edit-employee` (CAP-2) vs. `use-cases/record-change` (CAP-3).

**How both obey:** SPEC CAP-2: "create **and edit** an employee record individually … persists with role, level, **country**, gender, and hire date." EXPERIENCE.md's Employee form lists country as a field, on the edit surface. So the edit unit changes country — obeying every AD; AD-6 governs `salary_record`, not `employee`. Meanwhile the Deferred section asserts: *"Employee country change / relocation — **no capability requires it**. AD-6's write-time currency check holds while country is **effectively immutable**."* **CAP-2 requires it.** The deferral rests on a premise the SPEC contradicts.

Then AD-6's rule — currency "written from the employee's country … and validated to equal it" — meets EXPERIENCE.md's record-change form, which has a **user-facing currency field** defaulted "from the current record" (Flow 3 step 3). For an employee whose country was corrected from India to Germany, the form defaults to INR (from the current record) while AD-6 validates against EUR (from the country table).

**Divergent outcome:** three obedient builds, three behaviors — the form's currency field is read-only and derived (silently switching this person's timeline to EUR mid-series, so CAP-4 shows one person paid in two currencies and CAP-5's "structural" currency isolation is now discipline-based); or the form accepts INR and AD-6 rejects the save, so recording a change for this employee is impossible with no explicable message; or the form accepts INR and validation is skipped because F11's enforcement point was never named. Note this is not exotic: a country **typo** on import or on the Add-employee form is the everyday case, and correcting it is CAP-2's job.

**Close it:** delete the false premise from the Deferred section. AD-6 must state what a country change does to (a) existing salary records — **nothing**, they keep their currency; that is AD-6's whole point — and (b) the next appended record: it takes the new country's currency, which means a timeline **may** legitimately span currencies, which means CAP-4's display and CAP-5's set selection both need a rule. Recommended and cheapest: peer-group membership and every comparison use the **currency of the as-of current record**, and a mismatch between that and the employee's country currency is a first-class, displayed state rather than an invariant nobody enforces.

---

## F18 — LOW-MEDIUM — AD-12 bans "no cache" against a framework that caches by default

**Pair:** the Home RSC page vs. the Employee detail RSC page.

**How both obey:** AD-12 bans "no materialized outlier table, no cache". Next.js 16 App Router caches route segments and `fetch`/data results by default depending on segment config; a unit rendering Home with default caching has **no outlier table and no explicit cache** — it obeys AD-12's letter and inherits a cache from the framework. A unit marking the segment dynamic obeys AD-12's intent.

**Divergent outcome:** Alice records Priya's raise (Flow 3); the detail page (dynamic) shows the new current salary; Home (cached segment) still shows the old finding. AD-12's stated purpose — "a materialized outlier table going stale against a changed salary — re-introducing the exact untrustworthiness the product exists to kill" — happens anyway, via a mechanism AD-12 didn't name. Compounding: a cached segment also freezes `clock.today()`, so AD-11's as-of default is yesterday's date after midnight.

**Close it:** AD-12's rule should name the framework mechanism — every data surface is dynamic (`export const dynamic = 'force-dynamic'` or equivalent), no `revalidate`, no `unstable_cache` — and say so as a rule a lint or a review can check, not as an intention.

---

## Also noted (not developed into pairs)

- **`settings.outlier_threshold_pct` is `int`** in the ER model while AD-5 rounds distance to one decimal. Consistent today, but no AD declares the threshold's precision, so a story widening it to `numeric(4,1)` meets a one-dp distance and re-opens the boundary AD-5 closed. State the threshold's type and precision as an AD, not as a diagram detail.
- **AD-3's "rounded half-up"** for the even-`n` median is safe only because salaries are positive. If F4's zero-salary path or any negative correction ever lands, it inherits F1's ambiguity. Name the tie mode in AD-3 too, for the same one-word cost.
- **AD-9's spread at `n` where min == max** (a real case in a thin, uniform cell) renders "₹18,20,000 – ₹18,20,000 INR" — EXPERIENCE.md's range copy has no degenerate form. Story-level, but the copy contract should acknowledge it.
- **The `n ≥ 5` constant appears in CAP-5 and CAP-7 and in no AD.** It is not user-configurable (only the threshold is), so it is a domain constant with two consumers and no declared home. One line in the Consistency Conventions closes it.

## Summary of ADs required

| # | New / tightened AD | Closes |
|---|---|---|
| 1 | **AD-5 fix:** flag tests `|rounded distance| > threshold`; sign preserved for display only; round-half-away-from-zero named explicitly | F1 |
| 2 | **New AD — the as-of population.** One named domain concept: peer-group membership = employees with a current salary at the as-of date and `hire_date ≤ asOf`; every `n`, every count in a refusal sentence, and every median are cardinality/values of that same set | F2, F3, F5, F13, F14 |
| 3 | **New AD — CAP-7's gap arithmetic.** Direction, sign, denominator, precision, and payload shape | F19 *(see below)* |
| 4 | **New AD — employees without a salary record.** Permitted (CAP-2 requires it); excluded from all computed sets; never zero-valued; ER cardinality relaxed to `||--o{` | F4 |
| 5 | **AD-10 + AD-14 reconciliation:** id generation is an injected port; the seed drives it deterministically | F6 |
| 6 | **New AD — CAP-10 semantics:** cutoff from as-of, operator and boundary, hire-only records, zero-record employees | F7 |
| 7 | **AD-11 widening:** clock ban extends to `src/ui/**` and `src/app/**` (clock port excepted); "today" resolves in one named timezone | F8 |
| 8 | **AD-13 repair:** real rate-set identity or per-pair provenance in the payload; org-wide target currency named; incomplete coverage is a refusal | F9 |
| 9 | **New AD — findings row identity and refusal-row volume** | F10 |
| 10 | **AD-6 repair:** enforcement point named and un-bypassable (DB-level); CAP-11 bound to AD-6/AD-7; `statistics.ts` given a total response to mixed currency | F11 |
| 11 | **AD-4 repair:** `currency.minor_unit_exponent` column; `Intl` banned as an exponent source; wire encoding named (`amountMinor` as decimal string, one codec); AD-1's types-only UI edge amended to permit pure domain functions | F12, F15 |
| 12 | **New AD — total orderings**, id as final tie-break; findings order fixed; Deferred section's "not a divergence risk" retracted | F16 |
| 13 | **AD-6 + Deferred repair:** country is mutable (CAP-2 says so); history keeps its currency; the next record takes the new one; the mismatch is a displayed state | F17 |
| 14 | **AD-12 repair:** name the framework mechanism (dynamic segments, no revalidate, no unstable_cache) | F18 |

---

## F19 — CRITICAL — CAP-7's gap arithmetic has zero AD coverage

*(Numbered last for reading order; ranks with F1–F5.)*

**Pair:** `domain/gender-gap.ts` as built by the CAP-7 story vs. the CAP-11 seed's gap-planting/verification unit (the addendum makes the seed responsible for planting a within-peer gap that CAP-7 must then report — two units that must agree on what a gap *is*, built from different documents).

**How both obey:** the Capability map governs CAP-7 with **AD-2, AD-3, and the refusal convention** — nothing else. AD-3 fixes how to compute each median. AD-5 governs "distance", which is a CAP-5/CAP-6 concept and is explicitly bound to those two capabilities only — **the gap is not a distance and AD-5 does not reach it.** AD-4 governs *money*; a percentage is not money, so AD-4 does not reach a percentage gap either. SPEC CAP-7 says only: *"the gap between male and female medians within that group is reported."* Every one of the following obeys every binding AD:

| Reading | On male median ₹25,00,000 / female median ₹23,00,000 | Defensible because |
|---|---|---|
| `(male − female) / male` | **+8.0%** | EU Pay Transparency / ONS convention — the addendum's own research section |
| `(male − female) / female` | **+8.7%** | symmetry with AD-5's "distance from the median" shape |
| `(female − male) / female` | **−8.7%** | reads as "women are paid 8.7% less", the sentence Alice wants |
| absolute difference as money | **₹2,00,000 INR** | AD-4-compliant `{amountMinor: 200000n, currency:'INR'}`; the SPEC says "gap", not "gap percentage" |
| unsigned magnitude | **8.0%** | generalizing the SPEC's own outlier constraint: "symmetric and direction-agnostic" |

Precision is equally open: AD-5's one-decimal rounding is bound to CAP-5/CAP-6, so a gap unit may round to zero decimals (`8%`), one (`8.0%`), or not at all (`8.6956...%`).

**Divergent outcome:** EXPERIENCE.md gives the gender-gap card the **copy-answer** affordance — the sentence Alice pastes into Slack and stands behind. Two obedient builds produce, from byte-identical data: *"8% gap"*, *"−8.7% gap"*, *"+8.7% favouring men"*, or *"₹2,00,000 gap"*. The unsigned build is the worst: it reports a gap and **omits who is paid less**, which is the entire question CAP-7 asks. Meanwhile CAP-11's acceptance test ("a gap is reported") passes against every one of them, so the seed cannot falsify any. And a `(male − female)/male` build and a `(female − male)/female` build disagree on **sign**, so the same cell reads as favouring men on one and women on the other.

This is one of the product's two flagship fairness answers, it is quotable by design, and its arithmetic is specified nowhere in the spine.

**Close it:** an AD for CAP-7, at AD-5's level of precision. Recommended: gap is **signed**, computed as `(maleMedian − femaleMedian) / maleMedian`, rounded half-away-from-zero to one decimal place, positive meaning men are paid more; the payload carries both medians, both counts, and the signed percentage; the copy names the direction in words (per EXPERIENCE.md's Accessibility Floor: "Color is never the sole carrier"). Whichever convention is chosen matters far less than that **one** is, in the spine, before two units read the SPEC and reach different sentences.
