import { describe, expect, it } from 'vitest';

import { toThemeCss, type DesignFrontmatter } from '../../scripts/design-tokens/to-css.ts';

// Test-first (Law 1 / AD-23): this spec lands, red, before `scripts/design-tokens/to-css.ts`
// exists.
//
// It mirrors the story's I/O & Edge-Case Matrix row for row. The transform under test is PURE —
// frontmatter object in, one CSS string out — so nothing here touches the disk or the real
// DESIGN.md; the fixtures below are hand-built minimal frontmatters that isolate one rule each.
// (Reading the REAL DESIGN.md is `contrast.test.ts`'s job, where the values themselves are the
// subject.)
//
// The one rule every assertion here serves is F-5: a color token is emitted ONCE, under its light
// name, and the `-dark` suffix selects the value used inside the dark override — it never survives
// into a token name. Two names for one color is the drift AD-15 exists to prevent.

/**
 * A frontmatter with exactly one of everything. Each test overrides the one section it is about,
 * so a failure names the rule that broke rather than a fixture that drifted.
 */
function minimalFrontmatter(overrides: Partial<DesignFrontmatter> = {}): DesignFrontmatter {
  return {
    colors: { 'surface-base': '#f8fafc', 'surface-base-dark': '#0f172a' },
    typography: {
      'body-md': {
        fontFamily: 'Hanken Grotesk',
        fontSize: '14px',
        fontWeight: '400',
        lineHeight: '20px',
      },
      'number-sm': {
        fontFamily: 'JetBrains Mono',
        fontSize: '12px',
        fontWeight: '400',
        lineHeight: '16px',
      },
    },
    rounded: { sm: '0.125rem', DEFAULT: '0.25rem', full: '9999px' },
    spacing: { unit: '4px', gutter: '12px' },
    components: {},
    ...overrides,
  };
}

/** The `:root` body of the `@media (prefers-color-scheme: dark)` block, for targeted assertions. */
function darkBlockOf(css: string): string {
  const match = /@media \(prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\}\s*\}/.exec(css);
  if (match === null) {
    throw new Error('no dark override block found in the generated CSS');
  }
  return match[1] as string;
}

/** The `@theme static { … }` body — the light/default declarations. */
function themeBlockOf(css: string): string {
  const match = /@theme static \{([\s\S]*?)\n\}/.exec(css);
  if (match === null) {
    throw new Error('no `@theme static` block found in the generated CSS');
  }
  return match[1] as string;
}

/** Every custom-property NAME declared in a block, in declaration order. */
function tokenNamesIn(block: string): string[] {
  return [...block.matchAll(/^\s*(--[a-z0-9-]+):/gim)].map((m) => m[1] as string);
}

describe('toThemeCss — colors (the F-5 pairing rule)', () => {
  it('emits a paired color once under its light name, in the theme block', () => {
    const css = toThemeCss(minimalFrontmatter());

    expect(themeBlockOf(css)).toContain('--color-surface-base: #f8fafc;');
  });

  it('re-declares the same name with the `-dark` value inside the dark override', () => {
    const css = toThemeCss(minimalFrontmatter());

    expect(darkBlockOf(css)).toContain('--color-surface-base: #0f172a;');
  });

  it('never lets the `-dark` suffix survive into a token name', () => {
    const css = toThemeCss(minimalFrontmatter());

    expect(css).not.toMatch(/--color-[a-z0-9-]*-dark\b/);
  });

  it('declares exactly the same color names in the dark block as in the theme block', () => {
    const css = toThemeCss(
      minimalFrontmatter({
        colors: {
          'surface-base': '#f8fafc',
          'surface-base-dark': '#0f172a',
          ink: '#191c1e',
          'ink-dark': '#e2e8f0',
        },
      }),
    );

    const lightColors = tokenNamesIn(themeBlockOf(css)).filter((n) => n.startsWith('--color-'));
    const darkColors = tokenNamesIn(darkBlockOf(css));

    expect(darkColors).toEqual(lightColors);
  });

  it('overrides ONLY colors in the dark block — type, radius, and spacing are mode-invariant', () => {
    const css = toThemeCss(minimalFrontmatter());

    expect(tokenNamesIn(darkBlockOf(css)).every((n) => n.startsWith('--color-'))).toBe(true);
  });

  it('throws naming the color and its missing counterpart when a light color has no dark pair', () => {
    const frontmatter = minimalFrontmatter({ colors: { 'surface-base': '#f8fafc' } });

    expect(() => toThemeCss(frontmatter)).toThrowError(
      /surface-base[\s\S]*surface-base-dark|surface-base-dark[\s\S]*surface-base/,
    );
  });

  it('throws naming the orphan when a `-dark` key has no light base', () => {
    const frontmatter = minimalFrontmatter({
      colors: { 'surface-base': '#f8fafc', 'surface-base-dark': '#0f172a', 'foo-dark': '#000000' },
    });

    expect(() => toThemeCss(frontmatter)).toThrowError(/foo-dark/);
  });
});

