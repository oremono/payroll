# Product Brief — Salary Management for ACME HR

Scannable version. Full text unchanged in [`brief.md`](brief.md).

## The promise

**She never does salary arithmetic by hand again.**

It answers "how do we pay people?" by comparing each employee to their **peers** — same job, same
level, same country. It has no opinion about what a job *should* pay, because ACME has no market data
to ground that opinion in. It has a precise view of how ACME pays people relative to each other.

## The problem

10,000 employees. Multiple countries, multiple currencies, one spreadsheet lineage.

Data entry is dull, but dullness is not the cost. **Every question costs an afternoon:**

| She asks | Today |
| --- | --- |
| *Is this person in line with others doing their job?* | Filter, sort, eyeball, hope. |
| *Who has drifted out of line?* | No answer, unless she checks person by person. |
| *Who has not had a raise in two years?* | Unanswerable. The old numbers were overwritten. |
| *Are men and women paid differently for the same work?* | Possible by hand, never the same way twice. |

Hand-built answers are inconsistent. Inconsistent answers are not trusted, so they are not used. The
failure is quiet: something drifts, and a manager notices before she does.

## The solution, in six moves

1. **The spreadsheets come in.** She imports what she has. Role and level are a fixed taxonomy, not
   free text — "Sr. Engineer" and "Senior Engineer" are one job to her and two peer groups to a
   database. Unknown values are rejected and reported, **never guessed**. Guessing corrupts every
   median downstream in a way nothing later can detect.
2. **A record that keeps its own history.** Salary is a timeline, not a cell. Raises append. "What do
   we pay her?" and "how did we get here?" are both answerable. History stops there — no
   future-dating, no scheduled changes, no approval workflow.
3. **Peer comparison, computed.** Peers share role, level, and country. She sees the median, the
   spread, the distance. Because country is part of peer identity, peers always share a currency and
   exchange rates never enter the fairness math — structural, not a discipline to remember.
4. **Outliers, surfaced.** She does not go looking. People further than 20% from their peer median,
   above or below, come to her. She can widen the threshold when the list is longer than her
   afternoon.
5. **Pay equity, two ways.** Gender is sliced *within* a peer group, never part of it. Paired with an
   org-wide view of gender across levels, which catches the clustering the peer view structurally
   cannot.
6. **An answer she can trust, or none at all.** Below five peers, it declines. A gender gap needs five
   of *each* gender. Skewed groups are the norm, so **refusal is a common path, not an edge case**.

**The seed script is a design artifact.** The shape of the generated data decides whether the product
has anything to say. Outliers and thin groups are planted deliberately, so both detection and refusal
are demonstrable.

## Scope

**In:** employee records (role, level, country, currency, gender, hire date) · role and level as
seeded reference tables · append-only effective-dated salary history · create and edit via UI · bulk
import · peer comparison · outlier surfacing · gender gap within groups · gender across levels ·
country and org payroll totals · the minimum-group refusal · a 10,000-employee seed.

**Out, and why** — the five that matter most:

| Excluded | Reasoning |
| --- | --- |
| **Pay bands & compa-ratio** | Need a band grounded in market benchmark data ACME does not have. A compa-ratio against a made-up midpoint is precise, confident, and meaningless. Peer medians come from data that exists, so they are true statements about the population — and testable as such. |
| **Authentication & permissions** | Deferred, not dismissed. One named persona means no second role to model *yet*. This is the most sensitive table in the company, and auth is the first thing it needs before real data. |
| **Regression-based adjusted pay gap** | The peer group already controls for role, level, and geography. Regression adds machinery to reach where the schema already reaches. |
| **Equity, bonus, benefits** | Comp components are not interchangeable and vary sharply by country. A mixed bundle compared across countries is an invisible error. |
| **Cost-of-living adjustment** | A mobility concept, not a base-pay one. Using it to reason about pay is a documented mistake. |

Also out: merit cycles and budget modeling, EU pay transparency compliance, employee and manager
self-service, payroll execution. Reasoning for each in [`brief.md`](brief.md).

## Success criteria

- Every question above is answered in seconds, without a spreadsheet.
- The same question asked twice gives the same answer.
- The product declines when the data cannot support an answer — and shows why.
- Core logic covered by fast, deterministic unit tests. Fixed seed, no clock, no floating-point.
- The demo reveals judgment, not charts: a planted outlier found, a thin group honestly refused.

## Decisions worth arguing with

| Decision | Reasoning |
| --- | --- |
| Gender is `MALE` / `FEMALE` only | A deliberate simplification. The equity views compare two groups, and at peer-group scale a third value would sit below the reporting threshold nearly everywhere. **The cost is real:** the schema cannot represent an employee outside those two values. |
| Minimum peer group is 5; the gender gap needs 5 of *each* | Product judgments, not statistical results. |
| An outlier is >20% from the peer median, either direction, one finding | The 20% default is borrowed, not invented: employers police compa-ratio in an 80–120% corridor, and the peer median plays the role a band midpoint would. |
| Import rejects unknown roles per-row, never maps them | One bad row must not lose the import. Auto-mapping variants would be friendlier and occasionally wrong — and **a wrong match is invisible**. |

**Assumption to revisit first:** the sole user is the HR manager. The problem statement describes an
HR *team* managing the spreadsheets today. If the team are really users, authentication and roles move
from deferred to required.
