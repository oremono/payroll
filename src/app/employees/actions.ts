'use server';

import { revalidatePath } from 'next/cache';

import { systemClock } from '@/adapters/clock';
import { createEmployeeRepository } from '@/adapters/db/employee-repository';
import { createUuidV7Generator } from '@/adapters/id';
import type {
  CreateEmployeeResult,
  UpdateEmployeeResult,
} from '@/application/use-cases/employees';
import type { RecordSalaryChangeResult } from '@/application/use-cases/record-salary-change';

import {
  handleCreateEmployee,
  handleUpdateEmployee,
  type EmployeeWriteDeps,
} from './handle-employee-write';
import {
  handleRecordSalaryChange,
  type SalaryChangeWriteDeps,
} from './handle-salary-change';

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
 * No clock is wired into the CAP-2 actions, deliberately: a future hire date is accepted, so no
 * CAP-2 rule is date-relative and an unused clock dependency would be a Law 6 hazard rather than
 * compliance. CAP-3 is different — a record dated later than today is rejected on every write path
 * — so `recordSalaryChangeAction` wires the clock port in HERE, at the one boundary permitted to
 * read it, and the resulting `PlainDate` travels inward as an argument (AD-11).
 *
 * Note the `'use server'` constraint: every export in this file must be an async function, which is
 * why the payload TYPES live in the use-case module and are not re-exported here.
 */

/**
 * The routes a committed write to ONE employee invalidates — ONE list, shared by every write path
 * in this file.
 *
 * The one Next-specific effect in the capability, injected into the handlers so they stay testable.
 * Story 3-2 renders the directory from the read use-cases; without this its first successful create
 * would leave a stale list on screen, and it would have to add cache invalidation the "finalized"
 * contract never mentioned.
 *
 * BOTH routes, not just the directory: `/employees/{id}` is rendered from `getEmployee`, so an edit
 * that invalidated only the list would leave the detail page serving the pre-edit name — a page
 * contradicting the list it was reached from. Story 4-2 puts CAP-3's record-change trigger on that
 * same detail route — the salary TIMELINE is CAP-4 (Epic 5) and no surface displays a salary yet —
 * which is why CAP-2 and CAP-3 must invalidate the SAME set: two lists would mean the next route
 * added here is added to one of them, and the other path silently serves a stale page.
 *
 * The handlers call this only after a write that COMMITTED, and only with an id the repository
 * matched to a row, so the interpolated segment is a UUID by then.
 */
function revalidateEmployee(employeeId: string): void {
  revalidatePath('/employees');
  revalidatePath(`/employees/${employeeId}`);
}

/** Build the adapters fresh per invocation; the Prisma client itself is process-wide and cached. */
function deps(): EmployeeWriteDeps {
  return {
    repository: createEmployeeRepository(),
    idGenerator: createUuidV7Generator(),
    revalidate: revalidateEmployee,
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

/**
 * The CAP-3 dependencies. Same repository and same id port as the CAP-2 actions, plus the CLOCK —
 * the one thing this capability needs that CAP-2 does not, because a future-dated salary record is
 * rejected on every write path (Law 5 / AD-18) and that rule is date-relative by definition.
 *
 * `systemClock` is the only `Date.now()` in the codebase. It is read here and the resulting
 * `PlainDate` is passed inward; nothing in `src/application` or `src/domain` can reach it (AD-11).
 */
function salaryDeps(): SalaryChangeWriteDeps {
  return {
    repository: createEmployeeRepository(),
    idGenerator: createUuidV7Generator(),
    clock: systemClock,
    // The SAME invalidation list the CAP-2 writes use — see `revalidateEmployee`.
    revalidate: revalidateEmployee,
  };
}

/**
 * Record ONE salary change — an append, never an update (Law 5 / AD-18). There is no future-dating,
 * no scheduled change, and no edit or delete affordance over what came before; a correction is a
 * new record dated today.
 */
export async function recordSalaryChangeAction(
  employeeId: unknown,
  input: unknown,
): Promise<RecordSalaryChangeResult> {
  return handleRecordSalaryChange(salaryDeps(), employeeId, input);
}
