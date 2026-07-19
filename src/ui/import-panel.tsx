'use client';

import { useRef, useState, type FormEvent } from 'react';

import type { RowRejection } from '@/application/use-cases/import-employees';
import { useAnnounce } from '@/ui/announcer';
import {
  composeImportAnnouncement,
  composeRejectionHeading,
  composeSummaryStrip,
  nameCell,
  parseImportResponse,
  rejectionPage,
  REQUIRED_COLUMN_NAMES,
  UPLOAD_FAILED,
  type PanelReport,
} from '@/ui/import-report';

/**
 * The CAP-1 import surface: choose a CSV, submit it, read the report.
 *
 * A two-beat flow, not a wizard (epic-2-context § UX). This is the ONLY client component in the
 * story, and it is deliberately thin — every decision it makes it borrows from `import-report.ts`,
 * which is framework-free and unit-tested under node (`tests/ui/import-report.test.ts`). What is
 * left here is markup and one `fetch`.
 *
 * ## Why this is a Route Handler and not a Server Action
 *
 * AD-21 permits exactly two Route Handlers, and the CAP-1 multipart upload is one of them. A
 * multipart file POST is the one mutation Server Actions do not do well, and the endpoint already
 * exists and is proven by story 2-1. Nothing here is added to that contract: the payload is
 * consumed as received.
 *
 * ## Branching on `kind`, never on status
 *
 * The handler answers 200 for every reachable input, refusals included — encoding "your file had
 * bad rows" as a 4xx would make a truthful report look like a malfunction. So this component never
 * reads `response.status`; status-based handling here would be dead code that looked load-bearing.
 * The only non-200 path that matters is the one where there is no usable body at all, and that is
 * handled by `parseImportResponse` returning `null`.
 *
 * ## The three reports, and the one that is not a refusal
 *
 * `kind: 'imported'` renders the strip and (when there are any) the rejection table — INCLUDING
 * when `importedCount` is 0. An all-rejected file is a report, not a refusal: the reader needs to
 * know which rows failed and why, and a refusal panel would tell them neither.
 *
 * ## Register
 *
 * No spinner, no progress bar, no percentage (EXPERIENCE § Cold load bans progress theater). The
 * pending state is a disabled submit whose label states the action is under way. No red/green, no
 * celebration, no notification affordance — there is no error color in the token system, and a
 * partial import that tells the whole truth is the designed outcome, not a failure.
 */

const HELP_ID = 'import-file-help';
const FILE_INPUT_ID = 'import-file';

/** The heading the refusal region is named by — used for both a payload refusal and a dead POST. */
const REFUSAL_HEADING = 'The file was not imported';

