import {
  createEmployee,
  updateEmployee,
  type CreateEmployeeResult,
  type EmployeeUseCaseDeps,
  type UpdateEmployeeResult,
} from '@/application/use-cases/employees';
import {
  employeeWriteFailureRejection,
  nonTextFieldRejection,
  EMPLOYEE_CREATE_FIELDS,
  EMPLOYEE_UPDATE_FIELDS,
  type EmployeeField,
  type EmployeeInput,
  type EmployeeUpdateInput,
  type FieldRejection,
} from '@/domain/employee';

/**
 * The bodies of the CAP-2 Server Actions, separated from `actions.ts` so they are testable without
 * Next, without a database, and without a clock — exactly the split story 2-1 made between
 * `handle-import-request.ts` and `route.ts`.
 *
 * ## The boundary does not trust its own types
 *
 * A `'use server'` export is a LIVE RPC ENDPOINT. `EmployeeInput`'s `string` fields are erased at
 * runtime, so a hostile or buggy caller can send numbers, `null`, or nothing at all — and
 * `raw.name.trim()` on a number is a `TypeError` that the guard below would then report as a
 * generic write failure, telling the user their employee could not be saved when the truth is that
 * their client sent nonsense. So every field is coerced defensively HERE, and a non-string becomes
 * an ordinary field rejection naming the field.
 *
 * No schema library for this: hand-rolled shape checking at the one boundary is smaller than the
 * dependency and keeps the domain free of it. The field TABLES come from the domain
 * (`EMPLOYEE_CREATE_FIELDS` / `EMPLOYEE_UPDATE_FIELDS`), so the key-to-field mapping cannot drift
 * from the validator's.
 *
 * ## The boundary contract
 *
 * These functions return a PAYLOAD for every input they can receive. They never propagate an
 * exception and never turn bad data into a 500. The write funnel is DOCUMENTED to throw on an
 * invariant violation, so an unguarded call site here is a designed-in 500 rather than an oversight
 * — that is precisely how story 2-1's oversized-amount defect reached the client as an HTTP 500
 * carrying no report at all.
 *
 * The use-cases already guard themselves; this is the SECOND net, and it is deliberate. A Server
 * Action is the outermost frame of a request: anything that escapes it becomes a framework error
 * page rather than a form the user can correct.
 *
 * ## No clock, no Route Handler
 *
 * Mutations are Server Actions (AD-21); this capability adds no Route Handler, because exactly two
 * exist in the whole system and neither is this. And no CAP-2 rule is date-relative once a future
 * hire date is accepted, so nothing here reads a clock.
 */

export type EmployeeWriteDeps = EmployeeUseCaseDeps & {
  /**
   * Invalidate the cached routes that showed this employee, after a successful write.
   *
   * INJECTED rather than imported so this module stays testable without Next, and so the
   * invalidation is an observable fact rather than a side effect nobody can see. Story 3-2 renders
   * the directory from these reads; without this it would have to retrofit cache invalidation onto
   * a contract this story calls finalized, which is the "frontend adds nothing to the contract"
   * that Law 7 forbids.
   *
   * The employee ID travels with it because the DIRECTORY is not the only cached route that just
   * went stale: after an edit, `/employees/{id}` serves the pre-edit name until it too is
   * invalidated, and a detail page contradicting the list it was reached from is the same defect
   * this dependency exists to prevent.
   */
  readonly revalidate: (employeeId: string) => void;
};

/** The rejection payload shape both write results share. */
type Rejected = { readonly kind: 'rejected'; readonly reasons: readonly FieldRejection[] };

function rejected(reasons: readonly FieldRejection[]): Rejected {
  return { kind: 'rejected', reasons };
}

/**
 * Read the named keys off an untrusted payload, demanding a string for each.
 *
 * Returns EVERY offending field rather than the first, matching the validator it feeds: a form
 * reports every problem at once. A payload that is not an object at all fails every field, which is
 * the honest answer — none of them arrived.
 */
