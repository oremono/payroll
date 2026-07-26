# Stitch design-handoff prompt

The opening prompt given to [Google Stitch](https://stitch.withgoogle.com/projects/17248335032802531831)
on 2026-07-16, before any code existed. Many rounds of iteration followed it.

Three things to note about it, because they are the point of keeping it:

1. **It fixes what was already decided.** Persona, product personality, the trust texture, the exact
   UI vocabulary, nine screens, three flows — all settled in `brief.md` and `SPEC.md` first, and
   restated here so the tool could not drift from them.
2. **It marks eight questions `[OPEN]` and hands them over.** The front door's shape (verdict vs
   landscape), where the overdue list lives, where the threshold control lives, how the as-of date
   is entered, how spread is displayed, whether findings persist as seen/unseen, and the
   copy/export affordance. These were genuinely undecided, so the tool was asked to propose. All
   eight were resolved afterwards and folded into `EXPERIENCE.md` and `DESIGN.md`.
3. **The output was never built 1:1.** The mocks were a way to *see* the product before committing
   to it. What survived is recorded in [`reconcile-stitch.md`](reconcile-stitch.md), which walks the
   mock set against the decision log and classifies every idea the tool invented as adopt, drop, or
   neutral, with a reason.

The generated screens are in [`imports/stitch/`](imports/stitch/) with
[`MANIFEST.md`](imports/stitch/MANIFEST.md) recording the project id, model, and design system.

---

## The prompt

**Product.** A desktop web app called "Salary Management for ACME HR" — an internal salary system of
record and pay-fairness tool for exactly one user: Alice, the HR manager of a 10,000-person company
spread across many countries. It replaces Excel. Its promise: she never does salary arithmetic by
hand again. It is a knowing tool, not a compliance or workflow tool — no approvals, no other users,
nothing ever nags or notifies her. Findings wait quietly until she shows up.

**Personality.** Calm, precise, honest, unhurried. A data-dense professional tool where density is a
feature — closer to a well-set financial broadsheet than a spacious consumer dashboard. Numbers are
the protagonists: tabular figures, careful alignment, a clear visual grammar for above-median vs
below-median vs "refused to answer." No decorative illustration, no mascot energy, no alarmist
red-alert styling — an outlier is a quiet, firm flag, not a siren. Both light and dark modes.

**The trust texture (most important).** Alice trusts this tool only because it shows its receipts
and admits its limits:

- Every number carries its provenance nearby, ambiently: the peer-group size it was computed from,
  the as-of date, the currency.
- No salary is ever displayed without its currency. No comparison ever crosses currencies. Any
  converted org-wide total displays the conversion rate used and the date it was pinned.
- **Refusal is a first-class designed state, not an error.** When a peer group has fewer than 5
  people, the product says it will not compare — and names the count ("Only 3 peers — too few to
  compare fairly"). When a gender-gap view has fewer than 5 of either gender, it says which gender
  fell short. Refusals are common, styled with confidence and dignity — never apologetic gray error
  boxes.

**Vocabulary (use these exact words in the UI):** peer group (people sharing role + level +
country), peer median, spread, distance (always a percentage), outlier (more than the threshold from
peer median, either direction — one finding, not two), threshold (default 20%, adjustable by the
user), refusal, salary timeline, effective date, as-of date, overdue for review, reference tables.
Gender values are MALE and FEMALE only.

**Screens.**

1. **Home — "the sweep."** Alice's Tuesday ritual: she opens the app unprompted to learn whether
   anything has drifted. Outliers come to her — surfaced automatically, each showing the person,
   their peer group, that group's size, and their distance from its median. **[OPEN — your call in
   Stitch]** the front door's shape: a *verdict* ("3 people are outside their peer groups" and
   little else) or a *landscape* (an org-wide overview she scans, with findings embedded). Also
   **[OPEN]**: whether the overdue-for-review list lives on this same home screen or on its own
   screen; and where the threshold control lives (inline on this screen vs a settings surface).
2. **Employee directory.** Searchable, filterable list of 10,000 employees (role, level, country,
   current salary with currency). Fast keyboard-first search — this is how Alice reaches one person
   when a manager asks about them.
3. **Employee detail.** One employee's story on one screen: current salary (with currency), the peer
   comparison — group median, spread, their distance, group size — or the refusal state when the
   group is under 5; and their salary timeline (append-only history of effective-dated records, each
   with amount, currency, effective date). A "record a salary change" action lives here. This screen
   must produce the sentence Alice can paste into Slack and stand behind ("Priya is 8% under her
   peer median of 9").
4. **Peer group view.** The group Alice lands on from a finding or an employee: members, median,
   spread, and the within-group gender gap — or its refusal naming which gender is under 5.
5. **Gender distribution across levels.** Org-wide gender counts per level, revealing clustering the
   peer view can't see.
6. **Payroll totals.** Per-country totals in local currency, no conversion. An org-wide total that
   spans currencies shows the pinned conversion rate and its date.
7. **Overdue for review.** Given a period ("no raise in 2 years" — **[OPEN]** preset chips vs free
   date input), employees whose latest salary record predates it, with that record's date.
8. **Bulk import.** Upload a spreadsheet; valid rows import, invalid rows are rejected and reported
   per-row with the reason (unknown role or level — never guessed into the taxonomy). The rejection
   report is the hero of this screen.
9. **Add/edit employee & record salary change forms.** Thirty-second, keyboard-friendly, no modal
   labyrinths. Role and level are selectable only from reference tables — never free text.

**Flows to honor.** (1) *Maintenance:* directory → person → record a raise → out, in ~30 seconds.
(2) *Someone asked:* search a name → one quotable, hedge-free answer. (3) *The sweep:* open app →
findings are already there → click into each → end knowing "nothing else is drifting."

**Also open (decide while iterating, or leave for the UX pass):** how the as-of date is entered; how
"spread" is displayed (measure is undefined in the spec); whether findings persist as seen/unseen
across sweeps or every sweep is a fresh look; any copy/export affordance for the Slack-reply moment.
