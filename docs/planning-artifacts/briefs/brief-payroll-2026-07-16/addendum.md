---
title: "Addendum: Salary Management for ACME HR"
status: draft
created: 2026-07-16
updated: 2026-07-16
---

# Addendum

Depth captured during the brief conversation that belongs downstream (PRD / architecture / data model) rather than in the 1–2 page brief itself.

## Seed design parameters

The brief states that the seed script is a design artifact; these are the parameters behind that claim. The shape of the generated data decides whether the product has anything to reveal — random draws from a single distribution produce a demo where every peer group looks alike and no question has an interesting answer.

- **Log-normal within each peer group, not normal.** Real salary distributions are right-skewed: a floor below, a long tail above. Normal draws produce symmetric data where mean ≈ median and nothing separates them — which erases a distinction the product should be able to show her.
- **Country differentials as cost-of-labour multipliers** applied to a role/level base. Cost of *labour*, not cost of living (see the research digest below — this distinction is the most-repeated point in the literature). Makes the multi-currency story visible rather than theoretical.
- **Level progression of ~15–20% per level**, so the ladder stays coherent and no Level 4 systematically out-earns a Level 5 (the level-inversion failure Carta applies explicit sanity rules to prevent).
- **Planted outliers** — a few individuals well above and below their peer median, with plausible backstories (a retention counter-offer; a long-tenured person never adjusted). Without these the outlier view finds nothing and the demo is silent.
- **Deliberately thin cells** — a handful of role × country combinations holding 1–3 people, so the below-threshold refusal path is demonstrable. Density elsewhere is engineered so that the n ≥ 5 threshold never starves the demo.
- **Two distinct gender effects**, because they are different questions and different views catch them:
  1. *Within-peer gaps* in some cells — women paid less at the same role, level, country. This is pay **practice**; the peer view finds it.
  2. *Clustering* — women disproportionately at lower levels. This is workforce **shape**, and the peer view is structurally blind to it because it controls level away. Only the org-wide distribution view catches it.
- **Gender balance must satisfy the gap sub-threshold where it matters.** A gap is only reported when each gender has ≥5 members in the peer group, so the cells carrying planted gaps need ≥5 men *and* ≥5 women — i.e. ≥10 people, balanced. Seeding a gap into a cell of 8 that happens to run 7:1 produces a refusal, not a finding, and the demo shows nothing. Note the tension with clustering (effect 2): clustering deliberately skews gender by level, and skew is what starves the sub-threshold. Seed the two effects into *different* cells so they do not cancel each other out.

Grid sizing worth checking against the threshold: ~25 roles × 6 levels × 8 countries = 1,200 cells for 10,000 employees, averaging ~8 per cell. The average lies — the distribution will be lumpy, and unplanned cells of one will occur unless density is deliberately engineered.

## Comp-analytics domain research (2026-07-16)

Web research digest grounding what real comp tools (Pave, Figures, Carta Total Comp, Salary.com CompAnalyst, Ravio, Workday, Deel) actually answer. Retained here because it drives data-model decisions and the scope/exclusion reasoning.

### Core metric definitions

All of these hang off one object: a **pay band** carrying `min`, `midpoint`, `max` — and a currency.

| Metric | Formula | Answers |
|---|---|---|
| **Compa-ratio** | `salary ÷ range midpoint` (×100) | Where is this person relative to the rate we decided the job is worth? Policed within an 80–120% corridor. |
| **Range penetration** | `(salary − min) ÷ (max − min)` | How far through the band has this person progressed? 0% = floor, 100% = ceiling. |
| **Range spread** | `(max − min) ÷ min` | How wide is the band? Typically 40% admin, 50% professional, 50–65% executive. |
| **Midpoint progression** | `(higher midpoint − lower midpoint) ÷ lower midpoint` | Is the ladder coherent? 5–10% admin, 10–15% professional, 15–20% exec. Breaks into level inversions when bands are built per-country from thin data. |
| **Market index** | `salary ÷ market benchmark rate` | Distinct from compa-ratio: compa-ratio measures against *our policy*, market index against *the market*. If midpoints go stale, compa-ratio looks healthy while market index rots. |

Compa-ratio and range penetration are **not** linearly related — 100% compa-ratio equals 50% range penetration only in a symmetric range.

Directionality that matters for the data model: **midpoint is set first** from market data (e.g. P50 of benchmark), and min/max are *derived from it* via the target spread. The band is not `(min+max)/2` in practice; min/max descend from the midpoint.

Percentile targeting (P25/P50/P75) can vary **per comp component** — e.g. P75 salary, P25 equity (Carta). Real requirement, not a detail.

### Pay equity: adjusted vs unadjusted

The single most important distinction in the equity view:

- **Unadjusted (raw) gap** — mean/median difference between demographic groups, no controls. Measures workforce *shape* (are women clustered in lower grades?). Tells you **where to look**.
- **Adjusted gap** — residual after regressing pay on legitimate factors (grade, tenure, location, performance, job family). Measures *pay practice*. Tells you **where the risk is**. Industry standard is **log-linear regression** (log of pay as dependent variable, so coefficients read as % effects).

