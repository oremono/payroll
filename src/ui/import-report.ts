import type { ImportResult, RowRejection } from '@/application/use-cases/import-employees';
import type { FileRefusalReason } from '@/domain/import-row';

/**
 * Everything the import surface DECIDES, with no React in it.
 *
 * The repo carries no jsdom and no @testing-library, and story 2-2 forbids adding either. So the
 * split is the same one `nav-items.ts` makes: judgement lives here and is unit-tested under node
 * (`tests/ui/import-report.test.ts`), while `import-panel.tsx` is left thin enough that what it
 * does is visible by reading it, and its RENDERED behaviour is proven in `e2e/import.spec.ts`.
 *
 * ## What this module may and may not say
 *
 * It renders the backend's words and authors none of its own for a fact the backend has already
 * worded (Law 7, epic-2-context). `RowRejection.sentence` and `ImportResult.statement` are carried
 * through byte for byte — nothing here calls `composeRejectionSentence`, `rejectionOffendingValue`,
 * or `composeRefusalStatement`, and nothing re-phrases their output.
 *
 * The three sentences it DOES author are ones no backend reason exists for: the summary strip and
 * the rejection heading (presentation of counts the payload carries as numbers), and
 * `UPLOAD_FAILED`, which describes a request that never reached the handler at all.
 *
 * The import is `import type` only — `src/ui` may reach `application` and `domain` for TYPES by
 * convention (AD-1), and a value import would drag the use-case and its ports into the client
 * bundle.
 */

/**
 * The locale every number on this surface is grouped in, PINNED.
 *
 * Determinism, in the small (Law 6 / AD-19): under the ambient locale the same payload reads
 * `9,947` in one place, `9.947` in another, and `9 947` in a third, depending on where it happened
 * to render. A count is data; it does not change meaning with the machine.
 */
const NUMBER_LOCALE = 'en-US';

/** Rows per page of the rejection table. Pagination, never truncation, never infinite scroll. */
export const REJECTION_PAGE_SIZE = 50;

/**
 * The nine column names the format helper text spells out, in file order.
 *
 * Mirrors `REQUIRED_COLUMNS` in `src/adapters/csv/parse-import-csv.ts` deliberately rather than
 * importing it: `src/ui` may import `application` and `domain` only (AD-1), the adapter's constant
 * is not exported, and a UI that imported the parser would pull the whole CSV adapter into the
 * client bundle. `tests/ui/import-report.test.ts` is the drift gate on the duplication.
 */
export const REQUIRED_COLUMN_NAMES = [
  'name',
  'role_code',
  'level_code',
  'country_code',
  'gender',
  'hire_date',
  'amount_minor',
  'currency',
  'effective_from',
] as const;

/**
 * The one outcome the UI words itself: the POST never completed, so there is no payload at all.
 *
 * Deliberately NOT spelled as `kind: 'refusal'`. A `FileRefusalReason` is a judgement the backend
 * made about a file it read; this is the absence of any judgement, and giving it the backend's
 * discriminator would make an invented sentence indistinguishable from a composed one. It renders
 * in the refusal TREATMENT — the honest thing to look at is the same in both cases — while staying
 * a different thing in the types.
 */
export const UPLOAD_FAILED = {
  kind: 'upload-failed',
  statement:
    'The upload did not complete, so the file was never read. Nothing was imported. Try again ' +
    'when the connection is back.',
} as const;

/** What the panel has to show: a payload the backend sent, or the one it never got to send. */
export type PanelReport = ImportResult | typeof UPLOAD_FAILED;

/** One page of the rejection table, plus everything the page controls need to describe it. */
export type RejectionPage = {
  readonly rows: readonly RowRejection[];
  /** 1-based, and CLAMPED into `1..pageCount` — see `rejectionPage`. */
  readonly pageNumber: number;
  /** At least 1, so `page 1 of 0` is never renderable. */
  readonly pageCount: number;
  /** 1-based span of this page within the whole report; `0`/`0` when there are no rejections. */
  readonly firstIndex: number;
  readonly lastIndex: number;
  /** The size of the whole report, not of this page. */
  readonly totalCount: number;
};

function grouped(count: number): string {
  return count.toLocaleString(NUMBER_LOCALE);
}

/** `1 row` / `0 rows` / `9,947 rows` — the singular is exact, and zero takes the plural. */
function rowsPhrase(count: number): string {
  return `${grouped(count)} ${count === 1 ? 'row' : 'rows'}`;
}

