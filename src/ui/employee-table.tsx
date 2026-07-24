import Link from 'next/link';

import type { EmployeeSummary } from '@/application/ports/employee-repository';
import { formatPlainDate, plainDateToIso } from '@/domain/plain-date';
import { navHrefWithAsOf } from '@/ui/nav-items';

/**
 * The directory's data surface: six columns, one row per employee.
 *
 * A SERVER component. It renders rows it was handed and reads nothing — not the URL, not a
 * use-case, not the database. The `asOf` param arrives as a prop for exactly that reason: a server
 * component cannot call `useSearchParams`, and the composition root already has it.
 *
 * ## Codes, not names — deliberately
 *
 * `EmployeeSummary` carries `roleCode` / `levelCode` / `countryCode` and no display names. The names
 * live only on `EmployeeFormOptions`, which EXCLUDES inactive rows. Joining the two here would leave
 * a blank cell for anyone sitting on a deactivated role — a hole that appears exactly when something
 * is already wrong, and reads as a rendering bug rather than as the data it is. Codes are the
 * reference-table identity and Law 3 favours exact vocabulary, so codes render verbatim in data
 * positions; names appear only in the form's selects, where the options list is the source anyway.
 *
 * Gender renders as the literal `MALE` / `FEMALE` (Law 3) — no `M`/`F`, no title-casing.
 *
 * ## Typography
 *
 * Country, Gender, and Hire date are `font-mono text-number-sm`: DESIGN binds every numeral and
 * every code in a data position to JetBrains Mono ("a proportional numeral anywhere in a data
 * surface is a defect"). Name and Role/Level read as text.
 */

/** 36px rows — `h-9` at the generated `--spacing: 4px`. */
const ROW_HEIGHT = 'h-9';

const HEAD_CELL = 'px-cell-padding-h py-cell-padding-v';

export function EmployeeTable({
  employees,
  asOfParam,
}: {
  readonly employees: readonly EmployeeSummary[];
  /** The RAW `asOf` param, carried onto each row's link so the global date survives the hop. */
  readonly asOfParam: string | undefined;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">
          Employees, ordered by most recent hire date: name, role code, level code, country code,
          gender, and hire date. Choose a name to open that employee.
        </caption>
        <thead>
          {/* Real `<th scope="col">` headers, not styled divs — the row/column relationship is what
              makes this table navigable by a screen reader at all. Sticky, so the header stays
              readable down a long page without the table becoming a scroll container of its own. */}
          <tr className="sticky top-0 border-b border-border-hairline bg-surface-card text-label-caps text-ink-muted uppercase">
            <th scope="col" className={HEAD_CELL}>
              Name
            </th>
            <th scope="col" className={HEAD_CELL}>
              Role
            </th>
            <th scope="col" className={HEAD_CELL}>
              Level
            </th>
            <th scope="col" className={HEAD_CELL}>
              Country
            </th>
            <th scope="col" className={HEAD_CELL}>
              Gender
            </th>
            <th scope="col" className={HEAD_CELL}>
              Hire date
            </th>
          </tr>
        </thead>
        <tbody>
          {employees.map((employee) => (
            // Keyed on the opaque id, never on the index or the name: two people may legitimately
            // share a name, and the id is the identity.
            <tr
              key={employee.id}
              className={`border-b border-border-hairline hover:bg-surface-tint ${ROW_HEIGHT}`}
            >
              <td className="px-cell-padding-h py-cell-padding-v text-body-sm">
                {/* The row's destination. Built through `navHrefWithAsOf` so the ambient as-of date
                    survives the navigation — a link that dropped it would wind the application back
                    to today with no signal at all. */}
                <Link
                  href={navHrefWithAsOf(`/employees/${employee.id}`, asOfParam)}
                  className="text-ink underline underline-offset-2 hover:text-primary"
                >
                  {employee.name}
                </Link>
              </td>
              <td className="px-cell-padding-h py-cell-padding-v text-body-sm text-ink">
                {employee.roleCode}
              </td>
              <td className="px-cell-padding-h py-cell-padding-v text-body-sm text-ink">
                {employee.levelCode}
              </td>
              <td className="px-cell-padding-h py-cell-padding-v font-mono text-number-sm text-ink">
                {employee.countryCode}
              </td>
              <td className="px-cell-padding-h py-cell-padding-v font-mono text-number-sm text-ink">
                {/* Verbatim (Law 3) — never `M`/`F`, never title-cased. */}
                {employee.gender}
              </td>
              <td className="px-cell-padding-h py-cell-padding-v font-mono text-number-sm text-ink">
                {/* `formatPlainDate` is TOTAL and answers `null` for a month outside 1..12. It is
                    unreachable through a value the repository parsed, but the fallback is spelled
                    out rather than left to JSX's habit of rendering `null` as nothing: the ISO form
                    is honest, machine-readable, and cannot be mistaken for an empty cell. */}
                <time dateTime={plainDateToIso(employee.hireDate)}>
                  {formatPlainDate(employee.hireDate) ?? plainDateToIso(employee.hireDate)}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
