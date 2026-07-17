---
status: final
updated: 2026-07-17
sources:
  - ../../briefs/brief-payroll-2026-07-16/brief.md
  - ../../../specs/spec-payroll/SPEC.md
design: ./DESIGN.md
---

# Salary Management for ACME HR — Experience Spine

> Peer contract to [DESIGN.md](./DESIGN.md): that document owns how it looks; this one owns how it works. Composition references throughout link to the twelve Stitch mocks in [imports/stitch/](imports/stitch/MANIFEST.md). **On any conflict, this spine and DESIGN.md win over the mocks.**

## Foundation

Desktop web, 1280px+ primary; no mobile layout is specified, and sidebar behavior below 1280px follows DESIGN.md § Layout & Spacing (columns prioritized, card grids stacked). React or Next.js over a Node/TypeScript backend (SPEC constraint). `DESIGN.md` is the visual reference; every visual specific below is named by `{path.to.token}` into its frontmatter.

One user: **Alice**, ACME's HR manager, responsible for how 10,000 people across multiple countries get paid. Solo operator — no approvals, no workflow, no one chasing her; the consequence of error is embarrassment (a manager spots it first), not compliance risk. The product is a **knowing tool**, not a compliance or workflow tool: it replaces Excel, which fails at answers, not storage. Success criterion: Alice reads a number and the impulse to rebuild it in Excel does not fire — she acts on it or pastes it into Slack and stands behind it.

Three usage moments shape everything: **Maintenance** (low-attention data entry, ~30 seconds, must not fight her), **Someone-Asked** (one specific fairness answer, quotable without hedging), and **The Sweep** (unhurried, unprompted drift check — the moment Excel cannot serve at all). Authentication is out of scope but deferred, not dismissed (brief).

Determinism promise (SPEC): every answer is a function of the data and a supplied as-of date, never of the moment it was asked. The same question asked twice returns the same answer.

## Information Architecture

Sidebar (fixed, per [screen-01](imports/stitch/screen-01-home-sweep.html)): **Home · Employees · Gender Insights · Payroll Totals · Overdue for Review · Import · Settings** (Settings pinned at bottom).

| Surface | Reached from | Purpose (CAP coverage) |
|---|---|---|
| Home — The Sweep | App open / sidebar | Landscape-led org overview: headcount, countries, payroll-by-country, gender-by-level pulse, with findings (outliers, CAP-6) and overdue count (CAP-10 summary) embedded as regions among several. [screen-01](imports/stitch/screen-01-home-sweep.html) |
| Employees | Sidebar / `/` search | Directory of 10,000; search, row → detail. Create/edit employee (CAP-2). [screen-02](imports/stitch/screen-02-employees.html) |
| Employee detail | Employees row, findings row | Current salary, peer comparison or refusal (CAP-5), salary timeline (CAP-4), record-a-change entry point (CAP-3). [screen-03](imports/stitch/screen-03-employee-detail.html), [screen-03b](imports/stitch/screen-03b-refusal-tomas.html) |
| Peer group (contextual only) | A finding on Home, or the peer-comparison card | Group roster, median, spread, gender gap or its refusal (CAP-7). **No sidebar entry, no index/browse surface — peer groups are reached only through a finding or an employee** (user decision). [screen-04](imports/stitch/screen-04-peer-group.html) |
| Gender Insights | Sidebar | Gender counts per level org-wide; the clustering view CAP-7 is structurally blind to (CAP-8). [screen-05](imports/stitch/screen-05-gender-insights.html) |
| Payroll Totals | Sidebar | Per-country totals in local currency; org-wide total shows pinned rate + date (CAP-9). [screen-06](imports/stitch/screen-06-payroll-totals.html) |
| Overdue for Review | Sidebar + Home summary link | Employees whose latest salary record predates a period (CAP-10). Holds the period control. Placement is **both**: compact count on Home ("41 people overdue") linking here. [screen-07](imports/stitch/screen-07-overdue.html) |
| Import | Sidebar | Bulk spreadsheet import with per-row rejection report (CAP-1). [screen-08](imports/stitch/screen-08-import.html) |
| Record a salary change | Employee detail button | Append-only 3-field form (CAP-3). [screen-09](imports/stitch/screen-09-record-change.html) |
| Add employee | Employees "+ Add employee" button | Focused side panel, keyboard-first, reference-table selects only, currency follows country (CAP-2). [screen-11](imports/stitch/screen-11-add-employee.html) |
| Settings | Sidebar (bottom) | Outlier threshold (CAP-6 control) — a deliberate act, kept off the sweep. [screen-10](imports/stitch/screen-10-settings.html) |

