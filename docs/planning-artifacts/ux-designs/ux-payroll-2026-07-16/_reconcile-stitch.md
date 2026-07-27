# Reconcile — the mocks judged against the decisions

Scannable version. Full audit unchanged in [`reconcile-stitch.md`](reconcile-stitch.md).

**What this is.** After Stitch generated eleven screens, every screen was walked against the decision
log. Three questions per item: did the mock honor a decision, did it *invent* something, or does it
contradict a rule?

**Why it matters.** The mock was allowed to contribute ideas. It was not allowed to smuggle in
decisions.

## 1 · Decisions honored — 17 of 17

Every decision made before generation survived into the mocks. The ones worth naming:

- **Landscape-led Home** — findings are one region among several, not the whole page.
- **Contextual-only peer groups** — no sidebar entry on any of the 11 screens. "Peer Groups" appears
  only as a breadcrumb.
- **Fresh every sweep** — no acknowledgement, dismissal, or read-state affordance on any findings row.
- **Global as-of control** — `As of 16 Jul 2026` in the header of all 11 screens, grep-verified.
- **Refusal dignity** — the thin-group row uses a neutral hatch fill, not error styling. The
  gender-gap refusal names both counts: "6 men and 3 women."
- **Currency discipline** — every standalone salary carries its code. The USD aggregate is flagged
  "converted at rates pinned 01 Jul 2026."
- **Quiet amber** — grep-verified **zero** red-family classes or hexes in any screen.
- **No notifications** — no bell, inbox, toast, or alert affordance in any header or nav.
- **Exact boundary** — Settings carries the rule as UI copy: "19.9% does not flag and 20.1% does."

## 2 · What the tool invented, and the verdict on each

**Adopted** — ideas worth keeping:

| Idea | Why kept |
| --- | --- |
| **"nothing guessed"** in the import summary — *"9,947 imported · 53 rejected · nothing guessed"* | Perfect compression of CAP-1's hardest rule into three words. |
| **"a median would be noise dressed as an answer"** as refusal microcopy | Teaches *why* the tool refuses. The trust-building voice, exactly. |
| **Inline refusal rows inside the findings table** | Refusals surfaced in the sweep itself, not hidden behind a detail page. |
| **`/` to focus search**, with the hint in the placeholder | Cheap, discoverable, keyboard-first. |
| **Settings live impact preview** — "At 20%, 3 employees are outliers today." | Makes changing the threshold a sighted, deliberate act. |
| **Gender Insights framing caption** — clustering vs. within-group pay | Explains the CAP-8 / CAP-7 distinction in one sentence. |

**Dropped** — ideas that contradicted something:

| Idea | Why dropped |
| --- | --- |
| **"Review All" button** on the findings header | Implies a review/acknowledgement flow. Findings have no state — dealing with one means changing the salary. |
| **Employee headshot photos** | The data model holds no photo. Invented data the product cannot have. |
| **Amber badge on a sub-threshold distance** ("8% under peer median") | Breaks quiet-amber = outlier-only. 8% is below 20% and must render neutral. |
| **"scheduled compensation review"** wording | Nothing in the product is scheduled. Overdue is purely period-relative. |

## 3 · Decided but never drawn

The mocks did not cover everything committed. Named so nothing was assumed complete:

- **Dark mode** — zero dark renders. Stitch produced light only; the dark tokens were derived later
  and remain provisional.
- **Add/edit employee form** — entry points exist on two screens, but no form was ever mocked.
- **The copy-answer sentence format** — the button is present on two screens; the actual text with
  receipts is never spelled out.
- **The wound-back as-of state** — the control is on all 11 screens, but every one shows today.
- **Import pre-states** — only the post-import rejection report was mocked.

## 4 · Conflicts found

Grep-verified clean on the obvious checks: no "snapshot", no "Compa-ratio", no "Peer Groups" nav item,
no red styling, as-of on all 11 screens.

**What the greps missed — the one real defect.** The blurred backdrop behind the record-change modal
is a vocabulary-infection cluster:

- A `Comp-ratio: 0.98` badge — a SPEC non-goal that **evaded the grep because it is spelled
  "Comp-ratio", not "Compa-ratio."**
- Timeline columns **"Event Type"** and **"Approval"**, with values "Merit Increase", "Pending",
  "Approved by S. Lee" — merit cycles and approval workflows, both non-goals.
- A record marked **"Pending"** — implying scheduled changes, which the SPEC forbids.
- A timeline that **contradicts the canonical one** on the employee-detail screen.

The foreground modal — the actual subject of the screen — is fully compliant. The lesson is the
spelling: a verification grep is only as good as the exact string it looks for.

**Six smaller conflicts**, each logged with a fix: a generation label leaked into a page title
("the sweep (v3)"); a bell glyph on the Overdue nav icon; nav icons differing on every screen; a
rejection row rejecting on country when the SPEC mandates role/level only; a cross-screen outlier
count that says 3 on one screen and 4 on another; and a level taxonomy that uses L1–L8 on some screens
and IC2–IC6 on others.

None of these reached the code. All were caught here, on paper, before implementation.
