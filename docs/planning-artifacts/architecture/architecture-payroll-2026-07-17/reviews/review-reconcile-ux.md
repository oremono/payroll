---
type: review
subject: ARCHITECTURE-SPINE.md (architecture-payroll-2026-07-17)
against:
  - ../../../ux-designs/ux-payroll-2026-07-16/EXPERIENCE.md
  - ../../../ux-designs/ux-payroll-2026-07-16/DESIGN.md
reviewer: reconcile-ux
date: 2026-07-17
verdict: 'Structurally sound; one correctness defect (AD-5 loses outlier symmetry), one settled-but-contradictory note (AD-6 vs. the 3-field form), and the entire accessibility floor unrepresented.'
---

# Reconciliation — UX spines vs. Architecture spine

Scope: what the architecture **dropped, contradicted, or made impossible/awkward to honor**. Agreements are not listed.

---

## Part 1 — The five Notes for Architecture

| # | Note | Settled by | Settled? | Consistent with UX? |
|---|---|---|---|---|
| 1 | Spread measure | AD-9 | Yes | Yes — min–max, group's single currency. Matches EXPERIENCE § Trust & Provenance and Flow 2's `₹18,20,000 – ₹29,50,000 INR`. **But see F-6: binding is incomplete.** |
| 2 | Currency storage | AD-6 | Yes | **No — see F-2.** The storage answer (on the record) matches; the *derivation* rule contradicts the record-change form. |
| 3 | Employee identifier | AD-10 | Yes | Yes — UUIDv7, names searchable never identifying. Satisfies "some stable identifier exists"; URL-stable under name correction. |
| 4 | Country validation on import | AD-7 | Yes | Yes — per-row rejection with reason, valid rows still land. The UI's report "accommodates either" and gets the stricter branch. |
| 5 | Same-`effective_from` tie-break | AD-8 | Yes | Yes — greatest `(effective_from, seq)`, `seq` BIGSERIAL. **Verified against Flow 3's correction case:** the corrected record is appended later, so it has the greater `seq` and becomes current, while the typo'd record stays visible on the timeline. Append-only survives; `created_at` correctly rejected as clock-dependent. |

Four of five genuinely settled and consistent. Note 2 is settled in *letter* and contradicted in *effect*.

---

## Part 2 — Findings

### F-1 — AD-5 makes below-median outliers impossible to flag (CRITICAL, correctness)

AD-5: *"distance = `(salary − median) / median`, rounded half-up to one decimal place. The outlier flag tests that **rounded** value with a **strict `>`** against the threshold."*

There is no absolute value anywhere in the rule. A signed distance of `−25.2` is never `> 20`. Under AD-5 as written, Michael Chang (−25.2%, Flow 1 step 3) and Aisha Patel (−24.8%) do not appear in the findings list at all, and Priya's "8% under" case has no path to a badge.

This directly contradicts:
- EXPERIENCE § Component Patterns → Threshold control: *"symmetric (one finding either direction)"*
- EXPERIENCE § Component Patterns → Findings list: *"One finding per outlier, either direction"*
- DESIGN § Components → Outlier badge: *"`+28.4% above median` / `-25.2% below median` … One badge per finding regardless of direction"*
- Flow 1, which is the product's climax scenario and lists two below-median outliers out of four.

AD-5's *intent* (round before judging; the number shown is the number judged; 20.0 does not flag) is right and should survive. The rule needs to be: flag iff `abs(roundedDistancePct) > threshold`, while the **signed** rounded value is what the badge renders. The rule must state both halves explicitly — a unit reading AD-5 literally today ships a one-sided sweep that still passes every test it thinks to write.

Severity: critical. It silently halves the findings list, and a silently short findings list is precisely the untrustworthiness AD-12 exists to prevent.

### F-2 — AD-6 empties the record-change form's third field (HIGH, contradiction)

