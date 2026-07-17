# Source Extract for UX Design — Salary Management for ACME HR

Sources:
- **Brief:** `/home/rk/Projects/Dev/oremono/payroll/docs/planning-artifacts/briefs/brief-payroll-2026-07-16/brief.md`
- **SPEC:** `/home/rk/Projects/Dev/oremono/payroll/docs/specs/spec-payroll/SPEC.md` (canonical contract; references companion `addendum.md` for seed distribution parameters — not read here)

---

## 1. Product identity

- **Name:** "Salary Management for ACME HR" (title in both brief and SPEC).
- **What it is:** "a system of record for salaries" (brief). A salary *management* product — "Money never moves" / no payroll execution (brief + SPEC non-goals).
- **One-line purpose:** "its reason for existing is a single promise: **she never does salary arithmetic by hand again**" (brief; echoed verbatim in SPEC Why).
- **Core mechanism:** answers "how do we pay people?" by comparing each employee to their **peers** — same job, same level, same country. "It has no opinion about what a job *should* pay" because ACME has no market data (brief).
- **Success signal (SPEC):** "The HR manager opens the product, sees which employees need attention, and acts on a number she did not compute and does not re-derive. Demonstrable end to end: a planted outlier is surfaced without being searched for, and a thin peer group is refused out loud rather than answered with a median of one."

## 2. Users / personas

- **Sole user: ACME's HR manager** (unnamed, referred to as "she/her"). "Responsible for how 10,000 people across multiple countries get paid, and does the whole job in Excel" (brief).
- She is **self-directed** — "no CFO or regulator forces the questions; the failure mode is quiet drift she doesn't catch until a manager does" (SPEC Why). "The cost of a wrong answer is an awkward Slack message, not a filing" (brief).
- **[ASSUMPTION, both docs]:** the problem statement describes an HR *team* managing spreadsheets today, but names the HR *manager* as persona and intended user; the brief/SPEC follow the persona. "If the team are users, authentication moves from deferred to required" — flagged as the assumption to revisit first.
- No employee/manager self-service: "One user. Everything else is a different product" (brief).

## 3. Stated capabilities / requirements

SPEC capabilities (verbatim names CAP-1 … CAP-11), with success criteria condensed faithfully:

- **CAP-1 — Bulk import.** Import employees + current salaries from a spreadsheet. Valid rows land in full; a row whose role or level is absent from the reference tables is "rejected and reported with its reason; the remaining valid rows still import. No row is ever mapped or guessed into a taxonomy value." (Brief: rejection is "per-row rather than per-file — a single bad row does not lose the import.")
- **CAP-2 — Create/edit employee individually.** Persists with role, level, country, gender, hire date; "role and level are selectable only from the reference tables."
- **CAP-3 — Record a salary change.** "Appends a new effective-dated record. Prior records remain readable and unmodified. Current salary resolves to the latest record with `effective_from` on or before today." (Note: SPEC Constraints refine "today" to a supplied as-of date.)
- **CAP-4 — Salary timeline.** "Every salary record for that employee is listed with its effective date and its currency, ordered in time."
- **CAP-5 — Peer comparison.** For a peer group of 5 or more: "the view reports the group median, spread, and this employee's distance from the median, all in the group's single currency. Below 5, it reports an explicit refusal naming the peer count rather than a computed comparison."
- **CAP-6 — Outlier surfacing + adjustable threshold.** Employees whose salary differs from their peer median "by more than a threshold percentage — in either direction, one finding — are surfaced unprompted, each with the group they were judged against, that group's size, and their distance from its median. The threshold defaults to 20% and is adjustable by the user. Given a fixed threshold the result is reproducible, and the boundary is exact: 19.9% does not flag, 20.1% does." (Brief: threshold "she can widen when the list is longer than her afternoon.")
- **CAP-7 — Gender pay gap within peer group.** "For a peer group holding 5 or more of each gender, the gap between male and female medians within that group is reported. When either gender is under 5, the view refuses and says which, rather than comparing against a median of one."
- **CAP-8 — Gender distribution across levels.** "Gender counts per level are reported across the organization, revealing clustering that CAP-7 is structurally blind to because it holds level constant."
- **CAP-9 — Payroll totals.** "Per-country totals report in local currency with no conversion. Any org-wide total that spans currencies displays the conversion rate used and the date it was pinned to." (Brief: rate is "pinned, stamped, and disclosed.")
- **CAP-10 — Overdue for review.** "Given a period, the employees whose most recent salary record predates it are listed with the date of that record." (Brief framing: "Who hasn't had a raise in two years?" / "who is overdue for a review?" becomes a query.)
- **CAP-11 — Seed script.** "A single command produces 10,000 employees from a fixed seed, reproducibly," deliberately planting outliers, thin peer groups, within-group gender gaps, and gender clustering so every capability (incl. refusals) is demonstrable. Brief: "The seed script is a design artifact." Distribution parameters in companion `addendum.md`.

