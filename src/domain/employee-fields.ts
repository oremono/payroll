/**
 * The per-field validators, extracted so there is EXACTLY ONE of each. (Law 2 / AD-1, AD-7)
 *
 * Story 2-1 wrote the unknown-role / unknown-level / unknown-country / gender / date-parse checks
 * inside `validateImportRow`. Story 3-1 needs the same five judgements for a single-employee form —
 * and a second implementation of any of them is how two surfaces start disagreeing about what a
 * valid role code is. So the checks live here, and BOTH callers reach them:
 *
 *   - `validateImportRow` (src/domain/import-row.ts) collects FIRST-FAULT: one reason per row, in a
 *     contractual order 2-1 pinned and this extraction must not disturb.
 *   - `validateEmployeeInput` (src/domain/employee.ts) collects ALL failing fields, because a form
 *     reports every problem at once rather than forcing a round-trip per mistake.
 *
 * Same rules, different collection strategy — which is precisely why the VALIDATORS had to be
 * extracted rather than the whole of `validateImportRow` reused.
 *
 * ## Why this is a third module rather than living in `employee.ts`
 *
 * `employee.ts` composes its sentences with `import-rejection.ts`, and `import-rejection.ts`
 * imports `import-row.ts`. Putting the shared validators in `employee.ts` would therefore close a
 * cycle: import-row -> employee -> import-rejection -> import-row. A third pure module breaks it
 * with no duplication, and `import-row.ts` re-exports `DateColumn` / `Gender` / `ReferenceData` so
 * no existing import path had to move.
 *
 * No I/O, no clock, no randomness, no imports outside this layer. Every function is TOTAL: a
 * failure is a RETURN VALUE, never an exception. Reference data arrives as an ARGUMENT rather than
 * a lookup — that is what keeps this module inside the pure core, keeps the fast suite DB-free, and
 * makes the 100% mutation-score target reachable at all.
 *
 * Every cell is trimmed before it is judged — surrounding whitespace in a spreadsheet export or a
 * pasted form field is noise, not a value — but nothing else is normalized. A code that differs in
 * case is a DIFFERENT code, and matching it would be the fuzzy matching AD-7 forbids.
 */

import { parsePlainDate, type PlainDate } from './plain-date';
import { blankToNull } from './text';

/** The two date columns, spelled as they appear in the import file's header. */
export type DateColumn = 'hire_date' | 'effective_from';

/** Gender is exactly these two values, verbatim (Law 3). */
export type Gender = 'MALE' | 'FEMALE';

/**
 * The reference tables, reduced to exactly what a judgement needs. Passed IN — the domain cannot
 * read a database, and would not want to: an argument is what makes every branch here testable from
 * a literal.
 *
 * `countryCurrencies` is a map rather than a set because AD-6 needs the country's currency, not
 * merely the country's existence: an import's `salary_record.currency_code` is DERIVED from it and
 * the file's cell is only ever validated against it. CAP-2 creates no salary record, so it uses
 * only the map's KEYS — the same lookup, one caller deeper.
 */
export type ReferenceData = {
  readonly roleCodes: ReadonlySet<string>;
  readonly levelCodes: ReadonlySet<string>;
  readonly countryCurrencies: ReadonlyMap<string, string>;
};

/**
 * The subset of the rejection vocabulary a SINGLE FIELD can produce. `RejectionReason` in
 * import-row.ts is this union plus the row-level and record-level reasons (cross-field date
 * comparisons, the money cell, cell counts) that no one field owns — so both modules keep speaking
 * one vocabulary, composed by one function.
 */
export type FieldRejectionReason =
  | { readonly kind: 'blank-name' }
  | { readonly kind: 'unknown-role'; readonly value: string }
  | { readonly kind: 'unknown-level'; readonly value: string }
  | { readonly kind: 'unknown-country'; readonly value: string }
  | { readonly kind: 'unknown-gender'; readonly value: string }
  | { readonly kind: 'missing-date'; readonly column: DateColumn }
  | { readonly kind: 'malformed-date'; readonly column: DateColumn; readonly value: string };

/** The judgement on one field. `ok: false` carries the reason; nothing throws. */
export type FieldCheck<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: FieldRejectionReason };

/** A name is any non-blank text, trimmed. Deliberately not unique — the id is the identity. */
export function checkName(cell: string): FieldCheck<string> {
  const name = blankToNull(cell);
  if (name === null) {
    return { ok: false, reason: { kind: 'blank-name' } };
  }
  return { ok: true, value: name };
}

/** Role resolves ONLY against the active reference rows — never created, guessed, or mapped. */
export function checkRoleCode(cell: string, refs: ReferenceData): FieldCheck<string> {
  const roleCode = cell.trim();
  if (!refs.roleCodes.has(roleCode)) {
    return { ok: false, reason: { kind: 'unknown-role', value: roleCode } };
  }
  return { ok: true, value: roleCode };
}

/** Level resolves ONLY against the active reference rows. */
export function checkLevelCode(cell: string, refs: ReferenceData): FieldCheck<string> {
  const levelCode = cell.trim();
  if (!refs.levelCodes.has(levelCode)) {
    return { ok: false, reason: { kind: 'unknown-level', value: levelCode } };
  }
  return { ok: true, value: levelCode };
}

/**
 * Country resolves against the active reference rows AND yields the currency AD-6 derives from it.
 * An unknown country must be a rejection rather than a guess: it would otherwise produce a salary
 * record with no resolvable currency.
 */
export function checkCountryCode(
  cell: string,
  refs: ReferenceData,
): FieldCheck<{ readonly countryCode: string; readonly currency: string }> {
  const countryCode = cell.trim();
  const currency = refs.countryCurrencies.get(countryCode);
  if (currency === undefined) {
    return { ok: false, reason: { kind: 'unknown-country', value: countryCode } };
  }
  return { ok: true, value: { countryCode, currency } };
}

/** Exactly `MALE` or `FEMALE`, verbatim (Law 3). `Female` is not a match. */
export function checkGender(cell: string): FieldCheck<Gender> {
  const gender = cell.trim();
  if (gender !== 'MALE' && gender !== 'FEMALE') {
    return { ok: false, reason: { kind: 'unknown-gender', value: gender } };
  }
  return { ok: true, value: gender };
}

/**
 * One date cell, judged. A BLANK cell and a MALFORMED cell are deliberately different reasons: a
 * blank `effective_from` is the AD-7 case the import epic calls out by name ("never defaulted to
 * today or to the hire date"), and telling a reader "the cell is blank" is a different instruction
 * from telling them "the cell reads 01/06/2021".
 *
 * There is no comparison against today here, on purpose. Whether a date may be in the future is a
 * property of the CALLER's rule (a salary record may not be future-dated; a hire date may), so the
 * clock-dependent judgement stays with the caller that actually has one — CAP-2 has none, and an
 * unused clock dependency would be a Law 6 hazard rather than compliance.
 */
export function checkDateCell(cell: string, column: DateColumn): FieldCheck<PlainDate> {
  const trimmed = blankToNull(cell);
  if (trimmed === null) {
    return { ok: false, reason: { kind: 'missing-date', column } };
  }

  const parsed = parsePlainDate(trimmed);
  if (parsed === null) {
    return { ok: false, reason: { kind: 'malformed-date', column, value: trimmed } };
  }

  return { ok: true, value: parsed };
}
