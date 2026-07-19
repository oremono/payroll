import { describe, expect, it } from 'vitest';

import {
  isActiveNavItem,
  NAV_ITEMS,
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

  it('falls back to the product name on a path no nav item claims', () => {
    expect(pageTitleFor('/employees/42')).toBe('Salary Management for ACME HR');
  });
});
