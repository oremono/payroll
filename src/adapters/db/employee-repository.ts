import type {
  AppendSalaryRecordOutcome,
  EmployeeDetail,
  EmployeeFormOptions,
  EmployeeListPage,
  EmployeeListQuery,
  EmployeeRepository,
  EmployeeUpdate,
  NewEmployee,
  NewEmployeeWithSalary,
  NewSalaryRecord,
  UpdateEmployeeOutcome,
} from '@/application/ports/employee-repository';
import type { ReferenceData } from '@/domain/import-row';
import type { Money } from '@/domain/money';
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

/**
 * The inverse of `toDbDate`. A `@db.Date` column comes back as a JS `Date` pinned to midnight UTC,
 * so the UTC getters — never the local ones — are what read the stored calendar day back. Reading
 * `getFullYear()` here would shift the day for every reader west of Greenwich, which is the entire
 * reason `PlainDate` exists (Conventions / AD-11). Pinned by a test that sets a non-UTC `TZ`, since
 * the regression is invisible on a UTC CI box.
 */
export function fromDbDate(value: Date): PlainDate {
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

/**
 * The SQLSTATE the AD-16 hire-date triggers raise (`20260719050000_review_hardening_1_4` and
 * `20260719060000_hire_date_lock`).
 *
 * It is a CUSTOM state in a class PostgreSQL does not reserve, chosen by those migrations precisely
 * so this repository could map it onto a typed outcome instead of string-matching English message
 * text — which would break the moment the wording or the server locale changed.
 */
const HIRE_DATE_SQLSTATE = 'AP004';

/** Prisma's "operation failed because it depends on records that were required but not found". */
const PRISMA_RECORD_NOT_FOUND = 'P2025';

/** How many wrappers deep `hasErrorCode` will look before giving up. */
const MAX_ERROR_WRAP_DEPTH = 5;

/**
 * Does this error — or anything it wraps — carry `code`?
 *
 * Deliberately a WALK rather than a single property read. A driver-adapter error arrives wrapped:
 * Prisma's own error is outermost and the `pg` error carrying the SQLSTATE hangs off `cause` (and,
 * depending on the failure, off `meta`). Reading only the top-level `code` would see Prisma's
 * `P2010`/`P2036` and conclude the trigger never fired — silently converting a rejection the user
 * must see into a 500. Bounded depth so a self-referential `cause` cannot spin.
 */
export function hasErrorCode(error: unknown, code: string, depth = 0): boolean {
  if (depth > MAX_ERROR_WRAP_DEPTH || typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; cause?: unknown; meta?: unknown };
  if (candidate.code === code) {
    return true;
  }

  return (
    hasErrorCode(candidate.cause, code, depth + 1) || hasErrorCode(candidate.meta, code, depth + 1)
  );
}

/**
 * The bounds a page size is clamped into, and the size a caller who named none actually gets.
 *
 * `limit` and `offset` arrive from a URL a user can hand-edit, so they are hostile input by default.
 * An unbounded `take` is a denial of service on a 10,000-row table, and a negative `skip` is a raw
 * Prisma throw rather than an empty page.
 */
export const MIN_LIST_LIMIT = 1;
export const MAX_LIST_LIMIT = 200;
export const DEFAULT_LIST_LIMIT = 25;

/**
 * Clamp a requested page size into `1..200`, truncated to an integer.
 *
 * A value that is not a number at all answers the DEFAULT — not the ceiling, and not the floor.
 * This function exists because an unbounded `take` is a denial of service on a 10,000-row table, so
 * its own degenerate branch must not be the cheapest route to the most expensive page the system
 * serves: `?limit=abc` parses to `NaN`, and answering 200 there would hand the largest page to
 * precisely the caller who asked for nothing coherent. The floor is no better an answer — a page of
 * one reads as data loss to the person looking at it. An ordinary page size is the honest reading of
 * "no usable limit was given", and it is bounded, which is the property that matters.
 */
export function clampListLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.min(Math.max(Math.trunc(limit), MIN_LIST_LIMIT), MAX_LIST_LIMIT);
}

