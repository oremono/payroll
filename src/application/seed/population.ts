import type { NewEmployeeWithSalary } from '@/application/ports/employee-repository';
import type { IdGenerator } from '@/application/ports/id';
import type { Prng } from '@/application/ports/prng';
import type { Gender } from '@/domain/import-row';
import { comparePlainDate, type PlainDate } from '@/domain/plain-date';
import {
  applyCountryMultiplier,
  levelProgressionFactor,
  logNormal,
  standardNormal,
} from '@/domain/salary-distribution';

/**
 * The seed's population GENERATOR (CAP-11) — DB-free, clock-free, and drawing only from the injected
 * `Prng` + `IdGenerator` ports. It emits exactly 10,000 `NewEmployeeWithSalary` for the write funnel
 * (`createEmployeesWithSalaries`) to persist; it opens no connection and reads no clock, so the fast
 * suite exercises the whole engineered layout deterministically (Law 2 / Law 6 / AD-14).
 *
 * ## Engineered, not drawn (the five obligations)
 *
 * A single distribution makes every peer group look alike and no question interesting. So the cell
 * layout is PLACED, not averaged — each structure the downstream capabilities need to demonstrate is
 * built by construction and asserted by `tests/application/population.test.ts` over the full batch:
 *
 *   (a) Comparable DENSE cells (n ≥ 5) alongside deliberately THIN cells (1–3 people, the CAP-5
 *       refusal path).
 *   (b) Planted OUTLIERS — one individual ≥ 2× and one ≤ 0.5× their cell median (CAP-6).
 *   (c) A within-group GENDER GAP cell carrying ≥ 5 of each gender, women's median below men's at the
 *       same role/level/country (CAP-7).
 *   (d) Gender CLUSTERING across levels — women's share at the two lowest levels well above their
 *       share at the two highest (CAP-8), planted in cells DISTINCT from the gap cells.
 *
 * The two gender effects live in separate cells on purpose (AD-14 / epic constraint): clustering
 * skews gender by level, and that skew is exactly what would starve the sub-threshold a within-group
 * gap needs. Gap cells sit at level L3; clustering is realised across L1/L2 (low) and M1/M2 (high) —
 * never the same cell.
 *
 * ## The distribution shape (addendum parameters)
 *
 * Log-normal WITHIN each cell (right-skew: floor below, long tail above), a role/level base scaled by
 * a per-country COST-OF-LABOUR multiplier (making the multi-currency story visible), and ~18% level
 * progression so the ladder stays monotonic with no level inversions. Money is integer minor units;
 * the exponent comes from the currency reference row (JPY 0, never a hard-coded 100 — AD-4).
 */

/** One level as the generator needs it: its code and its rank (rank drives level progression). */
export type SeedLevel = {
  readonly code: string;
  readonly rank: number;
};

/** One country as the generator needs it: its code and the currency AD-6 derives salaries in. */
export type SeedCountry = {
  readonly code: string;
  readonly currency: string;
};

/**
 * The reference taxonomy the generator draws from — never invented, always injected (AD-7). Roles,
 * levels (with ranks), countries (with their currency), and the minor-unit exponent per currency so
 * money scales correctly (JPY 0). In the composition root these come from `loadFormOptions`, which
 * carries the ranks and exponents `loadReferenceData` alone does not.
 */
export type SeedReferences = {
  readonly roles: readonly string[];
  readonly levels: readonly SeedLevel[];
  readonly countries: readonly SeedCountry[];
  readonly currencyExponents: ReadonlyMap<string, number>;
};

/** Everything `generatePopulation` needs, all deterministic or pure. */
export type PopulationDeps = {
  readonly prng: Prng;
  readonly idGenerator: IdGenerator;
  readonly references: SeedReferences;
  /** The fixed as-of date; every hire/effective date the generator emits is ≤ this (AD-18). */
  readonly asOf: PlainDate;
};

/** The population size CAP-11 fixes. Exactly this many rows come out. */
export const SEED_POPULATION_SIZE = 10_000;

/** ~18% per level — inside the ratified 15–20% band, monotonic, no inversions. */
const LEVEL_STEP = 0.18;

/** Hire dates spread across the 15 years ending at `asOf`, so tenure varies for the outlier stories. */
const DATE_SPAN_YEARS = 15;

/** Log-normal spread within an ordinary fill cell — enough skew to make a cell interesting. */
const FILL_SIGMA = 0.22;

/** The engineered outlier cell: dense and tightly clustered, so its two planted extremes stand out. */
const OUTLIER_CELL_SIZE = 50;
const OUTLIER_CELL_SIGMA = 0.12;
const OUTLIER_HIGH_FACTOR = 3; // ≥ 2× the cell median — a retention counter-offer.
const OUTLIER_LOW_FACTOR = 0.35; // ≤ 0.5× the cell median — long-tenured, never adjusted.

