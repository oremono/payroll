import { describe, expect, it } from 'vitest';

import {
  MAX_UPLOAD_MEGABYTES,
  handleImportRequest,
  type ImportRequestDeps,
} from '@/app/api/import/handle-import-request';
import type { ImportResult } from '@/application/use-cases/import-employees';

// Test-first (Law 1 / AD-23): red before `handle-import-request.ts` exists.
//
// ## The handler error contract
//
// EVERY input this handler can receive yields an `ImportResult`. It never propagates an exception
// and never emits a 500 for bad data. That is not defensive padding — story 2-1's review found an
// unguarded call site here answering a 10,000-row upload with an HTTP 500 carrying no report at
// all, because one oversized amount aborted the transaction and the throw had nowhere to go. The
// write funnel is DOCUMENTED to throw on invariant violations, so an unguarded call site is a
// designed-in 500.
//
// Specifically: the size cap fires BEFORE the body is materialized with `file.text()`; several
// file parts is a refusal rather than a silent first-wins; a `formData()` that throws (truncated
// or aborted upload) is distinguished from a genuinely absent file part; and any repository throw
// becomes a whole-file refusal carrying a statement.

const OK_RESULT: ImportResult = {
  kind: 'imported',
  importedCount: 1,
  rejectedCount: 0,
  rejections: [],
};

/** A request whose `formData()` resolves to the given form. */
function requestWith(form: FormData): { formData: () => Promise<FormData> } {
  return { formData: () => Promise.resolve(form) };
}

function csvFile(contents: string, name = 'payroll.csv'): File {
  return new File([contents], name, { type: 'text/csv' });
}

/**
 * A File whose `size` and/or `text()` are overridden — for the cases a real File cannot produce
 * (a 16 MB body without allocating one, a stream that dies mid-read).
 *
 * It must be a REAL `File`, not a plain object cast to one: `FormData.set` coerces any non-Blob
 * value to a STRING, so a `{ name, size, text }` literal would arrive at the handler as
 * `"[object Object]"` and be correctly reported as "no file part".
 */
function fileWith(overrides: {
  readonly name?: string;
  readonly size?: number;
  readonly text?: () => Promise<string>;
}): File {
  const file = csvFile('name\nAda', overrides.name ?? 'payroll.csv');
  if (overrides.size !== undefined) {
    Object.defineProperty(file, 'size', { value: overrides.size });
  }
  if (overrides.text !== undefined) {
    Object.defineProperty(file, 'text', { value: overrides.text });
  }
  return file;
}

function depsThat(runImport: ImportRequestDeps['runImport']): ImportRequestDeps {
  return { runImport };
}

const PASSTHROUGH = depsThat(() => Promise.resolve(OK_RESULT));

describe('handleImportRequest — the happy path', () => {
  it('reads the single file part and returns the use-case result unchanged', async () => {
    const form = new FormData();
    form.set('file', csvFile('name,role_code\nAda,software_engineer'));

    let seen: string | undefined;
    const result = await handleImportRequest(
      requestWith(form),
      depsThat((text) => {
        seen = text;
        return Promise.resolve(OK_RESULT);
      }),
    );

    expect(seen).toBe('name,role_code\nAda,software_engineer');
    expect(result).toBe(OK_RESULT);
  });

  it('accepts the file part under any of the field names a client might use', async () => {
    const form = new FormData();
    form.set('csv', csvFile('anything'));

    expect(await handleImportRequest(requestWith(form), PASSTHROUGH)).toBe(OK_RESULT);
  });
});

describe('handleImportRequest — nothing usable arrived', () => {
  it('refuses an upload with no file part', async () => {
    expect(await handleImportRequest(requestWith(new FormData()), PASSTHROUGH)).toEqual({
      kind: 'refusal',
      reason: { kind: 'no-file-part' },
      statement: 'The upload carried no file.',
    });
  });

  it('refuses an upload whose only part is a plain text field, not a file', async () => {
    const form = new FormData();
    form.set('file', 'not-a-file');

    expect(await handleImportRequest(requestWith(form), PASSTHROUGH)).toEqual(
      expect.objectContaining({ kind: 'refusal', reason: { kind: 'no-file-part' } }),
    );
  });

  it('refuses several file parts rather than silently importing the first', async () => {
    // Silently taking the first would mean the reader believes a file was imported that was not.
    const form = new FormData();
    form.append('file', csvFile('one'));
    form.append('file', csvFile('two'));
    form.append('other', csvFile('three'));

    expect(await handleImportRequest(requestWith(form), PASSTHROUGH)).toEqual({
      kind: 'refusal',
      reason: { kind: 'multiple-file-parts', count: 3 },
      statement: 'The upload carried 3 files. Import reads one file at a time.',
    });
  });

  it('refuses an empty file without asking the use-case', async () => {
    const form = new FormData();
    form.set('file', csvFile(''));

    let called = false;
    const result = await handleImportRequest(
      requestWith(form),
      depsThat(() => {
        called = true;
        return Promise.resolve(OK_RESULT);
      }),
    );

    expect(result).toEqual(expect.objectContaining({ reason: { kind: 'empty-file' } }));
    expect(called).toBe(false);
  });

  it('refuses a workbook by its filename, before reading a byte of it', async () => {
    const form = new FormData();
    form.set('file', csvFile('anything at all', 'payroll.xlsx'));

    expect(await handleImportRequest(requestWith(form), PASSTHROUGH)).toEqual(
      expect.objectContaining({ kind: 'refusal', reason: { kind: 'not-csv' } }),
    );
  });

  it('refuses a workbook whose extension is upper-case', async () => {
    const form = new FormData();
    form.set('file', csvFile('anything', 'PAYROLL.XLSX'));

    expect(await handleImportRequest(requestWith(form), PASSTHROUGH)).toEqual(
      expect.objectContaining({ reason: { kind: 'not-csv' } }),
    );
  });

  it('does not refuse a CSV whose name merely contains the word xlsx', async () => {
    const form = new FormData();
    form.set('file', csvFile('anything', 'exported-from-xlsx.csv'));

    expect(await handleImportRequest(requestWith(form), PASSTHROUGH)).toBe(OK_RESULT);
  });
});

