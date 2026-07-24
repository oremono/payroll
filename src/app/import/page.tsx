import type { Metadata } from 'next';

import { ImportPanel } from '@/ui/import-panel';
import { pageTitleFor } from '@/ui/nav-items';

// The browser-tab title, drawn from the same IA declaration the shell reads (`nav-items`).
export const metadata: Metadata = { title: pageTitleFor('/import') };

/**
 * Import — the CAP-1 surface (story 2-2). Until now this route was story 1-6's placeholder
 * statement; the capability it stood in for is what renders here.
 *
 * Still a SERVER component, and deliberately empty of logic. There is nothing to read: the report
 * is produced by an upload, not by a query, so this page has no use-case call, no database read,
 * and no as-of date to resolve. It renders one client component and gets out of the way — the
 * composition root remains `src/app/layout.tsx` and the Route Handler.
 *
 * There is no `<h1>` here. The header's page title is the document's one `<h1>` and the first
 * heading in DOM order, derived from `nav-items` so it cannot disagree with the sidebar; the panel
 * starts its own headings at `<h2>`.
 */
export default function ImportPage() {
  return <ImportPanel />;
}
