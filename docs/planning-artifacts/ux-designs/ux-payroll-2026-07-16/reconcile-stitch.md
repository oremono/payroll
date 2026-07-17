# Reconcile — Stitch Mock Set vs Canonical Decision Log

- **Input:** `imports/stitch/` — 11 screen HTML files (authoritative), `design-system-equilibrium-finance.md`, `MANIFEST.md` (v2/v3 regeneration, harvested 2026-07-17)
- **Against:** `.memlog.md` (canonical decisions) and `.working/source-extract.md` (SPEC/brief extract)
- **Date:** 2026-07-17

---

## 1. DECISIONS HONORED

| # | Memlog decision | Where the mocks realize it |
|---|---|---|
| 1 | **Landscape-led home** — org overview with findings as one region among several | `screen-01-home-sweep.html`: metric row (10,000 headcount / 14 countries / total payroll), "The Findings (Outliers)" table as one region, gender-by-level pulse card, top-5 payroll-by-country card, overdue summary card |
| 2 | **Contextual-only peer groups** — no "Peer Groups" sidebar item | All 11 sidebars carry exactly: Home, Employees, Gender Insights, Payroll Totals, Overdue for Review, Import, Settings. "Peer Groups" appears only as breadcrumb ancestor on `screen-04-peer-group.html` (line 187, allowed per MANIFEST) |
| 3 | **Fresh every sweep** — findings a pure function of data + threshold + as-of; no seen/unseen/dismiss | `screen-01`: findings rows carry no acknowledgement, dismissal, or read-state affordance (but see "Review All" in §4.3) |
| 4 | **Global as-of control** — header, defaults today, always visible | "As of 16 Jul 2026" in the fixed header of **all 11 screens** (grep-verified); rendered as a calendar dropdown control on screens 02, 03, 03b, 04, 08, 09 |
| 5 | **Min–max spread in group currency** | `screen-03` peer card: "₹18,20,000 – ₹29,50,000 INR across 9 peers"; `screen-04` "Salary Spread" stat card: same range |
| 6 | **Copy + export** — copy on employee-detail verdict incl. refusals; CSV export on list views | Copy button (`content_copy`, title "Copy answer") on `screen-03` (line 275) **and** on the refusal card of `screen-03b` (line 242). "Export CSV" on `screen-01` findings (line 254), `screen-06` totals (line 305), `screen-07` overdue (line 212); "Download rejection report CSV" on `screen-08` (line 277) |
| 7 | **Overdue period: preset chips (1y/18mo/2y/3y) + custom date** | `screen-07` lines 192–198: "1 year / 18 months / 2 years / 3 years / Custom date" chips, 2 years selected, summary "41 employees' most recent salary record predates 16 Jul 2024" |
| 8 | **Threshold in Settings; changing it is deliberate** | `screen-10`: "Outlier threshold" card with stepper at 20%, "Default" tag, explicit Apply threshold / Reset to default (20%) buttons; boundary-exactness copy "19.9% does not flag and 20.1% does" (CAP-6 verbatim) |
| 9 | **Refusal dignity** — first-class state, names count/gender, no error styling | `screen-01` line 287–293: Elena Rossi hatch-pattern neutral row "Only 3 peers — too few to compare fairly"; `screen-03b`: "No comparison — only 3 peers." on soft `#F1F5F9` fill; `screen-04` lines 219–223: gender-gap refusal names which gender and both counts ("6 men and 3 women") |
| 10 | **Currency discipline** — currency always shown, no cross-currency comparison, pinned rate disclosed | Every standalone salary carries its currency (₹…INR, £…GBP, kr…NOK, ¥…JPY, R$…BRL, $…CAD/AUD); `screen-06` per-country totals in local currency, USD-equivalent aggregate flagged "converted at rates pinned 01 Jul 2026" (also on `screen-01` line 243), footer "Comparisons never cross currencies; conversion exists only for this total" (line 395). Caveat in §4.8 |
| 11 | **Quiet amber grammar** — amber for outliers/attention, never red/green | Outlier badges use `#FEF3C7/#92400E` and `#FFFBEB/#B45309`; `screen-04` defines `status-amber-bg/text` tokens. Grep-verified: **zero** `bg-error`/`text-error`/red-family classes or hexes in any screen. Caveat in §4.4 |
| 12 | **No notifications, ever** | No bell/inbox/toast/alert affordance in any header or nav; findings wait passively on Home. Icon-level caveat in §4.5 |
| 13 | **30-second maintenance form** — keyboard-friendly, sensible defaults | `screen-09` slide-over: exactly two fields — New Salary (autofocus, ₹ prefix + INR suffix, "current: ₹21,50,000 INR" hint) and Effective Date (defaulted to as-of); "Enter to save · Esc to cancel" (line 322) |
| 14 | **Append-only timeline; % change and Hire label derived, no reason/event field** | `screen-03`/`screen-03b` timelines: date + amount + currency with derived +9%/+12%/"Hire" annotations; `screen-09` form has no reason field, footnote "This appends a new record to Priya's salary timeline. Past records are never changed." (line 309) |
| 15 | **MALE/FEMALE only** | `screen-03` "FEMALE", `screen-03b` "MALE" (caps, in identity strip); `screen-05` legend exactly MALE/FEMALE; `screen-04` composition "(6 Male, 3 Female)"; directory abbreviates to F/M |
| 16 | **Overdue placement: BOTH** — count on home + dedicated screen holding the period control | `screen-01` card "41 people are currently overdue…" → "View overdue list" link; `screen-07` dedicated screen owns the period chips |
| 17 | **Exact >20% outlier boundary in demo data** (v3 fix) | `screen-01` findings distances all beyond threshold: +28.4 / −25.2 / +26.1 / −24.8, refusal row for Elena; `screen-04` flags only Karan Desai +26% (amber) while +19%/−19% rows stay neutral |