describe('toThemeCss — typography', () => {
  it('maps a style to `--text-*` with the v4 size / line-height / weight sub-properties', () => {
    const theme = themeBlockOf(toThemeCss(minimalFrontmatter()));

    expect(theme).toContain('--text-body-md: 14px;');
    expect(theme).toContain('--text-body-md--line-height: 20px;');
    expect(theme).toContain('--text-body-md--font-weight: 400;');
  });

  it('omits `--letter-spacing` for a style that declares no tracking', () => {
    expect(toThemeCss(minimalFrontmatter())).not.toContain('--text-body-md--letter-spacing');
  });

  it('emits `--letter-spacing` for a style that declares tracking', () => {
    const css = toThemeCss(
      minimalFrontmatter({
        typography: {
          'label-caps': {
            fontFamily: 'Hanken Grotesk',
            fontSize: '11px',
            fontWeight: '700',
            lineHeight: '16px',
            letterSpacing: '0.05em',
          },
          'number-sm': {
            fontFamily: 'JetBrains Mono',
            fontSize: '12px',
            fontWeight: '400',
            lineHeight: '16px',
          },
        },
      }),
    );

    expect(css).toContain('--text-label-caps--letter-spacing: 0.05em;');
  });

  it('lifts the proportional face into `--font-sans` with a fallback stack', () => {
    const theme = themeBlockOf(toThemeCss(minimalFrontmatter()));

    expect(theme).toMatch(/--font-sans: 'Hanken Grotesk', .+;/);
  });

  it('lifts the monospaced face into `--font-mono` with a fallback stack', () => {
    const theme = themeBlockOf(toThemeCss(minimalFrontmatter()));

    expect(theme).toMatch(/--font-mono: 'JetBrains Mono', .+monospace;/);
  });

  it('emits each family exactly once however many styles share it', () => {
    const css = toThemeCss(minimalFrontmatter());

    expect([...css.matchAll(/--font-sans:/g)]).toHaveLength(1);
    expect([...css.matchAll(/--font-mono:/g)]).toHaveLength(1);
  });

  it('throws when the typography block declares no monospaced face — all numerals are mono', () => {
    const frontmatter = minimalFrontmatter({
      typography: {
        'body-md': {
          fontFamily: 'Hanken Grotesk',
          fontSize: '14px',
          fontWeight: '400',
          lineHeight: '20px',
        },
      },
    });

    expect(() => toThemeCss(frontmatter)).toThrowError(/mono/i);
  });

  it('throws naming both families when two proportional faces compete for `--font-sans`', () => {
    const frontmatter = minimalFrontmatter({
      typography: {
        'body-md': {
          fontFamily: 'Hanken Grotesk',
          fontSize: '14px',
          fontWeight: '400',
          lineHeight: '20px',
        },
        'headline-lg': {
          fontFamily: 'Inter',
          fontSize: '24px',
          fontWeight: '600',
          lineHeight: '32px',
        },
        'number-sm': {
          fontFamily: 'JetBrains Mono',
          fontSize: '12px',
          fontWeight: '400',
          lineHeight: '16px',
        },
      },
    });

    expect(() => toThemeCss(frontmatter)).toThrowError(/Hanken Grotesk[\s\S]*Inter/);
  });
});

