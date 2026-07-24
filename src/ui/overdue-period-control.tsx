'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

import { overduePeriodToParam, resolveOverduePeriod } from '@/application/overdue-period';
import { useAnnounce } from '@/ui/announcer';
import { formatOverduePeriodLabel, PERIOD_PRESETS } from '@/ui/overdue-vm';

/**
 * The Overdue surface's period control — preset chips (1y / 18mo / 2y / 3y) plus a custom cutoff date
 * field. It mirrors `as-of-control.tsx`: the selection lives in the URL as `?period=`, resolved
 * server-side at the delivery boundary by the ONE `resolveOverduePeriod` policy, so a chip is a
 * period VALUE (not a separate code path) and a pasted link reproduces the view. This component never
 * decides what a param means.
 *
 * ## Where the period lives, and what a change does
 *
 * `?period=Nm` for a month preset, `?period=YYYY-MM-DD` for a custom cutoff — the canonical form
 * `overduePeriodToParam` produces and `resolveOverduePeriod` reads back. A change is MERGED into the
 * existing query (never rebuilt), so the ambient `?asOf=` survives; `?page=` is DROPPED, because a
 * new period is a new list and holding the old page number would land past its end. The push rides a
 * `startTransition` to the SAME route, so values swap in place and the app-level `<Announcer>` (a
 * stable node) speaks the recompute — no new live region.
 *
 * ## Accessibility
 *
 * Selection is conveyed by `aria-pressed`, so it never rides color alone (WCAG 2.2 AA). The chips are
 * a labelled group; the custom field is a native `<input type="date">` (fully keyboard-accessible,
 * inheriting the page `color-scheme`), with its own visible label and an Apply button, bounded by
 * `max={asOf}` — a cutoff AFTER the as-of would flag the whole population, so the picker forbids it.
 * On load the field is seeded from the URL, so a shared custom-cutoff link shows its active cutoff.
 */

const ANNOUNCE_PREFIX = 'Overdue list updated for';

/** A chip is selected when the resolved period is that exact month preset. A custom cutoff selects
 * none of the chips (there is no chip for it), which `aria-pressed="false"` states honestly. */
function isMonthsSelected(
  period: ReturnType<typeof resolveOverduePeriod>,
  months: number,
): boolean {
  return period.kind === 'months' && period.months === months;
}

export function OverduePeriodControl({ maxCutoff }: { readonly maxCutoff: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const announce = useAnnounce();

  // `getAll`, not `get`: a repeated param is ambiguous, and `resolveOverduePeriod` is the one place
  // that decides so. Reading the URL rather than a prop is what makes a pasted link reproduce the view.
  const period = resolveOverduePeriod(searchParams.getAll('period'));

  // Seed the custom-cutoff field from the URL so a shared/bookmarked custom-period link shows its
  // active cutoff in the control itself, not only in the list's receipts. A months preset selects a
  // chip instead, so the field stays empty. Initializer-only — a later chip click need not resync it.
  const [draft, setDraft] = useState(() =>
    period.kind === 'date' ? overduePeriodToParam(period) : '',
  );
  const [, startTransition] = useTransition();

  function commit(nextParam: string, label: string) {
    // MERGED into the existing query, never rebuilt — rebuilding as `?period=…` would destroy the
    // ambient `?asOf=`. `set` also collapses a repeated `period` to the one value that now holds.
    const query = new URLSearchParams(searchParams);
    query.set('period', nextParam);
    // A new period is a new list; the old page number would point past its end. Reset to page 1.
    query.delete('page');

    startTransition(() => {
      router.push(`${pathname}?${query.toString()}`);
      announce(`${ANNOUNCE_PREFIX} ${label}`);
    });
  }

  function applyCustom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Apply is a NO-OP on an empty field: pressing it with nothing typed must not silently switch to
    // (and announce) the default period the user never chose. A native date input yields either '' or
    // a valid `YYYY-MM-DD`, so an empty string is the only unselected state to guard.
    if (draft === '') {
      return;
    }
    // Resolved, not trusted: the native input can be typed into as well as picked from, and a
    // malformed value lands on the default period rather than an error surface.
    const resolved = resolveOverduePeriod(draft);
    commit(overduePeriodToParam(resolved), formatOverduePeriodLabel(resolved));
  }

  const CHIP_BASE = 'rounded border px-3 py-2 text-body-sm';
  const CHIP_SELECTED = `${CHIP_BASE} border-primary bg-primary text-primary-foreground`;
  const CHIP_UNSELECTED = `${CHIP_BASE} border-input-border bg-surface-card text-ink-muted hover:text-ink`;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div role="group" aria-label="Overdue period" className="flex flex-wrap gap-2">
        {PERIOD_PRESETS.map((preset) => {
          const selected = isMonthsSelected(period, preset.months);
          return (
            <button
              key={preset.months}
              type="button"
              aria-pressed={selected}
              onClick={() => commit(`${preset.months}m`, preset.label)}
              className={selected ? CHIP_SELECTED : CHIP_UNSELECTED}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <form onSubmit={applyCustom} className="flex items-end gap-2">
        <div>
          <label htmlFor="overdue-cutoff" className="block text-label-caps uppercase text-ink-muted">
            Custom cutoff
          </label>
          <input
            id="overdue-cutoff"
            name="period"
            type="date"
            max={maxCutoff}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="mt-1 block rounded border border-input-border bg-surface-card px-3 py-2 font-mono text-number-sm text-ink focus:border-primary"
          />
        </div>
        <button
          type="submit"
          className="rounded bg-primary px-3 py-2 text-body-sm text-primary-foreground"
        >
          Apply
        </button>
      </form>
    </div>
  );
}
