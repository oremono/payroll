# Method — how the work was done

This project was built with AI doing most of the typing. This document is the account of how, and of
what kept the quality from drifting.

## The problem with building this way

Ask an AI agent to build a feature and you usually get working code. Ask it for fifty features across
three weeks and you get something worse than bad code: **code that disagrees with itself.**

Two sessions, both obedient, implement "the median" differently. A rule agreed on in week one is
quietly forgotten in week three. Tests get written after the code, so they describe what was built
rather than what was wanted — and they pass, which is the problem.

None of that is a prompting failure. It is what happens when intent lives in a conversation instead
of in a file.

## The method

I used **BMAD** — an open framework of agent skills, one for each stage of building software: work
out the requirements, write the spec, design the UX, design the architecture, break it into stories,
implement, review.

The shape is what matters, and it is unusual:

**Instead of one long conversation, the work runs as a chain of narrow passes.** Each stage is a
separate skill with its own inputs and its own structured output. Each stage writes a file. **That
file is the next stage's input.**

Three consequences:

1. **Intent stops being conversational.** "A peer group is role + level + country" is a line in a
   committed spec, not something said once in a chat. Later stages cite it; they cannot forget it.
2. **Every stage is auditable.** You can read what the architecture stage was given and what it
   produced. Both are in this repo.
3. **Constraints accumulate forwards.** By the time an agent writes code, it inherits a spec, an
   architecture, a set of standing rules, and a story-specific brief — all written before it started.

That is the whole idea: **an agent is only as good as what it cannot do.** The method's job is to
narrow the space before generation begins.

## The stages, and what each produced

Everything in the right-hand column is committed to this repo.

| Stage | What it did | Output | Skill |
| --- | --- | --- | --- |
| **1. Requirements** | Interrogated the problem, ran web research on real compensation tools, decided scope and exclusions | [`brief.md`](planning-artifacts/briefs/brief-payroll-2026-07-16/brief.md) | `bmad-product-brief` |
| **2. Spec** | Distilled the brief into a machine-readable contract: 11 capabilities, each with a testable success criterion | [`SPEC.md`](specs/spec-payroll/SPEC.md) | `bmad-spec` |
| **3. UX** | Defined how it behaves and how it looks, *before* any visual mock existed | [`EXPERIENCE.md`](planning-artifacts/ux-designs/ux-payroll-2026-07-16/EXPERIENCE.md), [`DESIGN.md`](planning-artifacts/ux-designs/ux-payroll-2026-07-16/DESIGN.md) | `bmad-ux` |
| **4. Visual mocks** | Generated 11 screens from a written handoff prompt, then audited them against the decisions | [11 mocks](planning-artifacts/ux-designs/ux-payroll-2026-07-16/imports/stitch/), [`reconcile-stitch.md`](planning-artifacts/ux-designs/ux-payroll-2026-07-16/reconcile-stitch.md) | Google Stitch |
| **5. Architecture** | Fixed the invariants every later unit must obey, and wrote down what each cost | [`ARCHITECTURE-SPINE.md`](planning-artifacts/architecture/architecture-payroll-2026-07-17/ARCHITECTURE-SPINE.md), [`TRADE-OFFS.md`](planning-artifacts/architecture/architecture-payroll-2026-07-17/TRADE-OFFS.md), [`C4-MODEL.md`](planning-artifacts/architecture/architecture-payroll-2026-07-17/C4-MODEL.md) | `bmad-architecture` |
| **6. Attack it** | Tried to break the architecture *before* code existed | [7 review passes](planning-artifacts/architecture/architecture-payroll-2026-07-17/reviews/) | `bmad-review-adversarial-general` |
| **7. Standing rules** | Compressed everything binding into 8 laws every future session inherits | [`project-context.md`](project-context.md) | `bmad-generate-project-context` |
| **8. Breakdown** | Split the capabilities into 12 epics, backend story then frontend story | [`epics.md`](planning-artifacts/epics.md) | `bmad-create-epics-and-stories` |
| **9. Readiness gate** | Checked the specs were complete enough to build from | [readiness report](planning-artifacts/implementation-readiness-report-2026-07-17.md) | `bmad-check-implementation-readiness` |
| **10. Story briefs** | Wrote one detailed brief per story — the actual prompt the coding agent receives | ~40 files in [`implementation-artifacts/`](implementation-artifacts/) | `bmad-create-story` |
| **11. Implementation** | Executed each story brief, test-first | The code | `bmad-dev-story`, `bmad-dev-auto` |
| **12. Review** | Reviewed each change adversarially, from three angles at once | [`deferred-work.md`](implementation-artifacts/deferred-work.md) | `bmad-code-review` |
| **13. Course correction** | Handled a requirement that turned out to be unbuildable as written | [change proposal](planning-artifacts/sprint-change-proposal-2026-07-18.md) | `bmad-correct-course` |

