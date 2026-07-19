import type { PlainDate } from '@/domain/plain-date';

/**
 * The clock port AD-11 has been promising since story 1-1 — the ONE source of "now" in the
 * application, and the reason `src/domain/**` and `src/application/**` can be, and are, clock-free.
 * (Law 6 / AD-11, AD-19)
 *
 * The port is declared here and implemented ONLY in an adapter (`src/adapters/clock.ts`, the single
 * file in the repository permitted to read `Date`). A boundary — a Server Component, a Server
 * Action — calls `todayUtc()` once and passes the result INWARD as an argument. Nothing downstream
 * ever asks what day it is; it is told.
 *
 * "Today" is the current date in **UTC**, not in the viewer's zone. One organisation, one calendar:
 * if today depended on where the browser was, the same URL would produce two different answers, and
 * "same data + same as-of ⇒ same answer" would stop being true.
 *
 * The return is a `PlainDate`, never a `Date` and never a timestamp — the instant is discarded at
 * the only place that ever held it, so no time-of-day can leak into a calendar comparison.
 */
export type Clock = {
  readonly todayUtc: () => PlainDate;
};
