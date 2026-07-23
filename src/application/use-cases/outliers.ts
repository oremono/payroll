/**
 * The CAP-6 outlier-findings read use-case, and the FINALIZED boundary payload story 7-2 consumes
 * unmodified (Law 7 / AD-24).
 *
 * Orchestration only: load every peer group's as-of population, hand it to the ONE pure sweep
 * (`sweepOutliers`), then join the domain result back to labels, employee names, and currency and
 * encode money for the boundary. Every judgement is borrowed from `src/domain/**` and every effect
 * goes through the port, so the fast suite covering this touches no database and no clock.
 *
 * ## `asOf` and `thresholdPct` are PARAMETERS — the whole of Law 6 / AD-19 here
 *
 * The clock is read once at the delivery boundary (story 7-2's page), and the persisted threshold is
 * read once via `getSettings`; both are passed inward. Nothing here asks what day it is or reads
 * settings. The integer-percent threshold is converted to tenths at the DOMAIN EDGE
 * (`BigInt(thresholdPct) * 10n`), so the sweep's flag test is exact `bigint` (AD-5), and the integer
 * `thresholdPct` is echoed on the report as its receipt. Same population + same `asOf` + same
 * threshold ⇒ byte-identical payload, in a deterministic order.
 *
 * ## Read-only, fresh per request (Law 5 / AD-18 / AD-2 / AD-12)
 *
 * No write path, no mutation, no route handler. Groups and findings are computed fresh here per
 * request and never materialized or cached; the database selects the candidate sets and the domain
 * computes every median, distance, count, and flag (Law 2).
 *
 * ## TOTAL (Law 8 / AD-20)
 *
 * Any repository throw is `{ kind: 'unavailable' }`, never an exception across the boundary. Thin
 * groups are inline `refusal` rows carrying their `n` — return values, never exceptions.
 */

import type {
  EmployeeRepository,
  OutlierCandidate,
  PeerGroupPopulation,
} from '@/application/ports/employee-repository';
import { toBoundaryMoney, type BoundaryMoney } from '@/domain/money';
import {
  sweepOutliers,
  type OutlierGroupResult,
  type OutlierMember,
} from '@/domain/outliers';
import { formatDistancePct } from '@/domain/peer-comparison';
import type { PlainDate } from '@/domain/plain-date';

/**
 * The `(role, level, country)` codes (provenance) plus their display labels — the group's
 * definition (AD-16) AND its human-readable "role · level · location" naming, resolved without an
 * `is_active` filter so a retired label still names its group.
 */
export type OutlierPeerGroup = {
  readonly roleCode: string;
  readonly levelCode: string;
  readonly countryCode: string;
  readonly roleName: string;
  readonly levelLabel: string;
  readonly countryName: string;
};

/**
 * One flagged member as a receipt (Law 8 / AD-20): who they are, their `salary` as `BoundaryMoney`
 * (Law 4 / AD-4), and their signed one-decimal `distancePct` — always beyond the threshold, so never
 * `"0.0"`. The UI derives the badge ("+28.4% above median" / "-25.2% below median") from the sign;
 * there is no verdict sentence on this row (that is story 7-2's card, not this findings row).
 */
export type OutlierFinding = {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly salary: BoundaryMoney;
  /** Signed, one decimal: `"25.0"`, `"-30.0"` (AD-5). */
  readonly distancePct: string;
};

/**
 * One group's finalized section: an `outliers` section carrying its median, `n`, single currency,
 * and findings, or an inline `refusal` naming its `n` (AD-16 / UX-DR8 — a thin group appears, never
 * silently omitted). Groups with `n = 0` or with no flagged member never become a section at all.
 */
export type OutlierFindingGroup =
  | {
      readonly kind: 'outliers';
      readonly peerGroup: OutlierPeerGroup;
      readonly n: number;
      readonly currency: string;
      readonly peerMedian: BoundaryMoney;
      readonly findings: readonly OutlierFinding[];
    }
  | {
      readonly kind: 'refusal';
      readonly peerGroup: OutlierPeerGroup;
      readonly counts: { readonly n: number };
      readonly reason: 'thin-peer-group';
    };

/**
 * The whole report, carrying its receipts: the `asOf` it was computed at and the integer
 * `thresholdPct` judged against, plus the ordered groups (outlier sections and inline refusals).
 */
export type OutlierReport = {
  readonly asOf: PlainDate;
  readonly thresholdPct: number;
  readonly groups: readonly OutlierFindingGroup[];
};

/**
 * The read payload (Law 8 / AD-20). `findings` carries the report; `unavailable` means "we could not
 * find out" (a repository outage). Story 7-2 renders both and adds nothing to this contract.
 */
export type GetOutlierFindingsResult =
  | { readonly kind: 'findings'; readonly report: OutlierReport }
  | { readonly kind: 'unavailable' };

/** Injected, never imported: no clock, no Prisma, no settings read — a read needs only the repository. */
export type OutlierFindingsDeps = {
  readonly repository: EmployeeRepository;
};

/**
 * The opaque sweep key for a triple. Codes are JSON-encoded (not `|`-joined) so no reference code
 * containing the delimiter could ever collapse two distinct triples into one group. Must stay
 * byte-identical to the adapter's grouping key in `findAllPeerGroups`.
 */
function keyOf(group: { roleCode: string; levelCode: string; countryCode: string }): string {
  return JSON.stringify([group.roleCode, group.levelCode, group.countryCode]);
}