---

## 2. MOCK-INTRODUCED IDEAS (Stitch inventions that survived verification)

| Idea | Where | Classification | Rationale |
|---|---|---|---|
| "/" keyboard search hint + working focus script | `screen-02` line 263 placeholder "Search 10,000 employees... (Press / to focus)", script lines 411–420 | **ADOPT** | Serves someone-asked speed; cheap, discoverable, keyboard-first |
| "nothing guessed" summary-strip phrase | `screen-08` line 207: "9,947 rows imported · 53 rows rejected · nothing guessed" | **ADOPT** | Perfect compression of CAP-1's "never mapped or guessed"; trust texture in three words |
| Refusal microcopy "a median would be noise dressed as an answer" | `screen-03b` line 242, echoed `screen-04` line 221 | **ADOPT** | Teaches *why* the tool refuses; the trust-building voice the memlog wants |
| Review Status card on home (overdue count as prose sentence + link) | `screen-01` lines 320–325 | **ADOPT** (card) / **DROP** (wording) | The card realizes the "BOTH" decision; but "scheduled compensation review" invents a scheduling concept — see §4.3 |
| Settings live impact preview ("At 20%, 3 employees are outliers today.") | `screen-10` line 279 | **ADOPT** | Makes threshold change a sighted, deliberate act; fix count consistency (§4.7) |
| Boundary-exactness explainer prose in settings | `screen-10` lines 260–262 | **ADOPT** | Spec rule surfaced as UI copy where the control lives |
| "View Base Rates" expandable rate list on totals | `screen-06` lines 281–296 | **ADOPT** | Deepens pinned-rate provenance beyond the minimum disclosure |
| Inline refusal row *inside* the findings table (hatch pattern, full-width) | `screen-01` lines 285–295 | **ADOPT** | Refusals surfaced in the sweep itself, not hidden behind detail pages |
| Gender-insights framing caption ("Clustering: where women are in the org, not how they are paid within a group — see peer groups for that.") | `screen-05` line 164 | **ADOPT** | Explains CAP-8 vs CAP-7 blindness distinction in one sentence |
| Ghost vs primary button grammar: solid slate = commits data (Record change, Add employee, Apply threshold, Import another file); ghost = navigational/secondary (Edit employee, Export CSV, Cancel, Download report) | consistent across screens 01–10 | **ADOPT** | Coherent, worth stating as a rule in the DESIGN spine |
| Breadcrumbs (Employees / Priya Nair; Peer Groups / group name) | `screen-03` 237–241, `screen-03b` 219–225, `screen-04` 184–196 | **ADOPT** | Gives contextual-only peer groups a visible "way you got here" |
| Level chips (bordered mono badges) in directory and overdue lists | `screen-02` line 300 etc., `screen-07` line 233 | **ADOPT** | Good scannability; but harmonize taxonomy (§4.9) |
| "Enter to save · Esc to cancel" hint in form footer | `screen-09` line 322 | **ADOPT** | Direct service of the 30-second form decision |
| Amber duration badges + sticky name column on Overdue | `screen-07` lines 231–283 | **NEUTRAL** | Reasonable list treatment; amber for "attention" is within grammar |
| "Distribution Pulse" naming / pulse-chart component (compact stacked bars near tables) | design-system doc "Pulse charts"; realized `screen-01` GENDER BY LEVEL card, `screen-05` chart | **NEUTRAL** | Nice internal name for the component; not user-facing vocabulary |
| Pagination style ("Showing 1–50 of 10,000", numbered + ellipsis) | `screen-02` lines 390–406, `screen-07` lines 289–304 | **NEUTRAL** | Mock-local; virtualized scrolling is an equally valid implementation choice |
| "stark clustering" indigo callout on L7 | `screen-05` lines 246–248 | **NEUTRAL** | Indigo (highlight, not amber/red) is grammar-consistent; the editorializing label is a judgment call for the spines |
| Collapsed re-import zone atop rejection report | `screen-08` lines 187–193 | **NEUTRAL** | Sensible post-import layout; details mock-local |
| Country flags in tables | `screen-02`, `screen-06` (remote image URLs) | **NEUTRAL** | Fine as an idea; implementation cannot use Stitch's hosted images |
| Gender column abbreviated to F/M in directory | `screen-02` line 309 | **NEUTRAL** | Display abbreviation of MALE/FEMALE; acceptable in dense tables |
| Employee headshot photos (Tomas Berg avatar, background Priya avatar) | `screen-03b` line 226, `screen-09` line 218 | **DROP** | The data model holds no photo; invented data the product cannot have. (User-account avatar in headers: NEUTRAL, harmless chrome) |
| "Review All" button on findings header | `screen-01` line 255 | **DROP** | Implies a review/acknowledgement flow; findings have no state — dealing with a finding means changing the salary (fresh-every-sweep) |
| Amber badge on sub-threshold distance ("8% under peer median") | `screen-03` line 288 | **DROP** | Violates quiet-amber = outlier-only grammar; 8% < 20% should render neutral (see §4.4) |

