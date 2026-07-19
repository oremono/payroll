import { describe, expect, it } from 'vitest';

import type { ImportResult, RowRejection } from '@/application/use-cases/import-employees';
import {
  composeImportAnnouncement,
  composeRejectionHeading,
  composeSummaryStrip,
  nameCell,
  parseImportResponse,
  REJECTION_PAGE_SIZE,
  REQUIRED_COLUMN_NAMES,
  rejectionPage,
  UPLOAD_FAILED,
} from '@/ui/import-report';

// Test-first (Law 1 / AD-23): red before `src/ui/import-report.ts` exists.
//
// Everything the import surface DECIDES lives in that module, framework-free, so it can be judged
// here in the node suite. The repo has no jsdom and no @testing-library, and story 2-2 forbids
// adding either — rendered behaviour is Playwright's job (`e2e/import.spec.ts`), and the two never
// overlap. This file is the reason the panel component can stay thin enough to be obviously right.
//
// The sentences the BACKEND composed are never re-composed here. `RowRejection.sentence` and
// `ImportResult.statement` are rendered as received (Law 7, epic-2-context); the only sentences
// this module authors are ones no backend reason exists for — the summary strip, the rejection
// heading, and the transport-failure statement.

/** A rejection with a stable, obviously-synthetic shape. `at` doubles as the row number. */
function rejection(at: number, over: Partial<RowRejection> = {}): RowRejection {
  return {
    rowNumber: at,
    name: `Person ${String(at)}`,
    offendingValue: 'Ninja',
    sentence: `Role code "Ninja" is not in the role reference table.`,
    ...over,
  };
}

function rejections(count: number): readonly RowRejection[] {
  return Array.from({ length: count }, (_unused, index) => rejection(index + 2));
}

function imported(importedCount: number, rejected: readonly RowRejection[]): ImportResult {
  return {
    kind: 'imported',
    importedCount,
    rejectedCount: rejected.length,
    rejections: rejected,
  };
}

describe('composeSummaryStrip', () => {
  // The reconcile ADOPT ruling wins over EXPERIENCE's earlier phrasing: `N rows imported · N rows
  // rejected · nothing guessed`. "nothing guessed" is CAP-1's whole trust claim in three words and
  // is present unconditionally — it is true of a clean file and of an all-rejected one alike.
  it('states imported, rejected, and the trust claim, separated by middots', () => {
    expect(composeSummaryStrip(9947, 53)).toBe(
      '9,947 rows imported · 53 rows rejected · nothing guessed',
    );
  });

  it('pluralizes each count independently — a count of 1 takes the singular', () => {
    expect(composeSummaryStrip(1, 1)).toBe('1 row imported · 1 row rejected · nothing guessed');
  });

  it('takes the plural at zero, not the singular', () => {
    expect(composeSummaryStrip(0, 0)).toBe('0 rows imported · 0 rows rejected · nothing guessed');
  });

  // An all-rejected file is a REPORT, not a refusal (I/O matrix). The strip states it in the
  // ordinary way; nothing about the phrasing changes because the imported count happens to be zero.
  it('reports an all-rejected file as an ordinary strip', () => {
    expect(composeSummaryStrip(0, 4)).toBe('0 rows imported · 4 rows rejected · nothing guessed');
  });

  it('mixes a singular imported count with a plural rejected count', () => {
    expect(composeSummaryStrip(1, 2)).toBe('1 row imported · 2 rows rejected · nothing guessed');
    expect(composeSummaryStrip(2, 1)).toBe('2 rows imported · 1 row rejected · nothing guessed');
  });

  // Determinism (Law 6, in the small): the separator comes from an explicitly pinned locale. Under
  // the ambient locale a CI box set to de-DE would render `9.947` and a fr-FR one `9 947` — the
  // same payload reading differently depending on where it was rendered.
  it('groups thousands in the PINNED locale, not the ambient one', () => {
    expect(composeSummaryStrip(1000, 1000000)).toBe(
      '1,000 rows imported · 1,000,000 rows rejected · nothing guessed',
    );
  });

  it('leaves a three-digit count ungrouped', () => {
    expect(composeSummaryStrip(999, 100)).toBe(
      '999 rows imported · 100 rows rejected · nothing guessed',
    );
  });
});

describe('composeRejectionHeading', () => {
  it('names the report and its size, per the adopted mock', () => {
    expect(composeRejectionHeading(53)).toBe('Rejection Report (53 rows)');
  });

  it('takes the singular at one row', () => {
    expect(composeRejectionHeading(1)).toBe('Rejection Report (1 row)');
  });

  it('groups its count in the pinned locale too', () => {
    expect(composeRejectionHeading(10000)).toBe('Rejection Report (10,000 rows)');
  });
});