/** Fallbacks for any reference code outside the tuning tables — the generator stays total. */
const DEFAULT_ROLE_POINTS = 1;
const DEFAULT_COUNTRY_BASE = 50_000;

/**
 * Role base pay in currency-neutral POINTS (a mid role at the lowest level is ~1.0). Real reference
 * roles all appear; anything else takes `DEFAULT_ROLE_POINTS`.
 */
const ROLE_BASE_POINTS = new Map<string, number>([
  ['software_engineer', 1.3],
  ['product_manager', 1.55],
  ['data_scientist', 1.45],
  ['designer', 1.05],
  ['sales_executive', 1.1],
  ['quality_engineer', 1.1],
  ['site_reliability_engineer', 1.4],
  ['security_engineer', 1.45],
  ['data_engineer', 1.35],
  ['data_analyst', 1.0],
  ['ux_researcher', 1.1],
  ['technical_writer', 0.9],
  ['solutions_architect', 1.6],
  ['program_manager', 1.45],
  ['business_analyst', 1.05],
  ['marketing_specialist', 0.95],
  ['content_strategist', 0.9],
  ['account_manager', 1.05],
  ['sales_engineer', 1.25],
  ['customer_support_specialist', 0.7],
  ['financial_analyst', 1.15],
  ['recruiter', 0.9],
  ['people_partner', 1.0],
  ['operations_specialist', 0.95],
  ['legal_counsel', 1.7],
]);

/**
 * Per-country annual base at the lowest level for a 1.0-point role, in LOCAL major units. This bakes
 * cost-of-labour AND currency magnitude into one number (US 92k USD vs IN 1.5M INR vs JP 6.6M JPY),
 * which is what makes the multi-currency comparison visible rather than uniform.
 */
const COUNTRY_BASE_L1 = new Map<string, number>([
  ['US', 92_000],
  ['GB', 68_000],
  ['DE', 74_000],
  ['JP', 6_600_000],
  ['CA', 82_000],
  ['NO', 720_000],
  ['BR', 190_000],
  ['IN', 1_500_000],
]);

/**
 * The female share the FILL cells draw against, by level rank. Low ranks skew female, high ranks
 * skew male — org-wide this makes women's share at L1/L2 clearly exceed M1/M2 (CAP-8). It is applied
 * ONLY in fill cells, never in the gap cells (which sit at L3 and carry a fixed 8/8 split).
 */
function femaleProbability(rank: number): number {
  if (rank <= 1) {
    return 0.7;
  }
  if (rank === 2) {
    return 0.65;
  }
  if (rank === 3) {
    return 0.5;
  }
  if (rank === 4) {
    return 0.4;
  }
  if (rank === 5) {
    return 0.28;
  }
  return 0.22;
}

/**
 * The gender-gap cells (CAP-7): 8 men + 8 women at one role/level/country, men clustered near the
 * cell base and women clearly below it, so each gender has n ≥ 5 and women's median < men's. Two
 * cells for redundancy; both at L3, distinct from every clustering level.
 */
const GAP_CELLS: readonly { readonly role: string; readonly level: string; readonly country: string }[] = [
  { role: 'software_engineer', level: 'L3', country: 'US' },
  { role: 'data_scientist', level: 'L3', country: 'GB' },
];

/** Eight men clustered around the cell base (median factor ≈ 1.035). */
const GAP_MALE_FACTORS = [0.95, 0.98, 1.0, 1.02, 1.05, 1.08, 1.1, 1.12] as const;
/** Eight women clearly below it (median factor ≈ 0.75) — the within-group gap. */
const GAP_FEMALE_FACTORS = [0.68, 0.7, 0.72, 0.74, 0.76, 0.78, 0.8, 0.82] as const;

/** The planted outlier cell (CAP-6): dense and tight, with two engineered extremes. */
const OUTLIER_CELL = { role: 'product_manager', level: 'L2', country: 'US' } as const;

/**
 * Deliberately thin cells (CAP-5): each holds 1–3 people and nothing else, so the below-threshold
 * refusal path is demonstrable. All at high levels and assigned MALE, consistent with the clustering
 * skew rather than fighting it.
 */
const THIN_CELLS: readonly {
  readonly role: string;
  readonly level: string;
  readonly country: string;
  readonly count: number;
}[] = [
  { role: 'legal_counsel', level: 'M2', country: 'NO', count: 2 },
  { role: 'recruiter', level: 'M2', country: 'JP', count: 1 },
  { role: 'technical_writer', level: 'M1', country: 'BR', count: 3 },
  { role: 'content_strategist', level: 'M2', country: 'DE', count: 2 },
  { role: 'ux_researcher', level: 'M2', country: 'CA', count: 1 },
];