export function ImportPanel() {
  const announce = useAnnounce();

  const [hasFile, setHasFile] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [report, setReport] = useState<PanelReport | null>(null);
  const [requestedPage, setRequestedPage] = useState(1);
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = formRef.current;
    if (form === null || isPending) {
      return;
    }

    setIsPending(true);
    // The prior report is cleared before the request rather than after the answer: a report on
    // screen while a NEW file is being read is a statement about a file that is no longer the
    // subject. The replacement is wholesale, and the page position goes with it.
    setReport(null);
    setRequestedPage(1);

    // `FormData` from the form element itself, so the file is carried as a real multipart part
    // under the input's own `name` — the shape `handleImportRequest` reads.
    const body = new FormData(form);

    let settled: PanelReport;
    try {
      const response = await fetch('/api/import', { method: 'POST', body });
      // `.json()` throws on a body that is not JSON at all — a proxy error page, a truncated
      // response, a deploy swapping under the request. Inside the same `try` deliberately: a
      // report surface that throws during render is the one failure mode it must not have.
      settled = parseImportResponse(await response.json()) ?? UPLOAD_FAILED;
    } catch {
      // Caught locally, never an unhandled rejection. There is no `FileRefusalReason` for a request
      // that never reached the handler, so this is the one outcome the UI words itself.
      settled = UPLOAD_FAILED;
    }

    setReport(settled);
    setIsPending(false);
    // One voice (AD-20): the app-level polite region, never a second live region mounted here.
    announce(composeImportAnnouncement(settled));
  }

  return (
    <>
      <section
        aria-labelledby="import-upload-heading"
        className="rounded border border-border-hairline bg-surface-card p-4"
      >
        {/* `<h2>`, not `<h1>` — the header owns the document's one top-level heading, derived from
            nav-items so it cannot disagree with the sidebar. */}
        <h2 id="import-upload-heading" className="text-headline-md text-ink">
          Import employees
        </h2>

        <form ref={formRef} onSubmit={submit} className="mt-3">
          {/* A real `<label htmlFor>`, per the accessibility floor — not a placeholder, not an
              aria-label standing in for one. */}
          <label
            htmlFor={FILE_INPUT_ID}
            className="block text-label-caps text-ink-muted uppercase"
          >
            Spreadsheet file
          </label>
          <input
            id={FILE_INPUT_ID}
            name="file"
            type="file"
            // CSV only (AD-7). `.xlsx` is deliberately absent: a workbook is a whole-file refusal,
            // and offering it in the picker would promise something the importer refuses.
            accept=".csv,text/csv"
            aria-describedby={HELP_ID}
            onChange={(event) => setHasFile((event.target.files?.length ?? 0) > 0)}
            // The `as-of-control` idiom: form controls sit on `bg-surface-card`, where
            // `input-border` measures 3.09:1 — on `surface-base` it is 2.96:1, below DESIGN's own
            // 3:1 non-text floor.
            className="mt-1 block rounded border border-input-border bg-surface-card px-3 py-2 text-body-md text-ink focus:border-primary"
          />
          <p id={HELP_ID} className="mt-1 text-body-sm text-ink-muted">
            CSV only — a spreadsheet workbook has to be saved as CSV first. The header row must name
            these nine columns:{' '}
            <span className="font-mono text-number-sm">{REQUIRED_COLUMN_NAMES.join(', ')}</span>.
          </p>

          {/* Solid primary: this control commits data (the adopted button grammar). There is no
              ghost button on this surface at all — dropping the rejection-report download left only
              the one action, which also sidesteps the open `button-secondary` border-contrast
              defect rather than shipping it. */}
          <button
            type="submit"
            disabled={!hasFile || isPending}
            className="mt-3 rounded bg-primary px-3 py-2 text-body-md text-primary-foreground disabled:bg-secondary"
          >
            {/* The whole pending treatment: the label states the action is under way. No spinner,
                no bar, no percentage. */}
            {isPending ? 'Importing the file…' : 'Import file'}
          </button>
        </form>
      </section>

      {report === null ? null : <Report report={report} page={requestedPage} onPage={setRequestedPage} />}
    </>
  );
}

function Report({
  report,
  page,
  onPage,
}: {
  report: PanelReport;
  page: number;
  onPage: (next: number) => void;
}) {
  if (report.kind === 'imported') {
    return (
      <section
        aria-labelledby="import-report-heading"
        className="mt-4 rounded border border-border-hairline bg-surface-card p-4"
      >
        <h2 id="import-report-heading" className="text-headline-md text-ink">
          Import report
        </h2>
        {/* All numerals in the mono face (DESIGN § Typography) — the strip is one composed sentence
            and is carried whole rather than split into differently-faced spans. */}
        <p className="mt-2 font-mono text-number-md text-ink">
          {composeSummaryStrip(report.importedCount, report.rejectedCount)}
        </p>

        {report.rejections.length === 0 ? null : (
          <RejectionReport rejections={report.rejections} page={page} onPage={onPage} />
        )}
      </section>
    );
  }

  // A REGION with a heading, never `role="alert"` (NFR9; project-context § Conventions). A refusal
  // is an answer-shaped object and is styled with the same dignity as one: flat `refusal-fill`, a
  // hairline border, no warning icon, no error color — none exists in this system.
  return (
    <section
      aria-labelledby="import-refusal-heading"
      className="mt-4 rounded border border-border-hairline bg-refusal-fill p-4"
    >
      <h2 id="import-refusal-heading" className="text-body-md font-medium text-ink-muted">
        {REFUSAL_HEADING}
      </h2>
      {/* Verbatim. For a payload refusal this string was composed by `composeRefusalStatement` and
          is rendered as received (Law 7); for a dead POST it is `UPLOAD_FAILED.statement`. */}
      <p className="mt-1 text-body-sm text-ink">{report.statement}</p>
    </section>
  );
}