describe('REJECTION_PAGE_SIZE', () => {
  // Pagination, not truncation, and not infinite scroll. With no rejection-report download (a third
  // Route Handler is forbidden), truncating at 50 would hide data permanently.
  it('is 50', () => {
    expect(REJECTION_PAGE_SIZE).toBe(50);
  });
});

describe('rejectionPage', () => {
  it('returns the first 50 rows of a longer report, in file order', () => {
    const all = rejections(53);
    const page = rejectionPage(all, 1);

    expect(page.rows).toEqual(all.slice(0, 50));
    expect(page.rows.map((row) => row.rowNumber)).toEqual(all.slice(0, 50).map((r) => r.rowNumber));
  });

  it('returns the short LAST page rather than padding it', () => {
    const all = rejections(53);
    const page = rejectionPage(all, 2);

    expect(page.rows).toEqual(all.slice(50));
    expect(page.rows).toHaveLength(3);
  });

  it('counts pages so that every rejection is reachable', () => {
    expect(rejectionPage(rejections(53), 1).pageCount).toBe(2);
    expect(rejectionPage(rejections(100), 1).pageCount).toBe(2);
    expect(rejectionPage(rejections(101), 1).pageCount).toBe(3);
  });

  it('reaches every rejection exactly once when every page is walked', () => {
    const all = rejections(101);
    const first = rejectionPage(all, 1);
    const walked = Array.from({ length: first.pageCount }, (_unused, index) =>
      rejectionPage(all, index + 1),
    ).flatMap((page) => page.rows);

    expect(walked).toEqual(all);
  });

  it('is a single page when the report fits exactly', () => {
    const page = rejectionPage(rejections(50), 1);

    expect(page.pageCount).toBe(1);
    expect(page.rows).toHaveLength(50);
  });

  // A clean import has no rejections at all. One empty page rather than zero pages: a page count of
  // zero would make `page 1 of 0` renderable, which is not a sentence about anything.
  it('is one empty page when there are no rejections', () => {
    const page = rejectionPage([], 1);

    expect(page.rows).toEqual([]);
    expect(page.pageCount).toBe(1);
    expect(page.pageNumber).toBe(1);
    expect(page.totalCount).toBe(0);
  });

  it('reports the total across all pages, not the size of this one', () => {
    expect(rejectionPage(rejections(53), 2).totalCount).toBe(53);
  });

  // The requested page is DATA — it comes from component state that a second upload, or a report
  // that shrank, can leave pointing past the end. Clamping keeps the function total: there is no
  // input for which it returns rows nobody asked for or throws.
  it('clamps a page past the end back onto the last page', () => {
    expect(rejectionPage(rejections(53), 9).pageNumber).toBe(2);
    expect(rejectionPage(rejections(53), 9).rows).toHaveLength(3);
  });

  it('clamps a page below one back onto the first page', () => {
    expect(rejectionPage(rejections(53), 0).pageNumber).toBe(1);
    expect(rejectionPage(rejections(53), -4).pageNumber).toBe(1);
  });

  it('states the 1-based span this page covers, for the page-position line', () => {
    const first = rejectionPage(rejections(53), 1);
    const last = rejectionPage(rejections(53), 2);

    expect([first.firstIndex, first.lastIndex]).toEqual([1, 50]);
    expect([last.firstIndex, last.lastIndex]).toEqual([51, 53]);
  });

  it('spans zero to zero on an empty report, so no row is ever claimed', () => {
    const page = rejectionPage([], 1);

    expect([page.firstIndex, page.lastIndex]).toEqual([0, 0]);
  });
});

describe('nameCell', () => {
  it('renders the name the FILE spelled, unchanged', () => {
    expect(nameCell('Elena Rossi')).toBe('Elena Rossi');
  });

  // Colour is never the sole carrier of meaning, and neither is a dash: the em dash marks the
  // absence, while the Reason column's sentence ("The name cell is blank.") carries the MEANING.
  it('marks a blank name with an em dash rather than an empty cell', () => {
    expect(nameCell(null)).toBe('—');
  });
});