function coerceFields<K extends string>(
  payload: unknown,
  fields: readonly (readonly [K, EmployeeField])[],
): { readonly ok: true; readonly value: Record<K, string> } | Rejected {
  // `typeof null === 'object'`, hence the explicit null check. An array is an object and would
  // simply have none of the named keys, so it fails the same way a `{}` does.
  const source: Record<string, unknown> =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};

  const reasons: FieldRejection[] = [];
  const value = {} as Record<K, string>;

  for (const [key, field] of fields) {
    const candidate = source[key];
    if (typeof candidate === 'string') {
      value[key] = candidate;
    } else {
      reasons.push(nonTextFieldRejection(field));
    }
  }

  if (reasons.length > 0) {
    return rejected(reasons);
  }
  return { ok: true, value };
}

/**
 * Invalidate the caches for a write that has ALREADY COMMITTED — and never let that invalidation
 * change the answer.
 *
 * Called OUTSIDE the guard below, and swallowing its own failure, for one reason: by the time it
 * runs the row is in the database. `revalidatePath` throws when called outside a request scope,
 * during static generation, or on a malformed path — and inside the guard that throw would be
 * reported as `employeeWriteFailureRejection()`, telling the user "The employee could not be saved,
 * so nothing was changed" when the employee WAS saved. They would then resubmit, and the system
 * would hold two of them. A stale cache is a smaller wrong than a duplicate person, and it is the
 * only wrong left once this is separated.
 */
function revalidateCommitted(deps: EmployeeWriteDeps, employeeId: string): void {
  try {
    deps.revalidate(employeeId);
  } catch (cause) {
    // Swallowed for the CALLER — see above: the write is committed, and the answer must describe
    // the write, not the cache. But not swallowed SILENTLY.
    //
    // Silence here is how a stale directory becomes undiagnosable. If `revalidatePath` throws, the
    // row is saved, the live region says "Employee created.", the list still shows the pre-create
    // count, and nothing anywhere records why — which is exactly the shape of the CI-only failure
    // in `e2e/employees.spec.ts` that this comment was written during. A cache failure is still a
    // failure; it just is not the user's problem to hear about.
    console.error('[employee-write] revalidatePath failed after a committed write', {
      employeeId,
      cause,
    });
  }
}

/** Create one employee — and no salary record (UX-DR13 / AD-16). Never throws. */
export async function handleCreateEmployee(
  deps: EmployeeWriteDeps,
  payload: unknown,
): Promise<CreateEmployeeResult> {
  const coerced = coerceFields(payload, EMPLOYEE_CREATE_FIELDS);
  if (!('ok' in coerced)) {
    return coerced;
  }

  let result: CreateEmployeeResult;
  try {
    result = await createEmployee(deps, coerced.value as EmployeeInput);
  } catch {
    return rejected([employeeWriteFailureRejection()]);
  }

  if (result.kind === 'created') {
    // Only on a write that actually changed something. Revalidating after a rejection would
    // discard a warm cache to no purpose. OUTSIDE the guard above — see `revalidateCommitted`.
    revalidateCommitted(deps, result.employeeId);
  }
  return result;
}

/** Edit one employee's granted columns. There is no country here at all (AD-6). Never throws. */
export async function handleUpdateEmployee(
  deps: EmployeeWriteDeps,
  employeeId: unknown,
  payload: unknown,
): Promise<UpdateEmployeeResult> {
  if (typeof employeeId !== 'string') {
    // NOT-FOUND, the same answer `'not-a-uuid'` gets from the adapter — same wire, same cause, so
    // the same answer. A write failure would be a report of something that never happened: nothing
    // was attempted, because nothing identified a row to attempt it against. There is no id to
    // echo, and inventing one (`String(payload)` -> `[object Object]`) would tell a reader less
    // than the empty string does.
    return { kind: 'not-found', employeeId: '' };
  }

  // Reads only the five UPDATE keys, so a `countryCode` a hostile caller smuggles in is neither
  // written nor grounds for refusal — it simply is not an update field (AD-6).
  const coerced = coerceFields(payload, EMPLOYEE_UPDATE_FIELDS);
  if (!('ok' in coerced)) {
    return coerced;
  }

  let result: UpdateEmployeeResult;
  try {
    result = await updateEmployee(deps, employeeId, coerced.value as EmployeeUpdateInput);
  } catch {
    return rejected([employeeWriteFailureRejection()]);
  }

  if (result.kind === 'updated') {
    // OUTSIDE the guard: the UPDATE has committed, so a cache failure may not be reported as a
    // write failure. See `revalidateCommitted`.
    revalidateCommitted(deps, result.employeeId);
  }
  return result;
}
