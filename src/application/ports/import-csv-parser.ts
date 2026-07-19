import type { FileRefusalReason, ImportRowInput, RejectionReason } from '@/domain/import-row';

/**
 * The port between the import use-case and whatever turns an uploaded file into rows. (Law 2 /
 * AD-1: `src/application/**` may import only `src/domain/**`, so the CSV parse ADAPTER cannot be
 * named here — it implements this shape and is injected.)
 *
 * The parse result is deliberately per-record rather than "rows or nothing". A record the parser
 * cannot shape into cells at all — ragged, blank, or opening a quoted cell it never closes — is
 * still a record the reader must be told about, and it speaks the SAME `RejectionReason`
 * vocabulary the domain validator does. That is what makes the reconciliation rule below
 * expressible at all.
 */

/**
 * One data record of the file, already reconciled against the header.
 *
 * `rowNumber` is the 1-based LINE number in the file, so the header is line 1 and the first data
 * row is line 2 — the number the reader sees in their spreadsheet, not an index into some array
 * they cannot see.
 *
 * `name` is the name cell AS IT APPEARED, carried even on a rejected record, because "which person
 * is this?" is the first question a reader asks of a rejection row. It is `null` only when the
 * record has no name cell to read.
 */
export type ParsedRecord = {
  readonly rowNumber: number;
  readonly name: string | null;
} & (
  | { readonly ok: true; readonly row: ImportRowInput }
  | { readonly ok: false; readonly reason: RejectionReason }
);

/**
 * Either the file's data records, or a whole-file refusal. (Law 8: a refusal is a return value.)
 *
 * ## The record-count reconciliation rule
 *
 * `records` MUST contain one entry for every data record in the file. A record may be omitted in
 * exactly ONE case: a completely empty FINAL line, which is the artifact of a trailing newline and
 * not something anybody wrote. Every other record — blank, ragged, malformed, unparseable —
 * appears, so that `importedCount + rejectedCount` accounts for the whole file.
 *
 * A report that under-counts is worse than a refusal, because the epic sells the report as the
 * thing that tells the whole truth. Story 2-1's review found a parser that answered a 51-record
 * file with 1 record: fifty employees vanished with no rejection, no count, and no signal.
 */
export type CsvParseOutcome =
  | { readonly kind: 'records'; readonly records: readonly ParsedRecord[] }
  | { readonly kind: 'refusal'; readonly reason: FileRefusalReason };

/** The injected parse function. Total: it returns an outcome for any string, and never throws. */
export type ImportCsvParser = (text: string) => CsvParseOutcome;
