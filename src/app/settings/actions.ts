'use server';

import { revalidatePath } from 'next/cache';

import {
  updateOutlierThreshold,
  type UpdateThresholdResult,
} from '@/application/use-cases/settings';

import { settingsWriteDeps } from './settings-deps';

/**
 * The CAP-6 Settings threshold Apply — the ONE mutation this capability introduces (story 7-2).
 *
 * Mutations are Server Actions (AD-21); this capability adds NO Route Handler here (its one Route
 * Handler is the CSV export). This file is the COMPOSITION ROOT and nothing else: it constructs the
 * write dependencies (deferred, DB-free-safe) and hands them to the use-case, which holds the
 * validation and is testable without Next and without a database.
 *
 * ## The boundary does not trust its own type
 *
 * A `'use server'` export is a live RPC endpoint whose argument types are ERASED at runtime, so the
 * submitted value is typed `unknown` and coerced HERE rather than trusted — the same discipline the
 * CAP-2 write handlers hold to. A number arrives as a number; anything else coerces to `NaN`, which
 * the use-case rejects as `not-an-integer` with no write. Validation of the `[1, 100]` range lives
 * in the use-case (before the DB is touched); this root only normalises the wire value.
 *
 * ## Revalidate only on a committed write
 *
 * On `applied` — and only then — both surfaces that read the threshold are revalidated:
 * `revalidatePath('/')` (Home's findings are judged against it) and `revalidatePath('/settings')`
 * (the control echoes the current value). A `rejected` or `unavailable` result changed nothing, so
 * revalidating would discard a warm cache to no purpose. The action returns the use-case payload
 * unmodified and never throws across the boundary.
 */
export async function applyThresholdAction(input: unknown): Promise<UpdateThresholdResult> {
  // Coerce, don't trust: a non-number (string, null, object, undefined) becomes NaN, which the
  // use-case rejects as `not-an-integer` — never a write, never a throw.
  const value = typeof input === 'number' ? input : Number.NaN;

  const result = await updateOutlierThreshold(settingsWriteDeps(), value);

  if (result.kind === 'applied') {
    revalidatePath('/');
    revalidatePath('/settings');
  }

  return result;
}
