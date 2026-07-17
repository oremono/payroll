---
title: 'Verification round 3 — are round 2''s open findings closed by enforceable rules, and is anything load-bearing still broken?'
type: review
method: fix-verification + CRITICAL/HIGH divergence-hunt on the revision
target: ../ARCHITECTURE-SPINE.md
against:
  - ./review-verify-round2.md
  - ../../../../specs/spec-payroll/SPEC.md
  - ../../../ux-designs/ux-payroll-2026-07-16/EXPERIENCE.md
status: draft
created: '2026-07-17'
---

# Verification round 3

**Verdict: fifteen of round 2's seventeen open items are genuinely closed by enforceable rules — AD-22 is the missing AD the CAP-10 cluster needed, AD-4's `> 0` CHECK closes the divide-by-zero class at the source, and the AD-11 regression is reverted and the timezone finally named — but two HIGH divergences remain: AD-8 governs no statistical capability, and CAP-2's country-edit narrowing still lives only in the Deferred section, which is the one section that binds nothing.**

Test applied, unchanged from rounds 1 and 2: a fix counts as closed only if two units obeying the revised text to the letter cannot build incompatibly. An intention, a cross-reference, or a sentence in the Deferred section is not a rule.

---

## Part (a) — Round 2's open findings, verified one by one