describe('toThemeCss — radius and spacing', () => {
  it('maps named radii to `--radius-*`', () => {
    const theme = themeBlockOf(toThemeCss(minimalFrontmatter()));

    expect(theme).toContain('--radius-sm: 0.125rem;');
    expect(theme).toContain('--radius-full: 9999px;');
  });

  it('maps the `DEFAULT` radius to the bare `--radius`, never `--radius-DEFAULT`', () => {
    const theme = themeBlockOf(toThemeCss(minimalFrontmatter()));

    expect(theme).toContain('--radius: 0.25rem;');
    expect(theme).not.toMatch(/--radius-default/i);
  });

  it('maps `spacing.unit` to the bare `--spacing` — the v4 dynamic scale base', () => {
    const theme = themeBlockOf(toThemeCss(minimalFrontmatter()));

    expect(theme).toContain('--spacing: 4px;');
    expect(theme).not.toContain('--spacing-unit:');
  });

  it('maps every other spacing key to `--spacing-*`', () => {
    expect(themeBlockOf(toThemeCss(minimalFrontmatter()))).toContain('--spacing-gutter: 12px;');
  });
});

describe('toThemeCss — component reference validation', () => {
  it('accepts a component whose every reference resolves, and emits no component token', () => {
    const css = toThemeCss(
      minimalFrontmatter({
        components: {
          'button-primary': {
            background: '{colors.surface-base}',
            border: '1px solid {colors.surface-base}',
            radius: '{rounded.DEFAULT}',
            typography: '{typography.number-sm}',
            gap: '{spacing.gutter}',
            placement: 'global header, right side',
          },
        },
      }),
    );

    expect(css).not.toContain('button-primary');
  });

  it('throws naming the component key and the unresolved reference', () => {
    const frontmatter = minimalFrontmatter({
      components: { 'button-primary': { background: '{colors.nope}' } },
    });

    expect(() => toThemeCss(frontmatter)).toThrowError(/button-primary[\s\S]*colors\.nope/);
  });

  it('throws on a reference into a namespace that is not a token namespace', () => {
    const frontmatter = minimalFrontmatter({
      components: { 'button-primary': { background: '{elevation.card}' } },
    });

    expect(() => toThemeCss(frontmatter)).toThrowError(/elevation\.card/);
  });

  it('resolves a reference embedded in a longer declaration, not only a whole-value one', () => {
    const frontmatter = minimalFrontmatter({
      components: { 'refusal-panel': { border: '1px solid {colors.missing}' } },
    });

    expect(() => toThemeCss(frontmatter)).toThrowError(/colors\.missing/);
  });
});

describe('toThemeCss — the file as an artifact', () => {
  it('carries a do-not-edit header naming DESIGN.md as its source', () => {
    const css = toThemeCss(minimalFrontmatter());

    expect(css).toMatch(/DO NOT EDIT/i);
    expect(css).toContain('DESIGN.md');
  });

  it('names the rebuild command in the header, so a reader who edits it knows the way back', () => {
    expect(toThemeCss(minimalFrontmatter())).toContain('npm run tokens:build');
  });

  it('is byte-identical across invocations on the same input', () => {
    const frontmatter = minimalFrontmatter();

    expect(toThemeCss(frontmatter)).toBe(toThemeCss(minimalFrontmatter()));
  });

  it('emits tokens in a stable declared order — colors, type, radius, spacing', () => {
    const names = tokenNamesIn(themeBlockOf(toThemeCss(minimalFrontmatter())));
    const firstIndexOf = (prefix: string) => names.findIndex((n) => n.startsWith(prefix));

    expect(firstIndexOf('--color-')).toBeLessThan(firstIndexOf('--font-'));
    expect(firstIndexOf('--font-')).toBeLessThan(firstIndexOf('--text-'));
    expect(firstIndexOf('--text-')).toBeLessThan(firstIndexOf('--radius'));
    expect(firstIndexOf('--radius')).toBeLessThan(firstIndexOf('--spacing'));
  });

  it('ends with exactly one trailing newline, so the file is POSIX-clean and diffs quietly', () => {
    expect(toThemeCss(minimalFrontmatter())).toMatch(/[^\n]\n$/);
  });

  it('uses `@theme static` so every token is emitted whether or not a component uses it', () => {
    expect(toThemeCss(minimalFrontmatter())).toContain('@theme static {');
  });

  it('carries no `.dark` class or `data-theme` hook — system preference only, none other ratified', () => {
    const css = toThemeCss(minimalFrontmatter());

    expect(css).not.toContain('.dark');
    expect(css).not.toContain('data-theme');
  });
});

