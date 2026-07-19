import { notFound } from 'next/navigation';

import { getEmployee, loadEmployeeFormOptions } from '@/application/use-cases/employees';
import { formatPlainDate, plainDateToIso } from '@/domain/plain-date';
import { currencyLineFor, EMPLOYEE_FORM_FIELDS } from '@/ui/employee-form';
import { EmployeeFormPanel } from '@/ui/employee-form-panel';
import { EmployeeUnavailable } from '@/ui/employee-unavailable';

import { updateEmployeeAction } from '../actions';
import { employeeReadDeps } from '../employee-deps';

/**
 * One employee — IDENTITY FIELDS ONLY, and the edit form's invoking control.
 *
 * ## Why this route exists at all, and how far it goes
 *
 * `getEmployee` and the `revalidatePath('/employees/{id}')` call were both finalized by story 3-1
 * FOR this story; without a detail route they are dead code and an unreachable cache invalidation.
 * Epic 3 assigns "row-to-detail navigation" here, and `reconcile-stitch.md` puts the `Edit employee`
 * control on the detail screen.
 *
 * So it is a thin identity page and nothing more. NO current salary — the AD-8 resolver does not
 * exist yet and belongs to CAP-3/CAP-4. No salary timeline (DR9 → Epic 5), no peer comparison
 * (Epic 6), no record-a-change entry point (Epic 4). Epic 5 will add content to an existing page
 * rather than inventing one.
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

const UNAVAILABLE_HEADING = 'This employee could not be read';

export default async function EmployeeDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
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

  return (
    <section
      aria-labelledby="employee-detail-heading"
      className="rounded border border-border-hairline bg-surface-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* `<h2>` — the header owns the document's one `<h1>`, and no nav item claims this path, so
            its title is the product name. */}
        <h2 id="employee-detail-heading" className="text-headline-md text-ink">
          {employee.name}
        </h2>

        {options.kind === 'options' ? (
          <EmployeeFormPanel
            mode={{ kind: 'edit', employee, action: updateEmployeeAction }}
            options={options.options}
          />
        ) : (
          // No Edit button when the reference tables cannot be read: the form's selects would have
          // nothing to offer, and an empty select is worse than an absent control.
          <p className="text-body-sm text-ink-muted">
            The reference tables could not be read, so this employee cannot be edited right now.
          </p>
        )}
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
