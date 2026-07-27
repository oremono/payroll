# Experience Spine — how it works

Scannable version. Full text unchanged in [`EXPERIENCE.md`](EXPERIENCE.md).

Peer contract to [`DESIGN.md`](DESIGN.md): that owns how it looks, this owns how it works. On conflict
with the mocks, this spine and DESIGN.md win.

## The user

**Alice**, ACME's HR manager. Sole user, solo operator. No approvals, no workflow, no one chasing her.
The consequence of an error is embarrassment — a manager spots it first — not compliance risk.

This is a **knowing tool**, not a compliance or workflow tool. Excel fails at answers, not storage.

**Success criterion:** Alice reads a number and the impulse to rebuild it in Excel does not fire.

Three moments shape everything:

| Moment | Shape |
| --- | --- |
| **Maintenance** | Low-attention data entry, ~30 seconds, must not fight her. |
| **Someone-Asked** | One specific fairness answer, quotable without hedging. |
| **The Sweep** | Unhurried, unprompted drift check. The moment Excel cannot serve at all. |

Desktop, 1280px+. No mobile layout specified.

## Information architecture

Sidebar: **Home · Employees · Gender Insights · Payroll Totals · Overdue for Review · Import ·
Settings** (Settings pinned bottom).

| Surface | Purpose |
| --- | --- |
| **Home — The Sweep** | Landscape overview: headcount, countries, payroll-by-country, gender-by-level pulse. Findings (CAP-6) and overdue count (CAP-10) embedded as regions among several. |
| **Employees** | Directory of 10,000. Search, row → detail. Create and edit (CAP-2). |
| **Employee detail** | Current salary, peer comparison or refusal (CAP-5), salary timeline (CAP-4), record-a-change entry (CAP-3). |
| **Peer group** | Roster, median, spread, gender gap or refusal (CAP-7). **No sidebar entry, no browse surface** — reached only through a finding or an employee. |
| **Gender Insights** | Gender counts per level org-wide. The clustering view CAP-7 is blind to (CAP-8). |
| **Payroll Totals** | Per-country totals in local currency; org-wide shows pinned rate + date (CAP-9). |
| **Overdue for Review** | Holds the period control (CAP-10). Compact count on Home links here. |
| **Import** | Bulk import with per-row rejection report (CAP-1). |
| **Settings** | The outlier threshold — a deliberate act, kept off the sweep. |

**The global as-of control** sits in the header on every screen, defaulting to today. Wind it back and
every view recomputes. It is both a control and ambient provenance.

## Voice

**Quotable, hedge-free verdicts.** One sentence, pasteable unedited:

> "Priya Nair is 8% under her peer median (₹23,40,000 INR), based on 9 peers — Software Engineer · L4
> · India — as of 16 Jul 2026."

No "approximately". No "may indicate". No softeners.

**Refusals name the count** — and for gender, which gender. They are confident statements of a
standard, never apologies:

> "No comparison — only 3 peers. Below 5, a median would be noise dressed as an answer, so we don't
> compute one."

| Do | Don't |
| --- | --- |
| "Only 3 peers — too few to compare fairly" | "Error: insufficient data" |
| "41 people are overdue for review" | "⚠ 41 items require attention!" |
| "No outliers beyond 20% as of 16 Jul 2026." | "All good! 🎉" |
| "Rejected: role 'Ninja' is not in the reference tables" | "Row 214 failed validation (code 422)" |

**Exact vocabulary, verbatim:** peer group, peer median, spread, distance %, outlier, threshold,
refusal, salary timeline, effective date, as-of date, overdue for review, reference tables. Gender is
`MALE` / `FEMALE`. **Banned:** "snapshot", "compa-ratio".

## Component behavior

| Component | Rules |
| --- | --- |
| **Findings list** | **Fresh every visit — a pure function of data + threshold + as-of.** No seen/unseen, no dismissal, no acknowledgement. Dealing with a finding means changing the salary; the list shrinks only when the data does. One finding per outlier, either direction. Refusal-worthy groups appear inline as refusal rows, never silently omitted. |
| **Copy-answer** | Copies the verdict with receipts: name, distance, peer median with currency, group definition, size, as-of date. **On a refusal it copies the refusal sentence** — a refusal is a quotable answer too. |
| **Record-change form** | Three fields only: effective date, amount, currency. No reason field. Append-only, no future-dating, no retroactive correction. The timeline's % change and `(Hire)` label are derived, not stored. Enter saves, Esc cancels. ~30 seconds. |
| **Threshold control** | Default 20%, symmetric. Changing it needs an explicit **Apply** — a deliberate act, not a live slider. Boundary exact: 19.9% no, 20.1% yes. |
| **Import flow** | Valid rows land in full. A row with an unknown role or level is rejected with its per-row reason; the rest still import. **Per-row, never per-file. Nothing is ever guessed into a taxonomy value.** |
| **Pulse charts** | Static and non-interactive. No tooltips, no click targets. Underlying counts always available as text. |

