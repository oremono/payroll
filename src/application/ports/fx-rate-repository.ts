import type { FxRateRow } from '@/domain/fx';

/**
 * The FX-rate read port (CAP-9, AD-13) — a READ-ONLY loader, and deliberately its own port rather
 * than a method on the employee repository: `fx_rate` is a distinct table with no employee in sight,
 * and a payroll total reaches it directly, not through a person.
 *
 * "Adapter loads, domain resolves" — the exact split `findAllPeerGroups` + `resolveCurrentSalary`
 * use. This loads EVERY `fx_rate` row and the domain (`resolveRateSet`) picks the set at the
 * greatest `pinnedOn <= asOf` and requires the needed pairs; the database runs no as-of `where`, no
 * `ORDER BY`, and no grouping (AD-2 / AD-13). Filtering to the needed pairs is the domain's too — it
 * is what keeps the resolution isolated from unrelated rows.
 *
 * There is NO write method and never will be one here: seeding `fx_rate` rows is out of scope for
 * this story (the integration test creates its own), and production seeding is a later concern.
 */
export type FxRateRepository = {
  /**
   * Every `fx_rate` row, each with its pair, its exact rational rate (`rate` string +
   * `rateNumerator`/`rateDenominator`, decomposed from the stored `Decimal(18,8)` with NO float),
   * and its `pinnedOn`. Unordered and unfiltered — the domain owns set resolution (AD-13).
   */
  readonly findAllFxRates: () => Promise<readonly FxRateRow[]>;
};