---

## 3. DROPPED / UNREALIZED (decided or committed, but no mock shows it)

| Item | Status | Evidence |
|---|---|---|
| **Dark mode** (decision: in scope, both modes for v1) | **Unrealized — zero dark renders.** Known memlog note: dark tokens to be specified at DESIGN.md distillation | 5 files contain stray non-functional `dark:` classes (`screen-02/03/04/05/09`); no screen has a dark variant or `class="dark"` render |
| **Add/edit employee form** (CAP-2, committed scope) | **Unrealized.** Entry points exist ("Add employee" button `screen-02` line 277; "Edit employee" `screen-03` line 251) but no form mock | 11-screen plan never included it; must be specified in the spines (fields: name, role/level from reference tables, country, gender, hire date) |
| **Copy-sentence exact receipt format** | **Partially realized.** Copy buttons present (03, 03b) but the plain-text sentence — number + receipts (group size, as-of, currency) and its refusal variant — is never spelled out anywhere | Decision (memlog line 30) requires "plain-text sentence with receipts incl. refusals"; needs authoring at distillation |
| **"Fuller export (CSV/snapshot)"** — the non-CSV artifact half | **Partially realized.** CSV buttons cover findings/totals/overdue/rejections; no printable/snapshot-style export shown (and "snapshot" wording is now banned — needs a new name if kept) | memlog line 30 |
| **As-of wind-back state** | **Unrealized as a state.** The control is on all screens but no mock shows a non-today as-of (banner/recomputed view when Alice winds back) | All screens show only "As of 16 Jul 2026" (= today) |
| **Import pre-states** (upload in progress, wholly clean import) | **Unrealized.** Only the post-import rejection-report state is mocked | `screen-08` |
| **Peer-group contextual entry links** | **Implied, not demonstrated.** Findings rows and the employee peer-card are the decided entry points but no row/card is visibly linked to screen-04 | `screen-01` findings rows, `screen-03` peer card |
| **Employee identifier** (source-extract open question 3) | **Untouched.** No employee ID anywhere; names used as sole identity in every list and breadcrumb | all list screens |
| **Settings surface completeness** | Threshold + read-only reference tables only. If dark mode ships, Settings has no appearance control; fine to add at distillation | `screen-10` |

