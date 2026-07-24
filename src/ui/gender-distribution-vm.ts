import type {
  GenderDistribution,
  GetGenderDistributionResult,
} from '@/application/use-cases/gender-distribution';

/**
 * Everything the CAP-8 gender-distribution surface DECIDES, with no React in it.
 *
 * 9-2 is the CAP-8 twin of 8-2: this file is the structural mirror of `gender-gap-vm.ts`. The same
 * split, and the same reason: no jsdom, no @testing-library, and `src/ui/*.tsx` sits outside the
 * coverage gate. Every judgement — selecting the arm, mapping `distribution.levels` to rows, deriving
 * `hasPeople`, carrying `totals` verbatim, and mapping `unavailable` to the shared calm region — lives
 * here and is unit-tested, so `gender-distribution.tsx` is left with markup and nothing to get wrong.
 *
 * ## It consumes story 9-1's finalized payload UNMODIFIED (Law 7 / AD-24)
 *
 * `GetGenderDistributionResult` is used exactly as 9-1 finalized it. The builder RE-DERIVES no count
 * (Law 2 / Law 8): `maleN`, `femaleN`, `total`, `totals`, `levelLabel`, and the rank order all arrive
 * computed. The builder only SELECTS the arm, MAPS `distribution.levels` to rows (counts passed
 * through untouched), and FLAGS `hasPeople = total > 0` so the markup can show an empty track for a
 * populated-but-zero level. No field is added to the payload and no port is touched.
 *
 * ## No percentage, no verdict, no refusal — the union is `answer | unavailable`
 *
 * CAP-8 is an org-wide distribution surface with no `n >= 5` gate and no subject employee: an empty
 * population is a valid `answer` of zeros, never a refusal, and there is deliberately no percent-female
 * figure (9-1 omitted it from the payload). The bar proportion is set by the browser from the integer
 * counts in the `.tsx` (`flex-grow`), so no ratio is computed here or shown. `levels: []` maps to
 * `rows: []`, which the markup renders as a calm statement rather than an empty table.
 *
 * The imports are `import type` only — there is no `Date`, no `Math.random`, and no I/O here (Law 2 /
 * Law 6). Same input ⇒ same output.
 */

/**
 * The heading and statement for the gender-distribution "unavailable" region.
 *
 * The read itself did not resolve (`getGenderDistribution` → `unavailable`). The register is the
 * shared `EmployeeUnavailable` one (a region with a heading, never `role="alert"`; project-context
 * § Conventions). The statement names the OUTCOME and no cause — the read layer swallows the reason,
 * so inventing one would be the surface making something up.
 */
export const GENDER_DISTRIBUTION_UNAVAILABLE_HEADING = 'The gender distribution could not be read';
export const GENDER_DISTRIBUTION_UNAVAILABLE_STATEMENT =
  'The gender distribution is not readable right now. Nothing has changed.';

/**
 * One per-level row as the component consumes it: the level's unique `levelCode` (the React key —
 * `level.code`/`level.rank` are the schema's only `@unique` columns; the display `levelLabel` is
 * `level.name`, which is NOT unique and would collide as a key), its display `levelLabel`, the two
 * gender counts and their `total` (all passed through from the payload verbatim — the number shown is
 * the number counted), and `hasPeople = total > 0`, which lets the markup draw an empty
 * `bg-surface-tint` track for an active-but-empty level rather than a zero-width bar.
 */
export type GenderDistributionRow = {
  readonly levelCode: string;
  readonly levelLabel: string;
  readonly maleN: number;
  readonly femaleN: number;
  readonly total: number;
  readonly hasPeople: boolean;
};

/**
 * The gender distribution as the component consumes it.
 *
 *   - `answer` — the rank-ordered rows (possibly empty) plus the org-wide `totals`, both carried
 *     verbatim from the payload.
 *   - `unavailable` — the shared calm region's heading + statement.
 */
export type GenderDistributionVM =
  | {
      readonly kind: 'answer';
      readonly rows: readonly GenderDistributionRow[];
      readonly totals: GenderDistribution['totals'];
    }
  | { readonly kind: 'unavailable'; readonly heading: string; readonly statement: string };

/**
 * Build the CAP-8 view-model from story 9-1's `GetGenderDistributionResult`.
 *
 * PURE and TOTAL: every input answers with a value, never an exception. It selects the arm; for
 * `answer` it maps `distribution.levels` to rows (counts passed through, `hasPeople = total > 0`) in
 * the exact delivered order and carries `distribution.totals` verbatim; for `unavailable` it returns
 * the module-level heading/statement. No count is re-derived and no percentage is computed.
 */
export function buildGenderDistribution(result: GetGenderDistributionResult): GenderDistributionVM {
  if (result.kind === 'unavailable') {
    return {
      kind: 'unavailable',
      heading: GENDER_DISTRIBUTION_UNAVAILABLE_HEADING,
      statement: GENDER_DISTRIBUTION_UNAVAILABLE_STATEMENT,
    };
  }

  return {
    kind: 'answer',
    // Delivered order preserved (the payload is already rank-ordered, AD-16 / AD-2); counts passed
    // through untouched, `hasPeople` the only derived byte.
    rows: result.distribution.levels.map((level) => ({
      levelCode: level.levelCode,
      levelLabel: level.levelLabel,
      maleN: level.maleN,
      femaleN: level.femaleN,
      total: level.total,
      hasPeople: level.total > 0,
    })),
    totals: result.distribution.totals,
  };
}
