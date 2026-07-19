/**
 * The seam between DESIGN.md on disk and the pure transform in `to-css.ts`.
 *
 * `parseDesignFrontmatter` is pure — markdown string in, frontmatter object out — so the fence
 * rules and the section validation are testable without a file. `readDesignFrontmatter` is the ONE
 * function here that touches the filesystem, and it is the only door through which the generator
 * reads the design document.
 *
 * DESIGN.md is READ-ONLY to the token build (AD-15). Nothing in this module or its callers ever
 * writes to it; a defect in the source document surfaces as a named error, never as a repair.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import type { DesignFrontmatter } from './to-css.ts';

/**
 * The ratified design document, relative to the repository root. Named as a constant because three
 * places must agree on it: this reader, the generated file's header, and the README.
 */
export const DESIGN_MD_RELATIVE_PATH =
  'docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/DESIGN.md';

/** The sections `to-css.ts` reads. All five are required; a missing one is a source defect. */
const REQUIRED_SECTIONS = ['colors', 'typography', 'rounded', 'spacing', 'components'] as const;

/**
 * Split the leading `---` fenced YAML block off a markdown document and parse it.
 *
 * The fence must be the first thing in the file, and the body after it is ignored entirely — a
 * `colors:` line inside the prose is documentation, not a token.
 */
export function parseDesignFrontmatter(markdown: string): DesignFrontmatter {
  // A UTF-8 BOM is invisible in every editor and would push the opening `---` off position 0,
  // producing "no YAML frontmatter found" against a document whose fence is plainly there. Strip
  // it rather than report it — it is an encoding artifact, not a design defect.
  const text = markdown.replace(/^\uFEFF/, '');

  // Anchored at the start: a `---` further down the document is a horizontal rule, not a fence.
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (match === null) {
    throw new Error(
      `No YAML frontmatter found: expected the document to open with a '---' fence and close it ` +
        `with another. ${DESIGN_MD_RELATIVE_PATH} is the single source of visual truth (AD-15) and ` +
        'the token build cannot proceed without its frontmatter.',
    );
  }

  // A raw `YAMLParseError` names a line and column in a string the reader never saw — not the
  // document, not the build it stopped. Restate it against DESIGN.md, keeping the parser's own
  // diagnosis (which is the genuinely useful half) intact.
  let parsed: unknown;
  try {
    parsed = parse(match[1] as string);
  } catch (error) {
    throw new Error(
      `${DESIGN_MD_RELATIVE_PATH}: the YAML frontmatter does not parse — ` +
        `${(error as Error).message}`,
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('DESIGN.md frontmatter did not parse to a mapping of sections.');
  }

  const sections = parsed as Record<string, unknown>;
  for (const name of REQUIRED_SECTIONS) {
    const section = sections[name];
    if (typeof section !== 'object' || section === null || Array.isArray(section)) {
      throw new Error(
        `DESIGN.md frontmatter: section '${name}' is missing or is not a mapping. The token build ` +
          `requires all of: ${REQUIRED_SECTIONS.join(', ')}.`,
      );
    }
  }

  // The shape is now structurally checked; the VALUE-level rules (pairing, dangling references,
  // the two font families) belong to `toThemeCss`, which owns the contract they serve.
  return sections as unknown as DesignFrontmatter;
}

/** Read and parse the ratified DESIGN.md. The only filesystem access in the token build's read path. */
export function readDesignFrontmatter(): DesignFrontmatter {
  return parseDesignFrontmatter(readFileSync(designMdPath(), 'utf8'));
}

/**
 * Absolute path to DESIGN.md, resolved from this module's own location rather than from
 * `process.cwd()` — so the generator and the tests agree no matter where either is invoked from.
 * `scripts/design-tokens/` is two levels below the repository root.
 */
export function designMdPath(): string {
  return fileURLToPath(new URL(`../../${DESIGN_MD_RELATIVE_PATH}`, import.meta.url));
}