/**
 * The deepest page this repository will page to.
 *
 * The same denial-of-service class the limit clamp closes: PostgreSQL's `OFFSET` walks and discards
 * every row before the window, so an unbounded `skip` buys an expensive scan that returns nothing.
 * Far beyond any page a 10,000-row directory has, so no reachable page is lost to it.
 */
export const MAX_LIST_OFFSET = 100_000;

/**
 * Clamp a requested offset into `0..MAX_LIST_OFFSET`, truncated to an integer. Non-numeric answers
 * the start — a caller who named no coherent page is asking for the first one.
 */
export function clampListOffset(offset: number): number {
  if (!Number.isFinite(offset)) {
    return 0;
  }
  return Math.min(Math.max(Math.trunc(offset), 0), MAX_LIST_OFFSET);
}

/**
 * Escape the LIKE metacharacters in a search term.
 *
 * Prisma's `contains` compiles to `LIKE`/`ILIKE` and does NOT escape its arguments, so without this
 * a search for `%` matches every employee in the directory and `_` matches any single character —
 * ordinary punctuation behaving as a wildcard. PostgreSQL's default LIKE escape character is the
 * backslash, so that is what is doubled.
 *
 * The backslash is replaced FIRST, in the same pass. Escaping it last would rewrite `\%` to `\\%` —
 * a literal backslash followed by a LIVE wildcard, which is the exact bug being closed.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * The longest search term this repository will send to the database. Comfortably past any real
 * name — `employee.name` is unbounded text, but a person's name is not 200 characters long.
 */
export const MAX_SEARCH_LENGTH = 200;

/**
 * The search term this repository will actually filter on, or `null` for "do not filter".
 *
 * A BLANK term is no search at all. The port used to document `null` and `''` as different things,
 * and they were not: `contains: ''` matches every row, so an empty term coincided with no filter by
 * an accident of LIKE semantics rather than by decision. Story 3-2's search box sends `''` the
 * moment a reader clears it, so the coincidence was load-bearing and undocumented — it is now the
 * rule, and the port says so.
 *
 * Whitespace-only is the same case and the more damaging one: `contains: '   '` is a REAL filter
 * that matches almost nothing, so a reader who brushed the space bar would be shown an empty
 * directory with no explanation. Surrounding whitespace is trimmed for the same reason — nobody
 * searching for "ana" means "the string ' ana '".
 */
export function normalizeSearchTerm(search: string | null): string | null {
  // The port names `search` HOSTILE INPUT alongside `limit` and `offset`, and until this guard it
  // was the one of the three that was never defended. `string | null` is a compile-time claim: the
  // caller is a Server Component reading `searchParams`, where a repeated query parameter is an
  // ARRAY and an absent one is `undefined`. Either would reach `.trim()` as a `TypeError`, which
  // the read use-case catches and reports as `{ kind: 'unavailable' }` — telling a reader the
  // directory is down because they hit reload with `?q=a&q=b` in the bar.
  if (typeof search !== 'string') {
    return null;
  }

  const trimmed = search.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Bounded for the same reason `limit` is. `contains` compiles to `ILIKE '%…%'`, which cannot use
  // an index and is executed TWICE per page (the rows and the count) inside a REPEATABLE READ
  // transaction holding a pooled connection — so an unbounded term is the same denial-of-service
  // the limit clamp closes, on the one field that is free text. Truncated rather than refused: no
  // real name reaches this length, so anything past it is noise, and a substring search on the
  // first 200 characters of a hostile term matches nothing either way.
  return trimmed.slice(0, MAX_SEARCH_LENGTH);
}

