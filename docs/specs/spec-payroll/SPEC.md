---
id: SPEC-payroll
companions:
  - ../../planning-artifacts/briefs/brief-payroll-2026-07-16/addendum.md
  - ../../planning-artifacts/architecture/architecture-payroll-2026-07-17/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/ux-designs/ux-payroll-2026-07-16/EXPERIENCE.md
  - ../../planning-artifacts/ux-designs/ux-payroll-2026-07-16/DESIGN.md
sources:
  - ../../planning-artifacts/briefs/brief-payroll-2026-07-16/brief.md
  - ../../../Incubyte THA.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Salary Management for ACME HR

## Why

A pain to solve. ACME's HR manager owns how 10,000 people across multiple countries are paid, and does it in Excel. The spreadsheets store the data adequately; what they cannot do is answer a question without her computing it by hand, differently each time. Every question costs an afternoon, answers are inconsistent, and inconsistent answers stop being trusted. She is self-directed — no CFO or regulator forces the questions; the failure mode is quiet drift she doesn't catch until a manager does. This product exists so she never does salary arithmetic by hand again.

## Capabilities

- **CAP-1**
  - **intent:** HR manager can bulk-import employees and their current salaries from a spreadsheet.
  - **success:** A file of valid rows lands in full. A row whose role or level is absent from the reference tables is rejected and reported with its reason; the remaining valid rows still import. No row is ever mapped or guessed into a taxonomy value.

- **CAP-2**
  - **intent:** HR manager can create and edit an employee record individually.
  - **success:** A created or edited employee persists with role, level, country, gender, and hire date; role and level are selectable only from the reference tables.

- **CAP-3**
  - **intent:** HR manager can record a salary change for an employee.
  - **success:** The change appends a new effective-dated record. Prior records remain readable and unmodified. Current salary resolves to the latest record with `effective_from` on or before today.

- **CAP-4**
  - **intent:** HR manager can see an employee's full salary timeline.
  - **success:** Every salary record for that employee is listed with its effective date and its currency, ordered in time.

- **CAP-5**
  - **intent:** HR manager can see where an employee sits relative to their peers.
  - **success:** For a peer group of 5 or more, the view reports the group median, spread, and this employee's distance from the median, all in the group's single currency. Below 5, it reports an explicit refusal naming the peer count rather than a computed comparison.

- **CAP-6**
  - **intent:** HR manager is shown employees sitting far from their peer group without going looking for them, and can adjust how far "far" is.
  - **success:** Employees whose salary differs from their peer median by more than a threshold percentage — in either direction, one finding — are surfaced unprompted, each with the group they were judged against, that group's size, and their distance from its median. The threshold defaults to 20% and is adjustable by the user. Given a fixed threshold the result is reproducible, and the boundary is exact: 19.9% does not flag, 20.1% does.

- **CAP-7**
  - **intent:** HR manager can see whether men and women are paid differently for the same work.
  - **success:** For a peer group holding 5 or more of each gender, the gap between male and female medians within that group is reported. When either gender is under 5, the view refuses and says which, rather than comparing against a median of one.

- **CAP-8**
  - **intent:** HR manager can see how gender is distributed across levels org-wide.
  - **success:** Gender counts per level are reported across the organization, revealing clustering that CAP-7 is structurally blind to because it holds level constant.

- **CAP-9**
  - **intent:** HR manager can see what the organization spends on salary.
  - **success:** Per-country totals report in local currency with no conversion. Any org-wide total that spans currencies displays the conversion rate used and the date it was pinned to.

- **CAP-10**
  - **intent:** HR manager can find employees who have not had a salary change in a given period.
  - **success:** Given a period, the employees whose most recent salary record predates it are listed with the date of that record.

