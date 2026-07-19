/**
 * The `unavailable` arm of a CAP-2 read, given a voice.
 *
 * Story 3-1 made every read TOTAL: `listEmployees`, `getEmployee`, and `loadEmployeeFormOptions`
 * each answer a union with an `unavailable` arm, so a database outage is an ANSWER rather than an
 * exception. Nothing in the design documents describes that state — DR17 has no such thing — so its
 * register is borrowed from the nearest ratified pattern, which is the refusal panel:
 *
 *   - a REGION with a heading, never `role="alert"` (NFR9; project-context § Conventions). Losing a
 *     read is not an emergency and must not interrupt whatever the person is reading.
 *   - flat `refusal-fill`, a hairline border, no warning icon, no error color — none exists in this
 *     token system, and a refusal is styled with the same dignity as an answer.
 *   - a STATEMENT. It says what could not be read and stops. It does not apologise, does not offer
 *     a reload button, and does not speculate about the cause — every error in the CAP-2 stack is
 *     currently swallowed (`deferred-work.md` records the missing logging port), so the surface
 *     genuinely does not know why, and inventing a reason would be the surface making something up.
 *
 * A server component: there is nothing interactive here.
 *
 * It is shared by the directory and the detail route rather than written twice. Two copies of a
 * region whose whole job is to say ONE thing consistently is how the product ends up saying it two
 * ways. (This file is not in the spec's task list — recorded in its Spec Change Log.)
 */
export function EmployeeUnavailable({
  id,
  heading,
  statement,
}: {
  /** The heading's DOM id — distinct per surface, since both may not be mounted at once. */
  readonly id: string;
  readonly heading: string;
  readonly statement: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className="rounded border border-border-hairline bg-refusal-fill p-4"
    >
      {/* `<h2>`, not `<h1>`: the header owns the document's one top-level heading. */}
      <h2 id={id} className="text-body-md font-medium text-ink-muted">
        {heading}
      </h2>
      <p className="mt-1 text-body-sm text-ink">{statement}</p>
    </section>
  );
}