function RejectionReport({
  rejections,
  page,
  onPage,
}: {
  rejections: readonly RowRejection[];
  page: number;
  onPage: (next: number) => void;
}) {
  const slice = rejectionPage(rejections, page);

  return (
    <>
      <h3 id="rejection-report-heading" className="mt-4 text-headline-md text-ink">
        {composeRejectionHeading(slice.totalCount)}
      </h3>
      <p className="mt-1 text-body-md text-ink-muted">
        Rejected rows are never mapped or guessed into a taxonomy value. Fix the file and re-import
        the corrected rows — the rows that landed are unaffected.
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">
            Rejected rows, in file order: row number, the name as the file spelled it, the offending
            value, and the reason.
          </caption>
          <thead>
            {/* Real `<th scope="col">` headers, not styled divs — the row/column relationship is
                what makes this table navigable by a screen reader at all. */}
            <tr className="border-b border-border-hairline text-label-caps text-ink-muted uppercase">
              <th scope="col" className="px-cell-padding-h py-cell-padding-v text-right">
                Row #
              </th>
              <th scope="col" className="px-cell-padding-h py-cell-padding-v">
                Employee Name (File)
              </th>
              <th scope="col" className="px-cell-padding-h py-cell-padding-v">
                Offending Value
              </th>
              <th scope="col" className="px-cell-padding-h py-cell-padding-v">
                Reason
              </th>
            </tr>
          </thead>
          <tbody>
            {slice.rows.map((rejection) => (
              // `rowNumber` is the 1-based physical line in the file and is unique within a report,
              // so it is a real identity rather than an array index standing in for one.
              <tr key={rejection.rowNumber} className="border-b border-border-hairline align-top">
                <td className="px-cell-padding-h py-cell-padding-v text-right font-mono text-number-sm text-ink-muted">
                  {rejection.rowNumber}
                </td>
                <td className="px-cell-padding-h py-cell-padding-v text-body-sm text-ink">
                  {nameCell(rejection.name)}
                </td>
                <td className="px-cell-padding-h py-cell-padding-v font-mono text-number-sm text-ink">
                  {/* The raw trimmed cell as the file spelled it; `null` where the reason names no
                      single cell. The em dash marks the absence, and the Reason column beside it
                      carries the meaning. */}
                  {rejection.offendingValue ?? '—'}
                </td>
                <td className="px-cell-padding-h py-cell-padding-v text-body-sm text-ink-muted">
                  {/* Composed by the ONE composer, in the application layer. Rendered as received;
                      the UI never authors a second wording of a reason (Law 7). */}
                  {rejection.sentence}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination, not truncation and never infinite scroll. With no rejection-report download
          (that would be a third Route Handler, which AD-21 forbids), truncating at 50 would put
          rows permanently out of reach. Two named buttons — every rejection is reachable by
          keyboard alone. */}
      <nav aria-label="Rejection report pages" className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={slice.pageNumber === 1}
          onClick={() => onPage(slice.pageNumber - 1)}
          className="rounded border border-input-border bg-surface-card px-3 py-2 text-body-sm text-ink disabled:text-ink-faint"
        >
          Previous page
        </button>
        <p className="font-mono text-number-sm text-ink-muted">
          Rows {slice.firstIndex}–{slice.lastIndex} of {slice.totalCount} · Page {slice.pageNumber}{' '}
          of {slice.pageCount}
        </p>
        <button
          type="button"
          disabled={slice.pageNumber === slice.pageCount}
          onClick={() => onPage(slice.pageNumber + 1)}
          className="rounded border border-input-border bg-surface-card px-3 py-2 text-body-sm text-ink disabled:text-ink-faint"
        >
          Next page
        </button>
      </nav>
    </>
  );
}