AD-6: *"`salary_record.currency_code` is **written from the employee's country via the country reference table at write time, and validated to equal it**."*

EXPERIENCE § Component Patterns → Record-change form: *"**Three fields only: effective date (`effective_from`), amount, currency**"*, and Flow 3 step 3: *"currency (defaulted to INR from the current record)"*.

Under AD-6 the currency field has no agency: any value other than the country-derived one is rejected, and the derived one is already known. The form is a two-field form with a decorative select that can only produce a validation error. Either:
- the field becomes a **read-only derived display** (currency-follows-country, as Add employee already does per EXPERIENCE § IA / screen-11) — in which case EXPERIENCE's "three fields" clause and Flow 3's tab order need amending, or
- currency is genuinely user-supplied on the record and AD-6's "validated to equal it" is wrong.

The spine picked the first without saying so, and left EXPERIENCE asserting the second. Note the Deferred entry on relocation reveals the tension is understood ("history keeps its old currency") — but that argument supports storing currency, not deriving-and-validating it at write time.

Note also: AD-6 derives currency from `employee.country`, EXPERIENCE derives the form default from *the current salary record*. These agree only while country is immutable — which is exactly what the Deferred section flags. Pick one source and say it.

Severity: high — it's the single form in Flow 3's ~30-second maintenance moment, the flow most sensitive to "must not fight her".

### F-3 — The accessibility floor has no architectural representation at all (HIGH, dropped commitment)

EXPERIENCE § Accessibility Floor is ten behavioral commitments, and its closing line says *"the primitives above are commitments, not conveniences."* The architecture spine contains **zero** ADs, conventions, or map entries touching any of them. Specifically dropped:

- **WCAG 2.2 AA** as a binding floor — named nowhere in the spine.
- **`aria-live=polite` recompute announcements** on as-of/threshold change ("Findings updated as of 12 May 2026") — no AD, and see F-4 for why the chosen stack makes this the *hard* one.
- **Refusals announced as content (region + heading), never `role="alert"`** — the refusal *return-value* convention (§ Consistency Conventions) correctly prevents refusals being thrown into an error style at the domain layer, but nothing carries that dignity across to the render layer where the actual `role` is chosen.
- **Skeleton-not-spinner cold loads**, focus trapping / focus return on dialogs, `/` shortcut scoping (WCAG 2.1.4), skip-to-content, `aria-current="page"`, chart counts exposed as data tables, programmatic labels + `aria-describedby`.

AD-15 is the *only* AD binding "all UI surfaces", and it governs hex literals. There is no equivalent invariant for the accessibility floor — meaning it is unenforced, untested, and structurally invisible to anyone building from this spine. The spine's own stated purpose is `build-substrate`; a builder reading only the spine ships none of this.

At minimum this wants: an AD binding WCAG 2.2 AA with automated checks in CI (axe under Playwright — already in the stack), and an explicit statement that live-region announcement and dialog focus management are invariants, not story-level polish.

### F-4 — RSC + per-request recompute makes the in-place / no-skeleton recompute contract awkward (MEDIUM, tension)

Two EXPERIENCE contracts collide with the delivery choice:

> § State Patterns → Cold load / recompute: *"as-of or threshold recomputation **swaps values in place** … **never returning to skeleton**."*
> § Accessibility Floor: *"Changing the as-of date or threshold announces recomputation via `aria-live=polite`."*

The spine specifies "RSC surfaces · domain runs in-process" (§ Structural Seed) and AD-12 computes findings fresh per request. A naive RSC round-trip on as-of change re-renders the surface subtree — remounting Suspense fallbacks (skeletons re-appear, violating "never returning to skeleton") and re-mounting the live region (a re-mounted `aria-live` node announces nothing; the region must be **stable across the transition** and receive its text *after* mounting).

