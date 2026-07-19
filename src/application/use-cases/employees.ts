/**
 * The CAP-2 employee use-cases, and the FINALIZED boundary payloads story 3-2 consumes unmodified.
 *
 * Orchestration only: judge the input with the pure validator, then reach the database through the
 * one port. Every judgement is borrowed from `src/domain/**` and every effect goes through a port,
 * so this file is testable against fakes and the fast suite that covers it touches no database and
 * no clock.
 *
 * ## No clock, anywhere
 *
 * There is no `today` parameter in this file and no call site that needs one. A FUTURE hire date is
 * accepted (such an employee is simply outside the as-of population until their date arrives), and
 * once that is settled no CAP-2 rule is date-relative. Threading a clock through for symmetry with
 * import would be an unused dependency — a Law 6 hazard rather than compliance.
 *
 * ## Every function here is TOTAL — the reads included
 *
 * A validation failure is a payload. The database's `AP004` verdict on a hire date is a payload.
 * An adapter that THROWS — which the write funnel is documented to do on an invariant violation —
 * is caught here and answered with a payload too, mirroring `handleImportRequest`.
 *
 * The READS are total for a reason worth stating plainly, because getting it wrong is what reverted
 * the first attempt at this story: writes-are-total-and-reads-are-not is an incoherent boundary.
 * Story 3-2 renders the directory from `listEmployees`, `getEmployee`, and `loadEmployeeFormOptions`
 * — so a read that throws forces 3-2 to invent error handling the contract never defined, which is
 * precisely the "frontend adds nothing to the contract" that Law 7 forbids. Each read answers a
 * union with an `unavailable` arm, so a database outage is an ANSWER rather than an exception.
 */

import type {
  EmployeeDetail,
  EmployeeFormOptions,
  EmployeeListQuery,
  EmployeeRepository,
  EmployeeSummary,
} from '@/application/ports/employee-repository';
import type { IdGenerator } from '@/application/ports/id';
import {
  employeeWriteFailureRejection,
  hireDateAfterSalaryRejection,
  validateEmployeeInput,
  validateEmployeeUpdate,
  type EmployeeInput,
  type EmployeeUpdateInput,
  type FieldRejection,
} from '@/domain/employee';

export type { EmployeeInput, EmployeeUpdateInput, FieldRejection };

/**
 * The create payload (Law 8 / AD-20), shaped like `ImportResult` before it: a discriminated union
 * carrying either the answer or every reason it was refused. Story 3-2 renders this and adds
 * nothing to the contract.
 */
export type CreateEmployeeResult =
  | { readonly kind: 'created'; readonly employeeId: string }
  | { readonly kind: 'rejected'; readonly reasons: readonly FieldRejection[] };

/**
 * The edit payload. `not-found` is a third outcome rather than a rejection because it is not a
 * problem with any field the user typed — the row they were editing is gone.
 */
export type UpdateEmployeeResult =
  | { readonly kind: 'updated'; readonly employeeId: string }
  | { readonly kind: 'rejected'; readonly reasons: readonly FieldRejection[] }
  | { readonly kind: 'not-found'; readonly employeeId: string };

/**
 * The list payload. `limit` and `offset` are the EFFECTIVE values the adapter used after clamping,
 * never what was asked for — a pager that renders the requested value after a clamp lies.
 */
export type ListEmployeesResult =
  | {
      readonly kind: 'page';
      readonly employees: readonly EmployeeSummary[];
      readonly totalCount: number;
      readonly limit: number;
      readonly offset: number;
    }
  | { readonly kind: 'unavailable' };

/**
 * The detail payload. `not-found` and `unavailable` are deliberately different answers: one means
 * "there is no such person", the other means "we could not find out". A surface that conflated them
 * would tell a reader an employee had been deleted during a database outage.
 */
export type GetEmployeeResult =
  | { readonly kind: 'employee'; readonly employee: EmployeeDetail }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable' };

/** The form-options payload. */
export type FormOptionsResult =
  | { readonly kind: 'options'; readonly options: EmployeeFormOptions }
  | { readonly kind: 'unavailable' };

/** Injected, never imported: no `today`, no clock, no Prisma. */
export type EmployeeUseCaseDeps = {
  readonly repository: EmployeeRepository;
  readonly idGenerator: IdGenerator;
};

/** The one place an adapter throw becomes a WRITE payload. */
function writeFailure(): { readonly kind: 'rejected'; readonly reasons: readonly FieldRejection[] } {
  return { kind: 'rejected', reasons: [employeeWriteFailureRejection()] };
}