**Global as-of date control** lives in the header on every screen ({components.as-of-control}), defaulting to today. Alice can wind it back; every view recomputes. It is both a control and ambient provenance.

## Voice and Tone

Microcopy discipline. Aesthetic posture lives in DESIGN.md.

- **Quotable, hedge-free verdicts.** A verdict is one sentence Alice can paste into Slack unedited: "Priya Nair is 8% under her peer median (₹23,40,000 INR), based on 9 peers — Software Engineer · L4 · India — as of 16 Jul 2026." No "approximately", no "may indicate", no softeners.
- **Refusal grammar names the count — and for gender, which gender.** CAP-5: "No comparison — only 3 peers. This peer group has 3 people. Below 5, a median would be noise dressed as an answer, so we don't compute one." CAP-7: "No gender gap reported — this group has 3 FEMALE and 8 MALE employees; a gap needs 5 of each." Refusals are confident statements of standards, never apologies.
- **Exact spec vocabulary, verbatim, everywhere:** *peer group, peer median, spread* (shown as a min–max range), *distance %* from the median, *outlier, threshold, refusal, salary timeline, effective date, as-of date, overdue for review, reference tables,* gender values `MALE` / `FEMALE`. Banned: "snapshot", "compa-ratio" (see DESIGN.md Do's and Don'ts).

| Do | Don't |
|---|---|
| "Only 3 peers — too few to compare fairly" | "Error: insufficient data" |
| "41 people are overdue for review" | "⚠ 41 items require attention!" |
| "No outliers beyond 20% as of 16 Jul 2026." | "All good! 🎉" |
| "Rejected: role 'Ninja' is not in the reference tables" | "Row 214 failed validation (code 422)" |

## Component Patterns

Behavioral. Visual anatomy lives in DESIGN.md § Components.

