---
title: 'Verification round 2 — did the spine revision close the holes, and what did it open?'
type: review
method: fix-verification + divergence-hunt on the revision
target: ../ARCHITECTURE-SPINE.md
against:
  - ./review-adversarial.md
  - ./review-reconcile-spec.md
  - ./review-reconcile-ux.md
  - ./review-rubric.md
  - ../../../../specs/spec-payroll/SPEC.md
  - ../../../ux-designs/ux-payroll-2026-07-16/EXPERIENCE.md
status: draft
created: '2026-07-17'
---

# Verification round 2

**Verdict: substantial real progress — six of the seven CRITICALs are genuinely closed and the two worst structural gaps (as-of population, delivery boundary) now have enforceable ADs — but the CAP-10 cluster is untouched, AD-13's target currency and rate-set identity survive verbatim, F10/F11/F16/F18 were not attempted, and the revision *narrowed* AD-11's clock ban, which is a regression.**

The test applied is the same one the prior round used: a fix counts as closed only if two units obeying the revised text to the letter cannot build incompatibly. An intention, a cross-reference, or a sentence in the Deferred section is not a rule.

---

## Part (a) — Status of prior CRITICAL and HIGH findings

### CRITICAL

| # | Finding | Status |
|---|---|---|
| adversarial F1 / rubric F1 / spec F-1 / ux F-1 | AD-5 never flags underpaid | **CLOSED** (one residual, see N-1) |
| adversarial F2 | As-of population undefined | **CLOSED** (residual scope gaps, see N-3, N-4) |
| adversarial F3 | Gender gate vs gender median select different sets | **CLOSED** |
| adversarial F4 | CAP-2 creates salary-less employees vs `||--|{` | **CLOSED** except the zero-median denominator (see (c)4) |
| adversarial F5 | Is the subject in their own peer group? | **CLOSED** |
| adversarial F19 | CAP-7 gap arithmetic has no AD | **PARTIALLY CLOSED** — formula, sign, denominator fixed; **precision is not** (see (c)3) |

**F1 — closed.** AD-5 now reads: `d = (salary − median) / median × 100`, unit named (percentage points), magnitude rounded half-up to one decimal then the sign reapplied (`+20.05 → +20.1`, `−20.05 → −20.1`), flag tests `|d| > threshold` strictly, `|d| = 20.0` does not flag. Every fork the four reviews named — signed comparison, ratio-vs-percent, half-up across zero — is shut. This is a genuine fix.

**F2 — closed.** AD-16 is the missing AD the prior round said six findings were instances of. It names one predicate (`hire_date ≤ D` **and** ∃ salary record `effective_from ≤ D`), defines the peer group over that population, includes the subject, and states `n` is the size of that set "counted identically everywhere". The `n = 6 over a median of 4` divergence is unreachable.

**F3 — closed.** AD-17 computes both medians "over its as-of population (AD-16)" and gates on "both genders have `n ≥ 5` in that group" — the same set, by construction. The gate can no longer count a person the median does not.

**F4 — closed as to existence.** AD-16: "An employee may exist with zero salary records — CAP-2 creates one — and is invisible to all statistics until a record exists," plus "yields a distinct refusal (`no salary as of D`), never `n = 0` arithmetic." The ER cardinality is relaxed to `||--o{` with an explicit note. The *derived* hazard the prior round flagged — a zero-amount record producing a zero median and dividing by zero in AD-5 — is **not** closed; see (c)4.

**F5 — closed.** AD-16: "including `E`". `n` includes the subject. The `[100,100,100,100,200]` divergence is gone.

**F19 — partially closed.** AD-17 fixes `(M − F) / M × 100`, "the denominator is always the male median", positive means men are paid more. Four of the five readings are dead. The fifth axis F19 named — **precision** — is not fixed; see (c)3.

### HIGH

