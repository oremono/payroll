import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';

import { systemClock } from '@/adapters/clock';
import { getEmployee, loadEmployeeFormOptions } from '@/application/use-cases/employees';
import { getGenderGap } from '@/application/use-cases/gender-gap';
import { getPeerComparison } from '@/application/use-cases/peer-comparison';
import { getSalaryTimeline } from '@/application/use-cases/salary-timeline';
import { formatPlainDate, plainDateToIso } from '@/domain/plain-date';
import { currencyLineFor, EMPLOYEE_FORM_FIELDS } from '@/ui/employee-form';
import { EmployeeFormPanel } from '@/ui/employee-form-panel';
import { EmployeeUnavailable } from '@/ui/employee-unavailable';
import { GenderGapCard } from '@/ui/gender-gap';
import {
  buildGenderGap,
  GENDER_GAP_UNREADABLE_HEADING,
  GENDER_GAP_UNREADABLE_STATEMENT,
} from '@/ui/gender-gap-vm';
import { PeerComparison } from '@/ui/peer-comparison';
import {
  buildPeerComparison,
  PEER_COMPARISON_UNREADABLE_HEADING,
  PEER_COMPARISON_UNREADABLE_STATEMENT,
} from '@/ui/peer-comparison-vm';
import { salaryChangeAvailability } from '@/ui/salary-change-form';
import { SalaryChangePanel } from '@/ui/salary-change-panel';
import { SalaryTimeline } from '@/ui/salary-timeline';
import { buildSalaryTimeline } from '@/ui/salary-timeline-vm';

import { recordSalaryChangeAction, updateEmployeeAction } from '../actions';
import { employeeReadDeps } from '../employee-deps';

/**
 * One employee — identity fields, the edit/record-change controls, and the DR9 salary timeline.
 *
 * ## Why this route exists at all, and how far it goes
 *
 * `getEmployee` and the `revalidatePath('/employees/{id}')` call were both finalized by story 3-1
 * FOR this story; without a detail route they are dead code and an unreachable cache invalidation.
 * Epic 3 assigns "row-to-detail navigation" here, and `reconcile-stitch.md` puts the `Edit employee`
 * control on the detail screen.
 *
 * Story 5-2 adds the CAP-4 surface: it calls `getSalaryTimeline(deps, id, today)` and renders its
 * three arms as a sibling section after the identity one — the DR9 timeline (newest-first, with the
 * derived percent chip and `(Hire)` marker), a dignified empty line, or the shared "unreadable"
 * region. It CONSUMES story 5-1's finalized payload unmodified and adds nothing to the contract
 * (Law 7); the current record is the payload's head, never re-resolved here (AD-8). No peer
 * comparison yet (Epic 6).
 *
 * ## `today`, read once, here
 *
 * `await connection()` then `systemClock.todayUtc()` — the `src/app/layout.tsx` pattern exactly.
 * Without `connection()` Next would evaluate the clock at BUILD time and bake the build date in as
 * "today". The resulting `PlainDate` travels inward as a prop; no `Date` exists in `src/ui`,
 * `src/domain` or `src/application` (Law 6 / AD-11).
 *
 * ## The three arms, and why two of them are different answers
 *
 * `not-found` and `unavailable` are deliberately NOT conflated. One means "there is no such
 * person"; the other means "we could not find out". A surface that showed the first when the second
 * was true would tell a reader an employee had been deleted during a database outage.
 *
 * `notFound()` is Next's own control flow, not an exception reaching a user: it renders
 * `[id]/not-found.tsx` under HTTP 404.
 */

// The browser-tab title for the detail surface. Deliberately the SURFACE name ("Employee"), not the
// person's — the same choice the header `<h1>` makes (`pageTitleFor`), and it needs no extra read.
// Next composes it through the layout template as `Employee · Salary Management for ACME HR`.
export const metadata: Metadata = { title: 'Employee' };

const UNAVAILABLE_HEADING = 'This employee could not be read';

/**
 * The heading for the timeline's own "unreadable" region.
 *
 * Distinct copy AND a distinct DOM id from the whole-employee `unavailable` arm above: the identity
 * read can succeed while the salary read fails, so both regions may be on the page at once, and this
 * one names the salary history specifically rather than the employee.
 */
const TIMELINE_UNAVAILABLE_HEADING = 'This salary timeline could not be read';
const TIMELINE_UNAVAILABLE_STATEMENT =
  "This employee's salary history is not readable right now. Nothing has changed.";