**Nothing was coded before stage 10.** Stages 1–9 produced only documents.

## How TDD survived contact with an agent

This is the part worth scrutinising, because "the AI wrote tests" is easy to claim and usually means
tests written after the fact.

**Three mechanisms, in increasing order of how much I trust them.**

### 1. The rule is in every prompt

[`project-context.md`](project-context.md) is injected into **every** coding session. Law 1:

> *"**TDD — no production code without a failing test first.** Red → green → refactor, always in that
> order. Write the failing test, watch it fail for the right reason, then write the minimum code to
> pass. … **CI cannot prove ordering, so honor it in your commit sequence.**"*

That last clause matters. The prompt tells the agent what is *not* mechanically checked, rather than
implying everything is.

### 2. The task list is written as test/code pairs

Each story brief lists its work as pairs, in order. An agent that implements first has visibly
departed from its own task list. From the peer-comparison story:

> - `tests/domain/statistics.test.ts` + `src/domain/statistics.ts` — **test-first, then implement**
>   `median(...)` and `spread(...)`
> - `tests/domain/peer-comparison.test.ts` + `src/domain/peer-comparison.ts` — **test-first, then
>   implement** `distancePctTenths` … and `comparePeers(...)`
> - `tests/application/peer-comparison.test.ts` + `src/application/use-cases/peer-comparison.ts` —
>   **test-first against fake ports**, then implement
> - `tests/integration/peer-comparison.test.ts` — **against real Postgres 18**: prove the population
>   read groups by the exact triple … the median/spread/distance are computed in TS over real rows

Note the last line. Integration tests were specified against a **real disposable database, never a
mock** — because the thing most worth testing at that seam is whether the ORM and the schema actually
agree, and a mock cannot fail that way.

### 3. The gates do not care what the prompt said

The first two are discipline. This one is mechanical, and it is the one that actually holds.

| Gate | What it proves |
| --- | --- |
| **Coverage floor** — 100% domain, 90% application | No untested branch reached the core |
| **Mutation testing** over the domain | The tests would have *caught* a change, not merely executed the line. A surviving mutant is by definition a line no test pins down. |
| **Integration suite** against real Postgres 18 | The schema's guarantees hold in reality |
| **Import-boundary lint** | The pure core never touched the database, the clock, or randomness |
| **axe accessibility pass** | WCAG 2.2 AA holds on every surface |

**A failing gate blocks the merge.** None of them know or care whether a line was typed or generated.

Mutation testing is the sharpest of these. Coverage proves a line ran. Mutation deliberately breaks
the code and checks that some test notices — which is the only automated way to ask whether tests are
real.

## The prompts

Because every prompt is a committed file, they can be read rather than described.

### The standing rules

[`project-context.md`](project-context.md) opens by establishing that it outranks anything downstream:

> *"A per-story file briefs you on one story; **this file is the law you inherit regardless**. If a
> story instruction ever contradicts a Law below, stop and surface it; do not silently follow the
> story."*

It ends with an explicit list of forbidden patterns, because stating a rule positively is not enough:

> ❌ `new Date()` / `Date.now()` anywhere in the pure core
> ❌ `percentile_cont` / `AVG` / window functions for any user-facing statistic
> ❌ A second median, second current-salary resolver, or second verdict sentence
> ❌ Float for money or FX
> ❌ Widening a peer group below `n ≥ 5`

### A story brief

Each of the ~40 story files has four parts: intent, boundaries, test-first tasks, acceptance
criteria. The boundaries are written as prohibitions:

> *"Exactly ONE median: sort ascending by integer minor units; odd `n` → middle; even `n` → mean of
> the two middle, rounded half-up. Reuse the ONE current-salary resolver — **write no second
> `ORDER BY`**."*
>
> *"Distance is signed for display, exact for arithmetic: computed over `bigint` minor units (**never
> IEEE double**), magnitude rounded half-up to ONE decimal, then the sign reapplied. **The number
> shown is the number judged.**"*

