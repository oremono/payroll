/**
 * The peer-comparison core (CAP-5): the as-of population filter (AD-16), the signed distance from
 * the median (AD-5), and the pure orchestrator that turns a set of candidates into an answer or a
 * dignified refusal. No I/O, no clock, no randomness, no imports outside this layer. (Law 2 / AD-1)
 *
 * Every function here is TOTAL (Law 8 / AD-20): a thin group and a subject with no salary are RETURN
 * VALUES carrying their counts, never exceptions. The database never computes any of this — it
 * selects the candidate set and the domain computes the median, spread, distance, and `n` in
 * process (Law 2). `n` is the cardinality of the exact in-memory in-population set, never a COUNT.
 */

import { divideRoundHalfUp, type Money } from './money';
import type { PlainDate } from './plain-date';
import { resolveCurrentSalary, type SalaryRecordView } from './salary-timeline';
import { median, spread } from './statistics';

/**
 * The minimum in-population peer count a comparison needs (AD-16). A FIXED domain constant — NOT the
 * settings outlier threshold, which is persisted org config read at a different boundary. Below
 * this the group is never widened; the comparison refuses out loud, naming the count.
 */
export const MIN_PEER_GROUP_SIZE = 5;

/**
 * One candidate for the peer group: an employee id and their WHOLE append-only salary history,
 * UNORDERED. In-population membership is decided here by the ONE resolver, not by the read — the
 * adapter hands over every employee sharing the subject's `(role, level, country)` triple and the
 * domain filters to those with a salary in force at `asOf`.
 */
export type PeerCandidate = {
  readonly employeeId: string;
  readonly salaryHistory: readonly SalaryRecordView[];
};

/**
 * The domain-level outcome of a comparison — Money-typed, pre-boundary. The use-case encodes the
 * Money to `BoundaryMoney` and the tenths to a string; nothing here has crossed a boundary yet.
 *
 * `thin-peer-group` and `no-salary-as-of` are DISTINCT refusals: the first is a real group too
 * small to compare (naming `n`), the second a subject with no salary in force at all (no `n`, no
 * median computed) — never conflated, never `n = 0` arithmetic.
 */
export type PeerComparisonResult =
  | {
      readonly kind: 'answer';
      readonly n: number;
      readonly subjectSalary: Money;
      readonly peerMedian: Money;
      readonly spread: { readonly min: Money; readonly max: Money };
      readonly distancePctTenths: bigint;
    }
  | { readonly kind: 'thin-peer-group'; readonly n: number }
  | { readonly kind: 'no-salary-as-of' };

/**
 * The subject's signed distance from the peer median, in TENTHS OF A PERCENT (AD-5).
 *
 * `d = (salary − median) / median × 100`, and the tenths form is that × 10, all in ONE exact integer
 * division: `divideRoundHalfUp((salaryMinor − medianMinor) × 1000, medianMinor)`. The magnitude is
 * rounded half-up and the sign reapplied by the divider itself. This is `bigint` and never IEEE
 * double for the reason AD-5 gives at length: `20.05%` is `200.5` tenths → half-up `201` → `"20.1"`,
 * whereas a double reads `0.2005 × 1000` as `200.4999…` and rounds it the wrong way. The number
 * shown is the number judged.
 *
 * TOTAL and returns a plain `bigint`: `medianMinor > 0` by construction (salaries are `> 0` and the
 * group is non-empty), so the division never hits the divider's zero-denominator `null` arm through
 * `comparePeers`. The `?? 0n` keeps a DIRECT caller total for a degenerate zero median rather than
 * leaking the divider's `null` — the same discipline every function in this layer holds to.
 */
export function distancePctTenths(salaryMinor: bigint, medianMinor: bigint): bigint {
  return divideRoundHalfUp((salaryMinor - medianMinor) * 1000n, medianMinor) ?? 0n;
}

