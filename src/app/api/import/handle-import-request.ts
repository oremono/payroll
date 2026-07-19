import { refuseImport, type ImportResult } from '@/application/use-cases/import-employees';

/**
 * The body of the CAP-1 multipart upload handler, separated from `route.ts` so it is testable
 * without Next, without a database, and without a clock.
 *
 * ## The handler error contract
 *
 * This function returns an `ImportResult` for EVERY input it can receive. It never propagates an
 * exception and never emits a 500 for bad data. That is the second defect this story exists to
 * close: an unguarded call site here answered a 10,000-row upload with an HTTP 500 carrying no
 * report at all, because one oversized amount aborted the write transaction and the throw had
 * nowhere to go. The write funnel is DOCUMENTED to throw on invariant violations, so an unguarded
 * call site is a designed-in 500 rather than an oversight.
 *
 * Four specific obligations, each with a test of its own:
 *
 *  - Cap the upload size on `file.size`, BEFORE materializing the body with `file.text()`.
 *    Materializing a gigabyte to discover it is a gigabyte is the exact denial of service the cap
 *    exists to prevent.
 *  - Treat several file parts as a refusal rather than silently importing the first, which would
 *    leave the reader believing a file was imported that was not.
 *  - Distinguish a `formData()` that throws — a truncated or aborted upload — from a genuinely
 *    absent file part. They are different things to tell a reader, and both are reachable.
 *  - Wrap the use-case call, so any repository throw becomes a whole-file refusal with a statement.
 *
 * This is one of exactly TWO Route Handlers the system will ever have (AD-21); the other is CSV
 * export downloads. The rejection report is part of THIS response — a rejection-report CSV
 * download would be a third and is out of scope by design.
 */

/**
 * The largest upload this import reads.
 *
 * The epic's headline case is ~10,000 rows, which at roughly 80 bytes a row is about 800 KB. 16 MB
 * leaves an order of magnitude of headroom for wider files and longer names while still bounding
 * what one request can make the server hold in memory.
 */
export const MAX_UPLOAD_MEGABYTES = 16;

const MAX_UPLOAD_BYTES = MAX_UPLOAD_MEGABYTES * 1024 * 1024;

/** Workbook extensions the epic names — refused whole, by filename, before a byte is read. */
const WORKBOOK_EXTENSIONS = ['.xlsx', '.xls', '.xlsm', '.ods', '.numbers'];

/** Only what this handler actually needs from a `Request` — so a test can hand it a literal. */
export type ImportRequest = {
  readonly formData: () => Promise<FormData>;
};

export type ImportRequestDeps = {
  /** Runs the import use-case with its adapters already wired. May throw; this file catches. */
  readonly runImport: (text: string) => Promise<ImportResult>;
};

/**
 * The minimum shape of an uploaded file. Deliberately structural rather than `instanceof File`:
 * the runtime `File` differs between Node, the edge runtime, and the test environment, and an
 * `instanceof` check that silently fails would turn every upload into "no file part".
 */
type UploadedFile = {
  readonly name: string;
  readonly size: number;
  readonly text: () => Promise<string>;
};

function isUploadedFile(value: FormDataEntryValue): value is FormDataEntryValue & UploadedFile {
  if (typeof value === 'string') {
    return false;
  }
  const candidate = value as Partial<UploadedFile>;
  return typeof candidate.text === 'function' && typeof candidate.size === 'number';
}

function hasWorkbookExtension(fileName: string): boolean {
  const lowered = fileName.toLowerCase();
  return WORKBOOK_EXTENSIONS.some((extension) => lowered.endsWith(extension));
}

/** Turn one multipart upload into an import report, or into a refusal. Never throws. */
export async function handleImportRequest(
  request: ImportRequest,
  deps: ImportRequestDeps,
): Promise<ImportResult> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // A truncated or aborted upload — the body never arrived complete. Deliberately a DIFFERENT
    // refusal from `no-file-part`: "your upload was cut off" and "you attached nothing" are
    // different instructions to the person reading them.
    return refuseImport({ kind: 'unreadable-upload' });
  }

  // Every part, under any field name. Clients spell it `file`, `csv`, or the input's own name,
  // and refusing over the field name would be refusing a payroll on a technicality.
  const files: UploadedFile[] = [];
  for (const value of form.values()) {
    if (isUploadedFile(value)) {
      files.push(value);
    }
  }

  if (files.length === 0) {
    return refuseImport({ kind: 'no-file-part' });
  }
  if (files.length > 1) {
    return refuseImport({ kind: 'multiple-file-parts', count: files.length });
  }

  // Non-null by the two guards above.
  const file = files[0] as UploadedFile;

  // BEFORE `file.text()`, deliberately — see the contract above.
  if (file.size > MAX_UPLOAD_BYTES) {
    return refuseImport({ kind: 'too-large', limitMegabytes: MAX_UPLOAD_MEGABYTES });
  }
  if (hasWorkbookExtension(file.name)) {
    return refuseImport({ kind: 'not-csv' });
  }
  if (file.size === 0) {
    return refuseImport({ kind: 'empty-file' });
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    // The stream died mid-read: same refusal as a truncated body, because it is one.
    return refuseImport({ kind: 'unreadable-upload' });
  }

  try {
    return await deps.runImport(text);
  } catch {
    // The write funnel throws on invariant violations, and a transaction can fail for reasons
    // nobody's input caused — a deadlock, an FK race, a timeout. All of them are a refusal
    // carrying a statement, and none of them is a 500.
    return refuseImport({ kind: 'write-failed' });
  }
}
