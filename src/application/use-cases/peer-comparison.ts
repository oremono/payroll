/**
 * The CAP-5 peer-comparison read use-case, and the FINALIZED boundary payload story 6-2 consumes
 * unmodified (Law 7 / AD-24).
 *
 * Orchestration only: resolve the subject, load the as-of peer population by the subject's own
 * triple, hand it to the ONE domain orchestrator (`comparePeers`), compose the ONE verdict, and
 * encode money for the boundary. Every judgement is borrowed from `src/domain/**` and every effect
 * goes through the port, so this file is testable against fakes and the fast suite covering it
 * touches no database and no clock.
 *
 * ## `asOf` is a parameter, and that is the whole of Law 6 here
 *
 * The clock is read ONCE, at the delivery boundary (story 6-2's page), and the date is passed
 * inward. Nothing here asks what day it is. Same data + same `asOf` ⇒ identical payload (Law 6 /
 * AD-11), which is what makes the as-of control testable at all.
 *
 * ## Every function here is TOTAL (Law 8 / AD-20)
 *
 * A `null` subject is `not-found`; a null population (an unresolvable currency), a repository throw,
 * and a verdict that cannot render are all `unavailable`. A thin group and a subject with no salary
 * are REFUSALS carrying their counts — return values, never exceptions. `not-found` (there is no
 * such person) and `unavailable` (we could not find out) are deliberately different answers, exactly
 * as the sibling reads draw the line.
 *
 * ## Read-only (Law 5 / AD-18 / AD-2)
 *
 * No write path, no mutation, no route handler. A peer group is derived fresh here per request and
 * never materialized or cached (AD-12); the database selects the candidate set and the domain
 * computes every statistic a user sees (Law 2).
 */

import type { EmployeeRepository } from '@/application/ports/employee-repository';
import { toBoundaryMoney, type BoundaryMoney } from '@/domain/money';
import { comparePeers, formatDistancePct } from '@/domain/peer-comparison';
import type { PlainDate } from '@/domain/plain-date';
import { composeVerdict, type VerdictInput } from '@/domain/verdict';

/** The `(role, level, country)` triple echoed back as provenance — the group's definition (AD-16). */
type PeerGroupProvenance = {
  readonly roleCode: string;
  readonly levelCode: string;
  readonly countryCode: string;
};

/**
 * The answer, carrying its receipts (Law 8 / AD-20): the value AND its provenance in one object —
 * the group definition, `n`, the as-of date, and the single currency. Every monetary field is a
 * `BoundaryMoney` decimal string (Law 4 / AD-4); `distancePct` is a signed one-decimal string; and
 * `verdict` is the ONE composed sentence, included unmodified for the card and copy-answer alike.
 */
export type PeerComparison = {
  readonly employeeId: string;
  readonly asOf: PlainDate;
  readonly peerGroup: PeerGroupProvenance;
  /** As-of population, subject included; `>= 5` by construction of the answer arm (AD-16). */
  readonly n: number;
  /** The group's single ISO-4217 code — single-currency by construction, no FX in this epic. */
  readonly currency: string;
  readonly subjectSalary: BoundaryMoney;
  readonly peerMedian: BoundaryMoney;
  readonly spread: { readonly min: BoundaryMoney; readonly max: BoundaryMoney };
  /** Signed, one decimal: `"-8.0"`, `"0.0"`, `"20.5"` (AD-5). */
  readonly distancePct: string;
  readonly verdict: string;
};

/**
 * A refusal, a full citizen carrying its counts (Law 8 / AD-20). `thin-peer-group` names `n` and the
 * group it will not widen; `no-salary-as-of` names neither `n` nor a median (none was computed).
 * Both carry the ONE verdict sentence, quotable exactly as the answer is.
 */
export type PeerRefusal =
  | {
      readonly reason: 'thin-peer-group';
      readonly peerGroup: PeerGroupProvenance;
      readonly counts: { readonly n: number };
      readonly asOf: PlainDate;
      readonly verdict: string;
    }
  | {
      readonly reason: 'no-salary-as-of';
      readonly asOf: PlainDate;
      readonly verdict: string;
    };

/**
 * The read payload (Law 8 / AD-20). `answer` and `refusal` carry their receipts; `not-found` and
 * `unavailable` are distinct outcomes — one means "no such person", the other "we could not find
 * out". Story 6-2 renders all four and adds nothing to this contract.
 */