- **CAP-11**
  - **intent:** The system can be populated with 10,000 employees whose data exercises every capability above.
  - **success:** A single command produces 10,000 employees from a fixed seed, reproducibly. The generated population contains peer groups that support comparison, peer groups too thin to (exercising CAP-5's refusal), employees far from their medians (exercising CAP-6), peer groups with a within-group gender gap and enough of both genders to report it (exercising CAP-7), and gender clustering across levels (exercising CAP-8). Distribution parameters: see companion `addendum.md`.

## Constraints

- A peer group is employees sharing the same role, level, and country. Nothing else defines one.
- Distance from a peer median is measured as a percentage, not in standard deviations, quartiles, or percentile ranks. Peer groups are small by construction — n≥5, typically under ten — and every distribution-fitting method is unreliable at that size. A percentage is stable at any n and says what it means.
- Being underpaid and being overpaid are the same finding: outlier detection is symmetric and direction-agnostic.
- Gender is sliced within a peer group and is never part of peer identity — men and women doing the same job at the same level in the same country are peers. This is what makes CAP-7 computable without regression.
- No comparison crosses a currency. Because country is part of peer identity, this holds structurally rather than by discipline.
- Currency conversion appears only in aggregate totals spanning countries, never in a comparison between people. The rate is pinned to a date and displayed wherever a converted figure is.
- No salary is ever overwritten. Salary is an append-only effective-dated series. No future-dating, no scheduled changes, no approval workflow, no retroactive correction.
- Below threshold, refuse — never widen the peer group. Widening across countries would reintroduce currency into the fairness math.
- Role and level are seeded reference tables. Free text is not accepted anywhere, including import.
- Gender values are `MALE` and `FEMALE`.
- No salary is ever displayed without its currency.
- The same question asked twice returns the same answer. Every answer is a function of the data and an as-of date, never of the moment it was asked. The as-of date is supplied, not read from the system clock — CAP-3 resolves current salary against it, and it is what lets the same query be reproduced and tested.
- Backend is Node/TypeScript over a relational database. UI is React or Next.js. The product is deployed and demonstrable.
- Core logic — peer grouping, medians, outliers, gap, thresholds, currency isolation — is covered by unit tests that are fast and deterministic: fixed seed, no dependence on the wall clock.

## Non-goals

- **Pay bands, compa-ratio, range penetration, market index, merit matrices.** All require a band grounded in market benchmark data ACME does not have.
- **Merit cycles and budget modeling.** Presume an annual review process, an approved budget, and manager workflows that do not exist here.
- **Regression-based adjusted pay gap.** The peer group already controls for role, level, and geography.
- **EU Pay Transparency compliance.** Presumes a regulator; this persona is self-directed.
- **Employee and manager self-service.** One user.
- **Authentication and permissions.** Deferred, not dismissed — required before this touches a real salary record.
- **Equity, bonus, benefits, total rewards.** Base salary is the one comparable unit.
- **Payroll execution.** Money never moves.
- **Cost-of-living adjustment.** A mobility concept, not a base-pay one.

## Success signal

The HR manager opens the product, sees which employees need attention, and acts on a number she did not compute and does not re-derive. Demonstrable end to end: a planted outlier is surfaced without being searched for, and a thin peer group is refused out loud rather than answered with a median of one.

## Assumptions

- Employee attributes are role, level, country, currency, gender, hire date, and an identifying name. The source brief does not enumerate an exhaustive field list.
- Currency is determined by country. **Settled by the architecture spine (AD-6):** currency is stored on each salary record, written from the employee's country at write time and validated against it, so immutable history keeps its own currency and reads never re-resolve it.
- Salary means base salary, annual, gross, in local currency.
- The sole user is the HR manager. The source problem statement describes an HR *team* managing the spreadsheets today but names the HR *manager* as the persona and intended user. If the team are users, authentication moves from deferred to required.

## Open Questions

None open. The one that stood — the undefined UI surface — is resolved by the UX pass (companions `EXPERIENCE.md` and `DESIGN.md`): the sidebar IA and per-capability surfaces for CAP-1 through CAP-10 are specified, and CAP-6's threshold control lives in Settings, a deliberate act kept off the sweep. The five items UX flagged to architecture, and the currency-storage question above, are settled in companion `ARCHITECTURE-SPINE.md` (AD-6 through AD-10).