This is implementable — `useTransition` + a persistent client-owned live region outside the swapped subtree, no Suspense boundary re-triggered on the as-of param — but nothing in the spine says so, and the default reading of "RSC surfaces + as-of is a route param" produces the wrong behavior. Given that the as-of control is *global to every screen*, this is a whole-app structural decision, not a component detail. It belongs in the spine.

### F-5 — DESIGN's dark mode and contrast re-verification dropped by AD-15 (MEDIUM, dropped visual contract)

AD-15 generates the Tailwind theme from DESIGN.md frontmatter — but DESIGN.md's frontmatter is a **flat map with `-dark` suffixes**, not a light/dark pairing. Nothing in the spine states how the suffix convention maps to a mode, or that dark mode is in scope at all (DESIGN records *"dark mode is in scope for v1"* as a decision). A literal implementation of AD-15 emits `--color-surface-base` and `--color-surface-base-dark` as two unrelated tokens and leaves the pairing to whoever writes the first component — the exact drift AD-15 exists to prevent.

Also dropped: DESIGN § Colors → Contrast floor commits that *"Any future token change must re-verify the matrix before shipping."* AD-15 puts token generation in the build, which is the natural place to attach that gate, and doesn't. The dark set is explicitly *provisional* pending re-verification; the spine gives that flag nowhere to be cleared from.

### F-6 — AD-9 (spread) is not bound to the peer group surface (MEDIUM, coverage gap)

AD-9 binds `CAP-5` only, and the Capability → Architecture Map governs CAP-7 with `AD-2, AD-3, refusal convention` — no AD-9.

But EXPERIENCE § State Patterns → *Refusal: a gender < 5 in group*: *"**Median and spread for the whole group may still show above it**"*, and the peer group surface (screen-04, IA table) is defined as *"Group roster, median, **spread**, gender gap or its refusal (CAP-7)"*. Spread renders on a CAP-7 surface with no AD governing it there. Since AD-9's whole purpose is preventing the stored and displayed measures forking, a surface that displays spread outside AD-9's binding is the fork waiting to happen. Extend `binds` to CAP-7 and add AD-9 to the CAP-7 map row.

### F-7 — The answer payload isn't bound to carry its receipts; only FX is (MEDIUM, gap)

AD-13 gets this exactly right for one case: *"The resolved rate and its `pinned_on` travel in the **domain payload**, not just the caption — the number and its provenance are one object and cannot be separated by a careless render."*

Nothing generalizes it. EXPERIENCE demands the same inseparability everywhere:
- § Trust & Provenance → **Ambient receipts**: every computed number carries group size, as-of date, and currency within one line.
- § Component Patterns → **Copy-answer**: copies the verdict *with receipts* — name, distance %, peer median with currency, group definition, group size, as-of date — and on refusal, the refusal sentence with its count (and gender).
- Flow 2's climax is that the pasted sentence and the rendered card are **the same sentence**.

The refusal convention specifies `{ kind: 'refusal', reason, counts }`; the answer arm is left as `{ kind: 'answer', … }`. So there is no invariant forcing `{ peerCount, asOf, groupDefinition, median: Money, distancePct }` into the answer payload, and no statement of where the verdict sentence is composed. Composed twice — once for the card, once for the clipboard — they drift, and Flow 2's whole wager (paste it, stand behind it) is on their being identical. Recommend: one domain-level verdict payload, one sentence composer, card and clipboard both consumers of it. Apply AD-13's own reasoning to the answer type.

Also unstated for CAP-7: `counts` must carry **per-gender** counts (EXPERIENCE requires the refusal name *which* gender: "3 FEMALE, 8 MALE — a gap needs 5 of each"). A single `counts: number` satisfies CAP-5 and silently fails CAP-7.

### F-8 — Overdue period presets are not bound to the as-of date (MEDIUM, determinism hole)

EXPERIENCE § Component Patterns → Overdue period control: *"Preset chips: 1y / 18mo / 2y / 3y, plus a custom date field."* These are **relative durations** — relative to what?

