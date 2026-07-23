import { describe, expect, it } from 'vitest';

import type { Money } from '@/domain/money';
import {
  comparePeers,
  distancePctTenths,
  formatDistancePct,
  MIN_PEER_GROUP_SIZE,
  type PeerCandidate,
} from '@/domain/peer-comparison';
import type { PlainDate } from '@/domain/plain-date';
import type { SalaryRecordView } from '@/domain/salary-timeline';

// Test-first (Law 1 / AD-23): red before `src/domain/peer-comparison.ts` exists.
//
// Three things live here, all PURE and all TOTAL:
//   - `distancePctTenths` — the signed distance from the median, in tenths-of-percent, computed
//     EXACTLY over `bigint` minor units (AD-5). The number shown is the number judged.
//   - `formatDistancePct` — that signed tenths value rendered as a one-decimal string.
//   - `comparePeers` — the as-of population filter (AD-16) + the n>=5 gate + the answer/refusal.
//
// Nothing here reads a clock: `asOf` is a required argument (Law 6 / AD-11). The in-population test
// is `resolveCurrentSalary(history, asOf) !== null` — the ONE resolver (AD-8), never a second one.

const INR = (amountMinor: bigint): Money => ({ amountMinor, currency: 'INR' });
const date = (year: number, month: number, day: number): PlainDate => ({ year, month, day });

const AS_OF = date(2026, 7, 16);
const IN_FORCE = date(2021, 6, 1); // effective well before AS_OF
const FUTURE = date(2027, 1, 1); // effective AFTER AS_OF — outside the population

function rec(id: string, effectiveFrom: PlainDate, seq: bigint, amountMinor: bigint): SalaryRecordView {
  return { id, effectiveFrom, seq, salary: INR(amountMinor) };
}

/** A candidate whose single record is in force at AS_OF (unless `effectiveFrom` says otherwise). */
function peer(employeeId: string, amountMinor: bigint, effectiveFrom: PlainDate = IN_FORCE): PeerCandidate {
  return { employeeId, salaryHistory: [rec(`${employeeId}-r`, effectiveFrom, 1n, amountMinor)] };
}

describe('distancePctTenths — signed, EXACT, half-up (AD-5)', () => {
  it('is NEGATIVE when the subject is below the median', () => {
    // (92 - 100) / 100 = -8.0% → -80 tenths.
    expect(distancePctTenths(92n, 100n)).toBe(-80n);
  });

  it('is POSITIVE when the subject is above the median', () => {
    // (120 - 100) / 100 = +20.0% → 200 tenths.
    expect(distancePctTenths(120n, 100n)).toBe(200n);
  });

  it('is ZERO when the subject sits exactly on the median', () => {
    expect(distancePctTenths(100n, 100n)).toBe(0n);
  });

  it('matches the golden verdict figure — 8.0% under a ₹23,40,000 median', () => {
    // medianMinor = 234_000_000 paise; a subject 8% under is 215_280_000. Exactly -80 tenths.
    expect(distancePctTenths(215_280_000n, 234_000_000n)).toBe(-80n);
  });

  it('rounds the MAGNITUDE half-up to one decimal, EXACTLY — 20.05% becomes 20.1, not 20.0', () => {
    // The whole reason this is bigint and not a double: (2401 - 2000)/2000 = 20.05% = 200.5 tenths,
    // which rounds half-up to 201 → "20.1". In IEEE double, 0.2005 * 1000 is 200.4999… → 200, and
    // the figure shown would not be the figure judged.
    expect(distancePctTenths(2401n, 2000n)).toBe(201n);
  });

  it('reapplies the sign AFTER rounding the magnitude — -20.05% becomes -20.1', () => {
    expect(distancePctTenths(1599n, 2000n)).toBe(-201n);
  });

  it('is TOTAL — a zero median (never reached past the n>=5 gate) yields 0 rather than throwing', () => {
    // `medianMinor > 0` by construction (salaries are > 0, the group is non-empty), so this arm is
    // unreachable through `comparePeers`. It exists so a direct caller gets a value, not an
    // exception — the module-wide totality contract.
    expect(distancePctTenths(5n, 0n)).toBe(0n);
  });
});

