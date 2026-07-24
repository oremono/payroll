import { connection } from 'next/server';

import { systemClock } from '@/adapters/clock';
import { resolveAsOf } from '@/application/as-of';
import { getGenderDistribution } from '@/application/use-cases/gender-distribution';
import { formatPlainDate, plainDateToIso } from '@/domain/plain-date';
import { EmployeeUnavailable } from '@/ui/employee-unavailable';
import { GenderDistributionChart } from '@/ui/gender-distribution';
import {
  buildGenderDistribution,
  GENDER_DISTRIBUTION_UNAVAILABLE_HEADING,
  GENDER_DISTRIBUTION_UNAVAILABLE_STATEMENT,
} from '@/ui/gender-distribution-vm';

import { genderDistributionDeps } from '../employees/employee-deps';

/**
 * Gender Insights — the CAP-8 drill-down (story 9-2). Until now this route was story 1-6's
 * placeholder ("No employees yet…").
 *
 * A React Server Component reading IN-PROCESS (AD-21) — no `fetch` to our own origin, no Route
 * Handler. This file is the delivery boundary: the clock is read ONCE here and the resolved `asOf`
 * travels inward as an argument (Law 6 / AD-11). The nav href already carries the ambient as-of
 * (`navHrefWithAsOf`), so there is no per-page as-of picker; the page just echoes the date the same
 * way Home does, keeping recompute observable.
 *
 * The distribution consumes story 9-1's finalized payload unmodified: `unavailable` renders the calm
 * shared `EmployeeUnavailable` region (never `role="alert"`, HTTP 200), and `answer` renders
 * `<GenderDistribution>` with a FULLY VISIBLE counts table. An empty population is an answer of zeros,
 * not a refusal.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function GenderInsightsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Per REQUEST, never at build time — the clock read must not be hoisted into the build (AD-11).
  await connection();

  const params = await searchParams;

  // Hostile by default — anything a person or a stale bookmark can type. `resolveAsOf` is total: a
  // malformed, impossible, future, or repeated param resolves to today.
  const asOf = resolveAsOf(params['asOf'], systemClock.todayUtc());

  const result = await getGenderDistribution(genderDistributionDeps(), asOf);

  return (
    <>
      <p className="rounded bg-surface-card p-3 text-body-md">
        Showing gender distribution as of{' '}
        {/* All numerals are JetBrains Mono, dates in data positions included (DESIGN § Typography). */}
        <time
          data-testid="as-of-echo"
          dateTime={plainDateToIso(asOf)}
          className="font-mono text-number-sm"
        >
          {/* `formatPlainDate` returns `null` for an out-of-range month; unreachable through
              `resolveAsOf`, but the canonical machine form is the fallback (never an empty `<time>`). */}
          {formatPlainDate(asOf) ?? plainDateToIso(asOf)}
        </time>
        .
      </p>

      <div className="mt-3">
        {result.kind === 'unavailable' ? (
          <EmployeeUnavailable
            id="gender-insights-unavailable-heading"
            heading={GENDER_DISTRIBUTION_UNAVAILABLE_HEADING}
            statement={GENDER_DISTRIBUTION_UNAVAILABLE_STATEMENT}
          />
        ) : (
          <GenderDistributionChart vm={buildGenderDistribution(result)} />
        )}
      </div>
    </>
  );
}