And the acceptance criteria are Given/When/Then, so "done" is checkable rather than asserted:

> *"Given a peer group with fewer than 5 in-population employees, when `getPeerComparison` runs, then
> it returns `kind: 'refusal'`, `counts.n` = the group size, and a verdict naming that count; **the
> group is never widened and nothing throws.**"*

### The adversarial brief — the one that paid for itself

Before any code, the architecture was handed to a review pass with a falsification instruction rather
than "review this":

> *"The spine's job is to make independently-built units one level down compose without negotiation.
> The test applied here is the only one that matters: **construct pairs of features that each obey
> every rule to the letter and still build incompatibly.** A pair that survives is a hole."*

It built 18 such pairs. Five were critical. The headline finding:

> *"**AD-5 as written cannot flag an underpaid employee** … in the very rule authored to prevent that
> class of divergence."*

The rule said distance is `(salary − median) / median`, flagged with `>`. But `−25.2 > 20` is false —
so a literal implementation would have silently dropped **every underpaid finding**, and the demo
would still have looked fine, because the overpaid ones still show.

It also collapsed six separate findings into one root cause:

> *"the spine specifies **how** every number is computed and never specifies **over what set**."*

Both were fixed in a document, for the cost of a document.

### Code review, three lenses at once

Reviews ran three adversarial passes in parallel rather than one general one:

| Layer | Looks for |
| --- | --- |
| **Blind Hunter** | What the author could not see, reviewing without their framing |
| **Edge Case Hunter** | Every branch and boundary, exhaustively |
| **Acceptance Auditor** | Whether the acceptance criteria are actually met, not approximately met |

Findings were triaged into fix-now, defer-with-reason, or reject. Deferrals landed in
[`deferred-work.md`](implementation-artifacts/deferred-work.md) with reasoning — which is why that
file also records conclusions I reached, acted on, and later found were wrong.

## Running it unattended

Later stories ran through an orchestrator that executes a story brief, runs a **separate** review
session with fresh context, and commits — without me watching.

An author reviewing their own work in the same context is not a review, so the review is a different
session that has not seen the reasoning.

Its budget is declared in a config file, and the limits are the interesting part:

| Limit | Value | Effect |
| --- | --- | --- |
| Dev attempts per story | 2 | Two tries, then stop and escalate to a human |
| Review cycles | 3 | Review cannot loop forever |
| Session timeout | 90 min | A hung session is killed, not waited on |
| Human gate | every epic | A checkpoint at each epic boundary |

**Bounded autonomy, not unattended trust.** The loop is allowed to fail and stop; it is not allowed
to grind.

## What it cost

Stated because it is visible in the commit history, and because a method described only by its wins
is not a method description.

**A clean unattended run squashes an entire story into one commit.** Twenty stories are a single
*"implemented and reviewed via bmad-loop"* commit carrying tests and implementation together — so for
those, **the red-before-green ordering is not visible in the history**, even though the story briefs
show it was specified.

The inversion is uncomfortable and worth saying plainly:

> The stories that **kept** the clearest red/green trail are the ones that went **wrong** — their
> per-step commits survived a timeout and were recovered by hand. The runs that went right are the
> ones that erased the evidence.

This was caught mid-project and written into `deferred-work.md` rather than papered over by rewriting
history. CAP-1 is the worked example in the [README](../README.md) precisely because its trail
survived.

## Who decided what

| I decided | AI executed |
| --- | --- |
| The 11 capabilities and every exclusion | Drafting each artifact from the previous one |
| A peer group is 5 people; an outlier is 20%; gender is two values | Generating tests and implementations from the story briefs |
| Which mock ideas to adopt and which to drop | The 11 screen mocks |
| Postgres over SQLite; Prisma over Drizzle; TypeScript 5.9 over 7.0 | Finding the 18 divergence pairs |
| What "done" means for every story | Reviewing the code three ways |

Everything in the left column was **written down and committed before any code existed.**

## The short version

Generated code proposes. Something mechanical disposes.

The prompts state intent, and intent alone does not survive a hundred sessions. What survives is a
spec that later stages must cite, a set of laws every session inherits, and a row of CI gates that
are indifferent to how a line of code came to be.