/**
 * A signed tenths-of-percent value as a one-decimal string: `-80n → "-8.0"`, `0n → "0.0"`,
 * `205n → "20.5"`. The `.0` is always kept — a whole-percent distance is `"20.0"`, never `"20"`.
 *
 * The magnitude is split into whole and fractional digits on `bigint` (no float). ONE `negative`
 * flag drives BOTH the sign prefix and the magnitude, so `-5n` is `"-0.5"` (a leading-zero major
 * part) rather than `"0.-5"`, and `0n` is `"0.0"`. That single flag is deliberate: were the sign
 * and the magnitude to test `< 0n` independently, a `<= 0n` slip on the magnitude alone would be
 * invisible (negating zero is zero), whereas here the same slip also flips the sign of `0n` to
 * `"-0.0"` — a difference the `0n` case pins.
 */
export function formatDistancePct(tenths: bigint): string {
  const negative = tenths < 0n;
  const magnitude = negative ? -tenths : tenths;
  const whole = magnitude / 10n;
  const fraction = magnitude % 10n;
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * Compare `subjectId` against their peers as of `asOf`, returning an answer or a refusal.
 *
 * The order is the whole rule (AD-16):
 *   1. The subject must be among the candidates and have a salary in force at `asOf` (the ONE
 *      resolver, AD-8). If not, `no-salary-as-of` — a DISTINCT refusal from a thin group, and never
 *      `n = 0` arithmetic on an absent subject.
 *   2. `n` = every candidate (subject included) with a non-null current salary at `asOf`. That set
 *      IS the peer group; `n` is its exact cardinality, computed here, never a COUNT query.
 *   3. `n < MIN_PEER_GROUP_SIZE` → `thin-peer-group` naming `n`. The group is never widened.
 *   4. Otherwise the median (AD-3), the min–max spread, and the subject's signed distance, all over
 *      the in-population current-salary minor units in the group's single currency.
 *
 * Once the subject is in-population (step 1 passed), the in-population set contains at least the
 * subject, so `n >= 1` and the median/spread of it are non-null past the gate — asserted rather than
 * re-checked, because a re-check would be an unreachable, uncoverable branch (see `statistics.ts`).
 */
export function comparePeers(
  subjectId: string,
  candidates: readonly PeerCandidate[],
  asOf: PlainDate,
): PeerComparisonResult {
  const subject = candidates.find((candidate) => candidate.employeeId === subjectId);
  const subjectSalary = subject ? resolveCurrentSalary(subject.salaryHistory, asOf) : null;
  if (subjectSalary === null) {
    return { kind: 'no-salary-as-of' };
  }

  // The as-of population (AD-16): every candidate with a salary in force at `asOf`, subject included.
  const inPopulation = candidates
    .map((candidate) => resolveCurrentSalary(candidate.salaryHistory, asOf))
    .filter((current): current is SalaryRecordView => current !== null);

  const n = inPopulation.length;
  if (n < MIN_PEER_GROUP_SIZE) {
    return { kind: 'thin-peer-group', n };
  }

  const amountsMinor = inPopulation.map((current) => current.salary.amountMinor);
  // Non-null past the gate: `inPopulation` holds at least the subject, so the set is non-empty and
  // both statistics have an answer. Asserted, not re-checked — the `null` arm is unreachable here.
  const peerMedianMinor = median(amountsMinor) as bigint;
  const peerSpread = spread(amountsMinor) as { min: bigint; max: bigint };

  const currency = subjectSalary.salary.currency;
  return {
    kind: 'answer',
    n,
    subjectSalary: subjectSalary.salary,
    peerMedian: { amountMinor: peerMedianMinor, currency },
    spread: {
      min: { amountMinor: peerSpread.min, currency },
      max: { amountMinor: peerSpread.max, currency },
    },
    distancePctTenths: distancePctTenths(subjectSalary.salary.amountMinor, peerMedianMinor),
  };
}