export default async function EmployeeDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  // The clock port is the ONLY source of "now", read at the delivery boundary and passed inward.
  await connection();
  const today = systemClock.todayUtc();
  const deps = employeeReadDeps();

  // The id comes from a URL segment a person can hand-edit. That is ordinary input, not an
  // invariant breach: story 3-1's adapter answers `null` for a non-UUID rather than throwing, so
  // `not-a-uuid` reaches the same 404 as a well-formed id nobody holds.
  const result = await getEmployee(deps, id);

  if (result.kind === 'unavailable') {
    return (
      <EmployeeUnavailable
        id="employee-detail-unavailable-heading"
        heading={UNAVAILABLE_HEADING}
        statement="This employee's record is not readable right now. Nothing has changed."
      />
    );
  }

  if (result.kind === 'not-found') {
    notFound();
  }

  const employee = result.employee;
  const options = await loadEmployeeFormOptions(deps);
  const currencyLine =
    options.kind === 'options' ? currencyLineFor(options.options, employee.countryCode) : null;

  // Whether CAP-3's form can be offered at all. Withheld — with an explanatory statement in place of
  // the control — when the employee's currency cannot be resolved to a format, and when their hire
  // date is later than today, because every effective date such a form could submit would be
  // refused (deferred #3). The decision is in the pure module; this reads its answer.
  const salaryChange = salaryChangeAvailability(
    options.kind === 'options' ? options.options : null,
    employee.countryCode,
    employee.hireDate,
    today,
  );

  // The CAP-4 read, at the SAME `today` the sibling reads above use (Law 6 / AD-11). `deps` already
  // satisfies `SalaryTimelineDeps`; the payload is consumed unmodified (Law 7). `unavailable` and,
  // defensively, `not-found` (a race after `getEmployee` resolved) are the "unreadable" region;
  // `timeline` builds the view-model — currencies come from the reference options when they were
  // readable, and an empty list withholds the amounts through the builder rather than here.
  const timeline = await getSalaryTimeline(deps, id, today);

  // The CAP-5 read, at the SAME `today` the sibling reads use (Law 6 / AD-11). `deps` already
  // satisfies `PeerComparisonDeps`; the payload is consumed unmodified (Law 7). `unavailable` and,
  // defensively, `not-found` (a race after `getEmployee` resolved) are the shared "unreadable"
  // region; `answer`/`refusal` build the view-model — currencies come from the reference options
  // when they were readable, and an empty list fails the answer's figures closed through the builder
  // rather than here.
  const peer = await getPeerComparison(deps, id, today);

  // The CAP-7 read, at the SAME `today` the sibling reads use (Law 6 / AD-11). `deps` already
  // satisfies `GenderGapDeps`; the payload is consumed unmodified (Law 7). `unavailable` and,
  // defensively, `not-found` (a race after `getEmployee` resolved) are the shared "unreadable"
  // region; `answer`/`refusal` build the view-model — currencies come from the reference options
  // when they were readable, and an empty list fails the answer's figures closed through the builder
  // rather than here.
  const genderGap = await getGenderGap(deps, id, today);

  return (
    <>
    <section
      aria-labelledby="employee-detail-heading"
      className="rounded border border-border-hairline bg-surface-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* `<h2>` — the header owns the document's one `<h1>`, which names the SURFACE ("Employee",
            via `pageTitleFor`). The person's name is this card's own heading, one level down. */}
        <h2 id="employee-detail-heading" className="text-headline-md text-ink">
          {employee.name}
        </h2>

        <div className="flex flex-wrap items-start gap-3">
          {options.kind === 'options' ? (
            <EmployeeFormPanel
              mode={{ kind: 'edit', employee, action: updateEmployeeAction }}
              options={options.options}
            />
          ) : (
            // No Edit button when the reference tables cannot be read: the form's selects would
            // have nothing to offer, and an empty select is worse than an absent control.
            <p className="text-body-sm text-ink-muted">
              The reference tables could not be read, so this employee cannot be edited right now.
            </p>
          )}

          {salaryChange.kind === 'available' ? (
            // The Server Action arrives from HERE, the composition root — `src/ui` may not import
            // `@/app/*`.
            <SalaryChangePanel
              employeeId={employee.id}
              currency={salaryChange.currency}
              today={today}
              action={recordSalaryChangeAction}
            />
          ) : (
            // Mirrors the arm above: an absent control with a statement beside it, rather than a
            // control that cannot work.
            <p className="text-body-sm text-ink-muted">{salaryChange.statement}</p>
          )}
        </div>
      </div>

      {/* A description list, not a table: this is one subject's attributes, and `<dt>`/`<dd>` is
          what makes each value programmatically associated with its own label. */}
      <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-gutter gap-y-cell-padding-v">
        <Term label={EMPLOYEE_FORM_FIELDS.role.label} />
        <Code value={employee.roleCode} />

        <Term label={EMPLOYEE_FORM_FIELDS.level.label} />
        <Code value={employee.levelCode} />

        <Term label={EMPLOYEE_FORM_FIELDS.country.label} />
        <Code value={employee.countryCode} />

        <Term label={EMPLOYEE_FORM_FIELDS.gender.label} />
        {/* Verbatim (Law 3) — never `M`/`F`, never title-cased. */}
        <Code value={employee.gender} />

        <Term label={EMPLOYEE_FORM_FIELDS.hire_date.label} />
        <dd className="font-mono text-number-sm text-ink">
          <time dateTime={plainDateToIso(employee.hireDate)}>
            {/* `formatPlainDate` is total and answers `null` for a month outside 1..12; the ISO
                form is the honest fallback rather than an empty value. */}
            {formatPlainDate(employee.hireDate) ?? plainDateToIso(employee.hireDate)}
          </time>
        </dd>
      </dl>

      {/* Currency FOLLOWS from country (AD-6) and is never chosen. `null` when the country is not
          among the ACTIVE options — an employee on a deactivated country has no entry, and
          "Currency undefined" would be a rendering bug appearing exactly when something is already
          wrong. */}
      {currencyLine === null ? null : (
        <p className="mt-3 text-body-sm text-ink-muted">{currencyLine}</p>
      )}
    </section>

      {/* The DR9 salary timeline — a sibling section, flat under the page `<h1>`. `unavailable` and,
          defensively, `not-found` are the shared "unreadable" region (a region with a heading, never
          `role="alert"`), kept visibly distinct from a present employee with an empty history. */}
      {timeline.kind === 'unavailable' || timeline.kind === 'not-found' ? (
        <div className="mt-4">
          <EmployeeUnavailable
            id="salary-timeline-unavailable-heading"
            heading={TIMELINE_UNAVAILABLE_HEADING}
            statement={TIMELINE_UNAVAILABLE_STATEMENT}
          />
        </div>
      ) : (
        <SalaryTimeline
          vm={buildSalaryTimeline(
            timeline.timeline,
            // The reference currencies, when the tables were readable; an empty list otherwise, which
            // the builder answers by withholding the amounts rather than showing a bare figure.
            options.kind === 'options' ? options.options.currencies : [],
          )}
        />
      )}

      {/* The CAP-5 peer-comparison surface — a third sibling section, flat under the page `<h1>`.
          `unavailable` and, defensively, `not-found` are the shared "unreadable" region (a region
          with a heading, never `role="alert"`), kept visibly distinct from a refusal. `answer` and
          `refusal` build the view-model: an answer's money figures resolve from the reference
          currencies (an empty list fails them closed to verdict + provenance + copy), and both a
          refusal and an answer carry the ONE verdict for the card and copy-answer alike. */}
      {peer.kind === 'unavailable' || peer.kind === 'not-found' ? (
        <div className="mt-4">
          <EmployeeUnavailable
            id="peer-comparison-unavailable-heading"
            heading={PEER_COMPARISON_UNREADABLE_HEADING}
            statement={PEER_COMPARISON_UNREADABLE_STATEMENT}
          />
        </div>
      ) : (
        <PeerComparison
          vm={buildPeerComparison(
            peer,
            options.kind === 'options' ? options.options.currencies : [],
          )}
        />
      )}

      {/* The CAP-7 gender-gap surface — a fourth sibling section, flat under the page `<h1>`.
          `unavailable` and, defensively, `not-found` are the shared "unreadable" region (a region
          with a heading, never `role="alert"`), kept visibly distinct from a refusal. `answer` and
          `refusal` build the view-model: an answer's median figures resolve from the reference
          currencies (an empty list fails them closed to verdict + provenance + copy), and both a
          refusal and an answer carry the ONE verdict for the card and copy-answer alike. The
          gender-gap card adds only the gender split — the whole-group median/spread stays with the
          peer-comparison card above (AD-9). */}
      {genderGap.kind === 'unavailable' || genderGap.kind === 'not-found' ? (
        <div className="mt-4">
          <EmployeeUnavailable
            id="gender-gap-unavailable-heading"
            heading={GENDER_GAP_UNREADABLE_HEADING}
            statement={GENDER_GAP_UNREADABLE_STATEMENT}
          />
        </div>
      ) : (
        <GenderGapCard
          vm={buildGenderGap(
            genderGap,
            options.kind === 'options' ? options.options.currencies : [],
          )}
        />
      )}
    </>
  );
}

function Term({ label }: { readonly label: string }) {
  return <dt className="text-label-caps text-ink-muted uppercase">{label}</dt>;
}

/**
 * A reference CODE, rendered verbatim in the mono face.
 *
 * Codes rather than display names, for the reason the directory table gives at length: the names
 * live only on `EmployeeFormOptions`, which excludes inactive rows, so joining the two would leave
 * this value blank for anyone sitting on a deactivated role.
 */
function Code({ value }: { readonly value: string }) {
  return <dd className="font-mono text-number-sm text-ink">{value}</dd>;
}