| # | Finding | Status |
|---|---|---|
| adversarial F6 | AD-10 UUIDv7 vs AD-14 reproducibility | **CLOSED** |
| adversarial F7 | CAP-10 overdue: four forks | **1 of 4 closed** — see (c)1, (c)2 |
| adversarial F8 | Clock ban stops at `src/ui`; timezone unnamed | **STILL OPEN — and regressed** (see N-2) |
| adversarial F9 | AD-13 rate "set" doesn't exist; no target currency | **PARTIALLY CLOSED** |
| adversarial F10 | Refusal-row identity and volume | **STILL OPEN — not attempted** |
| adversarial F11 | AD-6 enforcement point; seed exempt from AD-6/AD-7 | **STILL OPEN — not attempted** |
| spec F-2 | AD-8 architects for retroactive correction | **CLOSED** |
| spec F-3 | Append-only has no AD | **CLOSED** |
| spec F-4 | No future-dating dropped | **PARTIALLY CLOSED** — CAP-1 and CAP-11 exempt (see N-5) |
| ux F-2 | AD-6 empties the record-change form's third field | **CLOSED** (decided explicitly) |
| ux F-3 | Accessibility floor has no architectural representation | **PARTIALLY CLOSED** — structure landed, the CI gate did not |
| rubric F3 | Delivery boundary silent | **CLOSED** (one seam, see N-8) |
| rubric F4 | CAP-1 `effective_from`, re-import identity, CSV-vs-XLSX | **STILL OPEN — not attempted** |
| rubric F5 | AD-13 order of operations / rate type / no-rate case | **CLOSED** (3 of 3 bullets) |
| rubric F7 | Country change deferred on an invented premise | **PARTIALLY CLOSED** — premise deleted, decision made in the wrong section |
| rubric F2 | AD-5 unit + half-up asymmetry | **CLOSED** |

**F6 — closed.** AD-10: "generated in the shell via an id port… The seed's id port derives every UUIDv7 from the seeded PRNG and a fixed epoch, not the wall clock — a seed run is byte-identical across runs (AD-14)." That is option (a) from the prior review, and CAP-11's map row now cites AD-10.

**F7 — 1 of 4 closed.** 7d (zero-record employees) is closed by AD-16 via CAP-10's binding. **7a (as-of vs today), 7b (operator/boundary), 7c (hire-only records) are untouched.** CAP-10's map row is still `AD-11, AD-16` and no CAP-10 semantics AD exists. Detail in Part (c).

**F8 — open, and worse.** The prior round asked AD-11's ban to be *widened* from `src/domain/** + src/application/**` to include `src/ui/**` and `src/app/**`, and asked it to name the timezone in which "today" resolves. The revised AD-11 instead reads: *"No code under `src/domain/** ` calls `Date.now()`, `new Date()`, or reads a timezone."* The application layer has been **dropped from the ban**. See N-2 — this is the single clearest regression in the revision. The timezone is still named nowhere, and AD-18 now depends on it.

