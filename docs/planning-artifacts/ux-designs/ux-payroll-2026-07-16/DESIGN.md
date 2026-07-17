---
status: final
updated: 2026-07-17
sources:
  - ../../briefs/brief-payroll-2026-07-16/brief.md
  - ../../../specs/spec-payroll/SPEC.md
name: Equilibrium Finance
description: Visual identity for Salary Management for ACME HR — a calm, data-dense financial broadsheet for one HR manager and 10,000 salaries. Owns HOW IT LOOKS; EXPERIENCE.md owns how it works.
colors:
  # --- Light (mocked in imports/stitch/) ---
  surface-base: '#f8fafc'
  surface-card: '#ffffff'
  surface-tint: '#f1f5f9'
  border-hairline: '#e2e8f0'
  border-strong: '#cbd5e1'
  input-border: '#8494a9'
  ink: '#191c1e'
  ink-muted: '#45474c'
  ink-faint: '#5f6672'
  primary: '#1e293b'
  primary-foreground: '#ffffff'
  secondary: '#64748b'
  accent-indigo: '#4f46e5'
  amber-badge-bg: '#fffbeb'
  amber-badge-border: '#fef3c7'
  amber-badge-text: '#b45309'
  refusal-fill: '#f1f5f9'
  # --- Dark (derived, not mocked — see Colors § Dark mode) ---
  surface-base-dark: '#0f172a'
  surface-card-dark: '#1e293b'
  surface-tint-dark: '#334155'
  border-hairline-dark: '#334155'
  border-strong-dark: '#475569'
  input-border-dark: '#8494ab'
  ink-dark: '#e2e8f0'
  ink-muted-dark: '#b4c0d0'
  ink-faint-dark: '#a3b0c4'
  primary-dark: '#e2e8f0'
  primary-foreground-dark: '#0f172a'
  secondary-dark: '#8494ab'
  accent-indigo-dark: '#a5b4fc'
  amber-badge-bg-dark: '#422006'
  amber-badge-border-dark: '#78350f'
  amber-badge-text-dark: '#fcd34d'
  refusal-fill-dark: '#334155'
typography:
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Hanken Grotesk
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  number-lg:
    fontFamily: JetBrains Mono
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  number-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  number-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-caps:
    fontFamily: Hanken Grotesk
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 12px
  container-margin: 24px
  cell-padding-v: 8px
  cell-padding-h: 12px
components:
  button-primary:
    background: '{colors.primary}'
    foreground: '{colors.primary-foreground}'
    radius: '{rounded.DEFAULT}'
  button-secondary:
    background: transparent
    border: '1px solid {colors.border-hairline}'
    foreground: '{colors.ink}'
    radius: '{rounded.DEFAULT}'
  outlier-badge:
    background: '{colors.amber-badge-bg}'
    border: '1px solid {colors.amber-badge-border}'
    foreground: '{colors.amber-badge-text}'
    radius: '{rounded.sm}'
    typography: '{typography.number-sm}'
  refusal-panel:
    background: '{colors.refusal-fill}'
    border: '1px solid {colors.border-hairline}'
    foreground: '{colors.ink-muted}'
    radius: '{rounded.DEFAULT}'
  provenance-caption:
    typography: '{typography.body-sm}'
    foreground: '{colors.ink-muted}'
  as-of-control:
    typography: '{typography.number-sm}'
    foreground: '{colors.ink-muted}'
    placement: global header, right side
  copy-answer:
    style: ghost icon button
    foreground: '{colors.ink-faint}'
    foreground-hover: '{colors.primary}'
  findings-row:
    height: 40px
    hover-background: '{colors.surface-tint}'
    numeric-typography: '{typography.number-sm}'
  timeline-list:
    row-height: 40px
    divider: '1px solid {colors.border-hairline}'
    numeric-typography: '{typography.number-md}'
  preset-chip:
    background: '{colors.surface-tint}'
    border: '1px solid {colors.border-strong}'
    foreground: '{colors.ink-muted}'
    radius: '{rounded.sm}'
    typography: '{typography.number-sm}'
---