## States

| State | Treatment |
| --- | --- |
| **Peer group < 5** | Full refusal panel naming the count. Same layout slot as an answer, never an error style. **Never widen the group.** |
| **A gender < 5** | Refusal that says *which* gender and both counts: "3 FEMALE, 8 MALE — a gap needs 5 of each." Median and spread for the whole group may still show above it. |
| **Zero findings** | "No outliers beyond 20% as of 16 Jul 2026. **Nothing is drifting.**" Calm body text, no celebration graphics. This is the sweep's payoff and must feel earned, not decorated. |
| **Partial import** | "9,942 rows imported · 58 rejected." Rejected rows tabled with reasons. Report stays reviewable after completion. |
| **Cold load / recompute** | **No spinners, no progress theater.** Chrome renders immediately with skeleton hairline rows. Recomputation swaps values in place, never back to skeleton. |
| **Wound-back as-of** | The header shows the non-today date prominently; every figure recomputes. |

## Interaction primitives

Keyboard-first. Maintenance must not fight her.

- `/` focuses search, active only while focus is outside editable fields.
- `Tab` follows reading order. Forms are completable without a mouse.
- `Enter` submits the active form. `Esc` cancels the topmost form or modal.
- Modals stack one level deep, never two. Dialogs trap focus and return it on close.

**Banned everywhere:** notification affordances of any kind — bells, unread badges, re-engagement
toasts. The product never reaches out; findings wait for Alice. Also banned: red/green semantics,
celebration animations, infinite scroll on data tables, free text for reference-table fields.

## Trust and provenance

**The core wager: honest refusal is the trust-building moment.** Saying "I don't know" when a group is
too small teaches Alice the tool is honest — which is what makes the answers trustworthy enough that
the Excel-verify impulse never fires.

- **Ambient receipts.** Every number carries its provenance within one line: group size, as-of date,
  currency on every salary without exception, and the pinned rate with its date wherever a converted
  figure appears.
- **Determinism she can feel.** Same data + same threshold + same as-of ⇒ same findings, same medians,
  same sentences. Winding the date back reproduces yesterday's answer exactly.
- **Refusals carry receipts too.** A refusal names its count. It is evidence of a standard.

## Accessibility floor

- WCAG 2.2 AA across the desktop surface.
- **Color is never the sole carrier.** The outlier badge always states direction in words: "+28.4%
  above median".
- **Refusal panels are announced as content** — a region with a heading, *not* `role="alert"`. Dignity
  extends to the screen-reader experience.
- Changing the as-of date or threshold announces recomputation via `aria-live=polite`.
- Every pulse chart's counts are exposed as a real data table.
- Landmarks (`nav`/`main`), skip-to-content past the fixed sidebar, `aria-current="page"` on the
  active nav item.

## The three flows, compressed

**1 · The Sweep.** Alice opens the product between meetings. Nobody asked her to. Home lists the
outliers fresh-computed at 20% — and one inline refusal row: "Elena Rossi — only 3 peers." She works
the short list top to bottom. *Climax:* she closes the tab **believing** nothing else is drifting —
not hoping. Because the list is a pure function and refusals are explicit rather than silent, an
absent row means an absent problem. Excel never opens.

**2 · Someone Asked.** A manager pings about Priya. `/`, type "Priya", open detail. The card answers at
a glance. She clicks copy-answer. *Climax:* one sentence into Slack, hedge-free, receipts attached,
and she **stands behind it.** Under two minutes, no "let me double-check."

> Variant: had it been Tomas Berg, the card shows the refusal and copy-answer copies *that*. "I don't
> know, and here's why" is also an answer she can stand behind.

**3 · Maintenance.** Priya's raise takes effect today. Employees → Priya → Record a salary change.
Three fields, defaults filled, tab-tab-Enter. The timeline shows the appended record at the top; the
old ones sit untouched below. *Climax:* out in ~30 seconds, before the coffee cools.

> Failure path: a typo'd amount. She appends a corrected record dated the same day. History stays
> append-only and both records remain visible.

## Coverage

Every capability has a surface. CAP-1 → Import. CAP-2 → Employees + form. CAP-3 → record-change form.
CAP-4 → employee detail. CAP-5 → employee detail. CAP-6 → Home findings + Settings. CAP-7 → peer
group. CAP-8 → Gender Insights. CAP-9 → Payroll Totals. CAP-10 → Overdue. CAP-11 (seed) has no UI — it
feeds the data these flows assume.
