/**
 * Clock adapter — the ONLY sanctioned home for `Date.now()` / `new Date()` in the entire codebase.
 *
 * Nothing in `src/domain/**` or `src/application/**` may read the clock; they take the as-of date as
 * an explicit argument (Law 6 / AD-11, AD-19). When a boundary needs "now", it comes from here — and
 * "today" is the current date in UTC.
 *
 * Story 1-1 sets this seam only. The real implementation (and its `Clock` port in
 * `src/application/ports/`) is wired up in a later story; until then this stub throws so nothing
 * depends on an un-built clock by accident.
 */
export function nowUtcDate(): never {
  throw new Error('clock adapter not implemented in Story 1-1 — wired up in a later story');
}