/**
 * The canonical UUID shape, anchored at both ends.
 *
 * `employee.id` is `@db.Uuid`, so Prisma raises a CAST error before any row is examined when handed
 * something else. An id arrives from a URL segment a user can hand-edit; that is ordinary input, not
 * an invariant breach, so a malformed one answers not-found / null rather than throwing.
 *
 * Deliberately shape-only, with no version or variant nibble check: this is a guard against a cast
 * error, not a claim about which UUID version the id port emits.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** The identity columns every employee read selects. No salary — that is CAP-3/CAP-4's (AD-8). */
const EMPLOYEE_IDENTITY_SELECT = {
  id: true,
  name: true,
  roleCode: true,
  levelCode: true,
  countryCode: true,
  gender: true,
  hireDate: true,
} as const;

/**
 * THE per-record write guard, applied by every path that appends a `salary_record`.
 *
 * ONE helper rather than two statements of the same rule, and that is the whole point (AD-6): the
 * batch funnel and CAP-3's single-record append must not be able to drift apart about what a
 * writable salary record is. A divergence between the two is exactly the defect the single funnel
 * exists to prevent, and two copies of a check is how a divergence begins.
 *
 * Both callers hand it a currency they resolved from the country INSIDE their own transaction, with
 * the same `is_active` filter `loadReferenceData` uses — that is what closes the window between
 * judging a row and writing it. `undefined` means the country did not resolve as ACTIVE at all.
 *
 * THROWS rather than returning a refusal, exactly as the batch funnel always has: the input was
 * already judged and reported on, so anything reaching here is an invariant violation rather than
 * user input. Adapters may throw; the pure layers may not. The Route Handler and the Server Action
 * boundary each catch and answer with a payload, because an unguarded call site is a designed-in
 * 500.
 *
 * `label` is what the message NAMES — an employee's name on the import path, an id on the append
 * path — because a batch failure has to say which of ten thousand rows it was about.
 */
