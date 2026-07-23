/**
 * The settings port: the ONE reader of the persisted single-row org configuration (AD-19).
 *
 * The outlier threshold is PERSISTED DATA — a single-row `settings` table — never an env var and
 * never read inside the math (Law 6 / AD-19). This port is how the delivery boundary reads it once
 * and hands it inward as a parameter; no `src/domain/**` code ever touches settings, and no
 * use-case reads a clock or environment to get it.
 *
 * READ-ONLY. This story surfaces the persisted defaults; there is no write path here. A settings
 * EDIT surface, if one is ever built, would be a separate mutation with its own single-row guard —
 * this port would not grow an `update`.
 */

/**
 * The persisted org configuration, as a read hands it over.
 *
 * `outlierThresholdPct` is an INTEGER percent (the DB CHECKs `> 0 AND <= 100`) — the boundary
 * converts it to tenths at the domain edge (`BigInt(pct) * 10n`) so the outlier flag stays exact
 * `bigint` (AD-5). `reportingCurrency` is the org-wide conversion target (AD-13), config rather than
 * a user-facing setting.
 */
export type SettingsView = {
  readonly outlierThresholdPct: number;
  readonly reportingCurrency: string;
};

export type SettingsRepository = {
  /**
   * The single settings row (guaranteed to exist by the `id = 1` single-row guard and the seeded
   * default). THROWS when the row is absent — an invariant violation the adapter surfaces, which
   * the use-case catches and turns into `{ kind: 'unavailable' }` (Law 8 / AD-20). Adapters may
   * throw; the pure layers may not.
   */
  readonly readSettings: () => Promise<SettingsView>;
};
