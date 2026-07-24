import { describe, expect, it } from 'vitest';

import {
  isActiveNavItem,
  NAV_ITEMS,
  navHrefWithAsOf,
  pageTitleFor,
  PRIMARY_NAV_ITEMS,
  SETTINGS_NAV_ITEM,
} from '@/ui/nav-items';

// Test-first (Law 1 / AD-23): red before `src/ui/nav-items.ts` exists.
//
// The information architecture is DATA, not markup, which is what lets it be unit-tested here
// rather than only in a browser. The labels are ratified verbatim (epic-1-context § App shell and
// IA); a typo or a re-order is a requirements defect, not a styling one, so it fails here.
//
// No jsdom, no @testing-library, no browser-mode project (story constraint). Rendered behaviour —
// that the active item actually carries `aria-current="page"` in a real document — is Playwright's
// job, in `e2e/shell.spec.ts`.

describe('NAV_ITEMS', () => {
  it('lists the seven ratified destinations in order, with exact labels', () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      'Home',
      'Employees',
      'Gender Insights',
      'Payroll Totals',
      'Overdue for Review',
      'Import',
      'Settings',
    ]);
  });

  it('routes each label to its own path', () => {
    expect(NAV_ITEMS.map((item) => item.href)).toEqual([
      '/',
      '/employees',
      '/gender-insights',
      '/payroll-totals',
      '/overdue',
      '/import',
      '/settings',
    ]);
  });

  it('pins Settings last — it sits at the BOTTOM of the sidebar', () => {
    expect(NAV_ITEMS.at(-1)).toEqual(SETTINGS_NAV_ITEM);
    expect(SETTINGS_NAV_ITEM.label).toBe('Settings');
  });

  it('splits into the six primary items plus Settings, with no item lost or duplicated', () => {
    expect(PRIMARY_NAV_ITEMS).toHaveLength(6);
    expect([...PRIMARY_NAV_ITEMS, SETTINGS_NAV_ITEM]).toEqual(NAV_ITEMS);
    expect(PRIMARY_NAV_ITEMS).not.toContainEqual(SETTINGS_NAV_ITEM);
  });

  it('uses no banned vocabulary in any label (Law 3)', () => {
    const labels = NAV_ITEMS.map((item) => item.label.toLowerCase()).join(' ');

    expect(labels).not.toContain('snapshot');
    expect(labels).not.toContain('compa');
    expect(labels).not.toContain('band');
  });
});

describe('isActiveNavItem', () => {
  it('marks an item active when the path matches exactly', () => {
    expect(isActiveNavItem('/employees', '/employees')).toBe(true);
  });

  it('does not mark an item active on a different path', () => {
    expect(isActiveNavItem('/employees', '/')).toBe(false);
  });

  // The reason the match is exact rather than a prefix: `/` is a prefix of every path in the app,
  // so a prefix rule would light Home up on all seven routes and put `aria-current="page"` on two
  // items at once, which is an accessibility defect, not a cosmetic one.
  it('does not treat "/" as a prefix of every route', () => {
    expect(isActiveNavItem('/', '/employees')).toBe(false);
  });

  it('marks Home active only on Home', () => {
    expect(isActiveNavItem('/', '/')).toBe(true);
  });

  it('does not match a deeper path under the same segment', () => {
    expect(isActiveNavItem('/employees', '/employees/42')).toBe(false);
  });

  it('marks exactly one of the seven items active for each of the seven routes', () => {
    for (const route of NAV_ITEMS) {
      const active = NAV_ITEMS.filter((item) => isActiveNavItem(item.href, route.href));

      expect(active).toEqual([route]);
    }
  });
});

describe('pageTitleFor', () => {
  it('titles a known route with its own nav label', () => {
    expect(pageTitleFor('/gender-insights')).toBe('Gender Insights');
  });

  it('titles Home with its nav label, not with the product name', () => {
    expect(pageTitleFor('/')).toBe('Home');
  });

  it('names the employee-detail surface "Employee", not the product name', () => {
    expect(pageTitleFor('/employees/42')).toBe('Employee');
    expect(pageTitleFor('/employees/01941f29-7c00-7f64-86bd-3853da7a2c2f')).toBe('Employee');
  });

  it('still uses the directory nav label for `/employees` itself', () => {
    expect(pageTitleFor('/employees')).toBe('Employees');
  });

  it('falls back to the product name on a path no nav item claims', () => {
    expect(pageTitleFor('/no-such-page')).toBe('Salary Management for ACME HR');
  });
});

// Code review 2026-07-19 (P1). The sidebar rendered `href={item.href}` with no search params, so
// setting the as-of date to a past date and then clicking ANY nav item silently returned the whole
// application to today — the header reporting the today it had just been handed, so the loss was
// not even visible. The as-of date is persistent ambient provenance; it travels.
describe('navHrefWithAsOf', () => {
  it('carries the as-of param onto the destination', () => {
    expect(navHrefWithAsOf('/employees', '2026-05-12')).toBe('/employees?asOf=2026-05-12');
  });

  it('carries it onto Home, whose href is a bare slash', () => {
    expect(navHrefWithAsOf('/', '2026-05-12')).toBe('/?asOf=2026-05-12');
  });

  it('leaves the href BARE when no as-of param is set — today needs no spelling out', () => {
    expect(navHrefWithAsOf('/employees', undefined)).toBe('/employees');
  });

  // The param is hostile by definition: anything a person or a stale link can type reaches this
  // function. It is carried VERBATIM (encoded) rather than parsed — `resolveAsOf` at the
  // destination's boundary is the one place that decides what a param means, so a garbage value
  // resolves to today identically before and after the navigation.
  it('carries a malformed param verbatim, leaving the meaning to resolveAsOf', () => {
    expect(navHrefWithAsOf('/employees', 'tomorrow')).toBe('/employees?asOf=tomorrow');
  });

  it('percent-encodes a param that would otherwise forge a second key', () => {
    expect(navHrefWithAsOf('/employees', 'a&b=c')).toBe('/employees?asOf=a%26b%3Dc');
  });

  it('percent-encodes the empty param rather than dropping it', () => {
    expect(navHrefWithAsOf('/employees', '')).toBe('/employees?asOf=');
  });
});
