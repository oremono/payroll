'use client';

import { useState } from 'react';

import type { OutlierRow, OutlierSection } from '@/ui/outlier-findings-vm';

/**
 * The CAP-6 findings TABLE — a client island that paginates the already-delivered sections.
 *
 * `outlier-findings.tsx` stays a server component and owns the `unreadable`/`empty` arms and the
 * `EmployeeUnavailable` region; it hands the FINDINGS arm's sections here. Pagination is CLIENT
 * state over data already present in the payload — no fetch to our own origin (AD-21 forbids that
 * for a read; `import-panel.tsx`'s pager is the precedent for turning a page over `useState`). It is
 * the peer-group SECTIONS that page, `SECTIONS_PER_PAGE` at a time, so a group is never split across
 * a page boundary — the 2px `border-strong` divider between groups stays meaningful.
 *
 * Pagination, never infinite scroll (epic-3-context § UX: "data tables paginate"). The ends are
 * buttons, not links, because the page position is client state and not a URL — the Home surface's
 * one and only URL parameter is the ambient as-of date. On the first/last page the corresponding
 * end is plain `ink-faint` text with no button, the same honesty `EmployeePager` gives its ends.
 */

/** Peer-group sections shown per page. Groups page whole — a section is never split. */
const SECTIONS_PER_PAGE = 8;

export function OutlierFindingsTable({
  sections,
}: {
  readonly sections: readonly OutlierSection[];
}) {
  const pageCount = Math.max(1, Math.ceil(sections.length / SECTIONS_PER_PAGE));
  // Clamp defensively — state can only reach [0, pageCount) through the controls below, but a
  // clamp keeps the slice total even if that ever stops being true.
  const [page, setPage] = useState(0);
  const current = Math.min(page, pageCount - 1);
  const start = current * SECTIONS_PER_PAGE;
  const visible = sections.slice(start, start + SECTIONS_PER_PAGE);

  const hasPrev = current > 0;
  const hasNext = current < pageCount - 1;

  return (
    <>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="sticky top-0 bg-surface-card">
              <th scope="col" className="py-2 pr-3 text-label-caps uppercase text-ink-muted">
                Employee
              </th>
              <th scope="col" className="py-2 pr-3 text-label-caps uppercase text-ink-muted">
                Peer group
              </th>
              <th scope="col" className="py-2 pl-3 text-right text-label-caps uppercase text-ink-muted">
                Peers
              </th>
              <th scope="col" className="py-2 pl-3 text-right text-label-caps uppercase text-ink-muted">
                Distance
              </th>
            </tr>
          </thead>
          {visible.map((section, index) => (
            <SectionBody key={sectionKey(section, start + index)} section={section} />
          ))}
        </table>
      </div>

      {/* The pager — only when there is more than one page. `Groups X–Y of Z` counts peer groups,
          the unit that pages, and each end stops being a button when there is nowhere to go. */}
      {pageCount > 1 ? (
        <nav
          aria-label="Outlier findings pages"
          className="mt-3 flex items-center gap-gutter text-body-sm"
        >
          {hasPrev ? (
            <button
              type="button"
              onClick={() => setPage(current - 1)}
              className="rounded border border-border-hairline px-3 py-2 text-ink-muted hover:text-ink"
            >
              Previous page
            </button>
          ) : (
            <span className="px-3 py-2 text-ink-faint">Previous page</span>
          )}

          <span className="font-mono text-number-sm text-ink-muted">
            Groups {start + 1}–{start + visible.length} of {sections.length} · Page {current + 1} of{' '}
            {pageCount}
          </span>

          {hasNext ? (
            <button
              type="button"
              onClick={() => setPage(current + 1)}
              className="rounded border border-border-hairline px-3 py-2 text-ink-muted hover:text-ink"
            >
              Next page
            </button>
          ) : (
            <span className="px-3 py-2 text-ink-faint">Next page</span>
          )}
        </nav>
      ) : null}
    </>
  );
}

/** A stable key for a section — the label is unique per peer-group triple; index disambiguates. */
function sectionKey(section: OutlierSection, index: number): string {
  return `${index}-${section.label}`;
}

/**
 * One peer-group section as a `<tbody>` — the 2px `border-strong` top rule is the divider DR8 asks
 * for between peer-group sections. An outlier section is one row per flagged member; a thin group is
 * a single full-width inline refusal row.
 */
function SectionBody({ section }: { readonly section: OutlierSection }) {
  if (section.kind === 'refusal') {
    return (
      <tbody className="border-t-2 border-border-strong">
        <tr>
          {/* The inline thin-group refusal (DR8 / AD-16): full-width, flat `refusal-fill`, hairline,
              rounded — a calm statement, never widened, never `role="alert"`, never error-colored. */}
          <td colSpan={4} className="py-2">
            <div className="rounded border border-border-hairline bg-refusal-fill p-3">
              <span className="text-body-md font-medium text-ink-muted">{section.label}</span>{' '}
              <span className="text-body-sm text-ink-muted italic">{section.refusalText}</span>
            </div>
          </td>
        </tr>
      </tbody>
    );
  }

  return (
    <tbody className="border-t-2 border-border-strong">
      {section.rows.map((row) => (
        <FindingRow key={row.employeeId} row={row} label={section.label} n={section.n} />
      ))}
    </tbody>
  );
}

/**
 * One 40px finding row: the employee name, the peer-group label, the right-aligned peer count, and
 * the right-aligned amber badge. Numerals are `font-mono`; hover tints the row.
 */
function FindingRow({
  row,
  label,
  n,
}: {
  readonly row: OutlierRow;
  readonly label: string;
  readonly n: number;
}) {
  return (
    <tr className="h-10 hover:bg-surface-tint">
      <td className="py-2 pr-3 text-body-md font-medium text-primary">{row.name}</td>
      <td className="py-2 pr-3 text-body-sm text-ink-muted">{label}</td>
      <td className="py-2 pl-3 text-right font-mono text-number-sm text-ink">{n} peers</td>
      <td className="py-2 pl-3 text-right">
        <OutlierBadge badgeText={row.badgeText} />
      </td>
    </tr>
  );
}

/**
 * The outlier badge (DR4): a small rectangular amber stamp — near-sharp `rounded-sm` (2px), a 1px
 * amber border, mono numerals. The text carries the signed distance AND the direction WORD, so the
 * meaning never rides color alone (WCAG 2.2 AA). Amber means "beyond the threshold", never error.
 */
function OutlierBadge({ badgeText }: { readonly badgeText: string }) {
  return (
    <span className="inline-block rounded-sm border border-amber-badge-border bg-amber-badge-bg px-2 py-0.5 font-mono text-number-sm text-amber-badge-text">
      {badgeText}
    </span>
  );
}