---

## 4. CONFLICTS (mock content contradicting a memlog decision or spec rule)

Grep-verified clean: no "snapshot", no "CompDirect", no "Compa-ratio" (exact string), no "Peer Groups" nav item, no red/error styling classes, "As of 16 Jul 2026" on all 11 screens. What the greps missed:

1. **`screen-09-record-change.html` background layer is a vocabulary-infection cluster — the one real defect.** The blurred backdrop behind the modal (an old-style Priya detail page) contains:
   - line 224: `Comp-ratio: 0.98` badge — compa-ratio is a SPEC non-goal; **evaded the verification grep because it is spelled "Comp-ratio", not "Compa-ratio"**
   - lines 238–241: timeline columns **"Event Type"** and **"Approval"** — violates the no-reason/no-event-field decision (memlog line 39) and the no-approval-workflow constraint
   - lines 247–257: values "Merit Increase", "Market Adjustment", "Pending", "Approved by S. Lee" — merit cycles and approvals are SPEC non-goals
   - line 246: top record effective **16 Jul 2026 marked "Pending"** — implies future/pending records; SPEC forbids scheduled changes
   - lines 253–262: backdrop timeline (hire 15 Aug 2023, ₹19,00,000; +4.2% in 2025) **contradicts the canonical Priya timeline** in `screen-03` (hire 03 Mar 2021 ₹17,60,000 → ₹19,70,000 → ₹21,50,000)
   The foreground modal — the actual subject of the screen — is fully compliant. Fix: at distillation treat screen-09's backdrop as non-normative noise, or patch it to mirror screen-03; do not let any of its vocabulary reach the spines.
2. **`screen-01` line 221:** header page title reads **"the sweep (v3)"** — a generation label leaked into UI copy. Should be "Home" / "The Sweep".
3. **`screen-01` line 321:** "overdue for their **scheduled compensation review**" — nothing in the product is scheduled; overdue is purely period-relative (CAP-10). Reword to match `screen-07`'s correct framing ("no salary change since…").
4. **`screen-03` line 288:** amber badge (`#FEF3C7/#92400E`) on **"8% under peer median"** — a sub-threshold distance wearing the outlier color, breaking quiet-amber = outlier-only grammar (contrast `screen-04`, where ±19% rows correctly stay neutral and only +26% is amber).
5. **Bell-family icon for Overdue nav:** `screen-07` line 145 and `screen-10` line 206 use `notification_important` (a bell glyph) — brushes against "no notification bells" at icon level. Also nav icons for the same items differ on every screen (home/dashboard, group/groups/badge, priority_high/pending_actions/history/history_toggle_off/event_busy/notification_important) — pick one set at distillation.
6. **`screen-08` lines 254–262:** third rejection row rejects on **country** not in reference tables — SPEC CAP-1 mandates role/level rejection only. Already flagged to architecture in memlog (line 36); keep the flag.
7. **Cross-screen count drift:** `screen-10` says "At 20%, **3** employees are outliers today" while `screen-01` shows **4** outlier findings. Demo-data inconsistency, not a decision conflict.
8. **`screen-04` lines 238–291:** member-table salary cells show bare `₹21,50,000` with currency only in the column header "Current Salary (INR)". Borderline against "no salary is ever displayed without its currency" — header-carried currency is defensible in a single-currency table but the spines should rule on it explicitly.
9. **Level taxonomy inconsistency (mock data, not decision):** Settings/Gender Insights use L1–L8 + M1–M3; Employees/Overdue chips use IC2–IC6 + M2/M4/M7; Home findings say "VP Engineering", "L6 Legal". One reference-table vocabulary must win at distillation.

---

*Prepared by the reconcile subagent for the BMad UX Finalize pass, 2026-07-17.*
