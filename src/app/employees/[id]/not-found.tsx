import Link from 'next/link';

/**
 * No employee holds that id.
 *
 * Rendered under HTTP 404 by `notFound()` in `[id]/page.tsx`. Scoped to this route rather than left
 * to the root `not-found.tsx`, because the two are different facts: "this page does not exist" is
 * true of a mistyped route, and false of a well-formed employee URL whose subject simply is not
 * there. An id is opaque and appears in URLs — a stale bookmark and a link that outlived its row
 * both land here.
 *
 * Deliberately NOT the same thing as the `unavailable` region one file over. That says "we could
 * not find out"; this says "there is no such person", and a surface that conflated them would tell
 * a reader an employee had been deleted during a database outage.
 *
 * The id is not echoed back. It is an opaque surrogate that identifies nobody to a human reader,
 * and reflecting an arbitrary URL segment into the page is a habit worth not forming.
 *
 * No `<h1>`: the header owns the document's one top-level heading. A statement, in the same calm
 * register as every other state in this product.
 */
export default function EmployeeNotFound() {
  return (
    <section
      aria-labelledby="employee-not-found-heading"
      className="rounded border border-border-hairline bg-refusal-fill p-4"
    >
      <h2 id="employee-not-found-heading" className="text-body-md font-medium text-ink-muted">
        No employee has that id
      </h2>
      <p className="mt-1 text-body-sm text-ink">
        The employee this link points at is not in the directory.
      </p>
      <p className="mt-2 text-body-sm">
        <Link href="/employees" className="text-primary underline underline-offset-2">
          Back to the employee directory
        </Link>
      </p>
    </section>
  );
}
