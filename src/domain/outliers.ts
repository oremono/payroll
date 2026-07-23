/**
 * THE outlier sweep (CAP-6): over a whole set of peer groups, flag every member whose current
 * salary drifts from the group median by more than the threshold. No I/O, no clock, no randomness,
 * no imports outside this layer. (Law 2 / AD-1)
 *
 * Every function here is TOTAL (Law 8 / AD-20): a thin group is a RETURN VALUE naming its count, a
 * degenerate empty group is simply omitted, and nothing throws. The database never computes any of
 * this — it selects the candidate sets and this domain computes every median, distance, count, and
 * flag in process (Law 2 / AD-2). `n` is the cardinality of the exact in-memory in-population set,
 * never a COUNT query.
 *
 * ## The threshold and the as-of date are PARAMETERS, never read here (Law 6 / AD-19)
 *
 * The sweep receives `thresholdPctTenths` already converted to tenths-of-percent — the boundary
 * reads the persisted `settings.outlier_threshold_pct` once and hands it in (`BigInt(pct) * 10n`).
 * Nothing in this module reads a clock or settings; same groups + same `asOf` + same threshold ⇒
 * byte-identical result. That is the whole of determinism (NFR1), and it is why the flag test is
 * pure `bigint`: the magnitude `distancePctTenths` produces is rounded half-up to one decimal, then
 * compared STRICTLY against the threshold in the same integer units (AD-5 — the number shown is the
 * number judged).
 *
 * ## Exactly one median, one resolver, one distance — reused, never re-implemented
 *
 * In-population membership is `resolveCurrentSalary(history, asOf) !== null`, the ONE resolver
 * (AD-8). The middle is the ONE `median` (AD-3). The drift is the ONE standalone
 * `distancePctTenths` (AD-5), called PER MEMBER — where CAP-5's `comparePeers` measures one subject
 * against the median, the sweep measures every member against it, so it iterates and calls the same
 * exact-arithmetic function directly rather than growing a second distance.
 */

import { median } from './statistics';
import {
  distancePctTenths,
  MIN_PEER_GROUP_SIZE,
  type PeerCandidate,
} from './peer-comparison';
import type { PlainDate } from './plain-date';
import { resolveCurrentSalary, type SalaryRecordView } from './salary-timeline';

/**
 * One peer group handed to the sweep: an OPAQUE `key` (the use-case builds it from the
 * `(role, level, country)` triple) and every candidate sharing it, each carrying their WHOLE
 * append-only salary history UNORDERED. The sweep decides in-population membership and never widens
 * a group — the caller has already grouped by the exact triple (AD-16).
 */
export type OutlierGroupInput = {
  readonly key: string;
  readonly candidates: readonly PeerCandidate[];
};

/**
 * One flagged member, pre-boundary: Money-typed minor units and the SIGNED tenths-of-percent
 * distance. The use-case encodes `salaryMinor` to `BoundaryMoney` and `distancePctTenths` to a
 * signed one-decimal string; nothing here has crossed a boundary yet.
 */
export type OutlierMember = {
  readonly employeeId: string;
  readonly salaryMinor: bigint;
  /** Signed: positive is above the median, negative below. Its magnitude strictly exceeds the threshold. */
  readonly distancePctTenths: bigint;
};

/**
 * The domain-level outcome for ONE group. `outliers` carries the median, the group's single
 * currency, and every flagged member; `thin-peer-group` names `n` and computes no median. A group
 * with `n = 0` (nobody effective at `asOf`) or with `n >= 5` and no flagged member is not
 * represented at all — the sweep returns only findings-bearing groups.
 */
export type OutlierGroupResult =
  | {
      readonly key: string;
      readonly kind: 'outliers';
      readonly n: number;
      readonly medianMinor: bigint;
      readonly currency: string;
      readonly outliers: readonly OutlierMember[];
    }
  | { readonly key: string; readonly kind: 'thin-peer-group'; readonly n: number };

/**
 * One in-population member: the employee id paired with the salary record in force at `asOf`.
 * The pairing keeps the id attached to the resolved salary so the flagged member can name itself.
 */
type InPopulationMember = {
  readonly employeeId: string;
  readonly current: SalaryRecordView;
};

