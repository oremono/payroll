import { describe, expect, it } from 'vitest';

import type { GetGenderDistributionResult } from '@/application/use-cases/gender-distribution';
import type { PlainDate } from '@/domain/plain-date';
import {
  buildGenderDistribution,
  GENDER_DISTRIBUTION_UNAVAILABLE_HEADING,
  GENDER_DISTRIBUTION_UNAVAILABLE_STATEMENT,
} from '@/ui/gender-distribution-vm';

// Test-first (Law 1 / AD-23): red before `src/ui/gender-distribution-vm.ts` exists.
//
// 9-2 is the CAP-8 UI. Same VM/markup split, and the same reason, as `gender-gap-vm.ts`: no jsdom,
// no @testing-library, and `src/ui/*.tsx` sits outside the coverage gate. Every judgement the
// gender-distribution surface makes — selecting the arm, mapping `distribution.levels` to rows,
// deriving `hasPeople = total > 0`, carrying `totals` verbatim, and the empty-levels case — lives
// in the PURE builder tested here, so `gender-distribution.tsx` is left with markup and nothing to
// get wrong.
//
// ## It consumes story 9-1's finalized payload UNMODIFIED (Law 7 / AD-24)
//
// `GetGenderDistributionResult` is used exactly as 9-1 finalized it. The builder RE-DERIVES no count
// (Law 2 / Law 8): `maleN`, `femaleN`, `total`, `totals`, `levelLabel`, and the rank order all arrive
// computed. The builder only selects the arm, maps rows, and flags `hasPeople`.

const AS_OF: PlainDate = { year: 2026, month: 7, day: 16 };

function answer(
  levels: readonly {
    levelCode: string;
    levelLabel: string;
    maleN: number;
    femaleN: number;
    total: number;
  }[],
  totals: { male: number; female: number; total: number },
): GetGenderDistributionResult {
  return { kind: 'answer', distribution: { asOf: AS_OF, levels, totals } };
}

describe('buildGenderDistribution', () => {
  it('maps a multi-level answer to rows in the delivered order with counts passed through and hasPeople derived', () => {
    const vm = buildGenderDistribution(
      answer(
        [
          { levelCode: 'L1', levelLabel: 'L1', maleN: 3, femaleN: 2, total: 5 },
          { levelCode: 'L2', levelLabel: 'L2', maleN: 0, femaleN: 1, total: 1 },
        ],
        { male: 3, female: 3, total: 6 },
      ),
    );

    expect(vm).toEqual({
      kind: 'answer',
      rows: [
        { levelCode: 'L1', levelLabel: 'L1', maleN: 3, femaleN: 2, total: 5, hasPeople: true },
        { levelCode: 'L2', levelLabel: 'L2', maleN: 0, femaleN: 1, total: 1, hasPeople: true },
      ],
      totals: { male: 3, female: 3, total: 6 },
    });
  });

  it('preserves the exact delivered rank order (never re-sorts)', () => {
    const vm = buildGenderDistribution(
      answer(
        [
          { levelCode: 'L3', levelLabel: 'L3', maleN: 1, femaleN: 1, total: 2 },
          { levelCode: 'L1', levelLabel: 'L1', maleN: 2, femaleN: 2, total: 4 },
          { levelCode: 'L2', levelLabel: 'L2', maleN: 1, femaleN: 0, total: 1 },
        ],
        { male: 4, female: 3, total: 7 },
      ),
    );

    expect(vm.kind === 'answer' && vm.rows.map((row) => row.levelLabel)).toEqual(['L3', 'L1', 'L2']);
  });

  it('treats an empty population (active levels at 0/0) as an answer of zeros, never a refusal', () => {
    const vm = buildGenderDistribution(
      answer(
        [
          { levelCode: 'L1', levelLabel: 'L1', maleN: 0, femaleN: 0, total: 0 },
          { levelCode: 'L2', levelLabel: 'L2', maleN: 0, femaleN: 0, total: 0 },
        ],
        { male: 0, female: 0, total: 0 },
      ),
    );

    expect(vm).toEqual({
      kind: 'answer',
      rows: [
        { levelCode: 'L1', levelLabel: 'L1', maleN: 0, femaleN: 0, total: 0, hasPeople: false },
        { levelCode: 'L2', levelLabel: 'L2', maleN: 0, femaleN: 0, total: 0, hasPeople: false },
      ],
      totals: { male: 0, female: 0, total: 0 },
    });
  });

  it('maps a levels: [] answer to rows: [] (still an answer, never an empty table upstream)', () => {
    const vm = buildGenderDistribution(answer([], { male: 0, female: 0, total: 0 }));

    expect(vm).toEqual({
      kind: 'answer',
      rows: [],
      totals: { male: 0, female: 0, total: 0 },
    });
  });

  it('carries a single-gender level with the absent gender at 0 and both fields present', () => {
    const vm = buildGenderDistribution(
      answer(
        [
          { levelCode: 'L1', levelLabel: 'L1', maleN: 4, femaleN: 0, total: 4 },
          { levelCode: 'L2', levelLabel: 'L2', maleN: 0, femaleN: 3, total: 3 },
        ],
        { male: 4, female: 3, total: 7 },
      ),
    );

    expect(vm.kind === 'answer' && vm.rows).toEqual([
      { levelCode: 'L1', levelLabel: 'L1', maleN: 4, femaleN: 0, total: 4, hasPeople: true },
      { levelCode: 'L2', levelLabel: 'L2', maleN: 0, femaleN: 3, total: 3, hasPeople: true },
    ]);
  });

  it('carries the unique levelCode on each row (the React key) even when two levels share a display label', () => {
    // `level.name` (→ `levelLabel`) is NOT unique in the schema; `level.code` is. Two levels renamed
    // to the same label must still be distinguishable so the markup can key on `levelCode`.
    const vm = buildGenderDistribution(
      answer(
        [
          { levelCode: 'IC-3', levelLabel: 'Senior', maleN: 3, femaleN: 2, total: 5 },
          { levelCode: 'MGR-1', levelLabel: 'Senior', maleN: 1, femaleN: 4, total: 5 },
        ],
        { male: 4, female: 6, total: 10 },
      ),
    );

    expect(vm.kind === 'answer' && vm.rows.map((row) => row.levelCode)).toEqual(['IC-3', 'MGR-1']);
  });

  it('carries totals through verbatim, re-deriving no count', () => {
    const vm = buildGenderDistribution(
      answer(
        [{ levelCode: 'L1', levelLabel: 'L1', maleN: 7, femaleN: 5, total: 12 }],
        { male: 7, female: 5, total: 12 },
      ),
    );

    expect(vm.kind === 'answer' && vm.totals).toEqual({ male: 7, female: 5, total: 12 });
  });

  it('maps unavailable to the module-level heading and statement', () => {
    const vm = buildGenderDistribution({ kind: 'unavailable' });

    expect(vm).toEqual({
      kind: 'unavailable',
      heading: GENDER_DISTRIBUTION_UNAVAILABLE_HEADING,
      statement: GENDER_DISTRIBUTION_UNAVAILABLE_STATEMENT,
    });
  });

  it('is deterministic — same input yields the same output', () => {
    const input = answer(
      [{ levelCode: 'L1', levelLabel: 'L1', maleN: 3, femaleN: 2, total: 5 }],
      { male: 3, female: 2, total: 5 },
    );

    expect(buildGenderDistribution(input)).toEqual(buildGenderDistribution(input));
  });
});
