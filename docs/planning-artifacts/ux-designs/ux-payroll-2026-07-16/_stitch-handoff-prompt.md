# Stitch design-handoff prompt

Scannable version. **The verbatim prompt is in
[`stitch-handoff-prompt.md`](stitch-handoff-prompt.md)** — read that one if you want the actual text.

Given to [Google Stitch](https://stitch.withgoogle.com/projects/17248335032802531831) on 2026-07-16,
before any code existed. Many rounds of iteration followed.

## Why it is worth keeping

**It fixes what was already decided.** Persona, product personality, the trust texture, the exact UI
vocabulary, nine screens, three flows — all settled in the brief and SPEC first, then restated so the
tool could not drift.

**It marks eight questions `[OPEN]` and hands them over.** These were genuinely undecided, so the tool
was asked to propose:

1. The front door's shape — a *verdict* or a *landscape*
2. Whether the overdue list lives on Home or its own screen
3. Where the threshold control belongs
4. How the as-of date is entered
5. How "spread" is displayed
6. Whether findings persist as seen/unseen, or every sweep is fresh
7. The copy/export affordance
8. Preset chips vs. a free date input for the overdue period

All eight were resolved afterwards and folded into `EXPERIENCE.md` and `DESIGN.md`.

**The output was never built 1:1.** The mocks were a way to *see* the product before committing to
it. What survived is recorded in [`_reconcile-stitch.md`](_reconcile-stitch.md).

## What the prompt actually specified

| Section | Contents |
| --- | --- |
| **Product** | A desktop web app for exactly one user: Alice, HR manager of a 10,000-person company. Replaces Excel. **A knowing tool, not a compliance or workflow tool** — no approvals, no other users, nothing ever nags. Findings wait quietly until she shows up. |
| **Personality** | Calm, precise, honest, unhurried. A well-set financial broadsheet, not a spacious consumer dashboard. **Numbers are the protagonists.** No decorative illustration, no mascot energy, no alarmist styling — an outlier is a quiet firm flag, not a siren. |
| **Trust texture** (flagged *most important*) | Provenance near every number. No salary without its currency. No comparison across currencies. **Refusal is a first-class designed state, not an error** — under five peers it names the count and stops. |
| **Vocabulary** | The exact words to use in the UI, listed. Gender is `MALE` / `FEMALE` only. |
| **Screens** | Nine, each with its purpose and its `[OPEN]` questions. |
| **Flows** | Three: Maintenance (~30 seconds), Someone-Asked (one quotable answer), The Sweep (unprompted drift check). |

## The one line that summarizes the method

Constrain what you have decided. Delegate only what you have not.
