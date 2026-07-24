import { describe, expect, it } from 'vitest';

import { createSeededPrng } from '@/adapters/prng';
import { createUuidV7Generator } from '@/adapters/id';
import type { NewEmployeeWithSalary } from '@/application/ports/employee-repository';
import { SEED, SEED_AS_OF as AS_OF, SEED_EPOCH_MS as FIXED_EPOCH_MS } from '@/application/seed/config';
import {
  generatePopulation,
  SEED_POPULATION_SIZE,
  type PopulationDeps,
  type SeedReferences,
} from '@/application/seed/population';

// Test-first (Law 1 / AD-23). The five structural obligations are proven HERE, over the full 10,000
// generated batch — engineered by construction, never left to the draw (AD-14). The generator is
// pure of DB and clock, so the whole layout is assertable in the fast suite.

/** The real reference taxonomy the migration ships — 25 roles, 6 levels (rank 1-6), 8 countries. */
const ROLE_CODES = [
  'software_engineer',
  'product_manager',
  'data_scientist',
  'designer',
  'sales_executive',
  'quality_engineer',
  'site_reliability_engineer',
  'security_engineer',
  'data_engineer',
  'data_analyst',
  'ux_researcher',
  'technical_writer',
  'solutions_architect',
  'program_manager',
  'business_analyst',
  'marketing_specialist',
  'content_strategist',
  'account_manager',
  'sales_engineer',
  'customer_support_specialist',
  'financial_analyst',
  'recruiter',
  'people_partner',
  'operations_specialist',
  'legal_counsel',
];

const LEVELS = [
  { code: 'L1', rank: 1 },
  { code: 'L2', rank: 2 },
  { code: 'L3', rank: 3 },
  { code: 'L4', rank: 4 },
  { code: 'M1', rank: 5 },
  { code: 'M2', rank: 6 },
];

const COUNTRIES = [
  { code: 'IN', currency: 'INR' },
  { code: 'US', currency: 'USD' },
  { code: 'GB', currency: 'GBP' },
  { code: 'DE', currency: 'EUR' },
  { code: 'JP', currency: 'JPY' },
  { code: 'BR', currency: 'BRL' },
  { code: 'NO', currency: 'NOK' },
  { code: 'CA', currency: 'CAD' },
];

const CURRENCY_EXPONENTS = new Map<string, number>([
  ['INR', 2],
  ['USD', 2],
  ['GBP', 2],
  ['EUR', 2],
  ['JPY', 0], // The case that proves the exponent is never hard-coded 100 (Law 4 / AD-4).
  ['BRL', 2],
  ['NOK', 2],
  ['CAD', 2],
]);

function realReferences(): SeedReferences {
  return {
    roles: ROLE_CODES,
    levels: LEVELS,
    countries: COUNTRIES,
    currencyExponents: CURRENCY_EXPONENTS,
  };
}

function buildDeps(seed: number, references: SeedReferences = realReferences()): PopulationDeps {
  const prng = createSeededPrng(seed);
  const idGenerator = createUuidV7Generator(
    () => FIXED_EPOCH_MS,
    (n) => prng.nextBytes(n),
  );
  return { prng, idGenerator, references, asOf: AS_OF };
}

