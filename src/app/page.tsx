import { connection } from 'next/server';

import { systemClock } from '@/adapters/clock';
import { resolveAsOf } from '@/application/as-of';
import { formatPlainDate, plainDateToIso } from '@/domain/plain-date';

/**
 * Home — placeholder route, plus the one thing on it that is not a placeholder: the SERVER-RENDERED
 * echo of the resolved as-of date.
 *
 * That echo is what makes recompute observable end to end. The header's control is a client
 * component reading the URL, so on its own it could show a new date while nothing had actually been
 * recomputed. This paragraph is rendered on the server from `searchParams`, at the delivery
 * boundary, through the same `resolveAsOf` policy — so when it changes, a real server render
 * happened. `e2e/shell.spec.ts` asserts on THIS element for exactly that reason.
 *
 * No database read, no use-case, no Server Action (story constraint). The as-of date is resolved
 * here and would, from the first capability onward, be passed inward as an argument — never read
 * inside the math (Law 6 / AD-11).
 *
 * The first paragraph keeps `bg-surface-card rounded p-3 text-body-md` because `e2e/tokens.spec.ts`
 * reads COMPUTED styles off `main p` — that is what makes the token contract an end-to-end claim
 * about a rendered utility rather than a claim about a string.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  // Same reason as the layout: the clock read must happen per REQUEST, never at build time.
  await connection();

  const params = await searchParams;
  const today = systemClock.todayUtc();

  // Hostile by default — anything a person or a stale bookmark can type arrives here. `resolveAsOf`
  // is total: a malformed, impossible, future, or repeated param resolves to today and renders
  // normally. There is deliberately no error surface for a bad as-of date.
  const asOf = resolveAsOf(params['asOf'], today);

  return (
    <>
      <p className="rounded bg-surface-card p-3 text-body-md">
        No employees yet. Import a spreadsheet to begin.
      </p>
      <p className="mt-3 text-body-sm text-ink-muted">
        Showing findings as of{' '}
        {/* All numerals are JetBrains Mono, dates in data positions included (DESIGN
            § Typography). */}
        <time
          data-testid="as-of-echo"
          dateTime={plainDateToIso(asOf)}
          className="font-mono text-number-sm"
        >
          {/* `formatPlainDate` returns `null` for an out-of-range month (the `money.ts` guard
              pattern). Unreachable through `resolveAsOf`, but JSX renders `null` as NOTHING — an
              empty `<time>` on a provenance line — so the canonical machine form is the fallback. */}
          {formatPlainDate(asOf) ?? plainDateToIso(asOf)}
        </time>
        .
      </p>
    </>
  );
}