**F9 — partially closed.** Genuinely fixed: per-country totals never convert (closes spec F-6's first half); order of operations pinned (sum per country → convert once → sum); `rate NUMERIC` with decimal arithmetic and a single final rounding; no rate at as-of → refusal. **Not fixed:** AD-13 still says *"the latest rate **set** whose `pinned_on ≤ as-of date`"* over a schema `fx_rate (from_currency, to_currency, rate, pinned_on)` that **still has no set identity** — the per-pair vs whole-table fork is verbatim intact, and AD-20's receipt list still carries *"the rate with its `pinned_on`"* in the singular for a total that may blend several pinned dates. **The org-wide total's target currency is still named nowhere in the spine, the SPEC, or EXPERIENCE.md.** Two units, two totals, both captioned.

**F10, F11, F16, rubric F4 — not attempted.** No text in the revision touches findings-row identity, refusal-row volume, AD-6's enforcement point, the seed's exemption from AD-6/AD-7, `statistics.ts`'s response to a mixed-currency set, total orderings/tie-breaks, or CAP-1's `effective_from` / re-import identity / format. The Deferred section still asserts pagination is *"not a divergence risk"*, which the prior round asked to be retracted.

**spec F-3 — closed, well.** AD-18 gives append-only what the other three structural guarantees had: a mechanical gate (`UPDATE`/`DELETE` revoked by migration on the application role, plus a port that exposes only `append`). This is the strongest new AD.

**ux F-3 — partially closed.** The Consistency Conventions' new Accessibility row lands the three *structural* commitments the prior round said RSC would otherwise break: a single app-level `aria-live=polite` region not remounted by a recompute, refusals as region+heading never `role="alert"`, and Suspense boundaries that a recompute must not re-trigger. That also closes ux F-4. **Not landed:** WCAG 2.2 AA as a named binding floor, and the axe-under-Playwright CI gate — so the floor is still unenforced, which was half of ux F-3's complaint. AD-15's "no hex literal appears in application code" also still has no named enforcement while AD-1 and AD-14 both name lint.

**rubric F7 — partially closed.** The false premise ("no capability requires it") is gone and replaced with an honest statement plus an *interim rule*: "the employee form does not offer country as an editable field in v1." A decision, at last. But it is a **rule living in the Deferred section**, which is the one section of a spine that by construction does not bind anything; it silently narrows CAP-2's "create and **edit** an employee record" and EXPERIENCE.md's single Employee form (which lists country among its fields and is used for both add and edit); and it is recorded as a deferral, not as a SPEC deviation. Move it into AD-6 as a clause and record the narrowing.

**Also still open from the prior round's medium tier** (listed for completeness, not developed): F12 (currency exponent column absent from the ER; `Intl` not banned as an exponent source; the formatter still homeless against AD-1's types-only UI edge), F18 (AD-12 still says "no cache" without naming the Next.js mechanism), rubric F10 (no testing AD), F12 (no Open Questions section; Playwright and TypeScript 7 are `[ASSUMPTION]`s filed in decided tables), F13 (production seed conflates reference data with the CAP-11 demo population), F16 (patch pins), rubric F8 (CSV money-cell encoding), spec F-5 (AD-5's rounding-before-testing reassigns the SPEC-defined 20.04 band and is still not recorded as a deviation).

**Cleanly closed elsewhere:** rubric F15 (source tree now names layers only, with "module filenames inside `src/domain/` are the code's to own"; AD-3's `statistics.ts` and AD-20's `verdict.ts` correctly remain pinned); rubric F17 (rationale stripped from AD-8/AD-9/AD-10/AD-12 rule bodies); rubric F6 (AD-1 now establishes a CI gate: lint, typecheck, unit tests on every push, blocking merge); adversarial F15 / spec F-11 / ux F-10 (AD-4 now names the wire encoding: decimal string at any JSON or Server Action boundary); ux F-7 (AD-20); ux F-9 (AD-18); ux F-12 (locale grouping named in the Money convention); spec F-9 (AD-19 makes the threshold a supplied argument, not an ambient read).

---

## Part (b) — New divergences the revision introduced

### N-1 — MEDIUM — AD-5 names a tie mode it cannot reach: the distance arithmetic's numeric type is unspecified

AD-5's boundary exactness now turns on `−20.05 → −20.1`. But AD-5 specifies no arithmetic type for `(salary − median) / median × 100`. AD-4 bans float **for money**; a distance is not money, so the ban does not reach it. AD-13, notably, *does* mandate decimal for rate arithmetic — so the spine knows this move and did not make it here.

**Pair:** a `domain/outliers` unit computing in IEEE double vs one computing in decimal. In double, `20.05` is representable as `20.049999999999997`; magnitude-half-up gives `20.0` → **no flag**. In decimal it gives `20.1` → **flag**. Both obey AD-5 word for word. The AD's entire stated purpose — "the number shown is the number judged", and the exact boundary CAP-6 bothered to fix — is decided by a type the AD does not name. This is F1's tail: the tie mode got named, the tie got made unreachable. Same applies to AD-17's gap.

**Close it:** AD-5 states the distance is computed in decimal (or as an exact rational over the integer minor units), never in IEEE floating point, and AD-17 inherits it.

### N-2 — HIGH — AD-11's clock ban was narrowed from domain+application to domain only

Prior AD-11 banned clock reads under `src/domain/**` **and** `src/application/**`. Revised AD-11: *"No code under `src/domain/**` calls `Date.now()`, `new Date()`, or reads a timezone."* The application layer is now unbanned.

This is a regression against F8 (which asked to *widen* the ban to `src/ui/**` and `src/app/**`) and it directly reopens F7a: a `use-cases/home-overdue-summary` unit may now legally call `new Date()` inside the use-case and compute `cutoff = today − 1y` while ignoring the `asOf` it accepted, because AD-11 only requires the parameter to *exist*. AD-11's compensating sentence — "the clock … supplies 'today' only as a default at the delivery boundary and for the write-time check in AD-18" — is a statement about the clock *port*; nothing stops `src/application/**` from constructing a `Date` directly now that the ban does not reach it, and AD-1's lint (scoped to `src/domain/**`) will not catch it.

**Close it:** restore `src/application/**` and add `src/ui/**` / `src/app/**`, with the clock port as the single named exception, and make it the AD-1 lint's scope.

### N-3 — MEDIUM-HIGH — The spine now has two disagreeing binding registries

Each AD carries a `Binds:` field, and the Capability → Architecture Map carries a governing-AD list. After the revision they contradict each other in at least three places:

| AD | `Binds:` field says | Map row says |
|---|---|---|
| AD-16 | CAP-5, 6, 7, 8, 10 — **no CAP-9** | CAP-9 is governed by AD-16 |
| AD-6 | CAP-2, 3, 4, 9 — **no CAP-1** | CAP-1 is governed by AD-6 |
| AD-9 | CAP-5, **CAP-7** | CAP-7 row omits AD-9 |

A builder working from the map and a builder working from the AD get different AD sets for CAP-1, CAP-7, and CAP-9. AD-9/CAP-7 is the live one — it is exactly ux F-6, which was fixed in one register and not the other, so spread on the peer-group surface is still ungoverned for anyone reading the map. Pick one registry as authoritative or make them agree mechanically.

### N-4 — MEDIUM-HIGH — AD-16 binds CAP-8 but its rule never mentions counts, and Home's headcount is bound to nothing

AD-16's rule enumerates what an out-of-population employee is absent from: *"in no peer group, in no `n`, and in no total."* A gender-by-level count is none of those three. So:

- **CAP-8 unit** reads AD-16's `Binds: … CAP-8` and counts only the as-of population → 9,240 at as-of 01 Jan 2026.
- **Home landscape unit** — headcount "10,000", "14 countries", the gender-by-level pulse — is not a capability row, is bound to no AD at all, and counts `employee` rows → 10,000.

EXPERIENCE.md declares Gender Insights *"the drill-down for the Home pulse"*. This is adversarial F13 surviving the fix that was supposed to close it, because AD-16's enumeration is narrower than its binding. **Close it:** AD-16's rule should say an out-of-population employee is absent from **every user-visible figure**, and either bind the Home landscape figures explicitly or state that headcount is deliberately as-of-invariant.

### N-5 — MEDIUM-HIGH — AD-18's write-time checks bind CAP-2/3/4 and exempt CAP-1 and CAP-11

spec F-4 asked for the no-future-dating validation "on the insert path, for CAP-3 **and CAP-1** both", and noted "nothing stops the seed generator emitting future-dated records". AD-18 binds **CAP-2, CAP-3, CAP-4**. CAP-1's map row is `AD-4, AD-6, AD-7, AD-21` — no AD-18. CAP-11's is `AD-4, AD-10, AD-14, addendum parameters` — no AD-18.

So an import row with a future `effective_from` lands (it is the everyday spreadsheet typo), and a seeded record may be future-dated. Both then sit invisibly under AD-8's `effective_from ≤ as-of` resolution and mature on their own — a scheduled change, which the SPEC bans outright. The append-only half of AD-18 does reach the import (it writes through the port, and the DB grant is revoked on the application role), but the seed writes `SEED -->|Prisma| PG` directly per the Containers diagram, and AD-18's revoke is scoped to "the application database role" — whether the seed shares it is unstated.

### N-6 — MEDIUM — AD-18's `today` inherits the timezone AD-11 still refuses to name

AD-18: *"Write-time validation rejects `effective_from > today`, with `today` supplied by the clock port."* AD-11 bans the domain from reading a timezone and names no zone anywhere; the Consistency Conventions say dates are calendar dates "no timezone, no instant"; the deployment table puts the server on Vercel (UTC); the worked examples are IST.

**Pair:** Alice, in IST, at 05:00 on 18 Jul, records a change dated 18 Jul (her today). The UTC server's `today` is 17 Jul → `18 Jul > 17 Jul` → **rejected as future-dating**, with no explicable message, for 5.5 hours a day. Symmetrically, an evening IST write dated tomorrow-in-UTC would be accepted. The revision took the one rule that most needs a named timezone (rubric F14, unclosed) and made a hard rejection depend on it.

### N-7 — MEDIUM — AD-19 and AD-20 don't compose: the threshold is not in the receipts

AD-12 declares the findings list a pure function of *data + threshold + as-of date*. AD-19 makes the threshold a supplied argument. AD-20 enumerates the receipts every answer must carry: *"group definition, `n`, as-of date, currency, and (where converted) the rate with its `pinned_on`."* **The threshold is not on that list** — one of the three declared inputs to CAP-6's answer does not travel with it. EXPERIENCE.md's CSV export explicitly "exports the visible list computed at the current as-of date **and threshold**" with provenance columns, and the copy-answer sentence for a finding is meaningless without the threshold it was judged at. Two units, two exports, one with a threshold column and one without.

### N-8 — LOW — AD-21's two rules overlap on the import, with no precedence

AD-21: *"**Mutations** — Server Actions"* and *"**Route Handlers** — only where a non-RSC transport genuinely requires one: the CAP-1 spreadsheet upload and CSV export downloads."* The CAP-1 upload is a mutation, so both clauses claim it and no precedence is stated. Worse, "genuinely requires" is a criterion a builder can dispute: React 19 Server Actions accept `File`/`FormData`, so a unit can argue the upload does *not* genuinely require a route and use a Server Action, while the AD names it as one of exactly two routes. Say whether the list is exhaustive (a decision) or illustrative (a criterion).

### N-9 — LOW-MEDIUM — AD-2 dropped "count" from its prohibition without adding the constraint that made dropping it safe

Revised AD-2 removes `count` from the banned list and permits `COUNT`/`ORDER BY`/`LIMIT` "used purely for directory listing and pagination". That correctly closes rubric F9 / ux F-11. But adversarial F14's *ask* was to tighten in the same breath: **"`n` and any count that annotates a computed statistic must be the cardinality of the exact in-memory set the statistic was computed over — never a separate query."** That sentence does not exist. With "count" gone from the ban, nothing now forbids a peer-comparison unit taking `n` from `SELECT COUNT(*)` while the median comes from loaded rows. AD-16 mostly rescues this ("`n` is the size of that set"), so the risk is a definitional drift between the COUNT's `WHERE` clause and the loader's, not a guaranteed split — hence low-medium rather than the guaranteed fork F14 described.

### N-10 — LOW — The `n ≥ 5` refusal constant is now homed for CAP-7 and still homeless for CAP-5

AD-17 states `n ≥ 5` for the gender gate. CAP-5's identical `n ≥ 5` refusal threshold appears in the SPEC and in no AD — AD-16 defines `n` but not the threshold, and AD-5 does not mention it. The prior round's "Also noted" item asked for one line in the Consistency Conventions declaring it a domain constant with two consumers. The revision homed one consumer and left the other, which is the worse of the two prior states: a builder now reads `n ≥ 5` inside AD-17 and reasonably infers it is a CAP-7 rule.

---

## Part (c) — The three unsettled questions, answered

### (c)1 — Is CAP-10 "overdue" measured against the as-of date or today? **Not unambiguous. Still open (high).**

CAP-10 is governed by `AD-11, AD-16`. AD-11 mandates that `asOf` be a required argument and (now) bans clock reads in `src/domain/**` only. Nothing anywhere states that the overdue cutoff derives from `asOf`.

The revision *weakly* improves this: AD-11's new clause — the clock port "supplies 'today' only as a *default* at the delivery boundary and for the write-time check in AD-18" — narrows what the port may be used for, which implies the cutoff must come from `asOf`. But it is an implication drawn from a rule about a port, not a rule about the cutoff, and it is defeated three ways:

1. The delivery boundary may legitimately obtain `today` from the port (permitted, explicitly) and pass it as the `asOf` argument of the Home overdue use-case while the page's as-of is 12 May. AD-11 is satisfied — the parameter was supplied.
2. **N-2**: `src/application/**` may now call `new Date()` directly, because the revision dropped it from the ban. A `use-cases/home-overdue-summary` unit computing `cutoff = today − 1y` violates no AD in the revised spine.
3. EXPERIENCE.md's Home copy — *"41 people are **currently** overdue"* — is unretracted and reads as a licence for exactly that.

So the prior round's 7a divergence stands unchanged: Alice winds back to 12 May, Home says 41, the surface she lands on says 63.

**Also still open in the same cluster:** **7b** — the cutoff's operator and boundary are stated nowhere. SPEC CAP-10 says "predates"; EXPERIENCE.md gives the control *both* a preset-chip shape and a custom-date field. `latest.effective_from < asOf − 1y` (chip) vs `≤ cutoff` (custom field, matching CAP-3's "on or before" phrasing) disagree for an employee whose last record is dated exactly one year before the as-of date — two controls, one screen, different answers. AD-5 proved the spine knows how to fix a boundary; CAP-10's has no AD. Additionally **rubric F11** survives: CAP-10's map row still omits AD-8, so "most recent salary record" invites a second resolver in `overdue`.