| Component | Use | Behavioral rules |
|---|---|---|
| Findings list | Home | **Fresh every visit — a pure function of data + threshold + as-of date.** No seen/unseen state, no dismissal, no acknowledgement. Dealing with a finding means changing the salary; the list shrinks only when the data changes. Each finding names the peer group judged against, its size, and the signed distance % ({components.findings-row}, {components.outlier-badge}). One finding per outlier, either direction. Refusal-worthy groups appear inline as refusal rows, never silently omitted. |
| Copy-answer | Employee detail peer-comparison card (answer *and* refusal states) | Copies the verdict sentence as plain text **with receipts**: name, distance %, peer median with currency, group definition, group size, as-of date. On a refusal state it copies the refusal sentence with the count (and gender, where applicable) — a refusal is a quotable answer too ({components.copy-answer}). |
| CSV export | Findings (Home), Overdue, Payroll Totals | Exports the visible list computed at the current as-of date and threshold; columns carry currency and provenance fields. [ASSUMPTION] Exact column layouts are unspecified in sources; architecture may settle them, provided currency and as-of columns are present. |
| Import flow | Import | Upload spreadsheet → report. Valid rows land in full; a row whose role or level is absent from the reference tables is **rejected and reported with its per-row reason; remaining valid rows still import. No row is ever mapped or guessed into a taxonomy value.** Per-row, never per-file. |
| Record-change form | Employee detail | **Three fields only: effective date (`effective_from`), amount, currency** — no reason/event field (confirmed spec-pure). Append-only; prior records remain readable and unmodified; no future-dating, no retroactive correction. Timeline % change and `(Hire)` label are **derived, not stored**. Enter saves, Esc cancels; sensible defaults make it a ~30-second task. |
| Salary timeline | Employee detail | Every record listed with effective date and currency, newest first ({components.timeline-list}). Read-only history. Current salary = latest record with `effective_from` on or before the as-of date. |
| Threshold control | Settings | Labeled `OUTLIER THRESHOLD`, default 20%, symmetric (one finding either direction). Changing it requires an explicit **Apply** confirmation — a deliberate act, not a live slider. Boundary is exact: 19.9% does not flag, 20.1% does; given a fixed threshold the findings list is reproducible. |
| Overdue period control | Overdue for Review | **Preset chips: 1y / 18mo / 2y / 3y, plus a custom date field.** List shows each employee with the date of their most recent salary record. |
| Employee form | Employees / detail | Role and level selectable **only** from the reference tables — no free text. Fields: name, role, level, country, gender (`MALE`/`FEMALE`), hire date. |
| Pulse charts | Home, Gender Insights | Static and non-interactive — no hover tooltips, no click targets; Gender Insights is the drill-down for the Home pulse. Underlying counts are always available as text (see Accessibility Floor). |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| Refusal: peer group < 5 | Employee detail, peer group, findings row | Full {components.refusal-panel} naming the count: "No comparison — only 3 peers." First-class designed state — same layout slot as an answer, never an error style. Never widen the peer group. |
| Refusal: a gender < 5 in group | Peer group gender-gap card | Refusal panel that **says which gender** and both counts: "3 FEMALE, 8 MALE — a gap needs 5 of each." Median and spread for the whole group may still show above it. |
| Zero findings | Home findings region | "No outliers beyond 20% as of 16 Jul 2026. **Nothing is drifting.**" Calm body text, no celebration graphics. This state is the sweep's payoff and must feel earned, not decorated. |
| Partial import | Import report | "9,942 rows imported · 58 rejected." Rejected rows tabled with per-row reason; import of valid rows is never blocked by bad rows. Report remains visible/reviewable after completion. |
| Empty directory / first run | Employees, Home | Point to Import: "No employees yet. Import a spreadsheet to begin." |
| Zero overdue | Overdue for Review | "No one is overdue for review within the selected period." Same calm register as zero findings — a statement, not a celebration. |
| Cold load / recompute | Every data surface | **No spinners, no progress theater.** Cold loads render the surface's chrome immediately with skeleton hairline rows in place of data; as-of or threshold recomputation swaps values in place (announced per Accessibility Floor), never returning to skeleton. |
| Wound-back as-of date | Every surface | Header control shows the non-today date prominently; every figure recomputes. [ASSUMPTION] A subtle persistent indicator (e.g. emphasized {components.as-of-control}) distinguishes "viewing the past" — sources decide recomputation, not the indicator's form. |

## Interaction Primitives

**Keyboard-first.** Maintenance must not fight Alice.

- `/` — focus the search field on any surface that has one (Employees). Active only while focus is outside editable fields, satisfying WCAG 2.1.4 as a focus-scoped shortcut.
- `Tab` order follows reading order on every surface; forms are completable without the mouse.
- `Enter` — submit the active form (record-change, employee form). `Esc` — cancel/close the topmost form or modal.
- Modal stacks one level deep, never two.
- Side panels and modals are `role="dialog"` with an accessible name: they take focus on open, contain `Tab` while open, and return focus to the invoking control on close — `Esc` included.
- **Banned everywhere:** notification affordances of any kind (bells, unread badges, re-engagement toasts — the product never reaches out; findings wait for Alice, pull-only), red/green semantics, celebration animations, infinite scroll on data tables (paginate), free-text entry for reference-table fields.

## Trust & Provenance

The product's core wager: **honest refusal is the trust-building moment.** When a peer group is too small, saying "I don't know" teaches Alice the tool is honest, which is what makes the answers trustworthy enough that the Excel-verify impulse never fires.

- **Ambient receipts.** Every computed number carries its provenance within one line ({components.provenance-caption}): peer **group size** ("Based on 9 peers"), the **as-of date**, the **currency** on every salary without exception, and the **pinned conversion rate and its date** wherever a converted figure appears ("converted at rates pinned 01 Jul 2026"). No comparison ever crosses a currency; conversion exists only in aggregate totals.
- **Determinism as a promise Alice can feel.** Same data + same threshold + same as-of date ⇒ same findings, same medians, same sentences. Nothing depends on the wall clock; winding the as-of date back reproduces yesterday's answer exactly.
- **Refusals carry receipts too.** A refusal names its count (and gender where relevant) — it is evidence of a standard, and the copy-answer affordance treats it as a full citizen.
- **Spread is shown as a min–max range in the group's single currency** ("₹18,20,000 – ₹29,50,000 INR across 9 peers") — a UX-made display decision; the underlying measure is flagged to architecture below.