AD-11 bans the clock from `domain/**` and `application/**`, and `domain/overdue.ts` is mapped as governed by AD-11 alone. But nothing states that `1y` resolves against the **as-of date** rather than today. If it resolves against today, then winding the as-of date back does *not* reproduce yesterday's overdue list, and EXPERIENCE § Trust & Provenance's *"winding the as-of date back reproduces yesterday's answer exactly"* — plus Home's "41 people are currently overdue" figure — become wall-clock-dependent. This is the one place a relative duration meets a determinism promise, and the spine doesn't name it. The AD-11 discipline makes the *right* answer nearly forced (the domain can't read a clock, so the cutoff must derive from the as-of parameter) — but "nearly forced" isn't an invariant; the shell could equally pass a today-derived cutoff in and nothing would object.

### F-9 — No-future-dating has no home under AD-11 (LOW–MEDIUM, gap)

EXPERIENCE § Component Patterns → Record-change form: *"no future-dating, no retroactive correction."* Enforcing "not in the future" requires reading today's date — which AD-11 forbids in `domain/**` and `application/**`. So the check must live at the HTTP/RSC boundary alongside the as-of default. That's a legitimate placement and probably what's intended, but it's unstated, and "the validation rule the domain is structurally forbidden from enforcing" is exactly the kind of thing that ends up enforced nowhere. Say where it lives.

### F-10 — AD-4's `bigint` collides with the JSON boundary it explicitly names (LOW–MEDIUM, friction)

AD-4: *"every monetary value is `{ amountMinor: bigint, currency: string }`. No `number`, no float, no bare amount crosses any boundary — **including JSON payloads**, CSV columns, and React props."*

`JSON.stringify` throws `TypeError` on `bigint`. Any route handler returning money as JSON (CSV export trigger, any client fetch) needs an explicit serialization convention — string minor units on the wire, parsed back at the edge — or AD-4 is unimplementable at the very boundary it names. React Server Component props serialize bigint fine; `Response.json()` does not. The invariant is right; it needs one sentence on wire representation, and one on Prisma's mapping (`BIGINT` → `bigint` requires explicit configuration, and `Decimal` is the trap AD-4 exists to avoid).

### F-11 — AD-2's blanket "no count" is in tension with headcount and directory pagination (LOW)

AD-2: *"It computes no median, spread, distance, gap, total, or **count** that reaches a user as a domain value."*

Home displays headcount (10,000) and country count (14) as user-facing numbers (Flow 1 step 2). The Employees directory is 10,000 rows, EXPERIENCE bans infinite scroll and mandates pagination — and pagination UI conventionally needs a total count, especially under `/`-search filtering. Under AD-2 read literally, `COUNT(*)` is banned and every count must be produced by loading rows in-process.

AD-12 already accepts a ~10,000-row read per sweep, so this is affordable — but the Deferred entry *"Pagination strategy … page size and cursor-vs-offset is a story-level call, not a divergence risk"* is written as if AD-2 doesn't constrain it. It does: AD-2 rules out offset pagination's `COUNT(*)` total. Either narrow AD-2's "count" to *domain statistics* (peer-group size, gender counts, overdue count — the counts refusal semantics depend on) and explicitly exempt cardinality/pagination counts, or acknowledge in Deferred that AD-2 forces the load-and-count shape. As written a builder must guess, and guessing wrong on the refusal-relevant counts is the failure AD-2 was actually written to prevent.

### F-12 — Indian digit grouping has no formatter contract (LOW)

DESIGN § Do's and Don'ts and Flow 2 render `₹23,40,000 INR` — **lakh/crore grouping**, not thousands grouping. § Consistency Conventions → Money says money is *"Rendered only through one formatter that requires both"* [amount + currency], which correctly forces the currency to be present but says nothing about locale-aware grouping. A single formatter defaulting to `en-US` renders `₹2,340,000` and quietly breaks the quotable sentence that Flow 2's climax pastes into Slack. The formatter contract needs a grouping rule keyed off currency/country, and AD-4's "minor-unit exponent comes from the currency reference table" suggests the reference table is where it belongs.

---

## Part 3 — IA surface coverage

Every surface in EXPERIENCE.md § Information Architecture has an architectural home. Checked individually:

| Surface | Served by | Note |
|---|---|---|
| Home — The Sweep | `domain/outliers` (AD-12), `domain/totals`, `domain/gender-gap`, `domain/overdue` | Composite; the Home *overdue count* inherits F-8. Headcount/countries figures inherit F-11. |
| Employees | `use-cases/employee` (AD-10) | Pagination deferred; see F-11. |
| Employee detail | `domain/timeline`, `domain/statistics`, `domain/peer-group` | Copy-answer receipts unbound; see F-7. |
| Peer group (contextual only) | `domain/peer-group`, `domain/gender-gap` | Spread unbound here; see F-6. No AD notes it is route-reachable-but-unindexed (a UX decision with a routing consequence) — minor. |
| Gender Insights | `domain/gender-gap` (CAP-8) | Served. |
| Payroll Totals | `domain/totals` (AD-13) | Served, and AD-13 is the model the rest of the spine should follow (F-7). |
| Overdue for Review | `domain/overdue` | See F-8. |
| Import | `adapters/csv` + `use-cases/import` (AD-7) | Served; per-row rejection preserved by the Errors convention. |
| Record a salary change | `domain/timeline` + `use-cases/record-change` | See F-2, F-9. |
| Add employee | `use-cases/employee` | Served; currency-follows-country is consistent with AD-6. |
| Settings | `settings` single-row table (Config convention) | Served. Nothing states the threshold's **Apply**-confirmation semantics are a UI concern rather than a live-write — low risk, but the "deliberate act, not a live slider" rule is a UX commitment with no architectural echo. |

**No surface is unserved.** The gaps are in *what the surfaces are guaranteed to receive*, not in whether they exist.

---

## Part 4 — Summary of severities

| ID | Severity | One line |
|---|---|---|
| F-1 | CRITICAL | AD-5's strict `>` on a signed distance means below-median outliers never flag, contradicting the symmetry both spines require and gutting Flow 1. |
| F-2 | HIGH | AD-6 derives-and-validates currency from country, leaving the record-change form's mandated third field with no agency. |
| F-3 | HIGH | The entire Accessibility Floor — WCAG 2.2 AA, `aria-live` recompute, refusal-as-region-not-alert, focus management — has no AD, convention, or CI gate. |
| F-4 | MEDIUM | RSC + per-request recompute defaults to remounting skeletons and the live region, breaking "swaps in place, never returning to skeleton" and silencing the announcement. |
| F-5 | MEDIUM | AD-15 has no light/dark pairing rule for DESIGN's flat `-dark` token map and drops DESIGN's contrast re-verification gate. |
| F-6 | MEDIUM | AD-9 binds CAP-5 only, but spread renders on the CAP-7 peer group surface — ungoverned. |
| F-7 | MEDIUM | Only FX provenance is bound into the domain payload (AD-13); answer receipts and the verdict sentence are unbound, and `counts` isn't specified per-gender for CAP-7. |
| F-8 | MEDIUM | Overdue's relative period presets are never bound to the as-of date, opening a wall-clock hole in the determinism promise. |
| F-9 | LOW–MED | "No future-dating" requires today's date, which AD-11 forbids in domain and application, and the spine doesn't say where it lives. |
| F-10 | LOW–MED | AD-4 mandates `bigint` across JSON payloads; `JSON.stringify` throws on bigint. |
| F-11 | LOW | AD-2 bans user-facing counts, which constrains directory pagination and headcount — and Deferred treats pagination as unconstrained. |
| F-12 | LOW | The single money formatter has no locale-grouping rule; `₹23,40,000` becomes `₹2,340,000` and the Flow 2 sentence breaks. |