/**
 * Create one employee — and NO salary record (UX-DR13 / AD-16). CAP-3 owns the first salary; an
 * employee without one is legitimately outside every as-of population until then.
 *
 * The id comes from the port (AD-10) and is generated only AFTER the input is judged, so a rejected
 * form burns nothing.
 */
export async function createEmployee(
  deps: EmployeeUseCaseDeps,
  input: EmployeeInput,
): Promise<CreateEmployeeResult> {
  try {
    const references = await deps.repository.loadReferenceData();

    const validation = validateEmployeeInput(input, references);
    if (!validation.ok) {
      return { kind: 'rejected', reasons: validation.reasons };
    }

    const employeeId = deps.idGenerator.next();
    await deps.repository.createEmployee({
      employeeId,
      name: validation.value.name,
      roleCode: validation.value.roleCode,
      levelCode: validation.value.levelCode,
      countryCode: validation.value.countryCode,
      gender: validation.value.gender,
      hireDate: validation.value.hireDate,
    });

    return { kind: 'created', employeeId };
  } catch {
    return writeFailure();
  }
}

/**
 * Edit one employee's granted columns. There is no country here at all (AD-6) — the input type
 * omits it, so an attempt to change it does not typecheck, and the database refuses it besides.
 */
export async function updateEmployee(
  deps: EmployeeUseCaseDeps,
  employeeId: string,
  input: EmployeeUpdateInput,
): Promise<UpdateEmployeeResult> {
  try {
    const references = await deps.repository.loadReferenceData();

    const validation = validateEmployeeUpdate(input, references);
    if (!validation.ok) {
      return { kind: 'rejected', reasons: validation.reasons };
    }

    const outcome = await deps.repository.updateEmployee(employeeId, {
      name: validation.value.name,
      roleCode: validation.value.roleCode,
      levelCode: validation.value.levelCode,
      gender: validation.value.gender,
      hireDate: validation.value.hireDate,
    });

    switch (outcome.kind) {
      case 'updated':
        return { kind: 'updated', employeeId };
      case 'not-found':
        return { kind: 'not-found', employeeId };
      case 'hire-date-after-salary':
        // The database was the judge (SQLSTATE AP004) because this layer cannot be one without
        // reading the salary history. Its verdict reaches the user as a field rejection.
        return {
          kind: 'rejected',
          reasons: [hireDateAfterSalaryRejection(validation.value.hireDate)],
        };
      default: {
        // Unreachable while the union and this switch agree — and that agreement is a COMPILE-time
        // fact about one build, not a runtime guarantee about the object a port implementation
        // actually hands back. Without this arm a widened union falls off the switch and the
        // function resolves to `undefined`, in a module whose header promises every function is
        // total. The `never` annotation is what makes a new variant a type error here rather than a
        // blank screen in story 3-2.
        const unhandled: never = outcome;
        void unhandled;
        return writeFailure();
      }
    }
  } catch {
    return writeFailure();
  }
}

/**
 * One employee by opaque id. Identity fields only — no current salary (AD-8 belongs to CAP-3/CAP-4).
 *
 * TOTAL: a repository throw is `unavailable`, not an exception. See the module header.
 */
export async function getEmployee(
  deps: EmployeeUseCaseDeps,
  employeeId: string,
): Promise<GetEmployeeResult> {
  try {
    const employee = await deps.repository.findEmployeeById(employeeId);
    if (employee === null) {
      return { kind: 'not-found' };
    }
    return { kind: 'employee', employee };
  } catch {
    return { kind: 'unavailable' };
  }
}

/**
 * One offset page of the directory. Ordering, clamping, and LIKE escaping live in the adapter,
 * behind the port — they are properties of the query, not of the orchestration.
 *
 * TOTAL: a repository throw is `unavailable`, not an exception.
 */
export async function listEmployees(
  deps: EmployeeUseCaseDeps,
  query: EmployeeListQuery,
): Promise<ListEmployeesResult> {
  try {
    const page = await deps.repository.listEmployees(query);
    return {
      kind: 'page',
      employees: page.employees,
      totalCount: page.totalCount,
      // The adapter's EFFECTIVE values, echoed. Not `query.limit` / `query.offset`, deliberately:
      // those are what was asked for, and the adapter may have clamped them.
      limit: page.limit,
      offset: page.offset,
    };
  } catch {
    return { kind: 'unavailable' };
  }
}

/**
 * The pickable reference values a create/edit form may offer. Active rows only.
 *
 * TOTAL: a repository throw is `unavailable`, not an exception.
 */
export async function loadEmployeeFormOptions(
  deps: EmployeeUseCaseDeps,
): Promise<FormOptionsResult> {
  try {
    return { kind: 'options', options: await deps.repository.loadFormOptions() };
  } catch {
    return { kind: 'unavailable' };
  }
}
