import { describe, expect, it } from 'vitest';

import {
  DESIGN_MD_RELATIVE_PATH,
  parseDesignFrontmatter,
  readDesignFrontmatter,
} from '../../scripts/design-tokens/design-source.ts';

// Test-first (Law 1 / AD-23): this spec lands, red, before
// `scripts/design-tokens/design-source.ts` exists.
//
// This module is the seam between DESIGN.md-on-disk and the pure transform: `parseDesignFrontmatter`
// is a pure string -> object function (tested here against hand-built documents), and
// `readDesignFrontmatter` is the one place that touches the filesystem (tested here against the
// REAL DESIGN.md, because "the real document still parses" is precisely the thing that would
// otherwise break silently when someone edits it).

/** A syntactically complete but minimal DESIGN.md — every required section, one entry each. */
const WELL_FORMED = `---
name: Test
colors:
  surface-base: '#f8fafc'
  surface-base-dark: '#0f172a'
typography:
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
rounded:
  DEFAULT: 0.25rem
spacing:
  unit: 4px
components:
  button-primary:
    background: '{colors.surface-base}'
---

# Body prose the parser must ignore

colors:
  not-a-token: '#ffffff'
`;

describe('parseDesignFrontmatter', () => {
  it('reads the colors map out of the frontmatter', () => {
    expect(parseDesignFrontmatter(WELL_FORMED).colors['surface-base']).toBe('#f8fafc');
  });

  it('ignores the markdown body, including anything in it that looks like frontmatter', () => {
    expect(parseDesignFrontmatter(WELL_FORMED).colors['not-a-token']).toBeUndefined();
  });

  it('keeps key order, which is what makes the generated file diff quietly', () => {
    expect(Object.keys(parseDesignFrontmatter(WELL_FORMED).colors)).toEqual([
      'surface-base',
      'surface-base-dark',
    ]);
  });

  it('throws when the document opens with no frontmatter fence at all', () => {
    expect(() => parseDesignFrontmatter('# Just prose\n')).toThrowError(/frontmatter/i);
  });

  it('throws when the opening fence is never closed', () => {
    expect(() => parseDesignFrontmatter('---\ncolors: {}\n')).toThrowError(/frontmatter/i);
  });

  it('throws naming the section when a required section is missing', () => {
    const withoutSpacing = WELL_FORMED.replace('spacing:\n  unit: 4px\n', '');

    expect(() => parseDesignFrontmatter(withoutSpacing)).toThrowError(/spacing/);
  });

  it('throws naming the section when a required section is not a mapping', () => {
    const scalarRounded = WELL_FORMED.replace('rounded:\n  DEFAULT: 0.25rem\n', 'rounded: 4px\n');

    expect(() => parseDesignFrontmatter(scalarRounded)).toThrowError(/rounded/);
  });
});

describe('readDesignFrontmatter — the real DESIGN.md', () => {
  it('points at the ratified design document', () => {
    expect(DESIGN_MD_RELATIVE_PATH).toBe(
      'docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/DESIGN.md',
    );
  });

  it('parses the real document into all five token sections', () => {
    const frontmatter = readDesignFrontmatter();

    // 17 colors x 2 modes, 8 type styles, 6 radii, 5 spacings, 10 components. A change to any of
    // them is a DESIGN.md change and should be seen here first.
    //
    // The story's Code Map says "components (12…)"; the document declares TEN
    // (button-primary, button-secondary, outlier-badge, refusal-panel, provenance-caption,
    // as-of-control, copy-answer, findings-row, timeline-list, preset-chip). Counted from the
    // source, which is the authority — the Code Map is descriptive prose, not the frozen contract,
    // and no component is emitted as a token either way.
    expect(Object.keys(frontmatter.colors)).toHaveLength(34);
    expect(Object.keys(frontmatter.typography)).toHaveLength(8);
    expect(Object.keys(frontmatter.rounded)).toHaveLength(6);
    expect(Object.keys(frontmatter.spacing)).toHaveLength(5);
    expect(Object.keys(frontmatter.components)).toHaveLength(10);
  });

  it('yields a document every color of which is paired — the precondition the transform needs', () => {
    const colors = readDesignFrontmatter().colors;
    const unpaired = Object.keys(colors).filter(
      (name) => !name.endsWith('-dark') && !(`${name}-dark` in colors),
    );

    expect(unpaired).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Reader diagnostics (code review 2026-07-19, follow-up review).
//
// Both cases below produced an error that pointed AWAY from the actual defect: a BOM reported a
// missing fence that was plainly present, and invalid YAML surfaced as a raw `YAMLParseError`
// naming a line and column in a string the reader never saw — neither DESIGN.md nor the build it
// stopped.
// ---------------------------------------------------------------------------------------------

describe('parseDesignFrontmatter — diagnostics', () => {
  it('parses a document saved with a UTF-8 BOM before the opening fence', () => {
    const withBom = '\uFEFF' + WELL_FORMED;

    expect(() => parseDesignFrontmatter(withBom)).not.toThrow();
  });

  it('names DESIGN.md and keeps the parser diagnosis when the YAML does not parse', () => {
    const broken = ['---', 'colors:', '  ink: "unterminated', '---', ''].join('\n');

    expect(() => parseDesignFrontmatter(broken)).toThrowError(/DESIGN\.md/s);
    expect(() => parseDesignFrontmatter(broken)).not.toThrowError(/^YAMLParseError/);
  });
});
