import type { FxRateRepository } from '@/application/ports/fx-rate-repository';
import type { FxRateRow } from '@/domain/fx';

import { getDbClient } from './client';
import { fromDbDate } from './employee-repository';
import type { PrismaClient } from './generated/client';

/**
 * The Prisma implementation of the FX-rate port (CAP-9, AD-13) — READ-ONLY. It loads EVERY `fx_rate`
 * row and hands them to the domain unresolved; `resolveRateSet` picks the set at the greatest
 * `pinnedOn <= asOf` and the domain requires the needed pairs (AD-2 / AD-13). No `where`, no
 * `orderBy`, no grouping in SQL. No write method, ever (production seeding is out of scope).
 *
 * ## Why the rate is DECOMPOSED here, with no float
 *
 * `fx_rate.rate` is `Decimal(18,8)` and comes back as a `Prisma.Decimal`, never a JS number (a
 * double cannot hold 8 fractional digits exactly). The domain arithmetic is exact `bigint`
 * (`divideRoundHalfUp`, AD-5), so the adapter turns the Decimal into an exact rational
 * `rateNumerator / rateDenominator` where `rateDenominator = 10^8` — via the Decimal's fixed-scale
 * STRING, never `Number(...)`. The `rate` string carried alongside is the display receipt, cleaned
 * of trailing zeros. (Law 4 / AD-4 / AD-13)
 */

/** The `Decimal(18,8)` scale — 8 fractional digits, so the exact denominator is `10^8`. */
const RATE_SCALE = 8;
const RATE_DENOMINATOR = 10n ** BigInt(RATE_SCALE);

/** The one thing this adapter needs off a `Prisma.Decimal`: its exact fixed-scale decimal string. */
type FixedScaleDecimal = {
  readonly toFixed: (decimalPlaces: number) => string;
};

/** The decomposed rate: display string + exact rational, all from the fixed-scale string (no float). */
export type DecomposedRate = {
  readonly rate: string;
  readonly rateNumerator: bigint;
  readonly rateDenominator: bigint;
};

/**
 * Decompose a `Decimal(18,8)` into `{ rate, rateNumerator, rateDenominator = 10^8 }` EXACTLY.
 *
 * `toFixed(8)` renders the stored value with all 8 scale digits and NO exponential notation (which
 * `toString()` would use for a value like `1e-8`, breaking both the display and the parse) — e.g.
 * `"0.01200000"`, `"83.00000000"`. Dropping the point makes the numerator a plain base-10 integer
 * string (`"001200000"` -> `1200000n`), and the denominator is fixed at `10^8`; the two together are
 * the SAME rational the Decimal holds, with no `Number` ever constructed. The display `rate` strips
 * trailing fraction zeros (and a bare trailing point) so `0.012`, not `0.01200000`, reaches the
 * receipt. A leading sign is carried onto the numerator, though a real FX quote is positive.
 */
export function decomposeRate(decimal: FixedScaleDecimal): DecomposedRate {
  const fixed = decimal.toFixed(RATE_SCALE);
  const negative = fixed.startsWith('-');
  const unsigned = negative ? fixed.slice(1) : fixed;

  // The point is the only non-digit in a fixed-scale render; removing it yields the integer number
  // of 10^-8 units, exactly.
  const magnitude = BigInt(unsigned.replace('.', ''));
  const rateNumerator = negative ? -magnitude : magnitude;

  // A clean decimal for the receipt: strip trailing fraction zeros, then a naked trailing point.
  const display = unsigned.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

  return {
    rate: negative ? `-${display}` : display,
    rateNumerator,
    rateDenominator: RATE_DENOMINATOR,
  };
}

export function createFxRateRepository(
  client: PrismaClient = getDbClient(),
): FxRateRepository {
  return {
    findAllFxRates: async (): Promise<readonly FxRateRow[]> => {
      // Every row, unfiltered and unordered — the domain resolves the set (AD-13). NO as-of `where`,
      // NO `orderBy`, NO grouping: the database SELECTs rows only (AD-2).
      const rows = await client.fxRate.findMany({
        select: { fromCurrency: true, toCurrency: true, rate: true, pinnedOn: true },
      });

      return rows.map((row) => {
        const { rate, rateNumerator, rateDenominator } = decomposeRate(row.rate);
        return {
          fromCurrency: row.fromCurrency,
          toCurrency: row.toCurrency,
          rate,
          rateNumerator,
          rateDenominator,
          // `@db.Date` read back through the UTC getters, never the local ones (AD-11).
          pinnedOn: fromDbDate(row.pinnedOn),
        };
      });
    },
  };
}