### (c)2 — Does AD-16 interact correctly with CAP-10 for an employee whose only record is their hire? **No. AD-16 makes them *more* visible, and does not resolve the fork. Still open (high).**

AD-16 closes **7d only**: an employee with zero salary records is out of the population, so CAP-10 cannot list them and cannot fail to render "the date of that record". That is correct and is a real fix.

But an employee whose only record **is** their hire has a record with `effective_from ≤ D`, so AD-16 puts them squarely **in** the population — and then says nothing more. CAP-10's two readings survive intact:

- **Criterion reader** (SPEC CAP-10 success: "employees whose most recent salary record predates it"): their most recent record is their hire, which predates the cutoff → **overdue**.
- **Intent reader** (SPEC CAP-10 intent: "employees who have not had a **salary change** in a given period"; EXPERIENCE.md makes `(Hire)` a derived label, so any unit may derive it): a hire is not a change; they never had one to be overdue on → **excluded**.

Across a 10,000-person seed with a realistic hire-date spread, "hired more than a year ago, one record" is hundreds of people. Home's overdue card reads 41 on one build and ~800 on the other. AD-16 did not touch this, and by putting hire-only employees in the population it removes the only accidental mechanism that might have excluded them.

**A new interaction AD-16 opens at CAP-10:** AD-16's rule says *"An employee not in the population yields a distinct refusal (`no salary as of D`), never `n = 0` arithmetic."* AD-16 binds CAP-10. Does the Overdue list therefore carry a refusal row per salary-less employee? EXPERIENCE.md's Overdue surface has no refusal state (its only non-list state is "No one is overdue for review within the selected period"). Two readings — silently excluded, or one refusal row per zero-record employee — and this is F10's unfixed refusal-volume problem arriving on a second surface. AD-16's refusal clause is written for CAP-5's single-subject card and is being bound to list surfaces where it does not obviously mean anything.

