'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

import { resolveAsOf } from '@/application/as-of';
import { formatPlainDate, plainDateToIso, type PlainDate } from '@/domain/plain-date';
import { useAnnounce } from '@/ui/announcer';

/**
 * The global as-of date control — persistent, right-aligned, on every screen (DESIGN
 * § Components → As-of date control). It is both a CONTROL and ambient provenance: the date it
 * shows is the date every figure on the page was computed at.
 *
 * ## Where the as-of date lives
 *
 * In the URL, as `?asOf=YYYY-MM-DD`, resolved server-side at the delivery boundary. That follows
 * from constraints already ratified — reads are Server Components calling inward in-process
 * (AD-21), and determinism (AD-11 / AD-19) wants the as-of date visible in the address bar so a
 * view is reproducible, bookmarkable, and shareable. `resolveAsOf` is the whole policy; this
 * component never decides what a param means.
 *
 * ## Why the change rides a transition
 *
 * `router.push` to the SAME route with a new param re-renders the page but does not remount the
 * layout, so the live region in `<Announcer>` is a stable node and values swap in place rather than
 * returning to skeleton (AD-20; EXPERIENCE § Cross-cutting state patterns: "recomputation swaps
 * values in place"). `startTransition` is what keeps the current content on screen while the new
 * content is prepared, instead of blanking it.
 *
 * ## Accessibility
 *
 * One named button, not an icon (WCAG 2.2 AA). Its accessible name carries both the current date
 * and the action — `As of 16 Jul 2026 — change as-of date` — and BEGINS with the visible text, so
 * SC 2.5.3 Label in Name holds. The calendar glyph is decorative and `aria-hidden`; it adds nothing
 * a screen reader needs and would otherwise be read as a stray graphic.
 *
 * The panel sits on `surface-card` deliberately, not on `surface-base` or `surface-tint`:
 * `input-border` measures 3.09:1 on card but only 2.96:1 and 2.82:1 on the other two, below
 * DESIGN's own 3:1 non-text floor. Recorded in deferred-work.md; this is the layout that stays
 * inside the floor without amending a document this story may not amend.
 *
 * No `react-day-picker`, no `@radix-ui/*`, no shadcn copy-in. A native `<input type="date">` is
 * fully keyboard-accessible, inherits the `color-scheme` declared in globals.css, adds nothing to
 * the bundle, and — unlike shadcn's Tailwind v4 templates, which ship `oklch` literals, a second
 * set of variable names, and a `.dark` class block — violates nothing.
 */

const ANNOUNCE_PREFIX = 'Findings updated as of';

function CalendarGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="2.5" y="3.5" width="11" height="10" rx="1" />
      <path d="M2.5 6.5h11M5.5 1.5v3M10.5 1.5v3" />
    </svg>
  );
}

export function AsOfControl({ today }: { today: PlainDate }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const announce = useAnnounce();

  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [, startTransition] = useTransition();
  const buttonRef = useRef<HTMLButtonElement>(null);

  // `getAll`, not `get`: a repeated param is ambiguous, and `resolveAsOf` is the one place that
  // decides so. Reading the URL rather than a prop is what makes a pasted link reproduce the view.
  const asOf = resolveAsOf(searchParams.getAll('asOf'), today);
  const asOfIso = plainDateToIso(asOf);
  const asOfLabel = formatPlainDate(asOf);
  const todayIso = plainDateToIso(today);

  function open() {
    setDraft(asOfIso);
    setIsOpen(true);
  }

  /** Close and return focus to the button — Esc must never strand focus on a removed element. */
  function close() {
    setIsOpen(false);
    buttonRef.current?.focus();
  }

  function commit() {
    // Resolved, not trusted: the native input can be typed into as well as picked from, and a
    // future or malformed value must land on today rather than on an error surface.
    const chosen = resolveAsOf(draft, today);
    close();

    startTransition(() => {
      router.push(`${pathname}?asOf=${plainDateToIso(chosen)}`);
      announce(`${ANNOUNCE_PREFIX} ${formatPlainDate(chosen)}`);
    });
  }

  return (
    <div
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && isOpen) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`As of ${asOfLabel} — change as-of date`}
        onClick={() => (isOpen ? close() : open())}
        className="flex items-center gap-2 rounded border border-input-border bg-surface-card px-3 py-2 text-ink-muted hover:text-ink"
      >
        <CalendarGlyph />
        <span className="text-body-sm">As of</span>
        {/* All numerals are JetBrains Mono, dates in data positions included (DESIGN
            § Typography). `<time>` also gives the date a machine-readable value. */}
        <time dateTime={asOfIso} className="font-mono text-number-sm">
          {asOfLabel}
        </time>
      </button>

      {isOpen ? (
        <div
          role="dialog"
          aria-label="Change as-of date"
          className="absolute top-full right-0 z-30 mt-2 rounded border border-border-strong bg-surface-card p-3"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              commit();
            }}
          >
            <label htmlFor="as-of-date" className="block text-label-caps text-ink-muted uppercase">
              As-of date
            </label>
            <input
              id="as-of-date"
              name="asOf"
              type="date"
              autoFocus
              value={draft}
              // A future as-of date is meaningless — no salary record may be effective-dated ahead
              // of today (Law 5 / AD-18). The native picker enforces it; `resolveAsOf` clamps
              // anything that gets past it.
              max={todayIso}
              aria-describedby="as-of-help"
              onChange={(event) => setDraft(event.target.value)}
              className="mt-1 block rounded border border-input-border bg-surface-card px-3 py-2 font-mono text-number-sm text-ink"
            />
            <p id="as-of-help" className="mt-1 text-body-sm text-ink-muted">
              Enter to apply · Esc to cancel
            </p>
            <button
              type="submit"
              className="mt-3 w-full rounded bg-primary px-3 py-2 text-body-md text-primary-foreground"
            >
              Apply
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