describe('composeImportAnnouncement', () => {
  // One voice (AD-20): the app-level polite region holds ONE statement of the outcome. For an
  // import that is the strip — the same sentence the reader sees — so the announcement and the
  // screen never disagree.
  it('announces an import with its summary strip', () => {
    expect(composeImportAnnouncement(imported(9947, rejections(53)))).toBe(
      composeSummaryStrip(9947, 53),
    );
  });

  it('announces a clean import with the same strip, zeros included', () => {
    expect(composeImportAnnouncement(imported(9947, []))).toBe(composeSummaryStrip(9947, 0));
  });

  it('announces an all-rejected file as a report, never as a refusal', () => {
    expect(composeImportAnnouncement(imported(0, rejections(4)))).toBe(composeSummaryStrip(0, 4));
  });

  // Rendered AND announced verbatim. The backend composed this sentence with the one composer; a
  // second wording of the same fact is the defect Law 7 exists to prevent.
  it('announces a whole-file refusal with the payload statement, byte for byte', () => {
    const statement = 'The uploaded file is empty.';

    expect(
      composeImportAnnouncement({ kind: 'refusal', reason: { kind: 'empty-file' }, statement }),
    ).toBe(statement);
  });

  it('announces a transport failure with the statement the panel shows', () => {
    expect(composeImportAnnouncement(UPLOAD_FAILED)).toBe(UPLOAD_FAILED.statement);
  });
});

describe('UPLOAD_FAILED', () => {
  // The ONE case the UI words itself, and it is legitimate: no `FileRefusalReason` describes a
  // request that never reached the handler, so there is no backend sentence to render. It is kept
  // distinct from `kind: 'refusal'` so it can never be mistaken for a payload the backend sent.
  it('is a refusal-shaped report the backend never sent', () => {
    expect(UPLOAD_FAILED.kind).toBe('upload-failed');
  });

  it('says the upload did not complete, and that nothing was imported', () => {
    expect(UPLOAD_FAILED.statement).toContain('did not complete');
    expect(UPLOAD_FAILED.statement).toContain('Nothing was imported');
  });

  // Register: statements, never alarm (EXPERIENCE § Cross-cutting state patterns).
  it('keeps the calm register — no apology, no alarm, no exclamation', () => {
    expect(UPLOAD_FAILED.statement).not.toMatch(/sorry|error|failed!|oops|!/i);
  });
});

describe('parseImportResponse', () => {
  // The handler answers 200 for every reachable input and the UI branches on `kind`, never on
  // status. But a body that is not an `ImportResult` at all is still reachable — a proxy error
  // page, a truncated response, a deploy mid-flight — and a render that trusted it would throw
  // inside React rather than tell the reader anything.
  it('accepts an imported payload with its rejections', () => {
    const payload = imported(2, rejections(1));

    expect(parseImportResponse(payload)).toEqual(payload);
  });

  it('accepts a refusal payload', () => {
    const payload: ImportResult = {
      kind: 'refusal',
      reason: { kind: 'not-csv' },
      statement: 'The upload could not be read as CSV text.',
    };

    expect(parseImportResponse(payload)).toEqual(payload);
  });

  it('rejects a body whose kind is not one of the two', () => {
    expect(parseImportResponse({ kind: 'ok' })).toBeNull();
  });

  it('rejects a body that is not an object at all', () => {
    expect(parseImportResponse(null)).toBeNull();
    expect(parseImportResponse('<!doctype html>')).toBeNull();
    expect(parseImportResponse(undefined)).toBeNull();
    expect(parseImportResponse([])).toBeNull();
  });

  it('rejects an imported payload missing its counts or its rejections', () => {
    expect(parseImportResponse({ kind: 'imported', importedCount: 1, rejectedCount: 0 })).toBeNull();
    expect(parseImportResponse({ kind: 'imported', rejections: [] })).toBeNull();
    expect(
      parseImportResponse({ kind: 'imported', importedCount: '1', rejectedCount: 0, rejections: [] }),
    ).toBeNull();
  });

  it('rejects a refusal missing its statement', () => {
    expect(parseImportResponse({ kind: 'refusal', reason: { kind: 'not-csv' } })).toBeNull();
  });
});

describe('REQUIRED_COLUMN_NAMES', () => {
  // The nine header names the format helper text spells out, in file order. They mirror
  // `REQUIRED_COLUMNS` in `src/adapters/csv/parse-import-csv.ts` DELIBERATELY: `src/ui` may import
  // `application` and `domain` only (AD-1), so the adapter's list cannot be reached from here, and
  // the constant is not exported in any case. This assertion is the drift gate.
  it('names the nine required columns, in the order the file carries them', () => {
    expect(REQUIRED_COLUMN_NAMES).toEqual([
      'name',
      'role_code',
      'level_code',
      'country_code',
      'gender',
      'hire_date',
      'amount_minor',
      'currency',
      'effective_from',
    ]);
  });
});