### (c)3 — Does AD-17's rounding rule work, given AD-5 binds only CAP-5/CAP-6? **The sign/tie half transfers; the precision half does not. Partially open (medium).**

Two separate problems, only one of them cosmetic:

**The metadata contradiction is survivable.** AD-5's `Binds:` is `CAP-5, CAP-6` and the CAP-7 map row lists `AD-2, AD-3, AD-16, AD-17, AD-20` — so by both registries AD-5 does not govern CAP-7. But AD-17's rule carries the pointer inline ("rounded per AD-5's magnitude-then-sign rule"), so a builder reading AD-17 reaches AD-5 regardless. Untidy — a rule reached only by a cross-reference from outside its own binding is exactly the fragility the `Binds:` field exists to prevent, and N-3 shows the two registries already disagree elsewhere — but not by itself a divergence.

**The precision gap is a real fork.** AD-17 says *"rounded per AD-5's **magnitude-then-sign** rule"*. That phrase names the tie/sign handling specifically. AD-5's rule is actually two decisions — *(i)* round the magnitude half-up **to one decimal place**, *(ii)* reapply the sign — and AD-17 imports only the one it names.

- **Unit A** reads "magnitude-then-sign" as the whole rounding rule and produces `+8.0%`.
- **Unit B** reads it as the sign/tie convention only, and — noting that AD-17 does not state a decimal place, and that a gender gap is conventionally reported to the nearest whole percent — rounds magnitude-then-sign to **zero** decimals: `+8%`.

