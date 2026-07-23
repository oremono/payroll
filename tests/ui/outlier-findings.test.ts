import { describe, expect, it } from 'vitest';

import type {
  GetOutlierFindingsResult,
  OutlierFindingGroup,
} from '@/application/use-cases/outliers';
import type { PlainDate } from '@/domain/plain-date';
import {
  buildOutlierFindings,
  OUTLIER_FINDINGS_UNREADABLE_HEADING,
  OUTLIER_FINDINGS_UNREADABLE_STATEMENT,
} from '@/ui/outlier-findings-vm';

// Test-first (Law 1 / AD-23): red before `src/ui/outlier-findings-vm.ts` exists.
//
// Same split, and the same reason, as `peer-comparison-vm.ts`: no jsdom, no @testing-library, and
// `src/ui/*.tsx` sits outside the coverage gate. Every judgement the findings surface makes — arm
// selection, the badge string from the signed `distancePct`, the role · level · country label, the
// peer-count, the inline refusal clause, the zero-state statement — lives in this PURE builder, so
// `outlier-findings.tsx` is left with markup and nothing to get wrong.
//
// ## It consumes story 7-1's finalized payload UNMODIFIED (Law 7 / AD-24)
//
// `GetOutlierFindingsResult` is used exactly as 7-1 finalized it. The builder RE-DERIVES no
// statistic (Law 2 / Law 8): `distancePct`, `n`, `peerMedian`, and the labels all arrive computed.
// The rows carry NO money — only the CSV export formats money. The builder derives display text and
// selects the arm.

const ASOF: PlainDate = { year: 2026, month: 7, day: 16 };

function group(overrides: Partial<Extract<OutlierFindingGroup, { kind: 'outliers' }>> = {}): OutlierFindingGroup {
  return {
    kind: 'outliers',
    peerGroup: {
      roleCode: 'SWE',
      levelCode: 'L4',
      countryCode: 'IN',
      roleName: 'Software Engineer',
      levelLabel: 'L4',
      countryName: 'India',
    },
    n: 6,
    currency: 'INR',
    peerMedian: { amountMinor: '234000000', currency: 'INR' },
    findings: [
      { employeeId: 'e1', employeeName: 'Priya Nair', salary: { amountMinor: '300000000', currency: 'INR' }, distancePct: '28.4' },
    ],
    ...overrides,
  };
}

function refusalGroup(n: number): OutlierFindingGroup {
  return {
    kind: 'refusal',
    peerGroup: {
      roleCode: 'SWE',
      levelCode: 'L3',
      countryCode: 'IN',
      roleName: 'Software Engineer',
      levelLabel: 'L3',
      countryName: 'India',
    },
    counts: { n },
    reason: 'thin-peer-group',
  };
}

function findings(groups: readonly OutlierFindingGroup[], thresholdPct = 20): GetOutlierFindingsResult {
  return { kind: 'findings', report: { asOf: ASOF, thresholdPct, groups } };
}

describe('buildOutlierFindings — outlier sections (DR8)', () => {
  it('builds one section per group, naming role · level · country and carrying n', () => {
    const vm = buildOutlierFindings(findings([group()]), ASOF);

    expect(vm.kind).toBe('findings');
    if (vm.kind !== 'findings') return;
    expect(vm.sections).toHaveLength(1);
    const section = vm.sections[0];
    expect(section?.kind).toBe('outliers');
    if (section?.kind !== 'outliers') return;
    expect(section.label).toBe('Software Engineer · L4 · India');
    expect(section.n).toBe(6);
    expect(section.rows).toHaveLength(1);
    expect(section.rows[0]?.name).toBe('Priya Nair');
  });

  it('carries NO money on a row — only name, badge text, and the raw distancePct', () => {
    const vm = buildOutlierFindings(findings([group()]), ASOF);
    if (vm.kind !== 'findings') throw new Error('expected findings');
    const section = vm.sections[0];
    if (section?.kind !== 'outliers') throw new Error('expected outliers');
    const row = section.rows[0];
    expect(Object.keys(row ?? {}).sort()).toEqual(['badgeText', 'distancePct', 'employeeId', 'name']);
  });
});