/** A stable serialisation for byte-reproducibility comparison (bigint → string). */
function serialize(batch: readonly NewEmployeeWithSalary[]): string {
  return JSON.stringify(batch, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}

function cellKey(row: NewEmployeeWithSalary): string {
  return `${row.roleCode}|${row.levelCode}|${row.countryCode}`;
}

function groupByCell(batch: readonly NewEmployeeWithSalary[]): Map<string, NewEmployeeWithSalary[]> {
  const cells = new Map<string, NewEmployeeWithSalary[]>();
  for (const row of batch) {
    const key = cellKey(row);
    const bucket = cells.get(key);
    if (bucket === undefined) {
      cells.set(key, [row]);
    } else {
      bucket.push(row);
    }
  }
  return cells;
}

/** AD-3-style median (ascending; odd → middle, even → mean of the two middle). Amounts fit a double. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] as number;
  }
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

const amountsOf = (rows: readonly NewEmployeeWithSalary[]): number[] =>
  rows.map((row) => Number(row.salary.amountMinor));

const rankByLevel = new Map(LEVELS.map((level) => [level.code, level.rank]));

describe('generatePopulation — size and reproducibility', () => {
  it('emits exactly 10,000 employees, each with an opening salary record priced in its country currency', () => {
    const batch = generatePopulation(buildDeps(SEED));

    expect(batch).toHaveLength(SEED_POPULATION_SIZE);

    const currencyByCountry = new Map(COUNTRIES.map((c) => [c.code, c.currency]));
    for (const row of batch) {
      expect(row.salary.currency).toBe(currencyByCountry.get(row.countryCode));
      expect(row.salary.amountMinor).toBeGreaterThan(0n);
      // No future-dating: hire and opening-effective dates both ≤ asOf (AD-18).
      expect(row.effectiveFrom).toEqual(row.hireDate);
      expect(
        row.hireDate.year < AS_OF.year ||
          (row.hireDate.year === AS_OF.year &&
            (row.hireDate.month < AS_OF.month ||
              (row.hireDate.month === AS_OF.month && row.hireDate.day <= AS_OF.day))),
      ).toBe(true);
    }
  });

  it('is byte-reproducible: two same-seed runs produce an identical batch (NFR8)', () => {
    const first = generatePopulation(buildDeps(SEED));
    const second = generatePopulation(buildDeps(SEED));

    expect(serialize(second)).toEqual(serialize(first));
    // ids are reproduced too, not merely the amounts.
    expect(second.map((r) => r.employeeId)).toEqual(first.map((r) => r.employeeId));
    expect(new Set(first.map((r) => r.employeeId)).size).toBe(SEED_POPULATION_SIZE);
  });

  it('diverges for a different seed', () => {
    const a = generatePopulation(buildDeps(SEED));
    const b = generatePopulation(buildDeps(SEED + 1));

    expect(serialize(b)).not.toEqual(serialize(a));
  });
});

describe('the five structural obligations, over the full batch', () => {
  const batch = generatePopulation(buildDeps(SEED));
  const cells = groupByCell(batch);

  it('(a) contains both dense cells (n ≥ 5) and deliberately thin cells (1–3 people)', () => {
    const sizes = [...cells.values()].map((rows) => rows.length);
    expect(sizes.some((n) => n >= 5)).toBe(true);
    expect(sizes.some((n) => n >= 1 && n <= 3)).toBe(true);

    // Comparable dense peer groups are the point of the obligation — the demo needs MANY cells at or
    // above the n ≥ 5 threshold, not just the handful of planted ones. `some(n >= 5)` alone would
    // stay green even if every fill cell starved to 1–4 people (e.g. after a taxonomy that grows the
    // grid faster than the population). Assert broad density so that starvation fails loudly.
    expect(sizes.filter((n) => n >= 5).length).toBeGreaterThan(1_000);

    // The planted thin cells hold exactly what they were built to.
    expect(cells.get('recruiter|M2|JP')).toHaveLength(1);
    expect(cells.get('technical_writer|M1|BR')).toHaveLength(3);
  });

  it('(b) plants an outlier ≥ 2× its cell median and one ≤ 0.5× its cell median (CAP-6)', () => {
    const cell = cells.get('product_manager|L2|US');
    expect(cell).toBeDefined();
    const amounts = amountsOf(cell ?? []);
    const cellMedian = median(amounts);

    expect(Math.max(...amounts)).toBeGreaterThanOrEqual(2 * cellMedian);
    expect(Math.min(...amounts)).toBeLessThanOrEqual(0.5 * cellMedian);
  });

  it('(c) has gap cells with ≥ 5 of each gender where women earn less at the same role/level/country (CAP-7)', () => {
    // Both planted gap cells feed the CAP-7 demo (they exist for redundancy), so assert the property
    // on EACH — testing only the US cell would let the GB cell silently regress.
    const gapCellKeys = ['software_engineer|L3|US', 'data_scientist|L3|GB'];
    for (const key of gapCellKeys) {
      const cell = cells.get(key);
      expect(cell, key).toBeDefined();
      const men = (cell ?? []).filter((r) => r.gender === 'MALE');
      const women = (cell ?? []).filter((r) => r.gender === 'FEMALE');

      expect(men.length, `${key} men`).toBeGreaterThanOrEqual(5);
      expect(women.length, `${key} women`).toBeGreaterThanOrEqual(5);
      expect(median(amountsOf(women)), `${key} women median < men median`).toBeLessThan(
        median(amountsOf(men)),
      );
    }
  });

  it('(d) clusters women into the lowest levels, distinct from the gap cells (CAP-8)', () => {
    const GAP_CELL_KEYS = new Set(['software_engineer|L3|US', 'data_scientist|L3|GB']);

    // Aggregate org-wide EXCLUDING the gap cells, so the clustering effect is provably separate.
    let lowFemale = 0;
    let lowTotal = 0;
    let highFemale = 0;
    let highTotal = 0;
    for (const row of batch) {
      if (GAP_CELL_KEYS.has(cellKey(row))) {
        continue;
      }
      const rank = rankByLevel.get(row.levelCode);
      const isLow = rank === 1 || rank === 2;
      const isHigh = rank === 5 || rank === 6;
      if (isLow) {
        lowTotal += 1;
        if (row.gender === 'FEMALE') lowFemale += 1;
      } else if (isHigh) {
        highTotal += 1;
        if (row.gender === 'FEMALE') highFemale += 1;
      }
    }

    const lowShare = lowFemale / lowTotal;
    const highShare = highFemale / highTotal;

    // A clear margin, not a photo finish.
    expect(lowShare).toBeGreaterThan(highShare + 0.15);

    // The gap cells are at L3 — neither a lowest nor a highest level — so the two effects cannot be
    // the same cell (the epic's "never seed both effects in one cell" constraint).
    for (const key of GAP_CELL_KEYS) {
      const level = key.split('|')[1] as string;
      expect(['L1', 'L2', 'M1', 'M2']).not.toContain(level);
    }
  });
});

describe('generatePopulation — totality for codes outside the tuning tables', () => {
  it('still emits 10,000 for reference codes it has no tuned base for', () => {
    const references: SeedReferences = {
      roles: [...ROLE_CODES, 'zz_unknown_role'],
      levels: LEVELS,
      countries: [...COUNTRIES, { code: 'ZZ', currency: 'ZZZ' }],
      // The unknown currency still needs an exponent — only the role/country BASE fallbacks are
      // exercised here; a missing exponent is a hard error (see the throw test below).
      currencyExponents: new Map([...CURRENCY_EXPONENTS, ['ZZZ', 2]]),
    };

    const batch = generatePopulation(buildDeps(SEED, references));
    expect(batch).toHaveLength(SEED_POPULATION_SIZE);
    // The unknown cells were still populated and priced positively.
    const unknown = batch.filter((r) => r.roleCode === 'zz_unknown_role' || r.countryCode === 'ZZ');
    expect(unknown.length).toBeGreaterThan(0);
    for (const row of unknown) {
      expect(row.salary.amountMinor).toBeGreaterThan(0n);
    }
  });

  it('throws when a required planted cell references a level the taxonomy lacks', () => {
    const references: SeedReferences = {
      roles: ROLE_CODES,
      levels: LEVELS.filter((level) => level.code !== 'L3'), // the gap cells need L3.
      countries: COUNTRIES,
      currencyExponents: CURRENCY_EXPONENTS,
    };

    expect(() => generatePopulation(buildDeps(SEED, references))).toThrow(/L3/);
  });

  it('throws when a required planted cell references a role the taxonomy lacks', () => {
    const references: SeedReferences = {
      // 'software_engineer' is the first gap cell's role — drop it and the planted-cell role check
      // must fail cleanly rather than emit an untaxonomied employee and an opaque FK violation.
      roles: ROLE_CODES.filter((code) => code !== 'software_engineer'),
      levels: LEVELS,
      countries: COUNTRIES,
      currencyExponents: CURRENCY_EXPONENTS,
    };

    expect(() => generatePopulation(buildDeps(SEED, references))).toThrow(/role software_engineer/);
  });

  it('throws (never silently defaults to exponent 2) when an active country currency has no exponent (AD-4)', () => {
    // JPY dropped from the exponent map: a silent fallback of 2 would persist yen inflated 100×.
    const references: SeedReferences = {
      roles: ROLE_CODES,
      levels: LEVELS,
      countries: COUNTRIES, // JP (JPY) is active…
      currencyExponents: new Map(
        [...CURRENCY_EXPONENTS].filter(([code]) => code !== 'JPY'), // …but its exponent is gone.
      ),
    };

    expect(() => generatePopulation(buildDeps(SEED, references))).toThrow(/exponent for currency JPY/);
  });
});
