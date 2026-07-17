# Accessibility Review — Salary Management for ACME HR

Lens: ACCESSIBILITY (BMad UX Finalize validation). Reviewed 2026-07-17.
Targets: `DESIGN.md` (token contrast, computed), `EXPERIENCE.md` (behavioral commitments), spot-checks of `imports/stitch/screen-01-home-sweep.html` and `imports/stitch/screen-11-add-employee.html` (non-normative; gaps recorded against the spines).

Claimed floor: WCAG 2.2 AA. Contrast method: WCAG relative-luminance ratio. Thresholds: 4.5:1 body text, 3:1 large text (≥18.66px bold / 24px) and non-text UI (1.4.11).

## Verified passing (for the record)

| Pair | Light | Dark |
|---|---|---|
| ink on surface-base / card / tint | 16.37 / 17.13 / 15.63 | 14.48 / 11.87 / 8.40 |
| ink-muted on surface-base / card | 8.89 / 9.30 | 6.96 / 5.71 |
| primary-foreground on primary | 14.63 | 14.48 |
| **amber-badge-text on amber-badge-bg** | **4.84** (#b45309 on #fffbeb) | **10.11** (#fcd34d on #422006) |
| ink-muted on refusal-fill (light) | 8.49 | — (fails dark, see A3) |

Amber badge text passes AA in both modes at number-sm (12px). Color-independence of the outlier signal is genuinely satisfied: DESIGN.md (Components → Outlier badge) mandates the signed distance and direction **in words** ("+28.4% above median"), and the mock renders exactly that. No red/green semantics anywhere. Good.

---

## BLOCKER

### A1 — ink-faint fails AA as body/metadata text in both modes
- **WCAG:** 1.4.3 Contrast (Minimum)
- **Location:** `DESIGN.md` frontmatter `ink-faint: '#75777d'` / `ink-faint-dark: '#64748b'`; Colors section assigns the ramp "data, supporting copy, **metadata**" — i.e. text duty at body-sm/number-sm (12px, not large).
- **Evidence (computed):**
  - Light #75777d: 4.28 on surface-base #f8fafc, **4.48** on surface-card #ffffff, **4.09** on surface-tint #f1f5f9 — all below 4.5.
  - Dark #64748b: 3.75 on base #0f172a, **3.07** on card #1e293b, **2.18** on tint #334155 — the tint pairing fails even the 3:1 large-text bar.
  - Concrete mock instance: screen-01 refusal row, "L6 Legal · IT" set in `text-outline` (#75777d) on the #F1F5F9 refusal fill = **4.09:1** at 12px.
- **Fix:** Retoken `ink-faint` → **#5f6672** (5.28 on tint, 5.78 on white) and `ink-faint-dark` → **#8494ab** (4.74 on card, 5.79 on base; still keep it off surface-tint-dark). Alternatively add a spine sentence to DESIGN.md Colors: "ink-faint is reserved for iconography and large text; it never sets copy at body-sm/number-sm sizes" — but then the copy-answer resting icon (#75777d = 4.48 ≥ 3:1 light) passes 1.4.11 while every current 12px use must move to ink-muted.

### A2 — accent-indigo "in range" badge text fails AA at 12px
- **WCAG:** 1.4.3
- **Location:** `DESIGN.md` Components → Outlier badge: "The indigo counterpart (`in range`) uses {colors.accent-indigo} text on {colors.surface-tint}" — number-sm, 12px.
- **Evidence (computed):** #6366f1 on #f1f5f9 = **4.08**; on #ffffff = 4.47; on #f8fafc = 4.27. Dark: #818cf8 on #334155 = **3.47** (passes only on base 5.98 / card 4.90, not on the tint the badge actually sits on).
- **Fix:** Retoken `accent-indigo` → **#4f46e5** (indigo-600: 5.74 on tint, 6.29 on white) and `accent-indigo-dark` → **#a5b4fc** (5.19 on tint-dark). Semantics unchanged; hue family preserved.

### A3 — Dark-mode refusal panel body text fails AA — the hero trust state
- **WCAG:** 1.4.3
- **Location:** `DESIGN.md` component `refusal-panel` (foreground {colors.ink-muted} on {colors.refusal-fill}); dark set maps to #94a3b8 on #334155. Same pair governs any ink-muted text on surface-tint-dark (row hover, section tints).
- **Evidence (computed):** #94a3b8 on #334155 = **4.04** at body-md/body-sm (14/12px). Light equivalent passes at 8.49. EXPERIENCE.md stakes the product on "honest refusal is the trust-building moment"; in dark mode that moment is sub-AA.
- **Fix:** Either lighten refusal foreground in dark to **#aab7c9** (5.09) / use ink-dark #e2e8f0 (8.40), or darken `refusal-fill-dark` toward #283548. Add to DESIGN.md Dark mode note: "every `*-dark` text/surface pair must be re-verified ≥4.5:1 before the provisional flag is removed" — the note currently says "treat as provisional" without a contrast acceptance test.

---

## SHOULD-FIX

### A4 — Input boundaries invisible at 1.4.11 non-text contrast
- **WCAG:** 1.4.11 Non-text Contrast
- **Location:** `DESIGN.md` Components → Inputs: "1px {colors.border-hairline} border … focus ring shifts border to {colors.primary}".
- **Evidence (computed):** border-hairline #e2e8f0 on card #ffffff = **1.23**; even border-strong #cbd5e1 = **1.48**. Dark: border-hairline-dark #334155 on card-dark #1e293b = **1.41**; border-strong-dark = 1.93. A white-on-white input whose only boundary is a 1.23:1 hairline is not perceivable; focus state (14:1) is fine, resting identification is not.
- **Fix:** Add an `input-border` token ≥3:1 for resting form controls — e.g. **#8494a9** (3.09 on white) light, **#64748b** (3.07 on card-dark) dark — leaving hairlines for decorative rules and table dividers, where 1.4.11 does not apply.

### A5 — Side-panel focus management unspecified
- **WCAG:** 2.4.3 Focus Order, 2.1.2 No Keyboard Trap, 4.1.2 Name/Role/Value
- **Location:** `EXPERIENCE.md` Interaction Primitives covers `Esc` closes and "modal stacks one level deep" but never states: initial focus on open, focus containment while open, focus return to the invoking control on close, or dialog semantics (`role="dialog"`, `aria-modal`, accessible name). Mock screen-11 confirms the gap: the Add-employee `<aside>` has no dialog role, no aria-modal, the dimming overlay does not make the background inert, and the close button is an unnamed icon.
- **Fix:** Add one spine sentence to Interaction Primitives: "Side panels and modals are `role=dialog` with an accessible name, take focus on open, contain Tab, and return focus to the invoking control on close (Esc included)."

### A6 — Form labels not required to be programmatically associated
- **WCAG:** 1.3.1 Info and Relationships, 3.3.2 Labels or Instructions
- **Location:** `EXPERIENCE.md` Accessibility Floor requires table header markup but says nothing about form label association. Mock screen-11: every `<label>` lacks `for`/`id` association with its input/select; the "Currency follows country: INR" hint and the in-field "INR" suffix are unassociated (no `aria-describedby`).
- **Fix:** Add to Accessibility Floor: "Every form control has a programmatically associated label; helper text (currency-follows-country, `Enter to save · Esc to cancel`) is linked via `aria-describedby`."

### A7 — Pulse charts are color-only with no required text equivalent
- **WCAG:** 1.4.1 Use of Color, 1.1.1 Non-text Content
- **Location:** `DESIGN.md` Components → Pulse charts: "{colors.primary} / {colors.border-hairline} pairs … no legends beyond a caps label". Mock screen-01: gender-by-level segments are bare `<div>`s distinguished solely by fill, values exposed only via `title` attributes (not reliably readable); the border-hairline segment is also 1.23:1 against the card, sub-1.4.11 for a graphical object. EXPERIENCE.md's Gender Insights row promises "gender counts per level org-wide" — counts exist as a surface, but **neither spine states the chart data is available as an accessible table/text equivalent**, and the Home pulse has no such fallback at all.
- **Fix:** Add to EXPERIENCE.md Accessibility Floor: "Every pulse chart's underlying counts are exposed as a proper data table (visible on Gender Insights; visually-hidden or adjacent text on Home)." In DESIGN.md, swap the second segment fill from border-hairline to border-strong or a patterned fill ≥3:1.

### A8 — Copy-answer success is never announced
- **WCAG:** 4.1.3 Status Messages
- **Location:** `EXPERIENCE.md` Accessibility Floor specifies `aria-live=polite` for as-of/threshold recomputation only; the copy-answer affordance (Flow 2's climax) has no specified confirmation, visual or announced.
- **Fix:** Add: "Activating copy-answer announces 'Answer copied' via the same polite live region (and shows a transient non-color-only confirmation)."

### A9 — As-of date control has no accessible-name requirement
- **WCAG:** 4.1.2, 2.4.6
- **Location:** `DESIGN.md` `as-of-control` ("calendar glyph + `As of 16 Jul 2026` … dropdown affordance"); EXPERIENCE.md calls it "both a control and ambient provenance" but neither spine requires the interactive element be named. Mock screen-11 renders it as static text plus a bare icon-only `calendar_today` button; screen-01 renders it as plain text — not a control at all.
- **Fix:** Spine sentence: "The as-of control is a single named button (`aria-label`/visible text 'As of 16 Jul 2026 — change as-of date') that opens the date picker; the glyph is decorative (`aria-hidden`)."

### A10 — `/` shortcut lacks a 2.1.4 escape hatch
- **WCAG:** 2.1.4 Character Key Shortcuts
- **Location:** `EXPERIENCE.md` Interaction Primitives: "`/` — focus the search field on any surface".
- **Fix:** Append: "active only when focus is not in an editable field" (sufficient for 2.1.4 as a focus-scoped shortcut, but state it — otherwise a speech-input or accidental keystroke steals focus mid-entry).

---

## NIT

### A11 — No bypass-blocks requirement
- **WCAG:** 2.4.1. The fixed 256px sidebar repeats on every screen; neither spine requires a skip-to-content link or landmark commitment (mocks use `<nav>/<main>` — good, but unrequired). Add "skip link + landmark regions" to the Accessibility Floor.

### A12 — Active nav state is visual-only
- **WCAG:** 1.3.1. Mocks mark the current page with bold + border only; spine should require `aria-current="page"`.

### A13 — Dangling token references in DESIGN.md prose
`{colors.error}` (Colors, Components → Refusal panel) and `{colors.secondary}` (Components → Pulse charts) are referenced but undefined in frontmatter. Harmless for `error` (used as a prohibition) but `secondary` is a real fill the pulse charts depend on — define it (mocks use #505f76) or reword.

### A14 — screen-01 structural nits (against the mock, non-normative)
Metric-card `<h3>`s precede the main content `<h2>`s (heading order); table `<th>` lack `scope="col"` (tolerable in a single-`thead` table); the inline refusal row is a `colspan=4` div soup that loses the row's column semantics. None are spine violations once A5–A7 sentences land; listed for the build phase.

### A15 — amber-badge-border near-invisible (1.11:1)
Decorative only — the badge is identified by fill + text which both pass, so no 1.4.11 failure. No action needed; recorded so nobody "fixes" the text token instead.

---

## Summary

| Severity | Count | IDs |
|---|---|---|
| BLOCKER | 3 | A1, A2, A3 |
| SHOULD-FIX | 7 | A4–A10 |
| NIT | 5 | A11–A15 |

The AA floor claim is currently false in both modes for three defined text tokens; all three are fixable by retokening alone (no layout change). Dark mode is the weak flank: it was derived, never rendered, and its worst pair (ink-faint-dark on tint-dark, 2.18:1) fails even the large-text bar. The behavioral spine is unusually strong (refusal-as-region not alert, live-region recompute, worded direction on badges) — the gaps are the unstated mechanics: dialogs, labels, announcements, names.

---

## Resolution log

Resolved 2026-07-17 (finalize pass). Retokening only — no semantic or layout changes.

| Finding | Status | Note |
|---|---|---|
| A1 | RESOLVED | `ink-faint` → **#5f6672** (worst 5.28:1 on surface-tint); `ink-faint-dark` → **#a3b0c4** (worst 4.72:1 on surface-tint-dark). |
| A2 | RESOLVED | `accent-indigo` → **#4f46e5** (5.74:1 on surface-tint); `accent-indigo-dark` → **#a5b4fc** (5.19:1 on surface-tint-dark). |
| A3 | RESOLVED | `ink-muted-dark` → **#b4c0d0** (5.62:1 on refusal-fill-dark #334155); Dark-mode note now requires every `*-dark` pair to re-verify ≥4.5:1 before the provisional flag is removed. |
| A4 | RESOLVED | New `input-border` **#8494a9** (3.09:1 on white) / `input-border-dark` **#8494ab** (4.74:1 on card-dark); Inputs spec now uses it, hairlines demoted to decorative rules/dividers. |
| A5 | RESOLVED | Interaction Primitives: side panels/modals are `role="dialog"` with accessible name, focus on open, Tab containment, focus return on close. |
| A6 | RESOLVED | Accessibility Floor: programmatic label association + `aria-describedby` for helper text. |
| A7 | RESOLVED | Accessibility Floor: pulse-chart counts exposed as a data table (visible on Gender Insights, hidden/adjacent on Home); second fill retokened to `{colors.secondary}` ≥3:1. |
| A8 | RESOLVED | Copy-answer announces "Answer copied" via the polite live region + non-color-only visual confirmation. |
| A9 | RESOLVED | As-of control specified as a single named button; glyph decorative (`aria-hidden`). |
| A10 | RESOLVED | `/` shortcut active only while focus is outside editable fields (focus-scoped per 2.1.4). |
| A11 | RESOLVED | Skip-to-content link + `nav`/`main` landmark commitment added to Accessibility Floor. |
| A12 | RESOLVED | Active nav item carries `aria-current="page"`. |
| A13 | RESOLVED | Via rubric B2/S1: `secondary` defined; `error` references reworded without brace syntax. |
| A14 | SKIPPED (NIT) | Mock-only structural notes for the build phase; mocks are non-normative and the spine sentences from A5–A7 now govern. |
| A15 | SKIPPED (NIT) | Explicitly "no action needed" — decorative badge border recorded so the text token isn't "fixed" by mistake. |

## Appendix — verified contrast matrix after retokening (computed 2026-07-17)

WCAG relative-luminance ratios over every ink × surface pair, both modes. Floor: 4.5:1 text, 3:1 non-text.

| Text token | on base | on card | on tint/refusal |
|---|---|---|---|
| ink #191c1e (light) | 16.37 | 17.13 | 15.63 |
| ink-muted #45474c (light) | 8.89 | 9.30 | 8.49 |
| ink-faint #5f6672 (light, NEW) | 5.53 | 5.78 | **5.28** |
| accent-indigo #4f46e5 (light, NEW) | 6.01 | 6.29 | 5.74 |
| primary #1e293b (light) | 13.98 | 14.63 | 13.35 |
| ink-dark #e2e8f0 | 14.48 | 11.87 | 8.40 |
| ink-muted-dark #b4c0d0 (NEW) | 9.68 | 7.94 | 5.62 |
| ink-faint-dark #a3b0c4 (NEW) | 8.13 | 6.66 | **4.72** |
| accent-indigo-dark #a5b4fc (NEW) | 8.96 | 7.34 | 5.19 |
| primary-dark #e2e8f0 | 14.48 | 11.87 | 8.40 |

Special pairs: amber-badge-text on amber-badge-bg 4.84 light / 10.11 dark; primary-foreground on primary 14.63 light / 14.48 dark; secondary fill 4.76 on card / 4.55 on base light, secondary-dark 4.74 on card-dark / 5.79 on base-dark (3:1 floor); input-border 3.09 on card light, input-border-dark 4.74 on card-dark; copy-answer resting icon 5.28 on tint (3:1 floor).

**Every pair passes.** Worst remaining: light — ink-faint on surface-tint **5.28:1**; dark — ink-faint-dark on surface-tint-dark **4.72:1**.
