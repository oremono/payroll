/**
 * The CAP-3 use-case, and the FINALIZED boundary payload story 4-2 consumes unmodified.
 *
 * Orchestration only: find the employee, resolve their country's currency, judge the input with the
 * pure validator, append. Every judgement is borrowed from `src/domain/**` and every effect goes
 * through a port, so this file is testable against fakes and the fast suite that covers it touches
 * no database and no clock.
 *
 * ## `today` is a parameter, and that is the whole of Law 6 here
 *
 * The clock port is read ONCE, at the delivery boundary, and the date is passed inward. Nothing in
 * this file asks what day it is, and nothing downstream of it does either — the funnel is told.
 * Same input + same `today` ⇒ identical answer, which is what makes the future-date rule testable
 * at all.
 *
 * ## Every function here is TOTAL
 *
 * A validation failure is a payload. A missing employee is a payload. The database's `AP004` verdict
 * on the hire date is a payload. An adapter that THROWS — which the write funnel is documented to do
 * on an invariant violation — is caught here and answered with a payload too, mirroring
 * `use-cases/employees.ts` and `handleImportRequest` before it.
 *
 * ## Append, and only append (Law 5 / AD-18)
 *
 * There is no update path and no delete path, here or on the port. A correction is a new record
 * dated today, which the validator accepts and the resolver's `seq` tie-break then honours (AD-8).
 */

import type {
  AppendSalaryRecordOutcome,
  EmployeeRepository,
} from '@/application/ports/employee-repository';
import type { IdGenerator } from '@/application/ports/id';
import type { PlainDate } from '@/domain/plain-date';
import {
  effectiveBeforeHireRejection,
  salaryWriteFailureRejection,
  unknownSalaryCountryRejection,
  validateSalaryChange,
  type SalaryChangeInput,
  type SalaryFieldRejection,
} from '@/domain/salary-change';

export type { SalaryChangeInput, SalaryFieldRejection };

/**
 * The record payload (Law 8 / AD-20), shaped like `CreateEmployeeResult` before it: a discriminated
 * union carrying either the answer or every reason it was refused. Story 4-2 renders this and adds
 * nothing to the contract.
 *
 * `not-found` is a third outcome rather than a rejection because it is not a problem with any field
 * the user typed — the person they were recording a change for is gone.
 */
export type RecordSalaryChangeResult =
  | { readonly kind: 'recorded'; readonly salaryRecordId: string }
  | { readonly kind: 'rejected'; readonly reasons: readonly SalaryFieldRejection[] }
  | { readonly kind: 'not-found'; readonly employeeId: string };

/** Injected, never imported: no clock, no Prisma. `today` arrives per call, as an argument. */
export type RecordSalaryChangeDeps = {
  readonly repository: EmployeeRepository;
  readonly idGenerator: IdGenerator;
};

/** The one place an adapter throw becomes a payload. */
function writeFailure(): RecordSalaryChangeResult {
  return { kind: 'rejected', reasons: [salaryWriteFailureRejection()] };
}

function rejected(reason: SalaryFieldRejection): RecordSalaryChangeResult {
  return { kind: 'rejected', reasons: [reason] };
}

/**
 * Record one salary change against an existing employee.
 *
 * The order is load-bearing. The employee is read FIRST, because their country and hire date are
 * what the input is judged against — there is no way to judge a currency or an effective date
 * without them. The id is generated only AFTER the input is judged, so a rejected form burns none.
 *
 * `asOf` does not appear: this is a WRITE, and the only date it needs is `today`. Reading the
 * timeline back at an as-of date is story 4-2's, through the one resolver in `salary-timeline.ts`.
 */
export async function recordSalaryChange(
  deps: RecordSalaryChangeDeps,
  employeeId: string,
  input: SalaryChangeInput,
  today: PlainDate,
): Promise<RecordSalaryChangeResult> {
  try {
    const employee = await deps.repository.findEmployeeById(employeeId);
    if (employee === null) {
      return { kind: 'not-found', employeeId };
    }

    // AD-6: the currency FOLLOWS from the employee's country, and is never chosen. The submitted
    // one is only ever validated to equal it. The adapter re-resolves it again inside its own
    // transaction, because this read happens outside one.
    const references = await deps.repository.loadReferenceData();
    const expectedCurrency = references.countryCurrencies.get(employee.countryCode);
    if (expectedCurrency === undefined) {
      // The country was deactivated after this employee was created. Nobody's input caused it, so
      // the rejection blames no field.
      return rejected(unknownSalaryCountryRejection(employee.countryCode));
    }

    const validation = validateSalaryChange(input, {
      countryCode: employee.countryCode,
      expectedCurrency,
      hireDate: employee.hireDate,
      today,
    });
    if (!validation.ok) {
      return { kind: 'rejected', reasons: validation.reasons };
    }

    const salaryRecordId = deps.idGenerator.next();
    const outcome = await deps.repository.appendSalaryRecord(
      {
        salaryRecordId,
        employeeId,
        salary: validation.value.salary,
        effectiveFrom: validation.value.effectiveFrom,
      },
      today,
    );

    return resolveOutcome(outcome, {
      salaryRecordId,
      employeeId,
      effectiveFrom: validation.value.effectiveFrom,
    });
  } catch {
    return writeFailure();
  }
}

/** What the funnel's outcome means to a caller. Exhaustive, with the widened-union guard. */
function resolveOutcome(
  outcome: AppendSalaryRecordOutcome,
  context: {
    readonly salaryRecordId: string;
    readonly employeeId: string;
    readonly effectiveFrom: PlainDate;
  },
): RecordSalaryChangeResult {
  switch (outcome.kind) {
    case 'appended':
      return { kind: 'recorded', salaryRecordId: context.salaryRecordId };
    case 'not-found':
      // The row was deleted between the read above and the write.
      return { kind: 'not-found', employeeId: context.employeeId };
    case 'effective-before-hire':
      // The database was the judge (SQLSTATE AP004), and the hire date it judged against comes back
      // ON THE OUTCOME rather than out of `context`. The one this layer read is known to be WRONG
      // here: the validator already cleared this input against it, so the trigger firing at all
      // means the stored date is a different one. Quoting the read date would name a hire date the
      // effective date is not earlier than, in every case this arm is reached.
      return rejected(effectiveBeforeHireRejection(context.effectiveFrom, outcome.hireDate));
    default: {
      // Unreachable while the union and this switch agree — and that agreement is a COMPILE-time
      // fact about one build, not a runtime guarantee about the object a port implementation
      // actually hands back. The `never` annotation makes a new variant a type error here rather
      // than a blank screen in story 4-2. Same arm, same reasoning, as `updateEmployee`.
      const unhandled: never = outcome;
      void unhandled;
      return writeFailure();
    }
  }
}