// ---------------------------------------------------------------------------------------------
// Shape validation (code review 2026-07-19, P2).
//
// The spec's Always clause: "malformed or incomplete input produces a named, actionable error,
// never a partial file." Until now only three VALUE-level rules were enforced (pairing, the two
// font families, dangling references) and the SHAPE was trusted, so the realistic authoring slips
// shipped a silently-broken stylesheet instead of failing:
//
//   surface-base: #f8fafc     <- unquoted: YAML reads `#…` as a COMMENT and the value is null,
//                                which emitted `--color-surface-base: null;`
//
// Each fixture below is cast through `unknown`: the TYPE says these cannot happen, and the point
// is exactly that YAML does not typecheck. The frontmatter is data from a document this build may
// not repair, so every failure must NAME the section, the key, and what was wrong.
// ---------------------------------------------------------------------------------------------

/** A frontmatter with one section replaced by something the type forbids but YAML can produce. */
function malformed(overrides: Record<string, unknown>): DesignFrontmatter {
  return { ...minimalFrontmatter(), ...overrides } as unknown as DesignFrontmatter;
}

describe('toThemeCss — color shape validation', () => {
  it('throws when a light color is null — the unquoted-hex YAML slip', () => {
    const frontmatter = malformed({
      colors: { 'surface-base': null, 'surface-base-dark': '#0f172a' },
    });

    expect(() => toThemeCss(frontmatter)).toThrowError(/colors.*surface-base/s);
  });

  it('never emits the string `null` as a token value', () => {
    const frontmatter = malformed({
      colors: { 'surface-base': null, 'surface-base-dark': '#0f172a' },
    });

    expect(() => toThemeCss(frontmatter)).toThrow();
  });

  it('throws when a DARK color is present but null', () => {
    const frontmatter = malformed({
      colors: { 'surface-base': '#f8fafc', 'surface-base-dark': null },
    });

    expect(() => toThemeCss(frontmatter)).toThrowError(/colors.*surface-base-dark/s);
  });

  it('throws when a color is not a six-digit hex — the CSS-injection shape', () => {
    const frontmatter = malformed({
      colors: {
        'surface-base': 'red; } body { display:none',
        'surface-base-dark': '#0f172a',
      },
    });

    expect(() => toThemeCss(frontmatter)).toThrowError(/colors.*surface-base/s);
  });

  it('throws on shorthand hex — the contrast gate reads #rrggbb only', () => {
    const frontmatter = malformed({
      colors: { 'surface-base': '#fff', 'surface-base-dark': '#0f172a' },
    });

    expect(() => toThemeCss(frontmatter)).toThrowError(/colors.*surface-base/s);
  });

  it('accepts uppercase hex — a spelling difference, not a defect', () => {
    const frontmatter = malformed({
      colors: { 'surface-base': '#F8FAFC', 'surface-base-dark': '#0F172A' },
    });

    expect(() => toThemeCss(frontmatter)).not.toThrow();
  });
});