function cellKey(role: string, level: string, country: string): string {
  return `${role}|${level}|${country}`;
}

function requirePresent<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

/**
 * Generate the fixed 10,000-employee population. Deterministic in `deps.prng`/`deps.idGenerator`:
 * two calls with the same seed produce a byte-identical batch (NFR8).
 */
export function generatePopulation(deps: PopulationDeps): readonly NewEmployeeWithSalary[] {
  const { prng, idGenerator, references, asOf } = deps;

  const levelByCode = new Map(references.levels.map((level) => [level.code, level]));
  const countryByCode = new Map(references.countries.map((country) => [country.code, country]));
  const roleSet = new Set(references.roles);

  // Fail loud on a missing exponent rather than silently defaulting to 2 (AD-4): a dropped
  // currency would otherwise persist a JPY-like (exponent-0) salary inflated 100×.
  const exponentOf = (currency: string): number => {
    const e = references.currencyExponents.get(currency);
    if (e === undefined) {
      throw new Error(`no minor-unit exponent for currency ${currency}`);
    }
    return e;
  };

  const cellMedianMinor = (roleCode: string, level: SeedLevel, country: SeedCountry): number => {
    const rolePoints = ROLE_BASE_POINTS.get(roleCode) ?? DEFAULT_ROLE_POINTS;
    const levelFactor = levelProgressionFactor(level.rank, LEVEL_STEP);
    const countryBase = COUNTRY_BASE_L1.get(country.code) ?? DEFAULT_COUNTRY_BASE;
    const baseMajor = applyCountryMultiplier(rolePoints * levelFactor, countryBase);
    return baseMajor * 10 ** exponentOf(country.currency);
  };

  const toMinor = (value: number): bigint => BigInt(Math.max(1, Math.round(value)));

  const drawDate = (): PlainDate => {
    const yearsBack = Math.floor(prng.nextUnit() * DATE_SPAN_YEARS);
    const month = 1 + Math.floor(prng.nextUnit() * 12);
    const day = 1 + Math.floor(prng.nextUnit() * 28); // ≤ 28 so every month holds the day.
    const candidate: PlainDate = { year: asOf.year - yearsBack, month, day };
    // Only the current-year draws can overshoot `asOf`. Rather than clamping the overshoot onto the
    // as-of boundary (which would pile ~2.9% of hires onto one identical date), roll it back to the
    // same month/day a year earlier — still ≤ asOf (AD-18), but spread instead of spiked.
    return comparePlainDate(candidate, asOf) > 0 ? { year: candidate.year - 1, month, day } : candidate;
  };

  const people: NewEmployeeWithSalary[] = [];
  let counter = 0;

  const addPerson = (
    roleCode: string,
    level: SeedLevel,
    country: SeedCountry,
    gender: Gender,
    amountMinor: bigint,
  ): void => {
    const employeeId = idGenerator.next();
    const salaryRecordId = idGenerator.next();
    const hireDate = drawDate();
    people.push({
      employeeId,
      salaryRecordId,
      name: `Seed Employee ${counter}`,
      roleCode,
      levelCode: level.code,
      countryCode: country.code,
      gender,
      hireDate,
      salary: { amountMinor, currency: country.currency },
      // The opening record takes effect on the hire date — equal, so ≥ hire and ≤ asOf both hold.
      effectiveFrom: hireDate,
    });
    counter += 1;
  };

  const reserved = new Set<string>();

  // (c) Gender-gap cells — 8 men near the base, 8 women below it.
  for (const cell of GAP_CELLS) {
    requirePresent(roleSet.has(cell.role) ? cell.role : undefined, `gap cell role ${cell.role} missing`);
    const level = requirePresent(levelByCode.get(cell.level), `gap cell level ${cell.level} missing`);
    const country = requirePresent(
      countryByCode.get(cell.country),
      `gap cell country ${cell.country} missing`,
    );
    const median = cellMedianMinor(cell.role, level, country);
    reserved.add(cellKey(cell.role, cell.level, cell.country));
    for (const factor of GAP_MALE_FACTORS) {
      addPerson(cell.role, level, country, 'MALE', toMinor(median * factor));
    }
    for (const factor of GAP_FEMALE_FACTORS) {
      addPerson(cell.role, level, country, 'FEMALE', toMinor(median * factor));
    }
  }

  // (b) Outlier cell — a dense, tight cell with one planted high extreme and one low extreme.
  {
    requirePresent(
      roleSet.has(OUTLIER_CELL.role) ? OUTLIER_CELL.role : undefined,
      `outlier cell role ${OUTLIER_CELL.role} missing`,
    );
    const level = requirePresent(
      levelByCode.get(OUTLIER_CELL.level),
      `outlier cell level ${OUTLIER_CELL.level} missing`,
    );
    const country = requirePresent(
      countryByCode.get(OUTLIER_CELL.country),
      `outlier cell country ${OUTLIER_CELL.country} missing`,
    );
    const median = cellMedianMinor(OUTLIER_CELL.role, level, country);
    reserved.add(cellKey(OUTLIER_CELL.role, OUTLIER_CELL.level, OUTLIER_CELL.country));
    for (let index = 0; index < OUTLIER_CELL_SIZE; index += 1) {
      const gender: Gender = prng.nextUnit() < femaleProbability(level.rank) ? 'FEMALE' : 'MALE';
      let amountMinor: bigint;
      if (index === 0) {
        amountMinor = toMinor(median * OUTLIER_HIGH_FACTOR);
      } else if (index === 1) {
        amountMinor = toMinor(median * OUTLIER_LOW_FACTOR);
      } else {
        const z = standardNormal(prng.nextUnit(), prng.nextUnit());
        amountMinor = toMinor(logNormal(median, OUTLIER_CELL_SIGMA, z));
      }
      addPerson(OUTLIER_CELL.role, level, country, gender, amountMinor);
    }
  }

  // (a) Thin cells — 1–3 people each, and nothing else lands in them.
  for (const cell of THIN_CELLS) {
    requirePresent(roleSet.has(cell.role) ? cell.role : undefined, `thin cell role ${cell.role} missing`);
    const level = requirePresent(
      levelByCode.get(cell.level),
      `thin cell level ${cell.level} missing`,
    );
    const country = requirePresent(
      countryByCode.get(cell.country),
      `thin cell country ${cell.country} missing`,
    );
    const median = cellMedianMinor(cell.role, level, country);
    reserved.add(cellKey(cell.role, cell.level, cell.country));
    for (let index = 0; index < cell.count; index += 1) {
      const z = standardNormal(prng.nextUnit(), prng.nextUnit());
      addPerson(cell.role, level, country, 'MALE', toMinor(logNormal(median, FILL_SIGMA, z)));
    }
  }

  // The remaining population fills every other cell, densely and evenly, with the level-based gender
  // skew that realises the CAP-8 clustering. Enumerated in a fixed order so the batch is reproducible.
  // Enumerate over CANONICALLY SORTED reference dimensions so the fill layout — and therefore the
  // byte-for-byte output — is identical no matter what order the reference loader returned rows in
  // (production `loadFormOptions` sorts by name; a test may not). Roles ascend by code, levels by
  // rank, countries by code. Only the enumeration uses these; the lookup maps and the planted cells
  // above are already order-independent.
  const sortedRoles = [...references.roles].sort();
  const sortedLevels = [...references.levels].sort((a, b) => a.rank - b.rank);
  const sortedCountries = [...references.countries].sort((a, b) =>
    a.code < b.code ? -1 : a.code > b.code ? 1 : 0,
  );

  const fillCells: { readonly role: string; readonly level: SeedLevel; readonly country: SeedCountry }[] =
    [];
  for (const roleCode of sortedRoles) {
    for (const level of sortedLevels) {
      for (const country of sortedCountries) {
        if (reserved.has(cellKey(roleCode, level.code, country.code))) {
          continue;
        }
        fillCells.push({ role: roleCode, level, country });
      }
    }
  }

  // Guard the `remaining / fillCells.length` below: an empty grid would make `perCell` Infinity and
  // `withExtra` NaN, silently returning ~91 rows instead of 10,000. Unreachable in practice — the
  // planted-cell checks above already require the eight planted roles across four levels and seven
  // countries to be present, so the enumerated grid always leaves >200 unreserved fill cells — but
  // kept as a loud tripwire against a future refactor of the planted layout.
  /* v8 ignore next 3 -- defensive: unreachable while any planted cell is satisfiable (see comment). */
  if (fillCells.length === 0) {
    throw new Error('no fill cells available to reach the target population size');
  }

  const remaining = SEED_POPULATION_SIZE - people.length;
  const perCell = Math.floor(remaining / fillCells.length);
  const withExtra = remaining % fillCells.length; // the first `withExtra` cells take one more.

  fillCells.forEach((cell, cellIndex) => {
    const count = perCell + (cellIndex < withExtra ? 1 : 0);
    const median = cellMedianMinor(cell.role, cell.level, cell.country);
    const femaleShare = femaleProbability(cell.level.rank);
    for (let index = 0; index < count; index += 1) {
      const gender: Gender = prng.nextUnit() < femaleShare ? 'FEMALE' : 'MALE';
      const z = standardNormal(prng.nextUnit(), prng.nextUnit());
      addPerson(cell.role, cell.level, cell.country, gender, toMinor(logNormal(median, FILL_SIGMA, z)));
    }
  });

  return people;
}