Key metric/threshold decisions (brief Assumptions & Decisions + SPEC Constraints):
- **Minimum peer group threshold = 5**; gender gap requires **5 of *each* gender** within the group. "Both are product judgments, not statistical results" (brief).
- **Outlier = more than 20% from peer median, above or below — one finding, not two.** User-adjustable; 20% is the default. Distance is a **percentage**, not SDs/quartiles/percentile rank (peer groups small by construction — "n≥5, typically under ten"). The 20% is "borrowed, not invented" from the compa-ratio 80–120% corridor (brief).
- **Refusal is a common path, not an edge case:** "Skewed groups are the norm" (brief). "Below threshold, refuse — never widen the peer group" (SPEC).
- **Median** is the central statistic throughout (peer median, male/female medians).

## 4. Data model surface (what a UI would show)

- **Employee:** role, level, country, currency, gender, hire date, "and an identifying name" (SPEC Assumptions: "The source brief does not enumerate an exhaustive field list").
- **Role, Level:** seeded reference tables (fixed taxonomy), never free text; selectable-only in forms, validated on import.
- **Salary record:** append-only, effective-dated (`effective_from` field named in SPEC), amount + currency; salary is "a timeline, not a cell" (brief). Salary means "base salary, annual, gross, in local currency" (both).
- **Peer group:** employees sharing **role + level + country** — "Nothing else defines one" (SPEC). Attributes shown: median, spread, employee's distance from median, group size, single currency.
- **Gender:** values are `MALE` and `FEMALE` — "[DECIDED] … A deliberate simplification … The cost is real — the schema cannot represent an employee outside those two values" (brief; SPEC constraint).
- **Currency:** "Currency is never implicit: every salary shown carries the currency it is denominated in" (brief); "No salary is ever displayed without its currency" (SPEC). SPEC assumption: "Currency is determined by country. Whether it is stored per salary record or resolved from the employee's country is an architecture decision this contract does not settle."
- **Conversion rate:** appears only in cross-currency aggregate totals; carries the rate used and the date it was pinned to, "displayed wherever a converted figure is" (SPEC).
- **Import report:** rejected rows with per-row reason (unknown role/level).
- **Scale:** 10,000 employees, multiple countries, multiple currencies.

## 5. Constraints

- **Tech stack (SPEC, verbatim):** "Backend is Node/TypeScript over a relational database. UI is React or Next.js. The product is deployed and demonstrable."
- **Form factor:** web UI implied (React/Next.js); no explicit mobile/desktop statement in either doc.
- **Determinism/reproducibility:** "The same question asked twice returns the same answer. Every answer is a function of the data and an as-of date, never of the moment it was asked. The as-of date is supplied, not read from the system clock" (SPEC). Core logic covered by fast deterministic unit tests — "fixed seed, no dependence on the wall clock" (SPEC); brief adds "no floating-point roulette."
- **Performance expectation:** "Every question in The Problem is answered in seconds, without a spreadsheet" (brief success criteria).
- **Currency isolation:** "No comparison crosses a currency" — structural, because country is part of peer identity; "exchange rates never enter the fairness math" (brief/SPEC). Conversion only in aggregates.
- **History rules:** "No salary is ever overwritten … No future-dating, no scheduled changes, no approval workflow, no retroactive correction" (SPEC).
- **Security/privacy:** Authentication & permissions **out of scope but "deferred, not dismissed"** — "this is the most sensitive table in the company. Auth is the first thing this needs before it touches a real salary record" (brief). No i18n mentioned; multi-country/multi-currency handled per the currency rules above.
- **Non-goals (SPEC list):** pay bands / compa-ratio / range penetration / market index / merit matrices; merit cycles & budget modeling; regression-based adjusted pay gap; EU Pay Transparency compliance; employee & manager self-service; authentication & permissions; equity/bonus/benefits/total rewards; payroll execution; cost-of-living adjustment.

## 6. Explicit UX/UI statements

