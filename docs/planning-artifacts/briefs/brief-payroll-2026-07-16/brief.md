---
title: "Product Brief: Salary Management for ACME HR"
status: final
created: 2026-07-16
updated: 2026-07-16
---

# Product Brief: Salary Management for ACME HR

## Executive Summary

ACME's HR manager is responsible for how 10,000 people across multiple countries get paid, and does the whole job in Excel. The spreadsheets hold the data well enough. What they cannot do is answer a question without her doing the arithmetic herself, by hand, differently every time.

This product is a system of record for salaries, and its reason for existing is a single promise: **she never does salary arithmetic by hand again.** It answers "how do we pay people?" by comparing each employee to their **peers** — same job, same level, same country. It has no opinion about what a job *should* pay, because ACME has no market data to ground that opinion in. It has a precise view of how ACME pays people relative to each other, which is the question she can act on.

## The Problem

Ten thousand employees, multiple countries, multiple currencies, one spreadsheet lineage. The data entry is dull, but dullness is not the real cost. The real cost is that **every question costs an afternoon**:

- *Is this person paid in line with the others doing their job?* Filter, sort, eyeball, hope.
- *Who's drifted out of line?* No answer, unless she goes looking person by person.
- *Who hasn't had a raise in two years?* Unanswerable — the old numbers were overwritten by the new ones.
- *Are we paying men and women differently for the same work?* Answerable in principle, by hand, and never the same way twice.

Because the answers are hand-built, they are also inconsistent — and inconsistent answers do not get trusted, so they do not get used. The failure mode is quiet: something drifts, she doesn't catch it, and a manager notices before she does.

## The Solution

**The spreadsheets come in.** Ten thousand rows do not get typed. She imports what she already has, and edits per-record thereafter. Role and level arrive as a fixed taxonomy rather than free text, because "Sr. Engineer" and "Senior Engineer" are the same job to her and two different peer groups to a database. A row whose role or level is not in the taxonomy is **rejected and reported, never guessed at** — guessing there would corrupt every median downstream in a way nothing later could detect.

**A record that keeps its own history.** Salary is a timeline, not a cell. Raises append; nothing is overwritten. "What do we pay her?" and "how did we get here?" are both answerable, and "who is overdue for a review?" becomes a query rather than an archaeology project. History stops there: no future-dating, no scheduled changes, no approval workflow, no retroactive correction.

**Peer comparison, computed.** Two employees are peers when they share **role, level, and country**. For any employee, she sees where they sit against their peer group — the median, the spread, the distance. This is the VLOOKUP, already done. Because country is part of peer identity, peers are always paid in the same currency and exchange rates never enter the fairness math — structural, not a discipline to remember. Conversion appears only in aggregate totals, where the rate is pinned, stamped, and disclosed.

**Outliers, surfaced.** She does not have to go looking. The people sitting far from their peer group come to her — further than 20% from their peer median, above or below, which she can widen when the list is longer than her afternoon.

**Pay equity, two ways.** Gender does not define a peer group — it is sliced *within* one. Men and women doing the same job at the same level in the same country are peers, and that is what makes the comparison possible. It is paired with an org-wide view of gender distribution across levels, which catches what the peer view structurally cannot: clustering.

**An answer she can trust, or none at all.** Below five peers, the product says so and declines to compare. The same rule applies one level down: a gender gap is reported only when *each* gender has five or more members in the group. Skewed groups are the norm, so this refusal is a common path, not an edge case.

**The seed script is a design artifact.** The shape of the generated data decides whether the product has anything to say. Outliers and thin peer groups are planted deliberately, so that both the detection and the refusal are demonstrable. (Distribution parameters: see addendum.)

## Scope

**In:** employee records with role, level, country, currency, gender, hire date · role and level as seeded reference tables · salary as append-only effective-dated history · create and edit employees and salary changes per-record via the UI · bulk import from spreadsheets · peer comparison against role + level + country · outlier surfacing · gender gap within peer groups · gender distribution across levels · org and country payroll totals · minimum-peer-group refusal · seed script for 10,000 employees.