/**
 * Whether a signed distance's MAGNITUDE strictly exceeds the threshold — the AD-5 flag test,
 * `abs(distancePctTenths) > thresholdPctTenths`, written as two strict `bigint` comparisons.
 *
 * Deliberately NOT `Math.abs`-style `(d < 0n ? -d : d) > t`: a lone sign test on the magnitude has
 * no observable consequence at `d = 0n` (negating zero is zero), so a `< → <=` slip there would be
 * an equivalent, unkillable mutant. Splitting it into `d > t` (above) OR `d < -t` (below) makes
 * BOTH directions of the boundary observable — a member at exactly `+t` or `−t` does not flag, one
 * at `+t + 1` or `−t − 1` does — which is exactly the 20.0 / 20.1 boundary the tests pin, in each
 * direction. The threshold is `> 0` by construction (the DB CHECKs `outlier_threshold_pct > 0`), so
 * `−t` is genuinely below zero and the two arms never overlap.
 */
function isBeyondThreshold(distanceTenths: bigint, thresholdPctTenths: bigint): boolean {
  return distanceTenths > thresholdPctTenths || distanceTenths < -thresholdPctTenths;
}

/**
 * Sweep every group, returning ONLY the findings-bearing ones (outliers or thin), in input order.
 *
 * Per group, the order is the rule (AD-16):
 *   1. The in-population set — every candidate with a salary in force at `asOf`, via the ONE
 *      resolver (AD-8). `n` is its exact cardinality, computed here, never a COUNT.
 *   2. `n = 0` — nobody effective at `asOf`. Degenerate: OMITTED (not a refusal row; there is no
 *      one to compare and no `n` worth naming).
 *   3. `1 <= n < 5` — a real group too small to compare: `thin-peer-group` naming `n`, never
 *      widened, no median computed.
 *   4. `n >= 5` — the ONE median (AD-3) over the group's single-currency minor units, then each
 *      member's signed `distancePctTenths` from it, flagging those beyond the threshold. If none
 *      flag, the group is OMITTED (no section); otherwise an `outliers` result carrying the median,
 *      the currency, and every flagged member.
 *
 * Pure, total, deterministic. Reads the group's single currency off the FIRST in-population member
 * — the group is single-currency by construction (country immutable, currency follows country), so
 * the first member's currency describes every member's money. The empty-set guard on that
 * destructure is REACHABLE (it is exactly the `n = 0` omission), so it is a live check rather than
 * an unreachable guard on an in-range index.
 */
export function sweepOutliers(
  groups: readonly OutlierGroupInput[],
  asOf: PlainDate,
  thresholdPctTenths: bigint,
): readonly OutlierGroupResult[] {
  const results: OutlierGroupResult[] = [];

  for (const inputGroup of groups) {
    // The as-of population (AD-16): each candidate paired with its current salary, keeping only
    // those in force at `asOf`. The id stays attached so a flagged member can name itself.
    const inPopulation: InPopulationMember[] = inputGroup.candidates
      .map((candidate) => ({
        employeeId: candidate.employeeId,
        current: resolveCurrentSalary(candidate.salaryHistory, asOf),
      }))
      .filter(
        (member): member is InPopulationMember => member.current !== null,
      );

    // The FIRST in-population member. Its absence IS the `n = 0` case (nobody effective at `asOf`),
    // a reachable, load-bearing check — the group is omitted as degenerate, never a refusal row.
    const [firstMember] = inPopulation;
    if (firstMember === undefined) {
      continue;
    }

    const n = inPopulation.length;
    if (n < MIN_PEER_GROUP_SIZE) {
      // A real group too small to compare — named, never widened, and no median computed.
      results.push({ key: inputGroup.key, kind: 'thin-peer-group', n });
      continue;
    }

    const amountsMinor = inPopulation.map((member) => member.current.salary.amountMinor);
    // Non-null past the gate: `n >= 5 > 0`, so the set is non-empty and the median has an answer.
    // Asserted, not re-checked — the `null` arm is unreachable here (see `comparePeers`).
    const medianMinor = median(amountsMinor) as bigint;

    const outliers: OutlierMember[] = inPopulation
      .map((member) => ({
        employeeId: member.employeeId,
        salaryMinor: member.current.salary.amountMinor,
        distancePctTenths: distancePctTenths(member.current.salary.amountMinor, medianMinor),
      }))
      .filter((member) => isBeyondThreshold(member.distancePctTenths, thresholdPctTenths));

    // A group of five-or-more with nobody beyond the threshold is OMITTED entirely — no section.
    if (outliers.length === 0) {
      continue;
    }

    results.push({
      key: inputGroup.key,
      kind: 'outliers',
      n,
      medianMinor,
      // Single-currency by construction — the first member's currency describes the whole group.
      currency: firstMember.current.salary.currency,
      outliers,
    });
  }

  return results;
}
