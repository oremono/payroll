'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type KeyboardEvent as ReactKeyboardEvent } from 'react';

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
 * The panel is a real modal, and holds up all three halves of EXPERIENCE § Interaction Primitives'
 * dialog contract: it takes focus on open (the input autofocuses), it CONTAINS `Tab` while open,
 * and it returns focus to the trigger on close. It also dismisses on an outside pointer press —
 * without which a click into `main` left it open and left `aria-expanded="true"` asserting
 * something false. (Containment and dismissal added by code review 2026-07-19; the role was
 * claiming a contract the component did not keep.)
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

/**
 * Everything inside the dialog that can hold focus, in DOM order.
 *
 * Queried live on every `Tab` rather than captured once: the popover's contents are small but they
 * are React-rendered, and a list captured at open time would go stale the moment anything inside it
 * became conditional. `[tabindex="-1"]` is excluded because it marks an element that is
 * programmatically focusable but deliberately NOT in the Tab sequence.
 */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

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

  /**
   * Close WITHOUT moving focus. Used only for an outside pointer press, where the person has just
   * chosen where they want to be: yanking focus back to the trigger would undo their own click.
   * Every keyboard path (Esc, the second Enter on the trigger, Apply) still goes through `close`,
   * so the "returns focus to the invoking control" half of EXPERIENCE § Interaction Primitives is
   * untouched.
   */
  function dismiss() {
    setIsOpen(false);
  }

  /**
   * Dismiss on an outside pointer press (code review 2026-07-19).
   *
   * Without this the popover stayed open when the person clicked into `main` — and, worse, the
   * trigger kept asserting `aria-expanded="true"`, which is a statement about the document that was
   * simply false. `pointerdown` rather than `click`: dismissal should follow the press, the way it
   * does in every other popover in the world, and a `click` listener would also fire after a drag
   * that merely ended outside.
   *
   * The whole control — trigger AND panel — is "inside". A press on the trigger must reach the
   * button's own `onClick` toggle rather than being closed here and immediately reopened.
   */
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function onPointerDown(event: PointerEvent) {
      const root = rootRef.current;
      if (root !== null && event.target instanceof Node && !root.contains(event.target)) {
        dismiss();
      }
    }

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  /**
   * Contain `Tab` inside the open dialog (code review 2026-07-19).
   *
   * EXPERIENCE § Interaction Primitives: modals "take focus on open, contain `Tab` while open, and
   * return focus to the invoking control on close". Only the first and third held. A `role="dialog"`
   * that lets `Tab` walk out into the page behind it tells a screen reader it is a modal and then
   * behaves like a tooltip — the assistive-technology contract and the actual behaviour disagree,
   * which is worse than never having claimed the role.
   *
   * The wrap is computed from the LIVE focusable list rather than from remembered endpoints, so it
   * stays correct if the panel's contents ever change.
   */
  function onDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') {
      return;
    }

    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }

    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) {
      return;
    }

    const active = document.activeElement;
    // A focus that is somehow already outside the dialog is pulled back in on the next Tab rather
    // than left where it is — containment, not merely edge-wrapping.
    if (event.shiftKey) {
      if (active === first || active === null || !dialog.contains(active)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (active === last || active === null || !dialog.contains(active)) {
      event.preventDefault();
      first.focus();
    }
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
      ref={rootRef}
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
          ref={dialogRef}
          role="dialog"
          aria-label="Change as-of date"
          onKeyDown={onDialogKeyDown}
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