Shipping only one is a known failure mode. Gap analysis must run **within comparable groups** — a global unadjusted gap across countries mostly measures geography, not gender.

### Multi-country / multi-currency — the central modeling decision

**The standard approach is NOT "normalize everything to USD and compare."** The dominant model is **bands per country (or geo tier), built from local-market data, each employee evaluated against their own local band in their own currency** — so compa-ratio is computed entirely within a currency and **FX never enters the fairness math**. Currency is an attribute of the *range* (Workday), not a global setting.

Three org-level strategies (Ravio's framing):
- **Location-based** — location-specific benchmarks per market. Most common at large multi-country scale.
- **Hybrid** — one anchor location's band plus a per-location multiplier. Pave anchors to "Tier 1" (SF/NYC/LA/Seattle), 32 countries and 33 US metros. Fewer bands to maintain; the multiplier becomes the contested artifact.
- **Location-agnostic** — one global band. Simple, expensive, rare at 10k scale.

**Cost of labor, not cost of living.** Sharpest repeated point in the literature. Cost of *living* = basket of goods an individual buys (driven by inflation). Cost of *labor* = what an employer must pay to hire/retain in a talent market (driven by labor supply/demand). ~89% of companies use salary surveys (cost of labor) as the basis for geo differentials; using COL indices to set core pay is explicitly advised against — COL belongs to mobility/relocation, not base-pay structure. ~60% use individual-city granularity. (SHRM figures via snippet — directional.)

**Where FX legitimately enters:** aggregate reporting and budget rollup only. You cannot sum payroll across 20 currencies without converting. The attested pattern is **pin a rate, stamp it, disclose it** — Pave's published cross-country research converts to USD "using exchange rates as of April 10, 2023."

### Known pitfalls (highest-value list for scope reasoning)

- **Converting everyone into an HQ range destroys the metric.** Compa-ratio stops being a fairness tool and becomes a finance exercise; FX moves manufacture phantom compa-ratio drift — a person's compa-ratio changes while neither their pay nor their local market moved. **The #1 modeling trap.** (Deel)
- **Rate-snapshot ambiguity.** Unpinned rates mean the same report run twice gives different answers and prior-cycle comparison is meaningless. Merit cycles need a *frozen* cycle rate for planning, separate from live rates for reporting, plus a policy for drift between freeze and payout.
- **Salary denominated in the wrong currency.** Pay set in the company's home currency makes employees abroad feel a pay cut when their local currency strengthens, and hands the employer unbudgeted spend in volatile-currency markets.
- **Gross salary is not comparable across countries.** Portugal and Guatemala mandate a 14th-month payment atop the 13th; employer social contributions, CBAs, and statutory benefits vary enormously. Like-for-like unit is *full cost of employment*, or at minimum an explicitly-defined consistent component set.
- **Component-set drift.** Total cash comp (base + STI), total direct comp (+ annualized equity), and total remuneration are not interchangeable; equity norms differ sharply by country. A "salary" comparison silently comparing different bundles is a common invisible error.
- **Thin data per country cut.** 10k employees sliced by country × job family × level yields cells too small to benchmark. Hence Ravio's per-benchmark confidence thresholds and Carta's cross-level sanity rules ("never pay a Level 4 more than a Level 5"). **A product must be able to say "not enough data here" rather than emit a confident wrong number.**

### Load-bearing vs nice-to-have

Load-bearing (every serious product answers these):
1. **What is this job worth?** — market pricing / job matching / leveling at a chosen percentile. Everything downstream is invalid if job matching is wrong. Ravio does job mapping *manually with humans* during onboarding precisely because it's load-bearing.
2. **Is this person paid correctly relative to that?** — compa-ratio, range penetration, market index, in/out-of-band.
3. **Who is broken right now?** — outliers: below-min (green-circled), above-max (red-circled), new-hire-vs-incumbent compression.
4. **Can we afford the cycle, and did we stay in budget?** — merit matrix + budget modeling + rollup against Finance's number.
5. **Are we legally exposed?** — adjusted pay gap, regression, EU Pay Transparency.

Nice-to-have: total-rewards statements, equity refresh modeling, offer generation, live data freshness, AI job matching, multi-scenario comparison.

**Key asymmetry:** vendors *market* on #1 (data quality) and AI, but customers *renew* on #4 (merit cycle shipped on time). Pave's own positioning — "deliver merit cycles on time and on budget" — is the tell.

**Merit matrix** — 2-D grid of performance rating × band position (compa-ratio bucket, e.g. <0.9 / 0.9–1.1 / >1.1); each cell holds a recommended increase %. Self-correcting by design: high performers low in band get the biggest bump, high-compa-ratio employees get throttled regardless of rating, pulling the population toward midpoint over time. 2026 US merit budgets ~3.5–4.2% of payroll; top performers 5–6%, average 2–3%.

**Outlier detection is two distinct things** often conflated: *employee* outliers (people outside their band) and *data/band* outliers (nonsense in the benchmark itself).

### Regulatory forcing function

**EU Pay Transparency Directive.** Employers ≥100 employees report median gender pay gap, gap in variable components, and gender distribution across quartile pay bands. A gap ≥5% **in any category of workers** that can't be justified on objective gender-neutral grounds and isn't corrected within six months triggers a mandatory **joint pay assessment with employee representatives**. Employers ≥150 file first reports by **7 June 2027**; member-state transposition deadline was **June 2026**.

Consequences for a 10k multi-country employer: "categories of workers" (equal-work groupings) becomes a **first-class modeling object**, and quartile-distribution-by-gender becomes a **required view, not an optional one**. Note the timing against today (2026-07-16): transposition has just passed, first filing is ~11 months out.

### Confidence notes

- Metric formulas: **high confidence**, multiple independent sources incl. vendor product docs (Dayforce is primary).
- Geo-differential stats (89%, 60%): SHRM via search snippet, underlying survey not read — **directional only**.
- **Weakest area: FX snapshotting as a named product feature.** The *practice* is well-attested (Pave dating conversion rates; Workday attaching currency to the range) and the *pitfalls* are well-attested, but largely via global-payroll vendor blogs rather than comp-analytics product docs. No explicit documentation found for how Pave/Figures/Ravio freeze an FX rate for a merit cycle. Worth a direct vendor-doc check if this mechanic becomes load-bearing.
- Ravio pages returned HTTP 429 on direct fetch; Ravio claims come from search snippets of their own pages.

### Sources

Dayforce ([compa-ratio & range penetration formulas](https://help.dayforce.com/r/documents/Compensation-Guide/How-Compa-Ratio-and-Range-Penetration-Are-Calculated)) · ADP ([compa-ratio](https://www.adp.com/resources/articles-and-insights/articles/c/compa-ratio.aspx)) · AIHR ([compa-ratio](https://www.aihr.com/blog/compa-ratio/)) · Deel ([compa-ratio, incl. HQ-range/FX critique](https://www.deel.com/blog/compa-ratio-calculation-and-use-guide/), [FX in payroll](https://www.deel.com/blog/how-to-manage-currency-exchange-rates-when-processing-payroll/)) · ERI ([comp formulas](https://www.erieri.com/blog/post/common-compensation-terms-formulas), [cost of labor vs cost of living](https://www.erieri.com/blog/post/cost-of-labor-vs-cost-of-living)) · SHRM ([geographic pay differential practices](https://www.shrm.org/topics-tools/news/benefits-compensation/geographic-pay-differential-practices)) · Pave ([geo differential guide](https://www.pave.com/blog-posts/insights-from-paves-geographic-pay-differential-guide), [market pricing](https://www.pave.com/products/market-pricing), [comp planning](https://www.pave.com/products/compensation-planning)) · Carta ([ML compensation bands](https://carta.com/product-updates/compensation-bands/)) · Salary.com ([CompAnalyst salary structures](https://www.salary.com/companalyst/salary-structure/), [salary midpoint formula](https://www.salary.com/blog/salary-midpoint-formula)) · Ravio ([benchmarking](https://ravio.com/compensation-benchmarking), [merit matrix guide](https://ravio.com/blog/merit-matrix-guide), [salary benchmarking](https://ravio.com/blog/what-is-salary-benchmarking), [EU Pay Transparency guide](https://ravio.com/blog/everything-you-need-to-know-about-the-eu-pay-transparency-directive)) · PayAnalytics ([unadjusted vs adjusted gap](https://www.payanalytics.com/resources/articles/the-unadjusted-pay-gap-vs-the-adjusted-pay-gap)) · paygap.com ([regression in pay equity audits](https://www.paygap.com/articles/regression-analysis-and-adjusted-pay-gaps-in-pay-equity-audits-an-eu-pay-transparency-guide)) · beqom ([adjusted/unadjusted gap](https://www.beqom.com/blog/unadjusted-and-adjusted-pay-gap)) · Pequity ([equitable increase modeling](https://blog.pequity.com/how-to-model-pay-increases-that-are-equitable-in-budget-merit-and-promotion-cycles-merit-matrices-compa-ratios-refreshing-equity-grants)) · G-P ([global salary benchmarking](https://www.globalization-partners.com/blog/guide-salary-benchmarking/)) · Papaya Global ([FX risk in payroll](https://www.papayaglobal.com/blog/foreign-exchange-risk-management-in-payroll-processing/)) · Littler ([EU Pay Transparency Directive](https://www.littler.com/eu-pay-transparency-directive)) · Ogletree ([June 2026 deadline](https://ogletree.com/insights-resources/blog-posts/the-june-2026-eu-pay-transparency-directive-implementation-deadline-looms/)) · European Commission ([new EU pay transparency rules](https://commission.europa.eu/news-and-media/news/new-eu-rules-pay-transparency-explained-2026-06-05_en))