## Accessibility Floor

Behavioral commitments; contrast ratios live in DESIGN.md § Colors → Contrast floor.

- WCAG 2.2 AA across the desktop web surface.
- Color is never the sole carrier: the outlier badge always states direction in words ("+28.4% above median"); refusal panels are distinguished by text and structure, not tint alone.
- Refusal panels are announced as content (region with heading), **not** `role="alert"` — dignity extends to the screen-reader experience.
- Changing the as-of date or threshold announces recomputation via `aria-live=polite` ("Findings updated as of 12 May 2026"). Activating copy-answer announces "Answer copied" through the same polite live region and shows a transient, non-color-only visual confirmation.
- The as-of control is a single named button (visible text plus accessible name, e.g. "As of 16 Jul 2026 — change as-of date") that opens the date picker; its calendar glyph is decorative (`aria-hidden`).
- Every form control has a programmatically associated label; helper text (currency-follows-country, `Enter to save · Esc to cancel`) is linked via `aria-describedby`.
- Every pulse chart's underlying counts are exposed as a proper data table — visible on Gender Insights, visually hidden or adjacent text on Home.
- All data tables use proper header markup; sortable/scannable by keyboard; focus rings visible at AA contrast.
- Landmark regions (`nav`/`main`) with a skip-to-content link past the fixed sidebar; the active nav item carries `aria-current="page"`.
- Full keyboard operability of every flow (import, record-change, threshold Apply) — the primitives above are commitments, not conveniences.

## Key Flows

### Flow 1 — The Sweep (Alice, Thursday mid-morning, unprompted)

1. Alice opens the product between meetings. Nobody asked her to.
2. Home loads: header reads `As of 16 Jul 2026` (today, the default). She scans the landscape — 10,000 headcount, 14 countries, total payroll with its pinned-rate caption, the gender-by-level pulse.
3. The findings region lists the outliers fresh-computed at the 20% threshold: Sarah Jenkins +28.4% above median (42 peers), Michael Chang −25.2% below (18 peers), David O'Connor +26.1% (24), Aisha Patel −24.8% (156) — and one inline refusal row: "Elena Rossi — only 3 peers, too few to compare fairly."
4. She clicks Sarah's row → employee detail: current salary with currency, peer comparison with median, min–max range, group size, as-of date. She notes it for a conversation with Sarah's director.
5. Back on Home she works the short list top to bottom; the overdue card says "41 people are currently overdue" — she files that for the afternoon.
6. She reaches the end of the list. Nothing else is flagged, and the one group the product couldn't judge said so out loud.
7. **Climax:** Alice closes the tab *believing* "nothing else is drifting" — not hoping. Because the list is a pure function of data + threshold + as-of date, and refusals are explicit rather than silent, an absent row means an absent problem. Excel never opens.

Failure path: zero findings → the "Nothing is drifting" state (see State Patterns); the sweep still ends in belief, just faster.

### Flow 2 — Someone Asked (Alice, 2:40pm, a manager pings about Priya)

1. Slack: "Hey — is Priya Nair paid fairly for her level? She asked me."
2. Alice hits `/` on Employees, types "Priya", opens Priya Nair's detail.
3. The peer-comparison card answers at a glance: peer median ₹23,40,000 INR, **8% under peer median**, range ₹18,20,000 – ₹29,50,000 INR across 9 peers, "Based on 9 peers as of 16 Jul 2026."
4. She clicks the copy-answer affordance on the card.
5. **Climax:** She pastes one sentence into Slack — "Priya Nair is 8% under her peer median (₹23,40,000 INR), based on 9 peers — Software Engineer · L4 · India — as of 16 Jul 2026" — hedge-free, receipts attached, and **stands behind it**. Under two minutes, no spreadsheet, no "let me double-check."

