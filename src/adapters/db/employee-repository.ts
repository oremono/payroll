import type {
  EmployeeRepository,
  NewEmployeeWithSalary,
} from '@/application/ports/employee-repository';
import type { ReferenceData } from '@/domain/import-row';
import { comparePlainDate, plainDateToIso, type PlainDate } from '@/domain/plain-date';

import { getDbClient } from './client';
import type { PrismaClient } from './generated/client';

/**
 * The Prisma implementation of the employee repository — and THE WRITE FUNNEL (AD-6 / AD-18).
 *
 * Every employee and every salary record in the product is created through
 * `createEmployeesWithSalaries`: this import, Epic 3's record-change form, and Epic 12's seed
 * alike. Import gets no privileged path and neither does the seed. That is what makes
 * "currency is derived from the country" and "no future-dating" enforceable claims rather than
 * things each caller is trusted to remember.
 *
 * ## Why the funnel re-validates what the domain already validated
 *
 * The use-case judged every row against reference data it loaded moments earlier, OUTSIDE the
 * transaction. Between that read and this write a role can be deactivated or a country's currency
 * changed, and the row that was valid on judgement would land wrong. So the funnel re-resolves the
 * currency from the country INSIDE the transaction, with the same `is_active` filter
 * `loadReferenceData` uses, and re-checks the effective date against today.
 *
 * ## Why it THROWS rather than returning a refusal
 *
 * These are invariant violations, not user input — the user's input was already judged and
 * reported on. Adapters may throw; the pure layers may not. The Route Handler is documented to
 * catch this and turn it into a whole-file refusal, because an unguarded call site here is a
 * designed-in 500 (that is precisely how review pass 1's oversized-amount defect reached the
 * client as an HTTP 500 carrying no report at all).
 */

/**
 * Rows per `createMany`. The 10,000-row criterion is "a bounded number of round-trips, never one
 * per row" — this makes it ~10 statement pairs rather than 10,000, while keeping each statement's
 * parameter count far below PostgreSQL's 65,535-bound protocol limit (9 parameters per employee
 * row × 1,000 = 9,000).
 */
const INSERT_CHUNK_SIZE = 1_000;

/**
 * A calendar date as the `DATE` columns want it. Midnight UTC exactly, so no timezone offset can
 * shift the stored day — the same reason `PlainDate` exists at all (Conventions / AD-11).
 */
function toDbDate(date: PlainDate): Date {
  return new Date(`${plainDateToIso(date)}T00:00:00.000Z`);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function createEmployeeRepository(
  client: PrismaClient = getDbClient(),
): EmployeeRepository {
  return {
    loadReferenceData: async (): Promise<ReferenceData> => {
      // Three narrow SELECTs rather than one join: these are the whole (small) reference tables,
      // and the domain wants three independent lookups, not a cross product.
      //
      // `isActive` is filtered HERE and again in the funnel below, and the two must agree — a
      // divergence would mean a row the importer judged acceptable being refused at write time,
      // or worse, accepted. `is_active` gates PICKABILITY for NEW writes; it never filters an
      // employee who already holds the code out of any statistic (that would reintroduce the
      // AD-16 population divergence the schema avoids).
      const [roles, levels, countries] = await Promise.all([
        client.role.findMany({ where: { isActive: true }, select: { code: true } }),
        client.level.findMany({ where: { isActive: true }, select: { code: true } }),
        client.country.findMany({
          where: { isActive: true },
          select: { code: true, currencyCode: true },
        }),
      ]);

      return {
        roleCodes: new Set(roles.map((role) => role.code)),
        levelCodes: new Set(levels.map((level) => level.code)),
        countryCurrencies: new Map(
          countries.map((country) => [country.code, country.currencyCode]),
        ),
      };
    },

    createEmployeesWithSalaries: async (
      batch: readonly NewEmployeeWithSalary[],
      today: PlainDate,
    ): Promise<void> => {
      if (batch.length === 0) {
        return;
      }

      await client.$transaction(async (tx) => {
        // Re-resolve currency from country INSIDE the transaction (AD-6), with the same
        // is_active filter loadReferenceData applies. Only the countries this batch names.
        const countryCodes = [...new Set(batch.map((row) => row.countryCode))];
        const countries = await tx.country.findMany({
          where: { code: { in: countryCodes }, isActive: true },
          select: { code: true, currencyCode: true },
        });
        const currencyByCountry = new Map(
          countries.map((country) => [country.code, country.currencyCode]),
        );

        for (const row of batch) {
          const currency = currencyByCountry.get(row.countryCode);
          if (currency === undefined) {
            throw new Error(
              `Country "${row.countryCode}" is not an active country. It resolved when the file ` +
                'was judged and does not now, so the reference data changed mid-import.',
            );
          }
          // AD-6: the record's currency is the COUNTRY's, and the value the domain carried is
          // validated to equal it rather than trusted.
          if (currency !== row.salary.currency) {
            throw new Error(
              `Currency mismatch writing "${row.name}": country "${row.countryCode}" resolves to ` +
                `"${currency}", not "${row.salary.currency}".`,
            );
          }
          // Law 5 / AD-18: no future-dating, on EVERY write path — re-checked here because this
          // funnel is what every later write path inherits, including callers that never ran the
          // domain validator.
          if (comparePlainDate(row.effectiveFrom, today) > 0) {
            throw new Error(
              `effective_from ${plainDateToIso(row.effectiveFrom)} for "${row.name}" is later ` +
                `than today, ${plainDateToIso(today)}. salary_record is append-only and admits ` +
                'no future-dated record.',
            );
          }
        }

        // Employees first — salary_record carries an FK to them. `createMany`, chunked: one
        // round-trip per thousand rows rather than one per row.
        for (const rows of chunk(batch, INSERT_CHUNK_SIZE)) {
          await tx.employee.createMany({
            data: rows.map((row) => ({
              id: row.employeeId,
              name: row.name,
              roleCode: row.roleCode,
              levelCode: row.levelCode,
              countryCode: row.countryCode,
              gender: row.gender,
              hireDate: toDbDate(row.hireDate),
            })),
          });
        }

        for (const rows of chunk(batch, INSERT_CHUNK_SIZE)) {
          await tx.salaryRecord.createMany({
            data: rows.map((row) => ({
              id: row.salaryRecordId,
              employeeId: row.employeeId,
              amountMinor: row.salary.amountMinor,
              // Written from the country, per the resolution above — never from the file.
              currencyCode: currencyByCountry.get(row.countryCode) ?? row.salary.currency,
              effectiveFrom: toDbDate(row.effectiveFrom),
            })),
          });
        }
      });
    },
  };
}