describe('toThemeCss — typography shape validation', () => {
  it.each(['fontSize', 'fontWeight', 'lineHeight', 'fontFamily'])(
    'throws when a style is missing %s instead of emitting `undefined`',
    (field) => {
      const complete = {
        fontFamily: 'Hanken Grotesk',
        fontSize: '14px',
        fontWeight: '400',
        lineHeight: '20px',
      } as Record<string, string>;
      const { [field]: _removed, ...incomplete } = complete;

      const frontmatter = malformed({
        typography: {
          'body-md': incomplete,
          'number-sm': {
            fontFamily: 'JetBrains Mono',
            fontSize: '12px',
            fontWeight: '400',
            lineHeight: '16px',
          },
        },
      });

      expect(() => toThemeCss(frontmatter)).toThrowError(
        new RegExp(`typography.*body-md.*${field}`, 's'),
      );
    },
  );

  it('throws when a typography field is present but not a string', () => {
    const frontmatter = malformed({
      typography: {
        'body-md': {
          fontFamily: 'Hanken Grotesk',
          fontSize: 14,
          fontWeight: '400',
          lineHeight: '20px',
        },
        'number-sm': {
          fontFamily: 'JetBrains Mono',
          fontSize: '12px',
          fontWeight: '400',
          lineHeight: '16px',
        },
      },
    });

    expect(() => toThemeCss(frontmatter)).toThrowError(/typography.*body-md.*fontSize/s);
  });

  it('throws when `letterSpacing` is present but not a string', () => {
    const frontmatter = malformed({
      typography: {
        'body-md': {
          fontFamily: 'Hanken Grotesk',
          fontSize: '14px',
          fontWeight: '400',
          lineHeight: '20px',
          letterSpacing: 0.05,
        },
        'number-sm': {
          fontFamily: 'JetBrains Mono',
          fontSize: '12px',
          fontWeight: '400',
          lineHeight: '16px',
        },
      },
    });

    expect(() => toThemeCss(frontmatter)).toThrowError(/typography.*body-md.*letterSpacing/s);
  });

  it('throws when a typography entry is not a mapping at all', () => {
    const frontmatter = malformed({ typography: { 'body-md': '14px' } });

    expect(() => toThemeCss(frontmatter)).toThrowError(/typography.*body-md/s);
  });
});

describe('toThemeCss — radius and spacing shape validation', () => {
  it('throws when `rounded` has no DEFAULT — the bare `--radius` the `rounded` utility reads', () => {
    const frontmatter = malformed({ rounded: { sm: '0.125rem', full: '9999px' } });

    expect(() => toThemeCss(frontmatter)).toThrowError(/rounded.*DEFAULT/s);
  });

  it('throws when `spacing` has no `unit` — the base of v4 numeric scale', () => {
    const frontmatter = malformed({ spacing: { gutter: '12px' } });

    expect(() => toThemeCss(frontmatter)).toThrowError(/spacing.*unit/s);
  });

  it('throws when a radius value is not a string', () => {
    const frontmatter = malformed({ rounded: { DEFAULT: '0.25rem', sm: 2 } });

    expect(() => toThemeCss(frontmatter)).toThrowError(/rounded.*sm/s);
  });

  it('throws when a spacing value is not a string', () => {
    const frontmatter = malformed({ spacing: { unit: '4px', gutter: 12 } });

    expect(() => toThemeCss(frontmatter)).toThrowError(/spacing.*gutter/s);
  });
});

describe('toThemeCss — component anatomy shape validation', () => {
  it('throws NAMING the component and the key when a value is not a string', () => {
    const frontmatter = malformed({ components: { 'button-primary': { padding: 8 } } });

    expect(() => toThemeCss(frontmatter)).toThrowError(/button-primary.*padding/s);
  });

  it('does not throw a bare TypeError about matchAll', () => {
    const frontmatter = malformed({ components: { 'button-primary': { padding: 8 } } });

    expect(() => toThemeCss(frontmatter)).not.toThrowError(/matchAll/);
  });

  it('throws when a component entry is not a mapping', () => {
    const frontmatter = malformed({ components: { 'button-primary': 'nope' } });

    expect(() => toThemeCss(frontmatter)).toThrowError(/components.*button-primary/s);
  });
});

// ---------------------------------------------------------------------------------------------
// Value and key SAFETY (code review 2026-07-19, follow-up review).
//
// The shape validation above closed the injection hole for COLORS, whose values must match a
// six-digit hex. It left the other three namespaces checked only for `typeof value === 'string'`,
// so every non-color value still reached `declaration()` unescaped. Reproduced by execution:
//
//   fontSize: '14px; } body { display: none'   ->  --text-body-md: 14px; } body { display: none;
//
// which closes the `@theme` block early and writes a real rule into the application's global
// stylesheet. Keys had the same hole from the other side: a key is interpolated straight into a
// custom-property NAME.
//
// DESIGN.md is an in-repo document, so this is not an untrusted-input boundary — it is the
// generator's own totality claim ("malformed input produces a named error, never a partial file"),
// which was true of one namespace out of four.
// ---------------------------------------------------------------------------------------------