**Out, and why:**

| Excluded | Reasoning |
|---|---|
| Pay bands & compa-ratio | The canonical comp metrics — compa-ratio, range penetration, market index, merit matrices — all require a band grounded in market benchmark data ACME does not have, and a 10,000-person org still on spreadsheets is not maintaining one. Inventing bands fabricates the domain's load-bearing input: a compa-ratio against a made-up midpoint is precise, confident, and meaningless. Peer medians are derived from data that actually exists, so they are true statements about the population — and testable as such. |
| Merit cycles & budget modeling | This is what comp *vendors* renew on, but it presumes an annual review process, a Finance-approved budget, and manager workflows. None exist in this problem. |
| Regression-based adjusted pay gap | The peer group already controls for role, level, and geography. Regression would add statistical machinery to reach a place the schema already reaches. |
| EU Pay Transparency compliance | Real and imminent for an org this size — but it presumes a regulator. This persona is self-directed and the cost of a wrong answer is an awkward Slack message, not a filing. Compliance-grade rigor would be scope bought with no buyer. |
| Employee & manager self-service | One user. Everything else is a different product. |
| Authentication & permissions | Deferred, not dismissed. A single named persona means there is no second role to model *yet* — but an HR team works alongside her, and this is the most sensitive table in the company. Auth is the first thing this needs before it touches a real salary record; it is out of scope here because the assessment names one user, not because the problem is absent. |
| Equity, bonus, benefits, total rewards | Comp components are not interchangeable and vary sharply by country. Base salary is one honest, comparable unit; a mixed bundle compared across countries is an invisible error. |
| Payroll execution | This is a salary *management* product. Money never moves. |
| Cost-of-living adjustment | Cost of living is a mobility concept, not a base-pay one. Using it to reason about pay is a documented mistake. |

## Success Criteria

- Every question in **The Problem** is answered in seconds, without a spreadsheet.
- The same question asked twice gives the same answer.
- The product declines to answer when the data cannot support one — and shows why.
- Core logic — peer grouping, medians, outliers, gap, thresholds, currency isolation — is covered by fast, deterministic unit tests. Fixed seed, no clock dependence, no floating-point roulette.
- The demo reveals the product's judgment, not just its charts: a planted outlier found, and a thin peer group honestly refused.

## Assumptions & Decisions

- **[ASSUMPTION]** The sole user is the HR manager. The problem statement describes an HR *team* managing the spreadsheets today but names the HR *manager* as the persona and intended user; this brief follows the persona. If the team are really users, authentication and roles move from deferred to required — this is the assumption to revisit first.
- **[ASSUMPTION]** Salary means base salary, annual, gross, in local currency. Currency is never implicit: every salary shown carries the currency it is denominated in.
- **[DECIDED]** Gender values are `MALE` and `FEMALE`. A deliberate simplification: the equity views compare two groups, and at peer-group scale any third value would sit below the reporting threshold nearly everywhere. The cost is real — the schema cannot represent an employee outside those two values.
- **[DECIDED]** The minimum peer group threshold is 5, and the gender gap requires 5 of *each* gender within the group. Both are product judgments, not statistical results.
- **[DECIDED]** An outlier is an employee more than 20% from their peer median, above or below — one finding, not two. The threshold is user-adjustable; 20% is the default. Distance is a percentage rather than standard deviations, quartiles, or percentile rank, because peer groups are small by construction and every distribution-fitting method is unreliable at that size — an SD from five points is noise, and the bottom decile of eight people is less than one person. The 20% default is borrowed, not invented: employers police compa-ratio within an 80–120% corridor, and the peer median plays the structural role a band midpoint would.
- **[DECIDED]** Role and level are seeded reference tables, not free text.
- **[DECIDED]** Bulk import rejects rows with unknown role or level rather than mapping them, per-row rather than per-file — a single bad row does not lose the import. Mapping variants automatically would be friendlier and occasionally wrong, and a wrong match is invisible.