# Equilibrium Finance — DESIGN.md

Visual contract for **Salary Management for ACME HR**. Adapted from the Stitch-generated "Equilibrium Finance" design system ([imports/stitch/design-system-equilibrium-finance.md](imports/stitch/design-system-equilibrium-finance.md)), with that document's two vocabulary infections stripped (see Do's and Don'ts). Composition references: the twelve mocks in [imports/stitch/](imports/stitch/MANIFEST.md) — this document and EXPERIENCE.md win over the mocks on any conflict.

## Brand & Style

Engineered for high-stakes salary work, prioritizing clarity over decoration. The personality is **calm, precise, unhurried** — Corporate/Modern with Data-Dense Minimalism, a "financial broadsheet" sensibility: orderly, information-rich, intellectually honest. The UI recedes to let data lead, using thin hairlines and subtle tonal shifts rather than chrome.

Density is a feature, not a compromise: this is a desktop-browser tool for one professional (Alice, ACME's HR manager) scanning 10,000 rows, not a consumer dashboard. Nothing celebrates, nothing nags, nothing animates for attention. The product's honesty is a visual property: numbers always arrive with their receipts (currency, group size, as-of date, pinned rate), and when the product cannot answer, the refusal is styled with the same dignity as an answer.

## Colors

A restrained professional palette on a near-white slate ladder.

- **{colors.surface-base}** — the L0 workspace background.
- **{colors.surface-card}** — L1 cards and tables, bounded by {colors.border-hairline}.
- **{colors.surface-tint}** — section tints, row hover, and the refusal fill. Quiet structure, never emphasis.
- **{colors.primary}** (deep slate) — navigation, headings, primary buttons. The product's "ink of authority."
- **{colors.ink}** / **{colors.ink-muted}** / **{colors.ink-faint}** — text ramp: data, supporting copy, metadata.
- **{colors.secondary}** (muted blue-gray) — the companion fill in pulse charts and other second-series graphics. Never a text color.
- **{colors.input-border}** — resting border for form controls only; hairlines stay on decorative rules and table dividers.
- **{colors.accent-indigo}** — standard highlight and "in range" status. The only decorative-adjacent hue, used sparingly.
- **Quiet Amber** ({colors.amber-badge-bg} / {colors.amber-badge-border} / {colors.amber-badge-text}) — outliers and attention states only. Amber means "beyond the threshold," never "error"; it appears if and only if distance from the peer median exceeds the configured threshold (boundary rules in EXPERIENCE.md § Component Patterns → Threshold control).
- **{colors.refusal-fill}** — refusal panels: a flat neutral tint with a hairline border (optionally a subtle diagonal hatch). Neutrality, not error; never grayed-out text, and never an error red — no error color exists in this system.
- **No red/green semantics anywhere.** Above-median and below-median are the same amber; success and failure are words, not colors.

### Contrast floor

All text/surface pairs meet WCAG 2.2 AA in both modes: ≥ 4.5:1 for body and numeric text (12–14px), ≥ 3:1 for large text and non-text UI (input borders, chart fills, icons). Verified by computation 2026-07-17 over the full ink × surface matrix; worst pairs are {colors.ink-faint} on {colors.surface-tint} (5.28:1 light) and {colors.ink-faint-dark} on {colors.surface-tint-dark} (4.72:1 dark). Any future token change must re-verify the matrix before shipping.

### Dark mode

> **Note: dark tokens are derived, not mocked.** Stitch rendered light only. The `*-dark` set in frontmatter was produced conservatively by inverting the surface ladder ({colors.surface-base-dark} base → {colors.surface-card-dark} cards → {colors.surface-tint-dark} tints) and keeping the amber/indigo semantics ({colors.amber-badge-text-dark}, {colors.accent-indigo-dark}). Primary buttons invert to light-fill/dark-text ({colors.primary-dark} on {colors.primary-foreground-dark}). Treat dark values as provisional until verified against real renders; they already pass the Contrast floor above by computation, and every `*-dark` text/surface pair must re-verify ≥ 4.5:1 before the provisional flag is removed. The semantic rules (amber = outlier, tint = refusal, no red/green) are binding in both modes. [ASSUMPTION] Exact dark hex values are my conservative derivation; only "dark mode is in scope for v1" is a recorded decision.

## Typography

- **Hanken Grotesk** for all UI labels, headings, and prose ({typography.headline-lg}, {typography.headline-md}, {typography.body-md}, {typography.body-sm}).
- **JetBrains Mono for ALL numerical data** — salaries, percentages, counts, dates in data positions ({typography.number-lg}, {typography.number-md}, {typography.number-sm}). Monospacing aligns columns of numbers for instant scanning; a proportional numeral anywhere in a data surface is a defect.
- **{typography.label-caps}** for table headers and metadata labels (e.g. `CURRENT SALARY`, `PEER COMPARISON`, `OUTLIER THRESHOLD`), tracked at 0.05em.
- Tight line heights throughout — density over airiness.

[ASSUMPTION] `number-lg` (24px mono) is regularized from the mocks' ad-hoc enlarged figures (hero salary on employee detail, home metric cards); the Stitch system doc listed only `number-md`/`number-sm`.

## Layout & Spacing

Fixed-fluid hybrid grid: fixed 256px side nav + fixed 64px header, fluid data workspace with {spacing.container-margin} margins and {spacing.gutter} gutters. Compact {spacing.unit} base scale; table cells pad {spacing.cell-padding-v} / {spacing.cell-padding-h}; table rows run 32–40px. White space is functional, not decorative.

Breakpoints: desktop 1280px+ is the primary surface (full table views, 12-column workspace grid); 768–1279px prioritizes columns and stacks card grids. This is a desktop web product — no mobile layout is specified.

## Elevation & Depth

**No shadows** — flat broadsheet aesthetic. Hierarchy comes from tonal layering and hairline borders: L0 {colors.surface-base}; L1 cards {colors.surface-card} with 1px {colors.border-hairline}; L2 modals {colors.surface-card} with 1px {colors.border-strong} and a subtle ambient backdrop blur. Side panels (e.g. Add employee) are L2 as well: {colors.surface-card} with a 1px {colors.border-strong} leading edge and the same dimmed backdrop, and they follow the modal Esc/stacking rules in EXPERIENCE.md § Interaction Primitives. Refusal panels are flat {colors.refusal-fill} (or subtle diagonal hatch) — depth never signals judgment.

## Shapes

Soft, document-like. Inputs and buttons at {rounded.DEFAULT} (4px); cards at {rounded.DEFAULT}; status badges at {rounded.sm} (2px, near-sharp — badges read as printed stamps, not pills); modals at {rounded.lg}. Data visualizations (pulse bars) use squared ends. {rounded.full} is reserved and currently unused — no pill shapes in v1.

## Components

Behavioral rules for every component live in EXPERIENCE.md; this section is visual anatomy only.

- **Outlier badge** — small rectangular stamp: {colors.amber-badge-bg} fill, 1px {colors.amber-badge-border}, {colors.amber-badge-text} text in {typography.number-sm}, {rounded.sm} corners. Text always carries signed distance and direction in words: `+28.4% above median` / `-25.2% below median`. One badge per finding regardless of direction. The indigo counterpart (`in range`) uses {colors.accent-indigo} text on {colors.surface-tint}. Reference: findings table in [imports/stitch/screen-01-home-sweep.html](imports/stitch/screen-01-home-sweep.html).
- **Refusal panel** — flat {colors.refusal-fill} block, 1px {colors.border-hairline}, {rounded.DEFAULT}, optional diagonal hatch. Headline in {typography.body-md} medium ({colors.ink-muted}); explanation in {typography.body-sm}. Full panel form on employee detail ([imports/stitch/screen-03b-refusal-tomas.html](imports/stitch/screen-03b-refusal-tomas.html)); inline row form inside the findings table (Elena Rossi row in screen-01). No warning icons, no error color (none exists), no italic apology styling beyond the inline row's single italic clause.
- **Provenance caption** — {typography.body-sm} in {colors.ink-muted}, sitting directly beneath any computed figure: `Based on 9 peers as of 16 Jul 2026`, `converted at rates pinned 01 Jul 2026`. Never separated from its number by more than one line of layout.
- **As-of date control** — persistent header element, right-aligned: calendar glyph + `As of 16 Jul 2026` in {typography.number-sm} {colors.ink-muted}, dropdown affordance. Always visible on every screen; it is ambient provenance, not a filter buried in toolbars.
- **Copy-answer affordance** — ghost icon button (`content_copy`) in the header row of the peer-comparison card, {colors.ink-faint} resting, {colors.primary} on hover, no border, no fill. Quietly present on both answer and refusal states.
- **Findings table row** — 40px row: employee name ({typography.body-md} medium, {colors.primary}), role · location ({typography.body-sm} {colors.ink-muted}), peer count right-aligned in {typography.number-sm}, outlier badge right-aligned. Hover {colors.surface-tint}. Sticky {typography.label-caps} header; 2px rules divide peer-group sections in grouped tables.
- **Timeline list** — chronological rows, newest first: effective date and amount-with-currency in {typography.number-md}, derived percent-change chip in {typography.number-sm}, `(Hire)` label on the first record. 1px {colors.border-hairline} dividers. No edit affordances on past rows — history is read-only ink.
- **Tabular data lists** — sticky headers, {colors.surface-tint} hover, monospaced numeric columns, right-aligned numbers.
- **Pulse charts** — compact bar strips (gender-by-level, payroll-by-country) in {colors.primary} / {colors.secondary} fill pairs (both ≥ 3:1 against their card); squared ends, no gridlines, no legends beyond a caps label. Static and non-interactive — Gender Insights is the drill-down; underlying counts are exposed per EXPERIENCE.md § Accessibility Floor.
- **Preset chip** — rectangular stamp, not a pill: {colors.surface-tint} fill, 1px {colors.border-strong}, {colors.ink-muted} text in {typography.number-sm}, {rounded.sm} corners. Selected state inverts to {colors.primary} fill with {colors.primary-foreground} text. Used for the Overdue period presets and the timeline's derived percent-change chip (the latter is display-only, never selectable).
- **CSV export affordance** — secondary button (hairline ghost) labeled `Export CSV`, placed at the right end of the list header row it exports, beside the caps label.
- **Inputs** — 1px {colors.input-border} border, {rounded.DEFAULT}; focus ring shifts border to {colors.primary}; no shadows. Labels in {typography.label-caps}. Selects only (never free text) for role, level, and other reference-table fields.
- **Buttons** — primary solid {colors.primary} with {colors.primary-foreground} text; secondary ghost with hairline border.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Show every salary with its currency, every time ({typography.number-md} + explicit code, e.g. `₹21,50,000 INR`) | Display any salary figure without its currency, anywhere, ever |
| Style refusals as dignified flat panels ({colors.refusal-fill}, hairline border) — an answer-shaped object | Style refusals as errors, warnings, alerts, grayed-out states, or apologies |
| Use Quiet Amber only when distance from the peer median exceeds the configured threshold — the boundary is exact (rules in EXPERIENCE.md § Component Patterns) | Use amber for sub-threshold distances, decoration, or general emphasis |
| Keep judgment monochrome-plus-amber; direction lives in words (`above` / `below median`) | Use red/green (or any success/failure color pair) for pay data, deltas, or status |
| Let findings wait silently on Home until Alice arrives | Add notification bells, badges with unread counts, toasts that nag, or any affordance implying the product reaches out |
| Set ALL numerals in JetBrains Mono, right-aligned in columns | Set any number, date-in-data, or percentage in the proportional UI face |
| Say "as of" (`As of 16 Jul 2026`) for every dated answer | Say "snapshot" / "Snapshot Date" — infected vocabulary, stripped |
| Speak the SPEC's language: peer group, peer median, distance, outlier, threshold, refusal | Say "compa-ratio", pay bands, or range penetration — spec non-goals, stripped |
| Put provenance (group size, as-of date, currency, pinned rate) within one line of every computed number | Ship a "clean" number whose receipts require a click |