describe('toThemeCss — non-color values cannot escape their declaration', () => {
  it.each([
    ['a semicolon and a closing brace', '14px; } body { display: none'],
    ['a bare closing brace', '14px }'],
    ['a comment delimiter', '14px /* x */'],
    ['a newline', '14px\n  color: red'],
    ['a quote', "14px'"],
  ])('throws when a typography value carries %s', (_label, fontSize) => {
    const frontmatter = minimalFrontmatter({
      typography: {
        'body-md': { fontFamily: 'Hanken Grotesk', fontSize, fontWeight: '400', lineHeight: '20px' },
        'number-sm': {
          fontFamily: 'JetBrains Mono',
          fontSize: '12px',
          fontWeight: '400',
          lineHeight: '16px',
        },
      },
    });

    expect(() => toThemeCss(frontmatter)).toThrowError(/typography.*body-md.*fontSize/s);
  });

  it('throws when a radius value would close the @theme block', () => {
    const frontmatter = minimalFrontmatter({
      rounded: { sm: '2px; } html { visibility: hidden', DEFAULT: '0.25rem' },
    });

    expect(() => toThemeCss(frontmatter)).toThrowError(/rounded.*sm/s);
  });

  it('throws when a spacing value would close the @theme block', () => {
    const frontmatter = minimalFrontmatter({
      spacing: { unit: '4px', gutter: '12px; } body {' },
    });

    expect(() => toThemeCss(frontmatter)).toThrowError(/spacing.*gutter/s);
  });

  it("throws when a font family carries an apostrophe — it is quoted into `--font-sans`", () => {
    const frontmatter = minimalFrontmatter({
      typography: {
        'body-md': {
          fontFamily: "Shantell Sans', monospace, x",
          fontSize: '14px',
          fontWeight: '400',
          lineHeight: '20px',
        },
        'number-sm': {
          fontFamily: 'JetBrains Mono',
          fontSize: '12px',
          fontWeight: '400',
          lineHeight: '16px',
        },
      },
    });

    expect(() => toThemeCss(frontmatter)).toThrowError(/typography.*body-md.*fontFamily/s);
  });

  it.each([
    ['rounded', { rounded: { sm: '', DEFAULT: '0.25rem' } }],
    ['spacing', { spacing: { unit: '4px', gutter: '   ' } }],
  ])('throws when a %s value is empty — it emits a declaration with no value', (section, override) => {
    const frontmatter = minimalFrontmatter(override as Partial<DesignFrontmatter>);

    expect(() => toThemeCss(frontmatter)).toThrowError(new RegExp(section, 's'));
  });

  it('still accepts every shape DESIGN.md actually uses', () => {
    expect(() =>
      toThemeCss(
        minimalFrontmatter({
          typography: {
            'label-caps': {
              fontFamily: 'Hanken Grotesk',
              fontSize: '0.6875rem',
              fontWeight: '600',
              lineHeight: '1.4',
              letterSpacing: '-0.01em',
            },
            'number-sm': {
              fontFamily: 'JetBrains Mono',
              fontSize: '12px',
              fontWeight: '400',
              lineHeight: '16px',
            },
          },
        }),
      ),
    ).not.toThrow();
  });
});

describe('toThemeCss — token keys must be spellable as custom-property names', () => {
  it.each([
    ['colors', { colors: { 'surface base': '#f8fafc', 'surface base-dark': '#0f172a' } }],
    ['rounded', { rounded: { 'sm: red; --x': '2px', DEFAULT: '0.25rem' } }],
    ['spacing', { spacing: { unit: '4px', 'a}b': '12px' } }],
  ])('throws when a %s key carries characters a CSS name cannot hold', (section, override) => {
    const frontmatter = minimalFrontmatter(override as Partial<DesignFrontmatter>);

    expect(() => toThemeCss(frontmatter)).toThrowError(new RegExp(section, 's'));
  });
});

describe('toThemeCss — an empty color section is a defect, not an empty theme', () => {
  it('throws rather than emitting a theme with no colors at all', () => {
    const frontmatter = minimalFrontmatter({ colors: {}, components: {} });

    expect(() => toThemeCss(frontmatter)).toThrowError(/colors.*empty/s);
  });
});