describe('formatDistancePct — signed one-decimal string', () => {
  it('renders a negative distance with a leading minus', () => {
    expect(formatDistancePct(-80n)).toBe('-8.0');
  });

  it('renders zero as "0.0" — no sign', () => {
    expect(formatDistancePct(0n)).toBe('0.0');
  });

  it('renders a positive distance without a plus', () => {
    expect(formatDistancePct(205n)).toBe('20.5');
  });

  it('keeps the trailing .0 on a whole-percent distance', () => {
    expect(formatDistancePct(200n)).toBe('20.0');
  });

  it('renders a sub-1% magnitude with a leading zero major part', () => {
    expect(formatDistancePct(-5n)).toBe('-0.5');
    expect(formatDistancePct(5n)).toBe('0.5');
  });
});

describe('comparePeers — the as-of population, the gate, and the answer/refusal (AD-16)', () => {
  it('exposes the fixed domain constant MIN_PEER_GROUP_SIZE = 5 (AD-16, not the settings threshold)', () => {
    expect(MIN_PEER_GROUP_SIZE).toBe(5);
  });

  it('answers with median, spread, and signed distance for an ODD group of 5', () => {
    const candidates = [
      peer('subject', 900_000n),
      peer('p1', 800_000n),
      peer('p2', 1_000_000n),
      peer('p3', 1_100_000n),
      peer('p4', 1_200_000n),
    ];

    const result = comparePeers('subject', candidates, AS_OF);

    // Sorted currents [800k, 900k, 1000k, 1100k, 1200k] → median 1000k; spread 800k–1200k.
    // Subject 900k is (900k-1000k)/1000k = -10.0% → -100 tenths.
    expect(result).toEqual({
      kind: 'answer',
      n: 5,
      subjectSalary: INR(900_000n),
      peerMedian: INR(1_000_000n),
      spread: { min: INR(800_000n), max: INR(1_200_000n) },
      distancePctTenths: -100n,
    });
  });

  it('takes the half-up mean of the two middle salaries for an EVEN group of 6', () => {
    const candidates = [
      peer('subject', 900_000n),
      peer('p1', 800_000n),
      peer('p2', 1_000_000n),
      peer('p3', 1_100_000n),
      peer('p4', 1_200_000n),
      peer('p5', 1_300_000n),
    ];

    const result = comparePeers('subject', candidates, AS_OF);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') return;
    expect(result.n).toBe(6);
    // Two middle salaries 1000k and 1100k → mean 1050k.
    expect(result.peerMedian).toEqual(INR(1_050_000n));
    // (900k - 1050k)/1050k = -14.285…% → magnitude half-up 143 → -143 tenths.
    expect(result.distancePctTenths).toBe(-143n);
  });

  it('carries a POSITIVE distance when the subject earns above the median', () => {
    const candidates = [
      peer('subject', 1_200_000n),
      peer('p1', 800_000n),
      peer('p2', 900_000n),
      peer('p3', 1_000_000n),
      peer('p4', 1_100_000n),
    ];

    const result = comparePeers('subject', candidates, AS_OF);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') return;
    // median 1000k; subject 1200k → +20.0% → 200 tenths.
    expect(result.distancePctTenths).toBe(200n);
  });

  it('carries the subject current-salary currency on every monetary field (single-currency group)', () => {
    const candidates = [
      peer('subject', 900_000n),
      peer('p1', 800_000n),
      peer('p2', 1_000_000n),
      peer('p3', 1_100_000n),
      peer('p4', 1_200_000n),
    ];

    const result = comparePeers('subject', candidates, AS_OF);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') return;
    expect(result.subjectSalary.currency).toBe('INR');
    expect(result.peerMedian.currency).toBe('INR');
    expect(result.spread.min.currency).toBe('INR');
    expect(result.spread.max.currency).toBe('INR');
  });

  it('REFUSES with thin-peer-group and the exact count when fewer than 5 are in-population', () => {
    const candidates = [peer('subject', 900_000n), peer('p1', 800_000n), peer('p2', 1_000_000n)];

    const result = comparePeers('subject', candidates, AS_OF);

    expect(result).toEqual({ kind: 'thin-peer-group', n: 3 });
  });

  it('never widens the group — a group of exactly 4 in-population still refuses', () => {
    const candidates = [
      peer('subject', 900_000n),
      peer('p1', 800_000n),
      peer('p2', 1_000_000n),
      peer('p3', 1_100_000n),
    ];

    expect(comparePeers('subject', candidates, AS_OF)).toEqual({ kind: 'thin-peer-group', n: 4 });
  });

  it('drops a peer whose only record is future at AS_OF, and may cross below 5 into a refusal', () => {
    // Five candidates, but p4's only record takes effect AFTER AS_OF — so it is outside the
    // population (AD-16) and the group is really 4. The count is recomputed, never a COUNT query.
    const candidates = [
      peer('subject', 900_000n),
      peer('p1', 800_000n),
      peer('p2', 1_000_000n),
      peer('p3', 1_100_000n),
      peer('p4', 1_200_000n, FUTURE),
    ];

    expect(comparePeers('subject', candidates, AS_OF)).toEqual({ kind: 'thin-peer-group', n: 4 });
  });

  it('excludes a candidate with an EMPTY history — no current salary means out of population', () => {
    const candidates = [
      peer('subject', 900_000n),
      peer('p1', 800_000n),
      peer('p2', 1_000_000n),
      peer('p3', 1_100_000n),
      { employeeId: 'p4', salaryHistory: [] },
    ];

    expect(comparePeers('subject', candidates, AS_OF)).toEqual({ kind: 'thin-peer-group', n: 4 });
  });

  it('resolves a same-day correction among peers through the ONE resolver (AD-8) into the statistic', () => {
    // p-correction has a typo (seq 10) and a same-day correction (seq 11). The correction wins, so
    // 5_000_000 enters the population, not the typo's 100. Proven by the spread MINIMUM: were the
    // typo current, the min would be 100 rather than 1_000_000.
    const corrected: PeerCandidate = {
      employeeId: 'p-correction',
      salaryHistory: [
        rec('typo', date(2026, 3, 1), 10n, 100n),
        rec('fix', date(2026, 3, 1), 11n, 5_000_000n),
      ],
    };
    const candidates = [
      peer('subject', 1_000_000n),
      peer('p1', 1_000_000n),
      peer('p2', 1_000_000n),
      peer('p3', 1_000_000n),
      corrected,
    ];

    const result = comparePeers('subject', candidates, AS_OF);

    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') return;
    expect(result.spread).toEqual({ min: INR(1_000_000n), max: INR(5_000_000n) });
  });

  describe('no-salary-as-of — a distinct refusal, never n=0 arithmetic', () => {
    it('refuses when the subject has no salary in force at AS_OF', () => {
      // The subject's only record is future; the peers are plentiful and in-population, but there is
      // no subject salary to compare, so this is `no-salary-as-of`, NOT thin-peer-group and NOT an
      // n=0 median.
      const candidates = [
        peer('subject', 900_000n, FUTURE),
        peer('p1', 800_000n),
        peer('p2', 1_000_000n),
        peer('p3', 1_100_000n),
        peer('p4', 1_200_000n),
      ];

      expect(comparePeers('subject', candidates, AS_OF)).toEqual({ kind: 'no-salary-as-of' });
    });

    it('refuses when the subject is not among the candidates at all', () => {
      // A total function: with no subject row there is no subject salary, which reads as the same
      // "no salary as of" refusal rather than an exception.
      const candidates = [
        peer('p1', 800_000n),
        peer('p2', 1_000_000n),
        peer('p3', 1_100_000n),
        peer('p4', 1_200_000n),
        peer('p5', 1_300_000n),
      ];

      expect(comparePeers('subject', candidates, AS_OF)).toEqual({ kind: 'no-salary-as-of' });
    });
  });
});
