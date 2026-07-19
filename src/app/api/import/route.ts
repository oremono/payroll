import { parseImportCsv } from '@/adapters/csv/parse-import-csv';
import { systemClock } from '@/adapters/clock';
import { createEmployeeRepository } from '@/adapters/db/employee-repository';
import { uuidV7Generator } from '@/adapters/id';
import { importEmployees, type ImportResult } from '@/application/use-cases/import-employees';

import { handleImportRequest } from './handle-import-request';

/**
 * The CAP-1 multipart upload — one of exactly TWO Route Handlers this system will ever have
 * (AD-21; the other is CSV export downloads). Reads are Server Components calling use-cases
 * in-process and mutations are Server Actions; this file is the sanctioned exception, because a
 * multipart file upload is the one thing neither of those does well.
 *
 * This module is the COMPOSITION ROOT for import: the only place the adapters are constructed and
 * injected. `systemClock.todayUtc()` is called exactly ONCE per request and the resulting
 * `PlainDate` travels inward as an argument — nothing downstream ever asks what day it is
 * (Law 6 / AD-11).
 *
 * All the judgement lives in `handleImportRequest`, which is separated so it can be tested without
 * Next, without a database, and without a clock.
 */

/**
 * Always HTTP 200, deliberately — including for a refusal.
 *
 * The response body IS the answer: a report of what landed and what did not, or a refusal carrying
 * one statement of what could not be read. Neither is a transport-level failure, and encoding
 * "your file had bad rows" as a 4xx would make the report look like a malfunction to every client
 * that branches on status before reading the body. A genuine 500 is now unreachable for bad input
 * — see the handler error contract.
 */
export async function POST(request: Request): Promise<Response> {
  const today = systemClock.todayUtc();

  const result: ImportResult = await handleImportRequest(request, {
    runImport: (text) =>
      importEmployees(
        {
          repository: createEmployeeRepository(),
          idGenerator: uuidV7Generator,
          parseCsv: parseImportCsv,
        },
        text,
        today,
      ),
  });

  return Response.json(result);
}
