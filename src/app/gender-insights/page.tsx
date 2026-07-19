/**
 * Gender Insights — placeholder route (story 1-6).
 *
 * The shell is this story's deliverable; the capability is not. No database read, no Prisma
 * import, no Server Action, no use-case (story constraint) — the page exists so the sidebar has a
 * real destination, `aria-current="page"` has something to be current ON, and the axe pass has all
 * seven surfaces to judge.
 *
 * The statement below is the ratified first-run copy. A statement, never a celebration
 * (EXPERIENCE § Cross-cutting state patterns: "in a calm register — statements, never
 * celebrations"), and no invented capability copy beyond it.
 *
 * There is no `<h1>` here: the header's page title is the document's one `<h1>` and the first
 * heading in DOM order, derived from `nav-items` so it cannot disagree with the sidebar.
 */
export default function GenderInsightsPage() {
  return (
    <p className="rounded bg-surface-card p-3 text-body-md">No employees yet. Import a spreadsheet to begin.</p>
  );
}