function assertSalaryRecordWritable(params: {
  readonly label: string;
  readonly countryCode: string;
  readonly resolvedCurrency: string | undefined;
  readonly salary: Money;
  readonly effectiveFrom: PlainDate;
  readonly today: PlainDate;
}): string {
  const { label, countryCode, resolvedCurrency, salary, effectiveFrom, today } = params;

  if (resolvedCurrency === undefined) {
    throw new Error(
      `Country "${countryCode}" is not an active country. It resolved when the input ` +
        'was judged and does not now, so the reference data changed in between.',
    );
  }
  // AD-6: the record's currency is the COUNTRY's, and the value the domain carried is validated to
  // equal it rather than trusted.
  if (resolvedCurrency !== salary.currency) {
    throw new Error(
      `Currency mismatch writing "${label}": country "${countryCode}" resolves to ` +
        `"${resolvedCurrency}", not "${salary.currency}".`,
    );
  }
  // Law 5 / AD-18: no future-dating, on EVERY write path — re-checked here because this guard is
  // what every write path inherits, including callers that never ran the domain validator.
  if (comparePlainDate(effectiveFrom, today) > 0) {
    throw new Error(
      `effective_from ${plainDateToIso(effectiveFrom)} for "${label}" is later ` +
        `than today, ${plainDateToIso(today)}. salary_record is append-only and admits ` +
        'no future-dated record.',
    );
  }

  // The currency the row is WRITTEN with — the country's, returned rather than re-looked-up, so no
  // caller can write one value after validating another.
  return resolvedCurrency;
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

        // The SHARED per-record guard — the same function CAP-3's single-record append calls, so
        // the two paths cannot drift apart about what a writable salary record is. Same checks,
        // same order, same messages this loop always raised.
        //
        // Its RETURN is what gets written below, carried on the row rather than looked up again.
        // Re-reading the map at insert time would be a second answer to a question the guard
        // already answered — and a caller that validates one currency and writes another is
        // exactly the divergence this guard was extracted to make impossible.
        const writable = batch.map((row) => ({
          row,
          currencyCode: assertSalaryRecordWritable({
            label: row.name,
            countryCode: row.countryCode,
            resolvedCurrency: currencyByCountry.get(row.countryCode),
            salary: row.salary,
            effectiveFrom: row.effectiveFrom,
            today,
          }),
        }));

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

        for (const rows of chunk(writable, INSERT_CHUNK_SIZE)) {
          await tx.salaryRecord.createMany({
            data: rows.map(({ row, currencyCode }) => ({
              id: row.salaryRecordId,
              employeeId: row.employeeId,
              amountMinor: row.salary.amountMinor,
              // Written from the country, as the guard resolved it — never from the file.
              currencyCode,
              effectiveFrom: toDbDate(row.effectiveFrom),
            })),
          });
        }
      });
    },

    // ── CAP-2 (story 3-1) ────────────────────────────────────────────────────────────────────
    // Sibling methods on THIS repository, not a second one. They share the client, `toDbDate`, and
    // the same error discipline. `createEmployee` writes no salary record and never will — the
    // funnel's currency-from-country and no-future-dating invariants are properties of a salary
    // record, and CAP-3 owns the first one.

    createEmployee: async (employee: NewEmployee): Promise<void> => {
      // A TRANSACTION, for the reason the batch funnel above uses one: reference data was read
      // OUTSIDE it, so a role, level, or country can be deactivated between judgement and write.
      // The FKs target `code` and therefore check EXISTENCE, not ACTIVITY — nothing in the schema
      // would notice.
      //
      // What is re-resolved here is WIDER than what the batch funnel re-resolves, and the
      // difference is deliberate rather than an oversight to be tidied away. The batch funnel
      // re-reads the COUNTRY only, because what it must protect is AD-6 — the currency written onto
      // a salary record has to be the country's at write time. It never re-checks role or level
      // activity at all. This path writes no salary record and so has no currency to protect;
      // what it protects instead is that a NEW employee is not created against a retired code, so
      // it re-resolves all three. Story 2-1 owns the batch funnel's narrower check and closing that
      // gap belongs to that story, not this one.
      //
      // What this NARROWS, and what it does not CLOSE. A plain `SELECT` takes no row lock, and this
      // transaction runs at PostgreSQL's default READ COMMITTED, so a concurrent
      // `UPDATE role SET is_active = false` can still commit in the interval between the re-read
      // below and the INSERT — and the FK, checking existence rather than activity, will not notice.
      // The window shrinks from "however long the form was open" to "the width of this transaction",
      // which is the difference that matters in practice; it does not vanish. Closing it outright
      // needs a `FOR SHARE` lock on the reference rows, the same technique
      // `20260719060000_hire_date_lock` uses on the parent row and argues for at length. That
      // hardening is recorded in `deferred-work.md`; the claim here is deliberately the weaker,
      // true one, because a comment promising a guarantee the code does not give is worse than the
      // gap it papers over.
      await client.$transaction(async (tx) => {
        const [role, level, country] = await Promise.all([
          tx.role.findFirst({
            where: { code: employee.roleCode, isActive: true },
            select: { code: true },
          }),
          tx.level.findFirst({
            where: { code: employee.levelCode, isActive: true },
            select: { code: true },
          }),
          tx.country.findFirst({
            where: { code: employee.countryCode, isActive: true },
            select: { code: true },
          }),
        ]);

        // Throws rather than returning a refusal, exactly as the batch funnel does: the input was
        // already judged, so this is an invariant violation rather than user input. The Server
        // Action boundary catches it and answers with a payload.
        if (role === null || level === null || country === null) {
          throw new Error(
            `Reference data changed between judgement and write for "${employee.name}": ` +
              `role "${employee.roleCode}", level "${employee.levelCode}", and country ` +
              `"${employee.countryCode}" must all still be active.`,
          );
        }

        await tx.employee.create({
          data: {
            id: employee.employeeId,
            name: employee.name,
            roleCode: employee.roleCode,
            levelCode: employee.levelCode,
            countryCode: employee.countryCode,
            gender: employee.gender,
            hireDate: toDbDate(employee.hireDate),
          },
        });
      });
    },

    updateEmployee: async (
      employeeId: string,
      update: EmployeeUpdate,
    ): Promise<UpdateEmployeeOutcome> => {
      // A hand-editable URL segment is ordinary input: answer not-found rather than letting Prisma
      // raise a cast error against the `@db.Uuid` column before any row is even examined.
      if (!isUuid(employeeId)) {
        return { kind: 'not-found' };
      }

      try {
        // A TRANSACTION for the same reason `createEmployee` uses one, and narrowing the same
        // window: reference data was read OUTSIDE it, so a role or level can be deactivated between
        // judgement and write. The FKs target `code` and check EXISTENCE, not ACTIVITY, so an edit
        // assigning a retired role would land and nothing in the schema would notice. Leaving this
        // open on the edit path while the create path narrows it would be a funnel whose two halves
        // disagree about their own invariant.
        //
        // NARROWS, not closes — and for the same reason, with the same remedy. See the long note in
        // `createEmployee` above: at READ COMMITTED a plain `SELECT` holds no lock, so a
        // deactivation committing inside this transaction's own span is still admitted. `FOR SHARE`
        // on the reference rows is what would close it, and it is deferred, not forgotten.
        //
        // No country here at all (AD-6): an edit cannot change it, so there is nothing to re-check
        // — and re-checking the STORED country would refuse a name change for anyone whose country
        // was later deactivated, which is a bug wearing the costume of thoroughness.
        await client.$transaction(async (tx) => {
          const [role, level] = await Promise.all([
            tx.role.findFirst({
              where: { code: update.roleCode, isActive: true },
              select: { code: true },
            }),
            tx.level.findFirst({
              where: { code: update.levelCode, isActive: true },
              select: { code: true },
            }),
          ]);

          // THROWS rather than returning an outcome, exactly as the create path does: the input was
          // already judged against reference data, so this is an invariant violation and not user
          // input. It carries no SQLSTATE, so it falls past the AP004 arm below and reaches the
          // Server Action boundary, which answers with a payload rather than a 500.
          if (role === null || level === null) {
            throw new Error(
              `Reference data changed between judgement and write for employee ` +
                `"${employeeId}": role "${update.roleCode}" and level "${update.levelCode}" ` +
                'must both still be active.',
            );
          }

          await tx.employee.update({
            where: { id: employeeId },
            // No `countryCode` — the port's type omits it (AD-6), and `payroll_app` holds no UPDATE
            // privilege on that column, so even a hand-written statement would be refused.
            data: {
              name: update.name,
              roleCode: update.roleCode,
              levelCode: update.levelCode,
              gender: update.gender,
              hireDate: toDbDate(update.hireDate),
            },
          });
        });
        return { kind: 'updated' };
      } catch (error) {
        if (hasErrorCode(error, PRISMA_RECORD_NOT_FOUND)) {
          return { kind: 'not-found' };
        }
        if (hasErrorCode(error, HIRE_DATE_SQLSTATE)) {
          // The ONE database error this repository converts to data. It is user input the
          // application cannot judge without reading the salary history, so the database is the
          // judge and its verdict must reach the user as a payload.
          return { kind: 'hire-date-after-salary' };
        }
        // Everything else is an invariant violation, not input — it throws, and the boundary
        // answers with a payload rather than a 500.
        throw error;
      }
    },

    findEmployeeById: async (employeeId: string): Promise<EmployeeDetail | null> => {
      if (!isUuid(employeeId)) {
        return null;
      }

      const row = await client.employee.findUnique({
        where: { id: employeeId },
        select: EMPLOYEE_IDENTITY_SELECT,
      });

      if (row === null) {
        return null;
      }

      return { ...row, hireDate: fromDbDate(row.hireDate) };
    },

    listEmployees: async (query: EmployeeListQuery): Promise<EmployeeListPage> => {
      // Hostile input, clamped and escaped before it reaches the database — see the helpers above.
      const limit = clampListLimit(query.limit);
      const offset = clampListOffset(query.offset);

      // No search, an empty search box, and a fistful of spaces are all "no filter" — see
      // `normalizeSearchTerm`.
      const term = normalizeSearchTerm(query.search);
      const where =
        term === null
          ? {}
          : {
              name: {
                contains: escapeLikePattern(term),
                mode: 'insensitive' as const,
              },
            };

      // ONE transaction at REPEATABLE READ, not two independent queries: a page and a total read
      // separately can straddle a concurrent write, and a pager showing "1-25 of 24" is a bug the
      // reader sees.
      //
      // The ISOLATION LEVEL is what makes that claim true, and it is not decoration. PostgreSQL's
      // default READ COMMITTED takes a FRESH snapshot per statement, so a transaction around the
      // two would leave open precisely the window it appears to close. REPEATABLE READ pins one
      // snapshot across both, so the rows and the count describe the same database.
      //
      // And the INTERACTIVE form is not a style choice either: Prisma's array form accepts
      // `isolationLevel` and SILENTLY DISCARDS it — the transaction runs at read committed, with no
      // error to notice. Both facts are pinned by tests (a stub asserts the form and the option
      // here; the integration suite asserts the database really reports `repeatable read`), because
      // this comment has no way to be true on its own.
      //
      // `(name, id)` — name alone TIES on duplicates (two people may legitimately share one), and
      // offset pagination over a non-total order silently drops and repeats rows between pages.
      const [rows, totalCount] = await client.$transaction(
        async (tx) => {
          // Sequential rather than concurrent: both statements ride ONE connection inside an
          // interactive transaction, and that is the point — they share its snapshot.
          const page = await tx.employee.findMany({
            where,
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            skip: offset,
            take: limit,
            select: EMPLOYEE_IDENTITY_SELECT,
          });
          const total = await tx.employee.count({ where });
          return [page, total] as const;
        },
        { isolationLevel: 'RepeatableRead' },
      );

      return {
        employees: rows.map((row) => ({ ...row, hireDate: fromDbDate(row.hireDate) })),
        totalCount,
        // The EFFECTIVE values, not what was asked for. A pager that renders the requested limit
        // after this method clamped it lies to its reader.
        limit,
        offset,
      };
    },

    loadFormOptions: async (): Promise<EmployeeFormOptions> => {
      // `isActive` gates PICKABILITY: a retired role must not be choosable for a NEW write even
      // though it still resolves for the employees who already hold it. Same filter
      // `loadReferenceData` applies, and the two must never diverge.
      //
      // Every ordering is TOTAL. Levels order by `rank`, which is UNIQUE — that uniqueness is what
      // stops the order reshuffling between page loads. Roles and countries have no rank, so `code`
      // is the tie-break behind `name`; without it two same-named rows would order by whatever the
      // query plan felt like.
      const [roles, levels, countries] = await Promise.all([
        client.role.findMany({
          where: { isActive: true },
          orderBy: [{ name: 'asc' }, { code: 'asc' }],
          select: { code: true, name: true },
        }),
        client.level.findMany({
          where: { isActive: true },
          orderBy: { rank: 'asc' },
          select: { code: true, name: true, rank: true },
        }),
        client.country.findMany({
          where: { isActive: true },
          orderBy: [{ name: 'asc' }, { code: 'asc' }],
          // The currency FOLLOWS from the country and is never chosen independently (AD-6), so it
          // travels with it rather than being looked up again by the form.
          select: { code: true, name: true, currencyCode: true },
        }),
      ]);

      return { roles, levels, countries };
    },

    // ── CAP-3 (story 4-1) ────────────────────────────────────────────────────────────────────
    // A SIBLING of `createEmployeesWithSalaries` on this same repository — not a second funnel.
    // It shares the client, `toDbDate`, the error discipline, and — the part that matters — the
    // SAME `assertSalaryRecordWritable` guard, so the currency-from-country rule and the
    // no-future-dating rule cannot mean one thing for an import and another for a form.

    appendSalaryRecord: async (
      record: NewSalaryRecord,
      today: PlainDate,
    ): Promise<AppendSalaryRecordOutcome> => {
      // A hand-editable URL segment is ordinary input: answer not-found rather than letting Prisma
      // raise a cast error against the `@db.Uuid` column before any row is even examined.
      if (!isUuid(record.employeeId)) {
        return { kind: 'not-found' };
      }

      try {
        const outcome = await client.$transaction(
          async (tx): Promise<AppendSalaryRecordOutcome> => {
            // The employee is read INSIDE the transaction for two reasons at once: the country is
            // what AD-6 resolves the currency from, and the row's existence is what distinguishes
            // a stale id from a write failure. Reading it outside would reopen the window the
            // batch funnel closes by re-resolving.
            const employee = await tx.employee.findUnique({
              where: { id: record.employeeId },
              select: { countryCode: true },
            });
            if (employee === null) {
              return { kind: 'not-found' };
            }

            // Re-resolve currency from country INSIDE the transaction (AD-6), with the same
            // `is_active` filter `loadReferenceData` applies. The country is the EMPLOYEE's —
            // immutable since create — never one the caller supplied.
            const country = await tx.country.findFirst({
              where: { code: employee.countryCode, isActive: true },
              select: { currencyCode: true },
            });

            const currencyCode = assertSalaryRecordWritable({
              label: record.employeeId,
              countryCode: employee.countryCode,
              resolvedCurrency: country?.currencyCode,
              salary: record.salary,
              effectiveFrom: record.effectiveFrom,
              today,
            });

            await tx.salaryRecord.create({
              data: {
                id: record.salaryRecordId,
                employeeId: record.employeeId,
                amountMinor: record.salary.amountMinor,
                // Written from the country, per the resolution above — never from the caller.
                currencyCode,
                effectiveFrom: toDbDate(record.effectiveFrom),
              },
            });

            return { kind: 'appended' };
          },
        );
        return outcome;
      } catch (error) {
        if (hasErrorCode(error, HIRE_DATE_SQLSTATE)) {
          // The ONE database error this path converts to data. The domain judged the same rule
          // against the hire date it READ; this is the backstop for one that moved in between, and
          // it is user-facing either way. `seq` is a BIGSERIAL, so the rolled-back INSERT burns a
          // number — AD-8 needs ordering, never contiguity, and the schema says so.
          //
          // Read the enforced hire date on a FRESH query, deliberately, and not inside the
          // transaction above. That transaction is GONE: the error propagated out of the callback,
          // so Prisma has already rolled it back and its client would answer 25P02 to anything
          // asked of it. A read placed before the INSERT to dodge that would be worse still — it
          // would cost every successful append an extra round-trip to serve a case that is
          // vanishingly rare, and it would report the date this connection saw rather than the one
          // the trigger actually judged.
          //
          // The reader is therefore told what the database holds NOW, which is the honest answer to
          // "what is this person's hire date" and the only one that makes the sentence true.
          const employee = await client.employee.findUnique({
            where: { id: record.employeeId },
            select: { hireDate: true },
          });
          if (employee === null) {
            // Deleted between the failed append and this read. There is no hire date to quote and
            // no person to record a change against, so the stale-id answer is the truthful one.
            return { kind: 'not-found' };
          }
          return { kind: 'effective-before-hire', hireDate: fromDbDate(employee.hireDate) };
        }
        // Everything else is an invariant violation, not input — it throws, and the boundary
        // answers with a payload rather than a 500.
        throw error;
      }
    },
  };
}