/**
 * The summary strip: `9,947 rows imported · 53 rows rejected · nothing guessed`.
 *
 * Phrasing is the reconcile-stitch ADOPT ruling, which wins over EXPERIENCE's earlier wording.
 * "nothing guessed" is unconditional — it is CAP-1's standing claim about how the file was read,
 * equally true of a clean import and of an all-rejected one, so it is not a state to be earned.
 *
 * An all-rejected file gets THIS, not a refusal panel: the reader needs to know which rows failed
 * and why, and a refusal would tell them neither.
 */
export function composeSummaryStrip(importedCount: number, rejectedCount: number): string {
  return `${rowsPhrase(importedCount)} imported · ${rowsPhrase(rejectedCount)} rejected · nothing guessed`;
}

/** `Rejection Report (53 rows)` — the adopted mock's heading, pluralized honestly. */
export function composeRejectionHeading(rejectedCount: number): string {
  return `Rejection Report (${rowsPhrase(rejectedCount)})`;
}

/**
 * Slice one page out of the report, in FILE ORDER — the payload arrives ordered by row number and
 * is never sorted here.
 *
 * TOTAL, like everything else on the import path: the requested page comes from component state
 * that a second upload or a shorter report can leave pointing past the end, so it is clamped rather
 * than trusted. There is no input for which this throws or returns rows nobody asked for.
 */
export function rejectionPage(
  rejections: readonly RowRejection[],
  requestedPage: number,
): RejectionPage {
  const totalCount = rejections.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / REJECTION_PAGE_SIZE));
  const pageNumber = Math.min(Math.max(Math.trunc(requestedPage), 1), pageCount);

  const start = (pageNumber - 1) * REJECTION_PAGE_SIZE;
  const rows = rejections.slice(start, start + REJECTION_PAGE_SIZE);

  return {
    rows,
    pageNumber,
    pageCount,
    firstIndex: rows.length === 0 ? 0 : start + 1,
    lastIndex: rows.length === 0 ? 0 : start + rows.length,
    totalCount,
  };
}

/**
 * The Employee Name (File) cell.
 *
 * A blank name is a real rejection reason, and an empty table cell would read as a rendering bug.
 * The em dash marks the absence; the MEANING is carried by the Reason column's sentence ("The name
 * cell is blank."), which is what keeps a typographic mark from being the sole carrier of meaning.
 */
export function nameCell(name: string | null): string {
  return name ?? '—';
}

/**
 * The one statement that rides the app-level polite live region when an upload settles (AD-20).
 *
 * For an import it is the SAME sentence the strip shows, so what is announced and what is on screen
 * can never disagree. For a refusal it is the payload's statement, byte for byte.
 */
export function composeImportAnnouncement(report: PanelReport): string {
  switch (report.kind) {
    case 'imported':
      return composeSummaryStrip(report.importedCount, report.rejectedCount);
    case 'refusal':
      return report.statement;
    case 'upload-failed':
      return report.statement;
  }
}

/**
 * Narrow a decoded response body to an `ImportResult`, or answer `null`.
 *
 * The handler answers 200 for every reachable input and the panel branches on `kind`, never on
 * status — but a body that is not an `ImportResult` at all is still reachable: a proxy error page,
 * a truncated response, a deploy swapping under the request. Trusting it would throw inside the
 * render, which is the one failure mode a report surface must not have. Structural, not exhaustive:
 * `reason` is checked for presence and left otherwise unread, because nothing here branches on it.
 */
export function parseImportResponse(body: unknown): ImportResult | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null;
  }

  const candidate = body as Partial<Record<string, unknown>>;

  if (candidate['kind'] === 'imported') {
    const { importedCount, rejectedCount, rejections } = candidate;
    if (
      typeof importedCount !== 'number' ||
      typeof rejectedCount !== 'number' ||
      !Array.isArray(rejections)
    ) {
      return null;
    }
    return { kind: 'imported', importedCount, rejectedCount, rejections };
  }

  if (candidate['kind'] === 'refusal') {
    const { reason, statement } = candidate;
    if (typeof statement !== 'string' || typeof reason !== 'object' || reason === null) {
      return null;
    }
    // The one cast on this path. `reason` narrows only to `object`, and nothing here branches on
    // it — validating the whole `FileRefusalReason` union would mean restating the domain's
    // vocabulary in the UI, which is the duplication Law 7 exists to prevent. The panel reads
    // `statement`, which IS validated.
    return { kind: 'refusal', reason: reason as FileRefusalReason, statement };
  }

  return null;
}
