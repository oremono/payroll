/**
 * The ONE place import rejection and refusal copy is composed. (Law 8 / AD-20, applied to CAP-1.)
 *
 * AD-20 states the rule for the verdict sentence — "composed by exactly one function and consumed
 * unmodified by both the card and copy-answer" — and the same reasoning holds here. Story 2-2's
 * rejection table, the whole-file refusal region, and Epic 12's seed all read these strings; if any
 * of them composed its own, the product would have two ways to say the same thing and they would
 * drift.
 *
 * No I/O, no clock, no randomness, no imports outside this layer. Every function is TOTAL and every
 * `switch` is EXHAUSTIVE WITH NO `default`: that is what makes adding a `RejectionReason` variant a
 * type error here rather than a blank cell in a payroll report.
 *
 * REGISTER (DESIGN, and the epic's UX notes): statements, never celebrations and never alarm. A
 * partial import that tells the whole truth is the designed outcome, not a failure — there is no
 * error color in the token system and there is no "error" in this vocabulary either.
 */

import type { FileRefusalReason, RejectionReason } from './import-row';
import { MAX_AMOUNT_MINOR } from './import-row';

/** The sentence a reader sees in the rejection table's reason column. */
export function composeRejectionSentence(reason: RejectionReason): string {
  switch (reason.kind) {
    case 'blank-name':
      return 'The name cell is blank.';
    case 'unknown-role':
      return `Role code "${reason.value}" is not in the role reference table.`;
    case 'unknown-level':
      return `Level code "${reason.value}" is not in the level reference table.`;
    case 'unknown-country':
      return `Country code "${reason.value}" is not in the country reference table.`;
    case 'unknown-gender':
      return `Gender "${reason.value}" is neither MALE nor FEMALE.`;
    case 'missing-date':
      return `The ${reason.column} cell is blank.`;
    case 'malformed-date':
      return `The ${reason.column} cell reads "${reason.value}", which is not a date in YYYY-MM-DD form.`;
    case 'future-effective-from':
      return `effective_from ${reason.effectiveFrom} is later than today, ${reason.today}.`;
    case 'effective-before-hire':
      return `effective_from ${reason.effectiveFrom} is earlier than the hire date, ${reason.hireDate}.`;
    case 'malformed-amount':
      return `amount_minor "${reason.value}" is not a whole number of minor units.`;
    case 'amount-not-positive':
      return `amount_minor "${reason.value}" is not greater than zero.`;
    case 'amount-out-of-range':
      // The maximum is interpolated from the single constant that also enforces it, so the
      // sentence can never name a number the validator does not actually apply.
      return (
        `amount_minor "${reason.value}" is larger than ${MAX_AMOUNT_MINOR.toString()}, ` +
        'the largest amount this system stores.'
      );
    case 'currency-mismatch':
      return `Currency "${reason.value}" is not "${reason.expected}", the currency of country "${reason.countryCode}".`;
    case 'wrong-cell-count':
      return `The row has ${String(reason.actual)} cells; the header has ${String(reason.expected)}.`;
    case 'unterminated-quote':
      // Deliberately says nothing about the rest of the file, because nothing else IS affected —
      // an unclosed quote is contained to its own record (see the CSV quoting contract).
      return 'The row opens a quoted cell that is never closed.';
  }
}

/**
 * The single cell value the report points at, or `null` when no one cell is to blame.
 *
 * Story 2-2's table has an "offending value" column beside the reason, and a report that repeats
 * the whole sentence there tells the reader nothing new. Two reasons genuinely have no single cell
 * to name — a blank name (the blankness IS the value) and an unclosed quote (the record never
 * became cells at all) — and they answer `null` rather than an invented empty string.
 */
export function rejectionOffendingValue(reason: RejectionReason): string | null {
  switch (reason.kind) {
    case 'blank-name':
    case 'unterminated-quote':
      return null;
    case 'unknown-role':
    case 'unknown-level':
    case 'unknown-country':
    case 'unknown-gender':
    case 'malformed-date':
    case 'malformed-amount':
    case 'amount-not-positive':
    case 'amount-out-of-range':
    case 'currency-mismatch':
      return reason.value;
    case 'missing-date':
      // The cell is blank, so the column name is the only thing that identifies it.
      return reason.column;
    case 'future-effective-from':
    case 'effective-before-hire':
      return reason.effectiveFrom;
    case 'wrong-cell-count':
      return String(reason.actual);
  }
}

/**
 * The one statement a whole-file refusal carries. Nothing was written, and there is no per-row
 * report to give — so this single sentence is the entire answer, and it says what could not be
 * read rather than merely that something went wrong.
 */
export function composeRefusalStatement(reason: FileRefusalReason): string {
  switch (reason.kind) {
    case 'not-csv':
      return (
        'The upload could not be read as CSV text. Import reads a CSV file; a spreadsheet ' +
        'workbook has to be saved as CSV first.'
      );
    case 'empty-file':
      return 'The uploaded file is empty.';
    case 'no-data-rows':
      return 'The uploaded file has a header row and no data rows.';
    case 'missing-columns':
      return `The header row is missing these columns: ${reason.columns.join(', ')}.`;
    case 'duplicate-columns':
      return `The header row names these columns more than once: ${reason.columns.join(', ')}.`;
    case 'no-file-part':
      return 'The upload carried no file.';
    case 'multiple-file-parts':
      return `The upload carried ${String(reason.count)} files. Import reads one file at a time.`;
    case 'too-large':
      return `The upload is larger than the ${String(reason.limitMegabytes)} MB this import reads.`;
    case 'unreadable-upload':
      // Deliberately distinct from `no-file-part`: a truncated or aborted upload is a different
      // thing to tell a reader than "you attached nothing", and they are separately reachable.
      return 'The upload did not arrive complete, so it could not be read.';
    case 'write-failed':
      return 'The rows could not be written, so nothing was imported.';
  }
}