| Round 2 item | Status | The rule that closes it |
|---|---|---|
| N-2 — AD-11's narrowed clock ban (regression) | **CLOSED** | AD-11 restores `src/domain/**` **or** `src/application/**`, and adds a system-wide clause: "the clock port is the only source of 'now' in the system, and only adapters may implement it." |
| (c)1 — CAP-10 overdue not bound to as-of | **CLOSED** | AD-22: "the cutoff is `asOf − period`, derived from the as-of date and never from the clock." |
| (c)2 — hire-only employee | **CLOSED** | AD-22: "**A hire record is a salary record**: someone hired long ago and never adjusted *is* overdue." The intent-reader is shut out by name. |
| (c)1 (7b) — cutoff operator/boundary | **CLOSED** | AD-22: overdue iff the current record's `effective_from` is "**strictly earlier** than the cutoff; a record dated exactly on the cutoff is not overdue," and "the preset chips and the custom date resolve to the same cutoff by the same rule — a chip is a period, not a second code path." |
| F9 — AD-13 "rate set" identity | **CLOSED** | AD-13: "A **rate set** is all rows sharing one `pinned_on` — that column is the set's identity, and a set is written whole or not at all." |
| F9 — org-wide target currency | **CLOSED** | AD-13: "The org-wide target currency is `settings.reporting_currency`; there is exactly one, and it is never inferred from the data." (See M-1 — the ER's `SETTINGS` block does not carry the column.) |
| (c)3 — AD-17 precision | **CLOSED** | AD-17 now states its own precision rather than inheriting it: "magnitude rounded half-up to **exactly one decimal place** then sign reapplied." Unit B's `+8%` reading is dead. |
| (c)4 — divide-by-zero median | **CLOSED, at the source** | AD-4: "A salary is strictly positive: `salary_record.amount_minor > 0` is a database `CHECK` and a write-time validation." This is the cheap class-closing move round 2 asked for — a mechanical gate, not a per-call-site guard. AD-5 restates the consequence ("The median is never zero (AD-4) and the group is never empty (AD-16), so the division is total"), and AD-3's unnamed even-`n` tie mode is now safe because the thing it depended on is stated. |
| N-1 — arithmetic type (IEEE double vs decimal) | **CLOSED** | AD-5: "The arithmetic is exact — rational or decimal over the integer minor units, never IEEE double, because in a double `20.05` is `20.049999…` and would never round up to flag." AD-17 restates it inline ("in exact decimal arithmetic") rather than inheriting. |
| N-3 — Binds registry vs Capability map | **PARTIALLY CLOSED** — the live one is fixed, the registries still disagree | The AD-9/CAP-7 divergence (ux F-6) is closed: CAP-7's map row now lists AD-9. But no authority statement was added and the registries still contradict — see M-2. |
| N-4 — AD-16 headcount / CAP-8 counts | **CLOSED** | AD-16's enumeration is widened past `n`/peer group/total to "**no headcount a user sees** — every figure on every surface, including Home's headcount and CAP-8's gender counts, is a count of the as-of population, never of the table." |
| N-5 — AD-18 not binding CAP-1 and CAP-11 | **CLOSED** | AD-18's `Binds:` is now CAP-1, CAP-2, CAP-3, CAP-4, CAP-11; both map rows carry AD-18; and the rule says "on **every** write path — form, import, and seed." AD-7's "the seed is a client of the same use-case, never a privileged write path" and AD-6's "the repository's `append`, which is the single funnel all three pass through" make the grant-scope question moot: there is one writer. |
| N-6 — AD-18 timezone for "today" | **CLOSED** | AD-11: "'Today' is the current date in **UTC**; no other timezone exists in this system." AD-18 restates it at the point of use ("with `today` the UTC date supplied by the clock port"). The IST-manager rejection is now a *decided behavior*, not a divergence — two units cannot differ on it. |
| N-7 — AD-19/AD-20 composition (threshold in receipts) | **CLOSED** | AD-20's receipt enumeration now includes "the threshold it was judged against where one applies (AD-19)." |
| ux F-3 — WCAG 2.2 AA + CI gate | **CLOSED** | Consistency Conventions → Accessibility: "WCAG 2.2 AA is the floor on every surface …, gated in CI by an automated axe pass alongside lint and typecheck," with the honest rider that automated gates do not discharge the manual checks. |
| N-9 — AD-2 count ban / `n` cardinality | **CLOSED** | AD-2 adds F14's missing sentence verbatim in substance: "any `n` a user sees is the cardinality of the exact in-memory set the statistic was computed over (AD-16), never a separate `COUNT` query." |
| N-10 — `n ≥ 5` homeless for CAP-5 | **CLOSED** | AD-16 gains a second rule block: "**Rule (`n ≥ 5`):** the refusal threshold is a property of the population, not of any one view. A peer group with `n < 5` refuses every comparison over it — CAP-5's card, CAP-6's finding row, and CAP-7's gap alike — naming `n`." All three consumers reach it by binding. |
| N-8 — AD-21 precedence | **CLOSED** | AD-21: "and this wins over the Server Action rule where both could apply: the CAP-1 multipart spreadsheet upload and CSV export downloads. **Exactly two routes exist; nothing else gets one.**" Precedence stated *and* the list made exhaustive — both halves of the ask. |
| rubric F4 — CAP-1 `effective_from`, re-import identity, CSV-vs-XLSX | **CLOSED** (all three) | AD-7: "Every import row carries an explicit `effective_from` …; a row without one is rejected rather than defaulted to today or to the hire date." · "**Import is create-only — never an upsert, never a merge.** … re-importing a row already imported creates a second person." · "The accepted format is **CSV**; an `.xlsx` upload is refused as a whole file with one statement of what could not be read." |
| rubric F7 — CAP-2 country-edit narrowing recorded as a deviation | **HALF-CLOSED — the recording landed, the rule did not** | The Deferred entry is now honestly labeled "**a recorded deviation from CAP-2, not a clean deferral**" — that half of the ask is done. But round 2 asked for two things, and the second — "move it into AD-6 as a clause" — was not done. See H-2; this is not cosmetic. |

**Also closed since round 2, unprompted:** rubric F11 (CAP-10's map row now carries AD-8); AD-15's enforcement is still unnamed while AD-1/AD-14 name lint (unchanged, low).

**Still not attempted** (round 2's list, unchanged, all below the CRITICAL/HIGH bar this round was scoped to): F10 refusal-row identity/volume — though EXPERIENCE.md line 65 ("Refusal-worthy groups appear inline as refusal rows, never silently omitted") plus Flow 1's named example ("Elena Rossi — only 3 peers") settles the inclusion question and points the volume question at per-employee, so this has degraded from HIGH to medium on its own; F11's AD-6 enforcement point (now largely answered by AD-6's named funnel); F12 currency exponent column; F18 AD-12 vs Next.js caching; rubric F10 no testing AD; F13 seed conflation; F16 patch pins; rubric F8 CSV money-cell encoding; spec F-5 AD-5's rounding-before-testing not recorded as a SPEC deviation. The Deferred section's "not a divergence risk" claim about pagination is now defensible, because AD-2 was tightened to say why.

---

## Part (b) — Remaining CRITICAL / HIGH divergences

### H-1 — HIGH — AD-8 binds CAP-3 and CAP-4 only, so no statistical capability has a rule for resolving "current salary"

AD-8 is the spine's only definition of *which* record is an employee's salary at a date: "Current salary = the record with the greatest `(effective_from, seq)` where `effective_from ≤ as-of date`. `created_at` may not be used as a tie-break."

Its `Binds:` is **CAP-3, CAP-4**. The map rows:

| Capability | Governed by | AD-8? |
|---|---|---|
| CAP-5 Peer comparison | AD-2, AD-3, AD-5, AD-9, AD-16, AD-20 | **no** |
| CAP-6 Outliers | AD-2, AD-3, AD-5, AD-12, AD-16, AD-19, AD-20 | **no** |
| CAP-7 Gender gap | AD-2, AD-3, AD-9, AD-16, AD-17, AD-20 | **no** |
| CAP-9 Payroll totals | AD-4, AD-13, AD-16, AD-20 | **no** |
| CAP-10 Overdue | AD-8, AD-11, AD-16, AD-22 | yes — fixed this round |

Every one of those four needs the resolver. AD-9 says spread is over "the peer group's **as-of current salaries**" and cites nothing. AD-16 defines who is *in* the population (`∃` a record with `effective_from ≤ D`) but is explicit only about membership — it never says which of an employee's records is the one the median takes. AD-13's per-country sums are sums of *current* salaries; AD-5's `salary` term is a current salary. CAP-10 got its AD-8 pointer this round; the other four did not.

**Why this is not cosmetic.** AD-18 makes same-day appending the *only* correction mechanism: "Appending a new record dated today is the only correction mechanism." Ties on `effective_from` are therefore not an edge case — they are the designed corrective path, and every typo fix produces one. So:

**Pair:** a `domain/statistics` peer-group loader resolving current salary as `DISTINCT ON (employee_id) … ORDER BY effective_from DESC` (Postgres returns either tied row) vs one resolving `ORDER BY effective_from DESC, seq DESC` per AD-8. Alice fixes a typo — 1,200,000 appended over 1,020,000, both dated 16 Jul. CAP-4's timeline (bound by AD-8) shows 1,200,000 as current. CAP-5's card, judged on the tied row Postgres happened to return, may compare against 1,020,000 — a different distance, possibly a different side of the 20% boundary, possibly a CAP-6 finding that CAP-4 says shouldn't exist. Both units obey every AD they are bound by. The employee's own timeline contradicts their own peer card.

This is exactly the class the spine already recognizes and already fixed once (rubric F11 → CAP-10's map row). The fix was applied to the capability that was named and not to the four that weren't.

**Close it:** AD-8's `Binds:` becomes CAP-3, CAP-4, CAP-5, CAP-6, CAP-7, CAP-9, CAP-10, and those map rows gain AD-8. Alternatively AD-16 absorbs the resolver — it already owns "who is in the set", and "which record is theirs" is the same question one step down — but the binding must exist either way.

### H-2 — HIGH — CAP-2's country-edit narrowing is the only thing preventing a mixed-currency peer group, and it lives in the Deferred section

Round 2 asked for two things: record the narrowing as a deviation, and **move the rule into AD-6 as a clause**. Only the first happened. The Deferred entry now reads: "country is set at create and is not editable in v1, because an edit would break AD-6's write-time currency invariant on records already written and silently move the employee between peer groups."

That sentence is correct, load-bearing, and in the one section of a spine that by construction binds nothing. Check what a builder actually has:

- **CAP-2's map row:** AD-6, AD-10, AD-16, AD-18, AD-21. None of them forbids editing country.
- **AD-6's rule** constrains the *write path* of `salary_record.currency_code` and explicitly tolerates the aftermath: "Reads never re-resolve it." An editable country violates no clause of AD-6.
- **EXPERIENCE.md** (line 73) lists country among the Employee form's fields, and (lines 32, 39) uses one form for both add and edit.

**Pair:** Unit A builds the employee form from EXPERIENCE.md + the map and ships country as an editable select — no AD says otherwise. Unit B builds `domain/statistics` on the SPEC's structural guarantee: "No comparison crosses a currency. **Because country is part of peer identity, this holds structurally rather than by discipline.**" Alice corrects a country from IN to DE. The employee's historical records keep INR (AD-6 forbids re-resolution); their `(role, level, DE)` peer group now contains one member whose as-of current salary is in INR. AD-3 sorts integer minor units and returns a median across INR and EUR. AD-9's "in the group's single currency" is unsatisfiable and the spine defines no refusal for the state. The SPEC's flagship structural invariant — the one it says holds *structurally rather than by discipline* — is now held by discipline, and the discipline is a paragraph under "Deferred".

This is a stronger finding than round 2 framed it. Round 2 called it a scope narrowing recorded in the wrong place; the actual exposure is that the mitigation for a currency-isolation break is non-binding text. Note that the fix is one sentence and the spine already wrote it — it is in the wrong file section.

**Close it:** AD-6 gains a clause — "`employee.country` is set at create and has no edit path; the employee form does not offer it as an editable field, and the repository exposes no country update" — with the Deferred entry retained as the revisit note and the deviation record.

---

## Part (c) — Medium, listed for completeness only (not in this round's scope)

- **M-1 — `settings.reporting_currency` is absent from the ER.** AD-13 names it as the org-wide target currency; the `SETTINGS` block in the Core entities diagram carries only `int outlier_threshold_pct`. A schema builder reading the ER and a builder reading AD-13 produce different `settings` tables. The AD binds and the ER is a seed, so AD-13 wins on precedence — but the diagram should carry the column.
- **M-2 — the two registries still disagree.** N-3's live case is fixed, but: AD-16's `Binds:` omits CAP-9 while CAP-9's map row lists AD-16; AD-6's `Binds:` omits CAP-1 and CAP-11 while its own rule body names both and CAP-1's map row lists AD-6; AD-2 binds CAP-9 and CAP-10 while neither map row lists AD-2; AD-4 binds CAP-1..CAP-10 while five map rows omit it; AD-11 binds "all" while most map rows omit it. None of these currently forks a build — in every case the AD's rule body or a cross-citation reaches the builder anyway — but the map is a subset registry masquerading as a complete one, and H-1 is what happens when a builder trusts it. State that the `Binds:` field is authoritative and the map is a navigational index, or generate one from the other.
- **M-3 — AD-20's receipt says "the rate with its `pinned_on`", singular, for a total that uses one rate per country.** AD-13's whole-set rule makes the *date* unambiguous (one `pinned_on` for the whole total), which was the sharp half. What remains is payload shape: `rate` vs `rates[]` across 14 countries. AD-20's "composed by exactly one function in `src/domain/verdict.ts`" keeps this from forking the sentence.
- **M-4 — EXPERIENCE.md's Home copy still says "41 people are *currently* overdue" (line 132) while AD-22 says the card reads "as of {date}", never "currently".** The AD wins and is right; this is an unrecorded deviation from EXPERIENCE.md, not a divergence.
- **M-5 — AD-22's `asOf − period` has no date-arithmetic rule.** "2 years" back from 29 Feb 2028 has two defensible answers (28 Feb / 1 Mar 2026). One day, once every four years, in one direction. Cheap to pin; not load-bearing.
- **M-6 — refusal-row volume on CAP-6's sweep** (F10's remnant): AD-16 says a thin group refuses "CAP-6's finding row"; whether that is one row per thin group or one per employee in a thin group is unstated in the spine. EXPERIENCE.md's named example ("Elena Rossi — only 3 peers") points at per-employee, which is why this is medium and not high.

Unchanged from round 2's medium tier: F12 (currency exponent column; formatter homelessness against AD-1's types-only UI edge), F18 (AD-12's "no cache" vs Next.js 16's default caching), rubric F10 (no testing AD), rubric F12 (no Open Questions section; two `[ASSUMPTION]`s filed in decided tables), F13 (production seed conflates reference data with the CAP-11 demo population), F16 (patch pins), rubric F8 (CSV money-cell encoding), spec F-5 (AD-5's rounding-before-testing reassigns the SPEC's 20.04 band, still not recorded as a deviation), AD-15's unnamed enforcement.
