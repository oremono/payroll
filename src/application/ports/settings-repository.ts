/**
 * The settings port: the ONE reader of the persisted single-row org configuration (AD-19).
 *
 * The outlier threshold is PERSISTED DATA — a single-row `settings` table — never an env var and
 * never read inside the math (Law 6 / AD-19). This port is how the delivery boundary reads it once
 * and hands it inward as a parameter; no `src/domain/**` code ever touches settings, and no
 * use-case reads a clock or environment to get it.
 *
 * READ + WRITE. The read (`readSettings`) surfaces the persisted defaults; the write
 * (`updateOutlierThresholdPct`, added by story 7-2) is the ONE mutation CAP-6 introduces — the
 * Settings threshold Apply. It updates the single guarded row (`id = 1`); `settings` already holds
 * table-level `UPDATE` for `payroll_app` and a `settings_outlier_threshold_pct_range` CHECK
 * (`> 0 AND <= 100`), so no migration is needed. The application-layer use-case
 * (`updateOutlierThreshold`) validates the integer percent in `[1, 100]` BEFORE the write; the DB
 * CHECK is the belt to that suspenders.
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

  /**
   * Persist a new outlier threshold onto the SINGLE settings row (`id = 1`) — the one mutation CAP-6
   * introduces (story 7-2). `pct` is an integer percent the use-case has ALREADY validated to be in
   * `[1, 100]`; the adapter updates `id = 1` only (never inserts, never touches a second row), so
   * the `settings_single_row` guard is honoured.
   *
   * Adapters MAY throw: a value that somehow bypassed validation trips the DB
   * `settings_outlier_threshold_pct_range` CHECK, which surfaces here as a rejected promise the
   * use-case catches and turns into `{ kind: 'unavailable' }` (Law 8 / AD-20). The pure layers may
   * not throw; this port method may.
   */
  readonly updateOutlierThresholdPct: (pct: number) => Promise<void>;
};
