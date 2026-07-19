import type { Clock } from '@/application/ports/clock';
import {
  recordSalaryChange,
  type RecordSalaryChangeDeps,
  type RecordSalaryChangeResult,
} from '@/application/use-cases/record-salary-change';
import {
  nonTextSalaryFieldRejection,
  salaryWriteFailureRejection,
  SALARY_CHANGE_FIELDS,
  type SalaryChangeInput,
  type SalaryFieldRejection,
} from '@/domain/salary-change';

/**
 * The body of the CAP-3 Server Action, separated from `actions.ts` so it is testable without Next,
 * without a database, and without a clock — exactly the split story 2-1 made between
 * `handle-import-request.ts` and `route.ts`, and story 3-1 between `handle-employee-write.ts` and
 * `actions.ts`.
 *
 * ## The boundary does not trust its own types
 *
 * A `'use server'` export is a LIVE RPC ENDPOINT. `SalaryChangeInput`'s `string` fields are erased
 * at runtime, so a hostile or buggy caller can send numbers, `null`, or nothing at all — and
 * `raw.amountMinor.trim()` on a number is a `TypeError` that the guard below would then report as a
 * generic write failure, telling the user their change could not be saved when the truth is that
 * their client sent nonsense. So every field is coerced defensively HERE, and a non-string becomes
 * an ordinary field rejection naming the field.
 *
 * The field TABLE comes from the domain (`SALARY_CHANGE_FIELDS`), so the key-to-field mapping cannot
 * drift from the validator's.
 *
 * ## Money crosses as a DECIMAL STRING (Law 4 / AD-4)
 *
 * `amountMinor` is a string here and nowhere else is it anything else at a boundary. A JS number
 * cannot hold ₹1,23,45,678.90 exactly and a raw `bigint` is something `JSON.stringify` refuses
 * outright, so either arriving means the caller bypassed the serialization contract — and both are
 * refused by the same coercion that refuses `null`. The `bigint` this eventually becomes is
 * produced by the domain, from the canonical decimal form, in the country's currency.
 *
 * ## The clock is read HERE, and only here (Law 6 / AD-11)
 *
 * `todayUtc()` is called once per invocation and the resulting `PlainDate` is passed inward as an
 * argument. No use-case, no domain function, and no repository method downstream of this line asks
 * what day it is; each is told. "Today" is UTC — one organisation, one calendar, so the same
 * submission does not mean two different days for two readers.
 *
 * ## No Route Handler
 *
 * Mutations are Server Actions (AD-21). This capability adds none: exactly two Route Handlers exist
 * in the whole system — the CAP-1 multipart upload and CSV export downloads — and neither is this.
 */

export type SalaryChangeWriteDeps = RecordSalaryChangeDeps & {
  /**
   * The ONE source of "now" (AD-11). Injected rather than imported so this module stays testable
   * without a clock, which is what lets every date assertion in its suite be exact.
   */
  readonly clock: Clock;

  /**
   * Invalidate the cached routes that showed this employee, after a successful write.
   *
   * INJECTED rather than imported so this module stays testable without Next, and so the
   * invalidation is an observable fact rather than a side effect nobody can see. Story 4-2 renders
   * the timeline from a read; without this its first recorded change would leave a stale page on
   * screen, and it would have to retrofit cache invalidation onto a contract this story calls
   * finalized — the "frontend adds nothing to the contract" Law 7 forbids.
   */
  readonly revalidate: (employeeId: string) => void;
};

type Rejected = { readonly kind: 'rejected'; readonly reasons: readonly SalaryFieldRejection[] };

function rejected(reasons: readonly SalaryFieldRejection[]): Rejected {
  return { kind: 'rejected', reasons };
}

/**
 * Read the three named keys off an untrusted payload, demanding a string for each.
 *
 * Returns EVERY offending field rather than the first, matching the validator it feeds: a form
 * reports every problem at once. A payload that is not an object at all fails every field, which is
 * the honest answer — none of them arrived. Keys that are not in the table are neither read nor
 * grounds for refusal; they simply are not fields of this form.
 */