/** THE order over strings, byte-wise so it is deterministic across environments (never `localeCompare`). */
function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/** A signed tenths value's magnitude, for the findings sort (absolute for judgement, AD-5). */
function magnitudeTenths(tenths: bigint): bigint {
  return tenths < 0n ? -tenths : tenths;
}

/** Findings order: abs(distance) DESC, then employeeId ASC — the DESIGN row order, made total. */
function compareFindingMembers(a: OutlierMember, b: OutlierMember): number {
  const aMagnitude = magnitudeTenths(a.distancePctTenths);
  const bMagnitude = magnitudeTenths(b.distancePctTenths);
  if (aMagnitude !== bMagnitude) {
    return aMagnitude > bMagnitude ? -1 : 1;
  }
  return compareStrings(a.employeeId, b.employeeId);
}

/** Group order: (roleCode, levelCode, countryCode) ASC — a total order on the group's own codes. */
function compareFindingGroups(a: OutlierFindingGroup, b: OutlierFindingGroup): number {
  return (
    compareStrings(a.peerGroup.roleCode, b.peerGroup.roleCode) ||
    compareStrings(a.peerGroup.levelCode, b.peerGroup.levelCode) ||
    compareStrings(a.peerGroup.countryCode, b.peerGroup.countryCode)
  );
}

/** The codes-plus-labels naming for a population — resolved `is_active`-inclusively by the read. */
function peerGroupOf(population: PeerGroupPopulation): OutlierPeerGroup {
  return {
    roleCode: population.key.roleCode,
    levelCode: population.key.levelCode,
    countryCode: population.key.countryCode,
    roleName: population.roleName,
    levelLabel: population.levelLabel,
    countryName: population.countryName,
  };
}

/**
 * Join ONE swept result back to its population — labels, employee names, and currency — and encode
 * for the boundary. The findings are built by iterating the population's candidates and keeping only
 * those the sweep flagged (a `Map` membership test): the candidate carries the display `name`
 * directly, so no name lookup can miss, and a non-flagged candidate simply drops out — the same
 * `member === undefined` arm that a within-threshold peer in a flagged group takes.
 */
function toFindingGroup(
  result: OutlierGroupResult,
  population: PeerGroupPopulation,
): OutlierFindingGroup {
  const peerGroup = peerGroupOf(population);

  if (result.kind === 'thin-peer-group') {
    return { kind: 'refusal', peerGroup, counts: { n: result.n }, reason: 'thin-peer-group' };
  }

  const memberById = new Map(result.outliers.map((member) => [member.employeeId, member] as const));
  const findings = population.candidates
    .flatMap((candidate: OutlierCandidate) => {
      const member = memberById.get(candidate.employeeId);
      // A candidate the sweep did NOT flag (within the threshold) drops out — a reachable arm, not
      // a defensive one: every flagged member's id came from these same candidates.
      if (member === undefined) {
        return [];
      }
      return [{ candidate, member }];
    })
    .sort((a, b) => compareFindingMembers(a.member, b.member))
    .map(({ candidate, member }) => ({
      employeeId: candidate.employeeId,
      employeeName: candidate.name,
      // The group's single currency (AD-6) — the sweep carries it off the in-population members.
      salary: toBoundaryMoney({ amountMinor: member.salaryMinor, currency: result.currency }),
      distancePct: formatDistancePct(member.distancePctTenths),
    }));

  return {
    kind: 'outliers',
    peerGroup,
    n: result.n,
    currency: result.currency,
    peerMedian: toBoundaryMoney({ amountMinor: result.medianMinor, currency: result.currency }),
    findings,
  };
}

/**
 * The outlier findings across the whole as-of population, at `asOf`, judged against `thresholdPct`.
 *
 * The order is the rule: load every group's population (AD-16); build the opaque-keyed sweep inputs;
 * run the ONE `sweepOutliers` with the threshold converted to tenths at the edge (AD-5); then, for
 * each population that produced a findings-bearing result, join labels/names/currency and encode
 * money — sorting groups by their codes and findings by abs(distance) then id. A population with no
 * findings-bearing result is dropped (the reachable "no swept result for this key" arm).
 *
 * TOTAL: any repository throw is `unavailable`, never an exception across the boundary.
 */
export async function getOutlierFindings(
  deps: OutlierFindingsDeps,
  asOf: PlainDate,
  thresholdPct: number,
): Promise<GetOutlierFindingsResult> {
  try {
    const populations = await deps.repository.findAllPeerGroups();

    // The pure sweep sees only the opaque key and the candidates; names and labels stay out of it.
    const inputs = populations.map((population) => ({
      key: keyOf(population.key),
      candidates: population.candidates.map((candidate) => ({
        employeeId: candidate.employeeId,
        salaryHistory: candidate.salaryHistory,
      })),
    }));

    // The threshold crosses into the domain in tenths (AD-5): 20% → 200n, so 20.0% does not flag.
    const thresholdPctTenths = BigInt(thresholdPct) * 10n;
    const swept = sweepOutliers(inputs, asOf, thresholdPctTenths);
    const sweptByKey = new Map(swept.map((result) => [result.key, result] as const));

    // Drive from the populations so each keeps its own labels/names in scope, joining the swept
    // result by key. A population with no findings-bearing result drops out (reachable — a
    // within-threshold or empty group produced nothing).
    const groups = populations
      .flatMap((population) => {
        const result = sweptByKey.get(keyOf(population.key));
        if (result === undefined) {
          return [];
        }
        return [toFindingGroup(result, population)];
      })
      .sort(compareFindingGroups);

    return { kind: 'findings', report: { asOf, thresholdPct, groups } };
  } catch {
    return { kind: 'unavailable' };
  }
}
