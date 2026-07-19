'use server';

import { revalidatePath } from 'next/cache';

import { createEmployeeRepository } from '@/adapters/db/employee-repository';
import { createUuidV7Generator } from '@/adapters/id';
import type {
  CreateEmployeeResult,
  UpdateEmployeeResult,
} from '@/application/use-cases/employees';

import {
  handleCreateEmployee,
  handleUpdateEmployee,
  type EmployeeWriteDeps,
} from './handle-employee-write';

/**
 * The CAP-2 Server Actions — the AD-20 boundary this story finalizes for story 3-2.
 *
 * Mutations are Server Actions (AD-21). This capability adds NO Route Handler: exactly two exist in
 * the whole system — the CAP-1 multipart upload and CSV export downloads — and neither is this.
 *
 * This file is the COMPOSITION ROOT and nothing else: it constructs the adapters and hands them to
 * `handle-employee-write.ts`, which holds the logic and is testable without Next, without a
 * database, and without a clock. Both actions answer with a payload for every input they can
 * receive and never propagate an exception — a rejection is data, all the way out.
 *
 * The parameters are typed `unknown` deliberately, and that is not a lapse of typing discipline: a
 * `'use server'` export is a live RPC endpoint whose argument types are erased at runtime, so
 * declaring them `EmployeeInput` would be a claim this layer cannot enforce. The handler coerces
 * every field and answers a hostile payload with a rejection naming the offending fields. Story
 * 3-2's call sites get their compile-time types from `EmployeeInput` / `EmployeeUpdateInput`, which
 * are exported from the use-case module.
 *
 * No clock is wired in, deliberately. A future hire date is accepted, so no CAP-2 rule is
 * date-relative; an unused clock dependency would be a Law 6 hazard rather than compliance.
 *
 * Note the `'use server'` constraint: every export in this file must be an async function, which is
 * why the payload TYPES live in the use-case module and are not re-exported here.
 */

/** Build the adapters fresh per invocation; the Prisma client itself is process-wide and cached. */
function deps(): EmployeeWriteDeps {
  return {
    repository: createEmployeeRepository(),
    idGenerator: createUuidV7Generator(),
    // The one Next-specific effect in the capability, injected here so the handler stays testable.
    // Story 3-2 renders the directory from the read use-cases; without this its first successful
    // create would leave a stale list on screen, and it would have to add cache invalidation the
    // "finalized" contract never mentioned.
    //
    // BOTH routes, not just the directory: `/employees/{id}` is rendered from `getEmployee`, so an
    // edit that invalidated only the list would leave the detail page serving the pre-edit name —
    // a page contradicting the list it was reached from. The handler calls this only after a write
    // that COMMITTED, and only with an id the repository matched to a row, so the interpolated
    // segment is a UUID by then.
    revalidate: (employeeId: string) => {
      revalidatePath('/employees');
      revalidatePath(`/employees/${employeeId}`);
    },
  };
}

/** Create one employee, with no salary record (UX-DR13 / AD-16). CAP-3 owns the first salary. */
export async function createEmployeeAction(input: unknown): Promise<CreateEmployeeResult> {
  return handleCreateEmployee(deps(), input);
}

/**
 * Edit one employee. The update carries no `countryCode` (AD-6) — the type omits it, the handler
 * never reads it, and `payroll_app` holds no UPDATE privilege on that column either.
 */
export async function updateEmployeeAction(
  employeeId: unknown,
  input: unknown,
): Promise<UpdateEmployeeResult> {
  return handleUpdateEmployee(deps(), employeeId, input);
}
