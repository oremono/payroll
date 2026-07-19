/**
 * The scaffold home page — now dressed entirely in generated token utilities (AD-15).
 *
 * Every class here compiles to `var(--color-…)`, `var(--text-…)`, `var(--radius)` or a multiple of
 * `var(--spacing)`; there is not a color, a size, or a length written by hand, and there is no
 * `dark:` variant — the dark values re-point the same token names via `prefers-color-scheme` inside
 * `tokens.generated.css`. `e2e/tokens.spec.ts` reads the COMPUTED styles of these elements, which
 * is what makes the token contract an end-to-end claim rather than a claim about a string.
 */
export default function HomePage() {
  return (
    <main className="bg-surface-base text-ink p-3">
      <h1 className="text-headline-lg">Salary Management for ACME HR</h1>
      <p className="text-body-md bg-surface-card rounded p-3">
        Project scaffold is up and running. Reference amount{' '}
        <data className="text-number-md font-mono" value="1234.56">
          1,234.56
        </data>
        .
      </p>
    </main>
  );
}
