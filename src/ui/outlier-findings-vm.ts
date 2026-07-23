import type {
  GetOutlierFindingsResult,
  OutlierFindingGroup,
  OutlierPeerGroup,
} from '@/application/use-cases/outliers';
import { formatPlainDate, plainDateToIso, type PlainDate } from '@/domain/plain-date';

/**
 * Everything the CAP-6 findings surface DECIDES, with no React in it.
 *
 * The same split, and the same reason, as `peer-comparison-vm.ts`: no jsdom, no @testing-library,
 * and `src/ui/*.tsx` sits outside the coverage gate. Every judgement — selecting the arm, deriving
 * the amber badge string from the signed `distancePct`, building the role · level · country label
 * and the peer count, assembling the inline refusal clause and the zero-state statement, and mapping
 * `unavailable` to the "unreadable" region — lives here and is unit-tested, so `outlier-findings.tsx`
 * is left with markup and nothing to get wrong.
 *
 * ## It consumes story 7-1's finalized payload UNMODIFIED (Law 7 / AD-24)
 *
 * `GetOutlierFindingsResult` is used exactly as 7-1 finalized it. The builder RE-DERIVES no statistic
 * (Law 2 / Law 8): `distancePct` (server-formatted, signed, one decimal), `n`, `peerMedian`, and the
 * group labels all arrive computed. The rows carry NO money — only the CSV export formats money, so
 * this builder needs no currencies list. It only derives DISPLAY TEXT (the badge string, the label,
 * the counts) and SELECTS the arm.
 *
 * ## The badge is derived, not re-computed (DR4)
 *
 * `distancePct` is a signed one-decimal string (`"28.4"`, `"-25.2"`) and, here, always beyond the
 * threshold — never `"0.0"`, so the direction is never ambiguous. The badge prepends `+` to a
 * non-negative distance and picks the direction WORD from the sign (never color alone, a11y floor):
 * `+28.4% above median` / `-25.2% below median` (the payload string already carries the `-`).
 *
 * The imports are `import type` except `formatPlainDate` and `plainDateToIso` — pure, total,
 * clock-free domain functions. There is no `Date`, no `Math.random`, no I/O, no money here.
 */

/** The middle dot (U+00B7) joining role · level · country, matching the CAP-5 verdict phrasing. */
const LABEL_SEPARATOR = ' · ';

/**
 * The heading and statement for the findings surface's "unreadable" region.
 *
 * Distinct from a refusal: a refusal is a first-class answer a thin group earns; "unreadable" means
 * the read itself did not resolve (`unavailable`). The register is the shared `EmployeeUnavailable`
 * one (a region with a heading, never `role="alert"`). The statement names the OUTCOME and no
 * cause — the read layer swallows the reason, so inventing one would be the surface making something
 * up.
 */
export const OUTLIER_FINDINGS_UNREADABLE_HEADING = 'The outlier findings could not be read';
export const OUTLIER_FINDINGS_UNREADABLE_STATEMENT =
  'The outlier findings are not readable right now. Nothing has changed.';

/** One flagged member's row: name + the derived badge + the raw signed distance. NO money. */
export type OutlierRow = {
  /**
   * The payload's stable, unique employee id — carried for React keying ONLY, never displayed. Two
   * flagged peers in one group can share a display name AND an identical one-decimal `distancePct`,
   * so a name+distance key could collide; `employeeId` is the payload's guaranteed-unique handle.
   */
  readonly employeeId: string;
  readonly name: string;
  /** `+28.4% above median` / `-25.2% below median` — direction in words (DR4). */
  readonly badgeText: string;
  /** The signed one-decimal `distancePct` verbatim from the payload (never re-derived). */
  readonly distancePct: string;
};

/**
 * One peer-group section: an `outliers` section carrying its label, peer count `n`, and rows, or an
 * inline `refusal` naming its count (AD-16 / DR8 — a thin group appears, never silently omitted).
 */
export type OutlierSection =
  | { readonly kind: 'outliers'; readonly label: string; readonly n: number; readonly rows: readonly OutlierRow[] }
  | { readonly kind: 'refusal'; readonly label: string; readonly refusalText: string };

/**
 * The findings as the component consumes it:
 *   - `findings` — the table: outlier sections + inline refusals, in the payload's order.
 *   - `empty` — the calm zero-state statement.
 *   - `unreadable` — the shared "unreadable" region, distinct from a refusal.
 */
export type OutlierFindingsVM =
  | { readonly kind: 'findings'; readonly sections: readonly OutlierSection[] }
  | { readonly kind: 'empty'; readonly statement: string }
  | { readonly kind: 'unreadable'; readonly heading: string; readonly statement: string };

/** role · level · country — all three, since a peer group is keyed on the full triple (DR8). */
function labelOf(peerGroup: OutlierPeerGroup): string {
  return [peerGroup.roleName, peerGroup.levelLabel, peerGroup.countryName].join(LABEL_SEPARATOR);
}

/**
 * The badge string, derived from the SIGN of the pre-formatted signed distance (DR4). A distance
 * that does not start with `-` is non-negative and reads "above median" with a `+` prefixed; one
 * that starts with `-` reads "below median" and already carries its own sign. No arithmetic — the
 * number is the payload's, unmodified.
 */
function badgeTextOf(distancePct: string): string {
  if (distancePct.startsWith('-')) {
    return `${distancePct}% below median`;
  }
  return `+${distancePct}% above median`;
}

/** One payload group → one section. Outlier rows carry no money; a refusal names its `n`. */
function sectionOf(group: OutlierFindingGroup): OutlierSection {
  const label = labelOf(group.peerGroup);

  if (group.kind === 'refusal') {
    return {
      kind: 'refusal',
      label,
      refusalText: `Only ${group.counts.n} peers — too few to compare fairly`,
    };
  }

  return {
    kind: 'outliers',
    label,
    n: group.n,
    rows: group.findings.map((finding) => ({
      employeeId: finding.employeeId,
      name: finding.employeeName,
      badgeText: badgeTextOf(finding.distancePct),
      distancePct: finding.distancePct,
    })),
  };
}

/**
 * Build the CAP-6 findings view-model from story 7-1's `GetOutlierFindingsResult`.
 *
 * PURE and TOTAL. `findings` with groups → sections in the payload's (already-sorted) order;
 * `findings` with an empty `groups` → the calm zero-state statement echoing the threshold judged
 * against and the as-of date; `unavailable` → the "unreadable" region. The zero-state date uses the
 * `asOf` argument (`formatPlainDate ?? plainDateToIso`, the total fallback), the threshold the
 * report's own `thresholdPct` receipt — the threshold judged is the threshold echoed.
 */
export function buildOutlierFindings(
  result: GetOutlierFindingsResult,
  asOf: PlainDate,
): OutlierFindingsVM {
  if (result.kind === 'unavailable') {
    return {
      kind: 'unreadable',
      heading: OUTLIER_FINDINGS_UNREADABLE_HEADING,
      statement: OUTLIER_FINDINGS_UNREADABLE_STATEMENT,
    };
  }

  const { report } = result;
  if (report.groups.length === 0) {
    const date = formatPlainDate(asOf) ?? plainDateToIso(asOf);
    return {
      kind: 'empty',
      statement: `No outliers beyond ${report.thresholdPct}% as of ${date}. Nothing is drifting.`,
    };
  }

  return { kind: 'findings', sections: report.groups.map(sectionOf) };
}