describe('handleImportRequest — the size cap', () => {
  it('refuses an oversized upload BEFORE materializing its body', async () => {
    // The cap has to fire on `size`, not after `text()`: materializing a gigabyte to discover it
    // is a gigabyte is the denial-of-service the cap exists to prevent.
    let materialized = false;
    const form = new FormData();
    form.set(
      'file',
      fileWith({
        name: 'huge.csv',
        size: MAX_UPLOAD_MEGABYTES * 1024 * 1024 + 1,
        text: () => {
          materialized = true;
          return Promise.resolve('');
        },
      }),
    );

    const result = await handleImportRequest(requestWith(form), PASSTHROUGH);

    expect(result).toEqual({
      kind: 'refusal',
      reason: { kind: 'too-large', limitMegabytes: MAX_UPLOAD_MEGABYTES },
      statement: `The upload is larger than the ${String(MAX_UPLOAD_MEGABYTES)} MB this import reads.`,
    });
    expect(materialized).toBe(false);
  });

  it('accepts an upload of exactly the limit — the cap is a boundary, not a narrowing', async () => {
    const form = new FormData();
    form.set(
      'file',
      fileWith({ name: 'big.csv', size: MAX_UPLOAD_MEGABYTES * 1024 * 1024 }),
    );

    expect(await handleImportRequest(requestWith(form), PASSTHROUGH)).toBe(OK_RESULT);
  });

  it('leaves room for a ten-thousand-row payroll', async () => {
    // ~80 bytes a row puts a 10,000-row file near 800 KB. A cap that refused the epic's own
    // headline case would be a bug in the cap.
    expect(MAX_UPLOAD_MEGABYTES * 1024 * 1024).toBeGreaterThan(10_000 * 80);
  });
});

describe('handleImportRequest — nothing throws, ever', () => {
  it('refuses a truncated upload whose formData() throws, distinctly from an absent file', async () => {
    const request = {
      formData: () => Promise.reject(new Error('Unexpected end of multipart body')),
    };

    expect(await handleImportRequest(request, PASSTHROUGH)).toEqual({
      kind: 'refusal',
      reason: { kind: 'unreadable-upload' },
      statement: 'The upload did not arrive complete, so it could not be read.',
    });
  });

  it('refuses when formData() throws synchronously', async () => {
    const request = {
      formData: () => {
        throw new Error('boom');
      },
    };

    expect(await handleImportRequest(request, PASSTHROUGH)).toEqual(
      expect.objectContaining({ reason: { kind: 'unreadable-upload' } }),
    );
  });

  it('refuses when reading the file body throws', async () => {
    const form = new FormData();
    form.set('file', fileWith({ text: () => Promise.reject(new Error('stream aborted')) }));

    expect(await handleImportRequest(requestWith(form), PASSTHROUGH)).toEqual(
      expect.objectContaining({ reason: { kind: 'unreadable-upload' } }),
    );
  });

  it('refuses when the use-case throws — a repository failure is never a 500', async () => {
    // The write funnel is DOCUMENTED to throw on an invariant violation. An FK race, a transaction
    // timeout, or an overflow that slipped past the domain must become a report, not a 500.
    const form = new FormData();
    form.set('file', csvFile('name\nAda'));

    expect(
      await handleImportRequest(
        requestWith(form),
        depsThat(() => Promise.reject(new Error('deadlock detected'))),
      ),
    ).toEqual({
      kind: 'refusal',
      reason: { kind: 'write-failed' },
      statement: 'The rows could not be written, so nothing was imported.',
    });
  });

  it('refuses when the use-case throws something that is not an Error', async () => {
    const form = new FormData();
    form.set('file', csvFile('name\nAda'));

    expect(
      await handleImportRequest(
        requestWith(form),
        // A non-Error rejection, deliberately: `catch {}` must not depend on what was thrown.
        depsThat(() => Promise.reject('a string, not an Error')),
      ),
    ).toEqual(expect.objectContaining({ reason: { kind: 'write-failed' } }));
  });

  it('answers every reachable input with a well-formed ImportResult', async () => {
    // The contract, asserted as a whole rather than only case by case.
    const emptyForm = new FormData();
    const twoFiles = new FormData();
    twoFiles.append('file', csvFile('a'));
    twoFiles.append('file', csvFile('b'));
    const oneFile = new FormData();
    oneFile.set('file', csvFile('name\nAda'));

    const requests = [
      requestWith(emptyForm),
      requestWith(twoFiles),
      requestWith(oneFile),
      { formData: () => Promise.reject(new Error('truncated')) },
    ];
    const dependencies = [
      PASSTHROUGH,
      depsThat(() => Promise.reject(new Error('repository exploded'))),
    ];

    for (const request of requests) {
      for (const deps of dependencies) {
        const result = await handleImportRequest(request, deps);
        expect(result.kind === 'imported' || result.kind === 'refusal').toBe(true);
        if (result.kind === 'refusal') {
          expect(result.statement.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
