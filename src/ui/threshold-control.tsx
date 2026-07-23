'use client';

import { useState, useTransition } from 'react';

import type { UpdateThresholdResult } from '@/application/use-cases/settings';
import { useAnnounce } from '@/ui/announcer';

/**
 * The CAP-6 threshold control (DR10, Settings) — the ONE deliberate act by which "how far is far"
 * changes. It shows the current persisted percent and lets an HR manager edit it and press an
 * explicit **Apply**; a `Reset to default (20%)` secondary path Applies `20`. There is NO live
 * slider and no auto-apply — changing the threshold is always a considered submit, kept OFF the
 * sweep (project-context § Conventions; the Settings surface never runs the outlier sweep).
 *
 * ## A `"use client"` island calling the Server Action (mirrors `as-of-control.tsx`)
 *
 * The write is a Server Action (`applyThresholdAction`, AD-21), HANDED IN AS A PROP from the Settings
 * page's composition root — `src/ui` may not import `@/app/*` (import-boundary lint), exactly as
 * `employee-form-panel` receives its create/update action. This island coerces nothing the server
 * trusts: it hands the entered number to the action, whose use-case validates the `[1, 100]`
 * integer BEFORE any database write. On `applied` it announces `Threshold updated to {n}%` through
 * the SINGLE app-level polite live region in `<Announcer>` (mounted in the root layout, never
 * remounted, AD-20) — the same plumbing the as-of control and copy-answer use — so the confirmation
 * is spoken without a second live region. A `rejected` / `unavailable` result surfaces a calm inline
 * message near the field, never `role="alert"`, never a JS `alert`/`confirm`/`prompt`, never a
 * dialog.
 *
 * ## Why the Apply rides a transition
 *
 * `startTransition` keeps the current control on screen while the action runs and the two paths
 * (`/` and `/settings`) revalidate, so the value swaps in place rather than blanking — the same
 * recompute-in-place discipline as the as-of change (AD-20).
 *
 * ## Accessibility (WCAG 2.2 AA)
 *
 * A labelled native number input (`min=1 max=100 step=1`, a stepper, not a slider), a real submit
 * button with visible text, and the reset as a second button. The inline status is associated with
 * the input via `aria-describedby` so it is announced when focus is on the field. Semantic tokens
 * only, light + dark (each name re-points itself under `prefers-color-scheme`, so no `dark:`
 * variant) — no hex, no shadow.
 */

const LABEL = 'OUTLIER THRESHOLD';
const DEFAULT_THRESHOLD_PCT = 20;

const MIN_THRESHOLD_PCT = 1;
const MAX_THRESHOLD_PCT = 100;

const INPUT_ID = 'outlier-threshold';
const STATUS_ID = 'outlier-threshold-status';

/** The calm inline copy for the two non-applied outcomes — statements, never alerts. */
const REJECTED_MESSAGE = `Enter a whole number between ${MIN_THRESHOLD_PCT} and ${MAX_THRESHOLD_PCT}.`;
const UNAVAILABLE_MESSAGE = 'The threshold could not be saved right now. Nothing has changed.';

type Status = { readonly kind: 'idle' } | { readonly kind: 'message'; readonly text: string };

/**
 * The Apply Server Action, as this island consumes it — handed in from the composition root so
 * `src/ui` imports no `@/app/*`. Its argument is `unknown` because a `'use server'` endpoint erases
 * its argument type at runtime (the use-case coerces and validates).
 */
export type ApplyThresholdAction = (input: unknown) => Promise<UpdateThresholdResult>;

export function ThresholdControl({
  current,
  action,
}: {
  readonly current: number;
  readonly action: ApplyThresholdAction;
}) {
  const announce = useAnnounce();
  const [draft, setDraft] = useState(String(current));
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [isPending, startTransition] = useTransition();

  /**
   * Apply one value through the Server Action. Shared by the form submit (the edited draft) and the
   * reset (a literal `20`). The action's use-case is the sole validator; this only reflects the
   * outcome — announce on success, a calm inline message otherwise.
   */
  function apply(value: number) {
    startTransition(async () => {
      let result: UpdateThresholdResult;
      try {
        result = await action(value);
      } catch {
        // The ACTION is total — the use-case maps everything to a returned arm. The TRANSPORT is
        // not: a `'use server'` call can still reject at the network/RPC layer, independent of the
        // action's own code. Caught locally so it is never an unhandled rejection and the same calm
        // outage message is spoken — the discipline every other action-calling island here holds to.
        result = { kind: 'unavailable' };
      }
      if (result.kind === 'applied') {
        setDraft(String(result.value));
        setStatus({ kind: 'idle' });
        announce(`Threshold updated to ${result.value}%`);
        return;
      }
      // The outcome the reader most needs read aloud is a failure, and after Apply focus is on the
      // button, not the field — so `aria-describedby` alone would leave a rejection/outage silent.
      // Route the SAME calm text through the single polite live region (never `role="alert"`), in
      // addition to the inline message, so it is announced regardless of where focus sits.
      const text = result.kind === 'rejected' ? REJECTED_MESSAGE : UNAVAILABLE_MESSAGE;
      setStatus({ kind: 'message', text });
      announce(text);
    });
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A number the use-case then judges; an empty or non-numeric field becomes NaN and is rejected
    // there (no write), so this island never decides validity.
    apply(draft.trim() === '' ? Number.NaN : Number(draft));
  }

  return (
    <section aria-labelledby="outlier-threshold-heading" className="rounded border border-border-hairline bg-surface-card p-4">
      <h2 id="outlier-threshold-heading" className="text-label-caps uppercase text-ink-muted">
        {LABEL}
      </h2>

      <p className="mt-2 text-body-sm text-ink-muted">
        Currently{' '}
        <span className="font-mono text-number-sm text-ink">{current}%</span> — findings flag anyone
        this far from their peer median, in either direction.
      </p>

      <form onSubmit={onSubmit} className="mt-4 flex flex-wrap items-end gap-gutter">
        <div>
          <label htmlFor={INPUT_ID} className="block text-label-caps uppercase text-ink-muted">
            Threshold %
          </label>
          <input
            id={INPUT_ID}
            name="thresholdPct"
            type="number"
            inputMode="numeric"
            min={MIN_THRESHOLD_PCT}
            max={MAX_THRESHOLD_PCT}
            step={1}
            value={draft}
            aria-describedby={STATUS_ID}
            onChange={(event) => setDraft(event.target.value)}
            className="mt-1 block w-24 rounded border border-input-border bg-surface-card px-3 py-2 font-mono text-number-sm text-ink focus:border-primary"
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-primary px-3 py-2 text-body-md text-primary-foreground"
        >
          Apply
        </button>

        <button
          type="button"
          disabled={isPending}
          onClick={() => apply(DEFAULT_THRESHOLD_PCT)}
          className="rounded border border-input-border px-3 py-2 text-body-md text-ink-muted hover:text-ink"
        >
          Reset to default ({DEFAULT_THRESHOLD_PCT}%)
        </button>
      </form>

      {/* Calm inline status — a statement, never `role="alert"`. Empty until an outcome needs it. */}
      <p id={STATUS_ID} className="mt-2 text-body-sm text-ink-muted">
        {status.kind === 'message' ? status.text : ''}
      </p>
    </section>
  );
}