- **SPEC Open Questions (verbatim):** "The UI surface is undefined. No UX pass has been run, so no screen, view, or navigation is specified for CAP-1 through CAP-10. Downstream will invent it unless it is decided. This now also owns where CAP-6's threshold control lives."
- Behavior/tone statements that are UX-load-bearing:
  - "She does not have to go looking. The people sitting far from their peer group come to her" (brief) / outliers "surfaced unprompted" (SPEC) — a push/attention surface, not a search task.
  - "An answer she can trust, or none at all. Below five peers, the product says so and declines to compare" (brief); refusal must name the peer count (CAP-5) and, for gender gap, "says which" gender is under 5 (CAP-7). "The product declines to answer when the data cannot support one — and shows why" (brief success criteria).
  - "create and edit employees and salary changes per-record via the UI" (brief scope) — per-record CRUD is a UI commitment.
  - Import rejection reporting is per-row with reasons (CAP-1); rejected rows are "rejected and reported, never guessed at" (brief).
  - CAP-6 threshold "adjustable by the user" — control placement explicitly delegated to UX.
  - Converted figures always display rate + pin date (CAP-9/constraint).
  - "The demo reveals the product's judgment, not just its charts" (brief) — hints charts exist but judgment (findings/refusals) is the centerpiece.
- No statements anywhere about visual identity, color, branding, layout, or navigation.

## 7. Named terms glossary (mirror verbatim)

| Term | Meaning / source |
|---|---|
| **peer / peer group** | Employees sharing role + level + country; "Nothing else defines one" (SPEC) |
| **peer median** | Median salary of the peer group; the reference point for distance and outliers (both) |
| **spread** | Reported alongside median in peer comparison (CAP-5) |
| **distance (from the median)** | Employee's difference from peer median, as a percentage (both) |
| **outlier** | Employee more than the threshold % from peer median, either direction, "one finding, not two" (brief/CAP-6) |
| **threshold** | Outlier cutoff; default 20%, user-adjustable (both) |
| **refusal / refuse / declines to compare** | Explicit non-answer when group < 5 or a gender < 5; names the count / which gender (both) |
| **minimum peer group threshold** | 5 (brief [DECIDED]) |
| **gender gap** | Gap between male and female medians within a peer group (CAP-7) |
| **gender distribution across levels** | Org-wide gender counts per level; catches "clustering" (CAP-8) |
| **clustering** | What the level-distribution view catches that peer view "is structurally blind to" (both) |
| **salary timeline** | Append-only effective-dated salary history (brief/CAP-4) |
| **effective-dated / `effective_from`** | Dating scheme for salary records (CAP-3) |
| **current salary** | Latest record with `effective_from` on or before the as-of date (CAP-3 + constraint) |
| **as-of date** | Supplied date every answer is a function of; not the system clock (SPEC constraint) |
| **reference tables** | Seeded role and level taxonomies; no free text (both) |
| **rejected and reported** | Import handling for unknown role/level rows (both) |
| **pinned** (rate) | Conversion rate fixed to a date and displayed with converted figures (both) |
| **`MALE` / `FEMALE`** | The only gender values (both) |
| **base salary, annual, gross, in local currency** | Definition of "salary" (both) |
| **seed script** | Fixed-seed generator of 10,000 employees; "a design artifact" (brief/CAP-11) |
| **overdue for a review** | Employees whose most recent salary record predates a given period (brief/CAP-10) |
| **CAP-1 … CAP-11** | SPEC capability identifiers |

## 8. Open questions / ambiguities for UX

1. **The entire UI surface** — SPEC states no screen, view, or navigation is specified for CAP-1 through CAP-10; UX must define it (SPEC Open Questions, verbatim quoted in §6).
2. **Where CAP-6's threshold control lives** — explicitly assigned to this UX pass (SPEC Open Questions).
3. **Employee field list is not exhaustive** — SPEC assumes role, level, country, currency, gender, hire date, "an identifying name"; what identifies an employee (ID? name uniqueness?) is unstated.
4. **Currency storage** (per salary record vs. resolved from country) is an unsettled architecture decision (SPEC Assumptions) — affects what the timeline and forms display.
5. **How the as-of date is "supplied"** — SPEC says it is supplied, not read from the clock, but does not say whether the user sets it in the UI or it is an implicit query parameter.
6. **Period input for CAP-10** — "given a period" with no stated format or presets.
7. **Persona name/identity** — the HR manager is never named; UX docs needing a persona name must invent or leave generic.
8. **Team vs. single user assumption** — flagged in both docs as "the assumption to revisit first"; UX for one user, but auth is "deferred, not dismissed."
9. **Spread** (CAP-5) has no defined measure (range? IQR? min–max?) — UX will need a display decision or a flag to architecture.
10. **Seed/demo distribution details** live in companion `addendum.md` (not extracted here) — relevant if UX docs reference demo data shapes.