Variant: had the question been about Tomas Berg, the card shows the refusal panel ("No comparison — only 3 peers") and copy-answer copies *that* sentence — "I don't know, and here's why" is also an answer she can stand behind ([screen-03b](imports/stitch/screen-03b-refusal-tomas.html)).

### Flow 3 — Maintenance (Alice, Thursday 4:50pm, recording Priya's raise)

1. Comp conversation concluded: Priya's raise to ₹23,00,000 takes effect today, 16 Jul 2026 — no future-dating exists, so the record is entered the day it takes effect. Alice has coffee cooling on her desk.
2. Employees → "Priya" → **Record a salary change**.
3. The 3-field form opens ([screen-09](imports/stitch/screen-09-record-change.html)): effective date (defaulted to today), amount, currency (defaulted to INR from the current record). No reason field, no workflow, nothing to negotiate.
4. She tabs through: date, amount, `Enter`.
5. The timeline shows the appended record at the top with its derived % change; because its `effective_from` (16 Jul) is on or before the as-of date (16 Jul), it is now the current salary everywhere. The old records sit untouched below. Nothing was overwritten.
6. **Climax:** She's out in ~30 seconds — before the coffee cools. The form never fought her; the product absorbed the fact and got out of the way.

Failure path: a typo'd amount — she re-opens the form and appends a corrected record dated the same day; history stays append-only, and both records remain visible on the timeline. [ASSUMPTION] Which of two records sharing an `effective_from` counts as current is **not** decided by CAP-3's "latest record on or before the as-of date" rule; the tie-break is flagged to architecture (Notes for Architecture, item 5), and the UI assumes only that some deterministic tie-break exists.

### Flow 4 — First Morning (Alice, day one, seeding the directory)

1. Fresh install: Home and Employees show the first-run state pointing at Import.
2. Import → she uploads the payroll spreadsheet — 10,000 rows.
3. The report lands: "9,942 rows imported · 58 rejected," rejected rows tabled with per-row reasons ("role 'Ninja' is not in the reference tables"). The valid rows are already in; nothing was blocked, nothing was guessed into a taxonomy value.
4. She fixes one rejected row's role in the source sheet and re-imports the corrected rows; the report reruns per-row.
5. **Climax:** The directory holds 10,000 people and Alice knows *exactly* which 58 aren't in yet and why — a partial import that tells the whole truth beats an all-or-nothing one that hides it.

Failure path: a wholly malformed file — the report is one refusal-styled statement of what could not be read, not a stack trace; nothing partial lands silently.

## Notes for Architecture

Left open by the SPEC and flagged, not settled here:

1. **Spread measure** — UX displays spread as a min–max range; whether "spread" is stored/computed as min–max, IQR, or other is architecture's call (memlog flags the range as a UX display decision).
2. **Currency storage** — per salary record vs. resolved from the employee's country (SPEC assumption, explicitly unsettled). Affects what the timeline and record-change form bind to.
3. **Employee identifier** — SPEC names "an identifying name" but no uniqueness scheme; search and directory UX assume some stable identifier exists.
4. **Country validation on import** — the import mock shows country validated against reference tables, but the SPEC mandates rejection only for unknown **role/level**. Whether country is validated the same way is architecture's decision; the UI's per-row rejection report accommodates either.
5. **Same-`effective_from` tie-break** — CAP-3's "latest record with `effective_from` on or before the as-of date" does not decide between two records sharing an `effective_from` (the correction case in Flow 3). Architecture must define a deterministic tie-break (e.g. insertion order); the UI only requires that one exists.

## Coverage

CAP-1 Import → Import surface + partial-import state + Flow 4. CAP-2 Employee CRUD → Employees + employee form. CAP-3 Record change → record-change form + Flow 3. CAP-4 Timeline → employee detail + Flow 3. CAP-5 Peer comparison/refusal → employee detail + Flow 2. CAP-6 Outliers + threshold → Home findings + Settings + Flow 1. CAP-7 Gender gap + refusal → peer group surface. CAP-8 Distribution → Gender Insights + Home pulse. CAP-9 Totals → Payroll Totals + Home metric. CAP-10 Overdue → Overdue surface + Home summary. (CAP-11 seed script has no UI surface; it feeds the demo data these flows assume.)
