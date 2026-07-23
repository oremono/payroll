'use client';

import { useAnnounce } from '@/ui/announcer';

/**
 * The copy-answer affordance — a ghost icon button that copies the ONE verdict sentence verbatim
 * and announces the copy through the app-level polite live region. Present on the peer-comparison
 * answer card AND on the refusal panel: a copied refusal is a full citizen, a quotable answer too
 * (epic-6-context § UX).
 *
 * ## It receives ONLY the verdict, and copies it verbatim
 *
 * `verdict` is the ONE server-composed sentence (`src/domain/verdict.ts`), carried unmodified from
 * the payload. This island assembles nothing and derives nothing — it writes exactly what it is
 * handed — so it needs no unit test of its own: the `.tsx` decides nothing, and the view-model is
 * what `tests/ui/peer-comparison.test.ts` covers. That is also why its only prop is `verdict`.
 *
 * ## The first clipboard client island (mirrors `as-of-control.tsx`)
 *
 * `"use client"` + `useAnnounce()` is the same pattern the as-of control established: the announce
 * rides the SINGLE `aria-live="polite"` region in `<Announcer>` (mounted in the root layout, never
 * remounted, AD-20), so "Answer copied" is spoken without a second live region and re-announces the
 * same text on a repeat copy (the announcer's clear-then-set makes an identical string a real
 * mutation).
 *
 * ## Clipboard failure is TOTAL — never a throw, never a dialog
 *
 * `navigator.clipboard.writeText` rejects when the document is not focused, permission is denied, or
 * the API is absent. The `try/catch` swallows it whole: a failed copy must never crash the surface
 * or surface a JS `alert/confirm/prompt` (project-context; no JS dialog anywhere). The optional
 * muted announce on failure keeps a screen-reader user from waiting on a confirmation that will
 * never come.
 *
 * ## Accessibility (WCAG 2.2 AA)
 *
 * A real accessible name (`aria-label="Copy answer"`); the inline-SVG copy glyph is decorative and
 * `aria-hidden`, exactly as the as-of control's `CalendarGlyph` is — `aria-label` already tells a
 * screen reader what the button does, and a second graphical telling would be read as a stray image.
 * No border/fill (a ghost button): `text-ink-faint hover:text-primary`, both token utilities that
 * re-point themselves under `prefers-color-scheme`, so no `dark:` variant is needed.
 */

const COPY_ANNOUNCEMENT = 'Answer copied';
const COPY_FAILED_ANNOUNCEMENT = 'Answer could not be copied';

/** The copy glyph — two offset rounded rectangles, `stroke="currentColor"`, decorative. */
function CopyGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
    </svg>
  );
}

export function CopyAnswer({ verdict }: { readonly verdict: string }) {
  const announce = useAnnounce();

  async function copy() {
    try {
      await navigator.clipboard.writeText(verdict);
      announce(COPY_ANNOUNCEMENT);
    } catch {
      // Total: a rejected clipboard write is swallowed. The muted announce keeps a screen-reader
      // user from waiting on a confirmation that will never arrive; it never throws or opens a dialog.
      announce(COPY_FAILED_ANNOUNCEMENT);
    }
  }

  return (
    <button
      type="button"
      aria-label="Copy answer"
      onClick={copy}
      // A ghost button (no border/fill), but `-m-1 p-1` grows the hit area to 24×24 (16px glyph +
      // 8px padding) so it meets WCAG 2.2 AA § 2.5.8 (Target Size Minimum) outright rather than
      // leaning on the undocumented-spacing exception; the negative margin keeps the glyph visually
      // flush in the header row. `focus-visible` mirrors `hover` so the keyboard affordance matches
      // the pointer one (the UA focus ring already satisfies 2.4.7 — this is the same color cue).
      className="-m-1 rounded p-1 text-ink-faint hover:text-primary focus-visible:text-primary"
    >
      <CopyGlyph />
    </button>
  );
}