Both obey AD-17 to the letter. F19's stated open axes were *formula, sign, denominator, precision, payload shape*; the revision fixed four and left precision to be inherited through an ambiguous reference — in the sentence Alice pastes into Slack, which was F19's whole point. It also inherits **N-1**: AD-17's `(M − F) / M × 100` has no named arithmetic type either.

**Close it:** AD-17 states its own precision explicitly — "rounded to one decimal place, magnitude-first then sign reapplied (AD-5), computed in decimal" — and AD-5's `Binds:` adds CAP-7, or the rounding rule is promoted to the Consistency Conventions where all three consumers can reach it by binding rather than by citation.

### (c)4 — Can AD-5's `|d| > threshold` still divide by a zero median given AD-16? **Yes. Still open (medium).**

AD-16 closes the path the prior round actually feared. F4's hazard was: a unit "fixes" the salary-less employee by writing `{ amountMinor: 0n }` at creation, a thin group's median goes to zero, and AD-5 divides by it. AD-16 removes the motive — a salary-less employee is legal and invisible — and AD-3 adds "a median of an empty set is not defined and is never computed — see AD-16". Both good.

But **nothing in the revised spine constrains `amountMinor` to be positive.** Check each candidate gate:

- **AD-4** — mandates the *shape* `{ amountMinor: bigint, currency }`. `0n` is a legal bigint; a negative one is too.
- **AD-18** — validates `effective_from` only. Explicitly: "Write-time validation rejects `effective_from > today`." Nothing about the amount.
- **AD-7 / CAP-1** — validates country, role, level. An empty or malformed amount cell parsing to `0` is rejected by nothing.
- **AD-16** — a zero-amount record *is* a salary record, so its owner is squarely **in** the population.
- **AD-3** — sorts and means integer minor units; `0` sorts fine and medians fine.
- **AD-14 / the seed** — log-normal, so positive. The seed is the one writer that is safe, and it is the one writer that is irrelevant to a data-entry zero.
- **Consistency Conventions → Errors** — "Domain functions are total — they do not throw." So `statistics.ts` will not stop it.

**The reachable path:** a peer group of 5 in which 3 records carry `amountMinor = 0` (three import rows with an empty salary column, or three CAP-3 typos) → AD-3's median is `0` → AD-5 computes `(salary − 0) / 0 × 100` = `Infinity` (or `NaN` for the zero-salary members themselves) → `roundHalfUp(Infinity)` → `Infinity > 20` is `true` → the card renders `Infinity% above median` and the finding flags. AD-17 has the identical exposure on `M = 0`, and there the denominator is a *single* gender's median, so it needs only 3 zero-amount males out of 5. Rarer than the F4 path, unblocked by anything, and the failure is silent and total-by-convention.

**Close it:** either a convention line — `salary_record.amount_minor > 0`, enforced by a DB check (the same move AD-18 makes for grants and the same move F11 asks of AD-6) — or AD-5 and AD-17 state that a zero denominator is a refusal, not a division. The first is cheaper and closes the class.

**Related, unchanged:** AD-3's even-`n` median still says "rounded half-up" with no tie mode named. It is safe only while salaries are positive — which is the very thing nothing states. AD-5 now names its tie mode; AD-3 should, for the same one-word cost.