function coerceSalaryFields(
  payload: unknown,
): { readonly ok: true; readonly value: SalaryChangeInput } | Rejected {
  // `typeof null === 'object'`, hence the explicit null check. An array is an object and would
  // simply have none of the named keys, so it fails the same way a `{}` does.
  const source: Record<string, unknown> =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};

  const reasons: SalaryFieldRejection[] = [];
  // Keyed by the INPUT's own keys rather than by `string`, so the assertion below is a narrowing of
  // a partial to a total — not the `as unknown as` laundering that would accept any object at all.
  const value: Partial<Record<keyof SalaryChangeInput, string>> = {};

  for (const [key, field] of SALARY_CHANGE_FIELDS) {
    const candidate = source[key];
    if (typeof candidate === 'string') {
      value[key] = candidate;
    } else {
      reasons.push(nonTextSalaryFieldRejection(field));
    }
  }

  if (reasons.length > 0) {
    return rejected(reasons);
  }
  // Every key is present: the table is EXHAUSTIVE over `keyof SalaryChangeInput` by construction
  // (`orderedSalaryChangeFields`), and any key the loop failed to fill pushed a reason and returned
  // above. The compiler cannot follow that, so the assertion states it — but a field added to the
  // input and forgotten in the table is now a compile error in the domain, not a silent `undefined`
  // arriving here typed as `string`.
  return { ok: true, value: value as SalaryChangeInput };
}

/**
 * Invalidate the caches for a write that has ALREADY COMMITTED — and never let that invalidation
 * change the answer.
 *
 * Called OUTSIDE the guard below, and swallowing its own failure, for one reason: by the time it
 * runs the row is in the database, and `salary_record` admits no DELETE, so it cannot be taken back.
 * `revalidatePath` throws when called outside a request scope, during static generation, or on a
 * malformed path — and inside the guard that throw would be reported as a write failure, telling
 * the user nothing was recorded when something was. They would resubmit, and the employee would
 * hold two records that can never be removed. A stale cache is a far smaller wrong.
 */
function revalidateCommitted(deps: SalaryChangeWriteDeps, employeeId: string): void {
  try {
    deps.revalidate(employeeId);
  } catch {
    // Deliberately swallowed: see above. There is nothing to report and nothing to undo.
  }
}

/** Record one salary change. Never throws — every input it can receive has a payload. */
export async function handleRecordSalaryChange(
  deps: SalaryChangeWriteDeps,
  employeeId: unknown,
  payload: unknown,
): Promise<RecordSalaryChangeResult> {
  if (typeof employeeId !== 'string') {
    // NOT-FOUND, the same answer `'not-a-uuid'` gets from the adapter — same wire, same cause, so
    // the same answer. A write failure would report something that never happened: nothing was
    // attempted, because nothing identified a row to attempt it against. There is no id to echo,
    // and inventing one (`String(payload)` -> `[object Object]`) would tell a reader less than the
    // empty string does.
    return { kind: 'not-found', employeeId: '' };
  }

  let result: RecordSalaryChangeResult;
  try {
    // Coercion is INSIDE the net. `payload` crossed `'use server'` from an untrusted caller, and
    // merely READING a property off it can throw — a getter, a Proxy with a hostile `get` trap.
    // Outside the net that throw would escape a function whose contract is that it never does.
    const coerced = coerceSalaryFields(payload);
    if (!('ok' in coerced)) {
      return coerced;
    }
    // The clock, read ONCE, at the boundary — and passed inward as a value (Law 6 / AD-11).
    result = await recordSalaryChange(deps, employeeId, coerced.value, deps.clock.todayUtc());
  } catch {
    // The use-case already guards itself; this is the SECOND net, and it is deliberate. A Server
    // Action is the outermost frame of a request: anything that escapes it becomes a framework
    // error page rather than a form the user can correct. Two inputs reach here that the use-case's
    // own guard cannot see: a throwing payload property, and a throwing clock.
    return rejected([salaryWriteFailureRejection()]);
  }

  if (result.kind === 'recorded') {
    // Only on a write that actually changed something. Revalidating after a rejection would
    // discard a warm cache to no purpose. OUTSIDE the guard above — see `revalidateCommitted`.
    revalidateCommitted(deps, employeeId);
  }
  return result;
}