export type GetPeerComparisonResult =
  | { readonly kind: 'answer'; readonly comparison: PeerComparison }
  | { readonly kind: 'refusal'; readonly refusal: PeerRefusal }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable' };

/**
 * Injected, never imported: no clock, no Prisma, no id generator. A read needs only the repository —
 * `asOf` arrives per call, as an argument.
 */
export type PeerComparisonDeps = {
  readonly repository: EmployeeRepository;
};

/**
 * The peer comparison for one employee as of `asOf`.
 *
 * The order is the rule (AD-16): resolve the subject (`null` ⇒ `not-found`); load the population by
 * the subject's OWN triple (`null` ⇒ `unavailable`); run the ONE `comparePeers`; compose the ONE
 * verdict (`null` ⇒ `unavailable`, never a sentence with a hole); then assemble the union, encoding
 * every Money to `BoundaryMoney` and the tenths to a signed one-decimal string.
 *
 * TOTAL: any repository throw is `unavailable`, never an exception across the boundary.
 */
export async function getPeerComparison(
  deps: PeerComparisonDeps,
  employeeId: string,
  asOf: PlainDate,
): Promise<GetPeerComparisonResult> {
  try {
    const subject = await deps.repository.findEmployeeById(employeeId);
    if (subject === null) {
      return { kind: 'not-found' };
    }

    const peerGroup: PeerGroupProvenance = {
      roleCode: subject.roleCode,
      levelCode: subject.levelCode,
      countryCode: subject.countryCode,
    };

    // The population is loaded by the subject's OWN triple (AD-16) — the group is never chosen or
    // widened. `null` is an unresolvable currency/label, a data condition mapped to `unavailable`.
    const peerPopulation = await deps.repository.findPeerPopulation(peerGroup);
    if (peerPopulation === null) {
      return { kind: 'unavailable' };
    }

    // The ONE orchestrator (AD-16): as-of population filter, the n>=5 gate, median/spread/distance.
    const result = comparePeers(employeeId, peerPopulation.candidates, asOf);

    // The group's DISPLAY labels for the ONE verdict — resolved without an `is_active` filter by the
    // read (AD-16). The verdict is composed exactly once, from the same numeric result the payload
    // carries, so the sentence and the fields can never disagree.
    const group = {
      roleName: peerPopulation.roleName,
      levelLabel: peerPopulation.levelLabel,
      countryName: peerPopulation.countryName,
    };
    const verdictInput: VerdictInput =
      result.kind === 'answer'
        ? {
            kind: 'answer',
            subjectName: subject.name,
            distancePctTenths: result.distancePctTenths,
            peerMedian: result.peerMedian,
            currencyFormat: peerPopulation.currencyFormat,
            n: result.n,
            group,
            asOf,
          }
        : result.kind === 'thin-peer-group'
          ? { kind: 'thin-peer-group', n: result.n, group, asOf }
          : { kind: 'no-salary-as-of', subjectName: subject.name, asOf };

    const verdict = composeVerdict(verdictInput);
    if (verdict === null) {
      // Unrenderable labels/currency/date — a data condition, answered as `unavailable` rather than
      // a payload carrying a broken sentence.
      return { kind: 'unavailable' };
    }

    switch (result.kind) {
      case 'answer':
        return {
          kind: 'answer',
          comparison: {
            employeeId,
            asOf,
            peerGroup,
            n: result.n,
            // The group's single currency IS the subject's current-salary currency (AD-6).
            currency: result.subjectSalary.currency,
            subjectSalary: toBoundaryMoney(result.subjectSalary),
            peerMedian: toBoundaryMoney(result.peerMedian),
            spread: {
              min: toBoundaryMoney(result.spread.min),
              max: toBoundaryMoney(result.spread.max),
            },
            distancePct: formatDistancePct(result.distancePctTenths),
            verdict,
          },
        };
      case 'thin-peer-group':
        return {
          kind: 'refusal',
          refusal: {
            reason: 'thin-peer-group',
            peerGroup,
            counts: { n: result.n },
            asOf,
            verdict,
          },
        };
      case 'no-salary-as-of':
        return {
          kind: 'refusal',
          refusal: { reason: 'no-salary-as-of', asOf, verdict },
        };
    }
  } catch {
    return { kind: 'unavailable' };
  }
}
