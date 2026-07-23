import { describe, expect, it } from 'vitest';

import { formatOutliersCsv } from '@/adapters/csv/format-outliers-csv';
import type { OutlierReport } from '@/application/use-cases/outliers';
import type { CurrencyFormat } from '@/domain/money';
import type { PlainDate } from '@/domain/plain-date';

// Test-first (Law 1 / AD-23): red before `src/adapters/csv/format-outliers-csv.ts` exists.
//
// The CSV serializer is PURE (no Date, no random, no I/O) and consumes 7-1's finalized `OutlierReport`
// UNMODIFIED. It RE-DERIVES no statistic (Law 2 / Law 8): `distancePct`, `n`, `peerMedian`, salary,
// and the labels all arrive computed. Money crosses through the ONE formatter
// (`formatMoney(fromBoundaryMoney(...))`) with the `CurrencyFormat` resolved by the row's own
// currency code (Law 4 / AD-4) — never a bare number, never a raw minor string; a currency that
// cannot format leaves that money cell BLANK (fail closed).

const INR: CurrencyFormat = { code: 'INR', symbol: '₹', minorUnitExponent: 2, groupingStyle: 'INDIAN' };

const ASOF: PlainDate = { year: 2026, month: 7, day: 16 };

const HEADER =
  'Status,Employee,Role,Level,Country,Peers,Currency,Salary,Peer median,Distance %,As of,Threshold %,Reason';

function report(overrides: Partial<OutlierReport> = {}): OutlierReport {
  return {
    asOf: ASOF,
    thresholdPct: 20,
    groups: [],
    ...overrides,
  };
}

function outlierGroup() {
  return {
    kind: 'outliers' as const,
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
    peerMedian: { amountMinor: '23400000', currency: 'INR' },
    findings: [
      {
        employeeId: 'e1',
        employeeName: 'Priya Nair',
        salary: { amountMinor: '30000000', currency: 'INR' },
        distancePct: '28.4',
      },
    ],
  };
}

function thinGroup() {
  return {
    kind: 'refusal' as const,
    peerGroup: {
      roleCode: 'SWE',
      levelCode: 'L3',
      countryCode: 'IN',
      roleName: 'Software Engineer',
      levelLabel: 'L3',
      countryName: 'India',
    },
    counts: { n: 3 },
    reason: 'thin-peer-group' as const,
  };
}

function lines(csv: string): readonly string[] {
  return csv.split('\r\n');
}

describe('formatOutliersCsv — the header and provenance columns', () => {
  it('emits the header row even for an empty report (header-only)', () => {
    const csv = formatOutliersCsv(report(), [INR]);
    expect(lines(csv)).toEqual([HEADER]);
  });
});

describe('formatOutliersCsv — one row per outlier finding (money through the one formatter)', () => {
  it('formats salary and peer median via formatMoney, quoting the comma-bearing cells', () => {
    const csv = formatOutliersCsv(report({ groups: [outlierGroup()] }), [INR]);

    expect(lines(csv)).toEqual([
      HEADER,
      'outlier,Priya Nair,Software Engineer,L4,India,6,INR,"₹3,00,000 INR","₹2,34,000 INR",28.4,2026-07-16,20,',
    ]);
  });

  it('leaves the money cells BLANK when the currency cannot be resolved (fail closed)', () => {
    const csv = formatOutliersCsv(report({ groups: [outlierGroup()] }), []);

    // No raw minor string anywhere — the salary and peer-median cells are empty, not "30000000".
    expect(csv).not.toContain('30000000');
    expect(csv).not.toContain('23400000');
    expect(lines(csv)[1]).toBe('outlier,Priya Nair,Software Engineer,L4,India,6,INR,,,28.4,2026-07-16,20,');
  });
});

describe('formatOutliersCsv — one row per thin group (a refusal is data)', () => {
  it('names the group and its count with blank money cells and the reason', () => {
    const csv = formatOutliersCsv(report({ groups: [thinGroup()] }), [INR]);

    expect(lines(csv)).toEqual([
      HEADER,
      'refusal,,Software Engineer,L3,India,3,,,,,2026-07-16,20,Only 3 peers — too few to compare fairly',
    ]);
  });

  it('emits outlier rows and refusal rows together, in group order', () => {
    const csv = formatOutliersCsv(report({ groups: [outlierGroup(), thinGroup()] }), [INR]);

    const rows = lines(csv);
    expect(rows).toHaveLength(3);
    expect(rows[1]?.startsWith('outlier,')).toBe(true);
    expect(rows[2]?.startsWith('refusal,')).toBe(true);
  });
});

describe('formatOutliersCsv — quoting is an explicit decision (RFC 4180)', () => {
  it('quotes a field containing a comma, a quote, or a newline, escaping embedded quotes', () => {
    const group = {
      ...outlierGroup(),
      findings: [
        {
          employeeId: 'e1',
          employeeName: 'Nair, "Q"\nJr',
          salary: { amountMinor: '30000000', currency: 'INR' },
          distancePct: '28.4',
        },
      ],
    };
    const csv = formatOutliersCsv(report({ groups: [group] }), [INR]);

    // The name has a comma, a double-quote (doubled to ""), and a newline → wrapped in quotes.
    expect(csv).toContain('"Nair, ""Q""\nJr"');
  });

  it('neutralizes a formula-lead free-text cell so it opens as literal text (injection defense)', () => {
    const group = {
      ...outlierGroup(),
      findings: [
        {
          employeeId: 'e1',
          employeeName: '=HYPERLINK("http://evil")',
          salary: { amountMinor: '30000000', currency: 'INR' },
          distancePct: '28.4',
        },
      ],
    };
    const csv = formatOutliersCsv(report({ groups: [group] }), [INR]);

    // Apostrophe-prefixed (then RFC-quoted for its embedded quotes) — never a live `=…` lead.
    expect(csv).toContain(`'=HYPERLINK`);
    expect(csv).not.toContain('outlier,=HYPERLINK');
    // The numeric distance keeps its own leading `-`/digit untouched — guard is text-cells only.
    const below = { ...outlierGroup(), findings: [{ employeeId: 'e1', employeeName: 'A', salary: { amountMinor: '1', currency: 'INR' }, distancePct: '-25.2' }] };
    expect(formatOutliersCsv(report({ groups: [below] }), [INR])).toContain(',-25.2,');
  });
});

describe('formatOutliersCsv — determinism (Law 6)', () => {
  it('is byte-identical across runs for the same report', () => {
    const r = report({ groups: [outlierGroup(), thinGroup()] });
    expect(formatOutliersCsv(r, [INR])).toBe(formatOutliersCsv(r, [INR]));
  });
});