describe('buildOutlierFindings — the badge derives direction from the sign (DR4)', () => {
  it('renders a non-negative distance as "+X.X% above median"', () => {
    const vm = buildOutlierFindings(
      findings([group({ findings: [{ employeeId: 'e1', employeeName: 'A', salary: { amountMinor: '1', currency: 'INR' }, distancePct: '28.4' }] })]),
      ASOF,
    );
    if (vm.kind !== 'findings') throw new Error('expected findings');
    const section = vm.sections[0];
    if (section?.kind !== 'outliers') throw new Error('expected outliers');
    expect(section.rows[0]?.badgeText).toBe('+28.4% above median');
    expect(section.rows[0]?.distancePct).toBe('28.4');
  });

  it('renders a negative distance as "X.X% below median" (the payload already carries the -)', () => {
    const vm = buildOutlierFindings(
      findings([group({ findings: [{ employeeId: 'e1', employeeName: 'A', salary: { amountMinor: '1', currency: 'INR' }, distancePct: '-25.2' }] })]),
      ASOF,
    );
    if (vm.kind !== 'findings') throw new Error('expected findings');
    const section = vm.sections[0];
    if (section?.kind !== 'outliers') throw new Error('expected outliers');
    expect(section.rows[0]?.badgeText).toBe('-25.2% below median');
    expect(section.rows[0]?.distancePct).toBe('-25.2');
  });

  it('preserves finding order as the payload gives it (already sorted by the use-case)', () => {
    const vm = buildOutlierFindings(
      findings([
        group({
          findings: [
            { employeeId: 'e1', employeeName: 'First', salary: { amountMinor: '1', currency: 'INR' }, distancePct: '40.0' },
            { employeeId: 'e2', employeeName: 'Second', salary: { amountMinor: '1', currency: 'INR' }, distancePct: '-30.0' },
          ],
        }),
      ]),
      ASOF,
    );
    if (vm.kind !== 'findings') throw new Error('expected findings');
    const section = vm.sections[0];
    if (section?.kind !== 'outliers') throw new Error('expected outliers');
    expect(section.rows.map((r) => r.name)).toEqual(['First', 'Second']);
    expect(section.rows.map((r) => r.badgeText)).toEqual([
      '+40.0% above median',
      '-30.0% below median',
    ]);
  });
});

describe('buildOutlierFindings — inline thin-group refusal (DR8 / AD-16)', () => {
  it('builds a refusal section naming n in the italic clause', () => {
    const vm = buildOutlierFindings(findings([refusalGroup(3)]), ASOF);
    if (vm.kind !== 'findings') throw new Error('expected findings');
    const section = vm.sections[0];
    expect(section?.kind).toBe('refusal');
    if (section?.kind !== 'refusal') return;
    expect(section.label).toBe('Software Engineer · L3 · India');
    expect(section.refusalText).toBe('Only 3 peers — too few to compare fairly');
  });

  it('preserves the mixed order of outlier and refusal sections', () => {
    const vm = buildOutlierFindings(findings([group(), refusalGroup(2)]), ASOF);
    if (vm.kind !== 'findings') throw new Error('expected findings');
    expect(vm.sections.map((s) => s.kind)).toEqual(['outliers', 'refusal']);
  });
});

describe('buildOutlierFindings — zero-findings state', () => {
  it('renders the calm statement echoing the threshold and the formatted as-of date', () => {
    const vm = buildOutlierFindings(findings([], 20), ASOF);
    expect(vm).toEqual({
      kind: 'empty',
      statement: 'No outliers beyond 20% as of 16 Jul 2026. Nothing is drifting.',
    });
  });

  it('echoes whatever threshold the report was judged against', () => {
    const vm = buildOutlierFindings(findings([], 35), ASOF);
    expect(vm.kind).toBe('empty');
    if (vm.kind !== 'empty') return;
    expect(vm.statement).toBe('No outliers beyond 35% as of 16 Jul 2026. Nothing is drifting.');
  });
});

describe('buildOutlierFindings — unreadable', () => {
  it('maps an unavailable read to the shared unreadable region copy', () => {
    const vm = buildOutlierFindings({ kind: 'unavailable' }, ASOF);
    expect(vm).toEqual({
      kind: 'unreadable',
      heading: OUTLIER_FINDINGS_UNREADABLE_HEADING,
      statement: OUTLIER_FINDINGS_UNREADABLE_STATEMENT,
    });
  });
});
