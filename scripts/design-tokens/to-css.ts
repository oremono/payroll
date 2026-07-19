/**
 * The pure half of the design-token build: DESIGN.md's frontmatter in, one Tailwind v4 stylesheet
 * out. (AD-15)
 *
 * No I/O of any kind — no `fs`, no `process`, no clock. The CLI
 * (`scripts/generate-design-tokens.ts`) owns reading and writing; this module owns the CONTRACT, so
 * every rule below is unit-testable without touching disk and the output is a pure function of its
 * input (same frontmatter ⇒ byte-identical CSS, which is what `tokens:check` compares).
 *
 * This is BUILD TOOLING, not product logic — it deliberately lives outside `src/`, so the Law-2
 * purity lint and the domain coverage/mutation gates do not apply to it. It does throw, which
 * `src/domain` may never do: a malformed DESIGN.md must stop the build loudly rather than emit a
 * partial theme.
 *
 * ## One name, two values (the F-5 fix)
 *
 * DESIGN.md's frontmatter is a FLAT color map with `-dark` suffixes. Read literally that yields two
 * unrelated tokens per color — `--color-ink` and `--color-ink-dark` — which is exactly the drift
 * AD-15 exists to prevent. So the suffix is treated as a MODE SELECTOR, not part of a name: every
 * color is emitted once under its light name inside `@theme static`, and the same name is
 * re-declared inside a `prefers-color-scheme: dark` block with its `-dark` value. Tailwind compiles
 * every utility to `var(--color-…)`, so re-pointing the variable re-points every utility — no
 * component ever writes `dark:`.
 *
 * `static` (rather than the default) forces Tailwind to emit ALL theme variables, used or not: the
 * token contract must be observable and overridable before story 1-6 consumes any of it.
 *
 * System preference only. No `.dark` class, no `data-theme` attribute, no persistence cookie —
 * none of those is ratified, and a class hook would be speculative surface.
 */

/** One typography style as DESIGN.md declares it. `letterSpacing` is present only where tracked. */
export type TypographyStyle = {
  readonly fontFamily: string;
  readonly fontSize: string;
  readonly fontWeight: string;
  readonly lineHeight: string;
  readonly letterSpacing?: string;
};

/**
 * DESIGN.md's frontmatter, narrowed to the sections this transform reads. Everything else in the
 * document (`name`, `description`, prose) is ignored.
 */
export type DesignFrontmatter = {
  readonly colors: Readonly<Record<string, string>>;
  readonly typography: Readonly<Record<string, TypographyStyle>>;
  readonly rounded: Readonly<Record<string, string>>;
  readonly spacing: Readonly<Record<string, string>>;
  /** Component anatomy. Reference-only: VALIDATED for dangling references, never emitted. */
  readonly components: Readonly<Record<string, Readonly<Record<string, string>>>>;
};

/** The mode-selector suffix. It is stripped from names and never appears in the output. */
const DARK_SUFFIX = '-dark';

/**
 * The key whose radius becomes the BARE `--radius`. Tailwind v4's `rounded` utility (no scale
 * suffix) reads `--radius`, so `DEFAULT` cannot be spelled `--radius-DEFAULT` and still work.
 */
const DEFAULT_RADIUS_KEY = 'DEFAULT';

/**
 * The spacing key that becomes the BARE `--spacing` — v4's dynamic scale base, from which `p-3`,
 * `gap-2`, and every other numeric spacing utility are computed as multiples.
 */
const SPACING_BASE_KEY = 'unit';

/** The frontmatter sections a `{namespace.key}` reference inside `components:` may point into. */
const REFERENCE_NAMESPACES = ['colors', 'typography', 'rounded', 'spacing'] as const;

/**
 * Fallback stacks appended after the DESIGN-named face. The webfonts themselves are NOT loaded here
 * — `next/font` wiring is story 1-6's shell work — so until then these fallbacks are what actually
 * renders, and they must already be a proportional face and a monospaced one respectively.
 */
const SANS_FALLBACKS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONO_FALLBACKS = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";

/**
 * Render the whole `src/app/tokens.generated.css` file, header included.
 *
 * Throws — naming the offending key — when a color is unpaired, when the typography block does not
 * yield exactly one proportional and one monospaced family, or when a `components:` reference
 * resolves to no token. Each is a defect in DESIGN.md, which this story may not amend, so the only
 * honest outcome is a named failure rather than a partial theme.
 */
export function toThemeCss(frontmatter: DesignFrontmatter): string {
  validateShape(frontmatter);
  validateComponentReferences(frontmatter);

  const colors = pairColors(frontmatter.colors);
  const families = liftFontFamilies(frontmatter.typography);

  const themeDeclarations = [
    section(
      'Colors — LIGHT values. Every name below is re-declared in the dark block at the foot of',
      'this file with its `*-dark` counterpart: one token name, two values. No component ever',
      'writes a `dark:` variant. (AD-15, F-5)',
    ),
    ...colors.map(({ name, light }) => declaration(`--color-${name}`, light)),

    section(
      'Type faces. DESIGN binds ALL numerals to the mono face and everything else to the',
      'proportional one, so eight styles collapse to two families. The webfonts are not loaded',
      'yet — that is story 1-6 — so today the fallback stacks are what renders.',
    ),
    declaration('--font-sans', `'${families.sans}', ${SANS_FALLBACKS}`),
    declaration('--font-mono', `'${families.mono}', ${MONO_FALLBACKS}`),

    section('Type scale, with the Tailwind v4 `--text-*--<property>` sub-properties.'),
    ...Object.entries(frontmatter.typography).flatMap(([name, style]) =>
      typographyDeclarations(name, style),
    ),

    section('Radii. `DEFAULT` is the bare `--radius`, which is what the `rounded` utility reads.'),
    ...Object.entries(frontmatter.rounded).map(([name, value]) =>
      declaration(name === DEFAULT_RADIUS_KEY ? '--radius' : `--radius-${name}`, value),
    ),

    section('Spacing. `unit` is the bare `--spacing`: v4 computes the numeric scale from it.'),
    ...Object.entries(frontmatter.spacing).map(([name, value]) =>
      declaration(name === SPACING_BASE_KEY ? '--spacing' : `--spacing-${name}`, value),
    ),
  ];

  const darkDeclarations = colors.map(({ name, dark }) => declaration(`--color-${name}`, dark));

  return [
    FILE_HEADER,
    '',
    '@theme static {',
    // `section()` opens with a blank line to separate runs of declarations; the first run has
    // nothing to separate from, so it loses it.
    ...themeDeclarations
      .map(indent(1))
      .map((block, index) => (index === 0 ? block.replace(/^\n/, '') : block)),
    '}',
    '',
    '/*',
    ' * Dark mode is SYSTEM PREFERENCE ONLY — no manual toggle, no class hook, no attribute hook,',
    ' * no persistence cookie; none of those is ratified. Re-declaring the same variables re-points',
    ' * every Tailwind utility that reads them, which is why there is no second token and no `dark:`',
    ' * variant anywhere in the app.',
    ' *',
    ' * These values are flagged PROVISIONAL in DESIGN.md § Dark mode — derived by inversion, never',
    ' * verified against a real render. They already meet the contrast floor by computation.',
    ' */',
    '@media (prefers-color-scheme: dark) {',
    '  :root {',
    ...darkDeclarations.map(indent(2)),
    '  }',
    '}',
    '',
  ].join('\n');
}

const FILE_HEADER = [
  '/*',
  ' * GENERATED FILE — DO NOT EDIT.',
  ' *',
  ' * Source:  docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/DESIGN.md (YAML frontmatter)',
  ' * Rebuild: npm run tokens:build',
  ' * Verify:  npm run tokens:check  (CI fails on drift between DESIGN.md and this file)',
  ' *',
  ' * DESIGN.md is the single source of visual truth (AD-15). To change a token, change it THERE and',
  ' * rebuild — an edit made here is erased by the next build and rejected by the drift gate before',
  ' * that. This is the only file in src/ permitted to contain a color literal; everywhere else the',
  ' * color ban in eslint.config.mjs and tests/tokens/no-hex.test.ts hold the line.',
  ' */',
].join('\n');

/**
 * A six-digit sRGB hex color, the one spelling DESIGN.md uses and the only one `contrast.ts`
 * reads. Shorthand (`#fff`) is rejected rather than expanded: the contrast gate would throw on it
 * later, and a token spelled two ways is a token that drifts.
 */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** The typography fields every style must declare, and the optional one. */
const REQUIRED_TYPOGRAPHY_FIELDS = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight'] as const;
const OPTIONAL_TYPOGRAPHY_FIELDS = ['letterSpacing'] as const;

/**
 * Structural validation of the frontmatter, before a single declaration is rendered.
 *
 * `design-source.ts` proves the five sections EXIST and are mappings; nothing proved their
 * CONTENTS, and YAML does not typecheck — so the `DesignFrontmatter` type is a claim about the
 * document, not a guarantee. Every slip below was reachable and silent (code review 2026-07-19):
 *
 *   surface-base: #f8fafc      <- unquoted `#` opens a YAML COMMENT; the value is null, and
 *                                 `--color-surface-base: null;` shipped with no error at all
 *   fontSize: 14               <- a bare number; `--text-body-md: 14;` is not a length
 *   background: red; } body {  <- closes the @theme block early and injects a rule into the app
 *   padding: 8                 <- `TypeError: value.matchAll is not a function`, naming nothing
 *
 * The spec's Always clause is that malformed or incomplete input produces a NAMED, ACTIONABLE
 * error and never a partial file. Every throw here names the section, the key, and what was wrong,
 * because DESIGN.md is read-only to this build: a defect there is reported, never repaired.
 */
function validateShape(frontmatter: DesignFrontmatter): void {
  validateColors(frontmatter.colors);
  validateTypography(frontmatter.typography);
  validateScale('rounded', frontmatter.rounded, DEFAULT_RADIUS_KEY, '`rounded` utility');
  validateScale('spacing', frontmatter.spacing, SPACING_BASE_KEY, 'numeric spacing scale (p-3, …)');
  validateComponentShape(frontmatter.components);
}

/**
 * A token key, as it appears in the frontmatter. It is interpolated straight into a custom-property
 * NAME (`--color-<key>`), so anything outside this set either produces invalid CSS or escapes the
 * declaration entirely — the same hole `CSS_SAFE_VALUE` closes on the value side.
 */
const TOKEN_KEY = /^[A-Za-z0-9_-]+$/;

/**
 * A value safe to copy verbatim into a declaration.
 *
 * Colors get a far stricter check (`HEX_COLOR`); this is the floor for every OTHER namespace, whose
 * values are free-form CSS lengths, numbers and family names. It bans exactly the characters that
 * let a value stop being a value: `;` and `}` close the declaration and the `@theme` block (code
 * review 2026-07-19 — `fontSize: '14px; } body { display: none'` shipped two extra rules into the
 * app's global stylesheet with no error), quotes escape the family-name quoting at `--font-sans`,
 * and comment delimiters and newlines break the block open more slowly but just as completely.
 */
const CSS_SAFE_VALUE = /^[^;{}<>'"\\\n\r]+$/;

/** A comment delimiter anywhere in a value — `/*` or `*\/` — which `CSS_SAFE_VALUE` cannot express. */
const CSS_COMMENT = /\/\*|\*\//;

/**
 * Reject a token key that cannot be spelled as a custom-property name.
 *
 * DESIGN.md is read-only to this build, so a bad key is reported against its section and its own
 * text rather than sanitized — sanitizing would rename a token silently, which is the drift AD-15
 * exists to prevent.
 */
function validateTokenKey(section: string, key: string): void {
  if (!TOKEN_KEY.test(key)) {
    throw new Error(
      `DESIGN.md ${section}: '${key}' is not a usable token name. A key becomes a CSS ` +
        'custom-property name verbatim, so it may contain only letters, digits, `-` and `_`.',
    );
  }
}

/**
 * Reject a non-color value that would not survive being copied verbatim into a declaration.
 *
 * `consumer` names what the value becomes, so the message points at the emitted declaration rather
 * than at an abstract rule.
 */
function validateCssValue(section: string, key: string, value: string): void {
  if (value.trim() === '') {
    throw new Error(
      `DESIGN.md ${section}: '${key}' is empty. Values are copied verbatim into the stylesheet, so ` +
        'an empty one emits a malformed declaration that the CSS parser silently drops.',
    );
  }
  if (!CSS_SAFE_VALUE.test(value) || CSS_COMMENT.test(value)) {
    throw new Error(
      `DESIGN.md ${section}: '${key}' is '${value}', which contains CSS punctuation ` +
        '(`;` `{` `}` `<` `>` a quote, a backslash, a comment delimiter or a newline). Values are ' +
        'copied verbatim into the generated stylesheet, so such a value would not stay a value — ' +
        'it would close the declaration and inject rules into the application stylesheet.',
    );
  }
}

/** Every color, light and dark alike, must be a six-digit hex string. */
function validateColors(colors: Readonly<Record<string, string>>): void {
  if (Object.keys(colors).length === 0) {
    throw new Error(
      'DESIGN.md colors: the section is empty. The theme would ship with no color tokens at all, ' +
        'which is never an intended state — every surface in DESIGN.md names one.',
    );
  }

  for (const [key, value] of Object.entries(colors)) {
    validateTokenKey('colors', key);
    if (typeof value !== 'string') {
      throw new Error(
        `DESIGN.md colors: '${key}' is ${describe(value)}, not a string. If the value is written ` +
          "unquoted in the frontmatter (`" +
          key +
          ': #f8fafc`), YAML reads the `#` as a COMMENT and the ' +
          'color becomes null — quote it.',
      );
    }
    if (!HEX_COLOR.test(value)) {
      throw new Error(
        `DESIGN.md colors: '${key}' is '${value}', which is not a six-digit hex color (#rrggbb). ` +
          'Every color in DESIGN.md is declared that way, the contrast gate reads that form only, ' +
          'and anything else would be copied verbatim into the stylesheet.',
      );
    }
  }
}

/** Every typography style must be a mapping of present strings. */
function validateTypography(typography: Readonly<Record<string, TypographyStyle>>): void {
  for (const [name, style] of Object.entries(typography)) {
    if (typeof style !== 'object' || style === null || Array.isArray(style)) {
      throw new Error(
        `DESIGN.md typography: '${name}' is ${describe(style)}, not a mapping. Each style declares ` +
          `${REQUIRED_TYPOGRAPHY_FIELDS.join(', ')}.`,
      );
    }

    validateTokenKey('typography', name);

    const fields = style as unknown as Record<string, unknown>;
    for (const field of REQUIRED_TYPOGRAPHY_FIELDS) {
      if (typeof fields[field] !== 'string') {
        throw new Error(
          `DESIGN.md typography.${name}: '${field}' is ${describe(fields[field])}, not a string. ` +
            'Every style needs all of ' +
            `${REQUIRED_TYPOGRAPHY_FIELDS.join(', ')}; a missing one would emit ` +
            `\`--text-${name}--…: undefined;\` into the theme.`,
        );
      }
      validateCssValue(`typography.${name}`, field, fields[field] as string);
    }
    for (const field of OPTIONAL_TYPOGRAPHY_FIELDS) {
      if (fields[field] === undefined) {
        continue;
      }
      if (typeof fields[field] !== 'string') {
        throw new Error(
          `DESIGN.md typography.${name}: '${field}' is ${describe(fields[field])}. It is optional, ` +
            'but where present it must be a string.',
        );
      }
      validateCssValue(`typography.${name}`, field, fields[field] as string);
    }
  }
}

/**
 * A flat `name -> value` scale (`rounded`, `spacing`): every value a string, and the ONE key that
 * becomes a bare custom property present.
 *
 * The bare key is not cosmetic. `rounded.DEFAULT` is what `--radius` — and therefore the `rounded`
 * utility — reads, and `spacing.unit` is what Tailwind v4 computes the entire numeric scale from.
 * Missing, each silently emitted nothing and took a whole family of utilities down with it.
 */
function validateScale(
  section: string,
  scale: Readonly<Record<string, string>>,
  bareKey: string,
  consumer: string,
): void {
  for (const [key, value] of Object.entries(scale)) {
    validateTokenKey(section, key);
    if (typeof value !== 'string') {
      throw new Error(
        `DESIGN.md ${section}: '${key}' is ${describe(value)}, not a string. Values are copied ` +
          'verbatim into the stylesheet, so they must already carry their unit.',
      );
    }
    validateCssValue(section, key, value);
  }
  if (!(bareKey in scale)) {
    throw new Error(
      `DESIGN.md ${section}: no '${bareKey}' key. It becomes the BARE custom property that the ` +
        `${consumer} reads; without it that whole family of utilities resolves to nothing.`,
    );
  }
}

/** Component anatomy is never emitted, but it IS scanned for references — so it must be strings. */
function validateComponentShape(
  components: Readonly<Record<string, Readonly<Record<string, string>>>>,
): void {
  for (const [name, anatomy] of Object.entries(components)) {
    if (typeof anatomy !== 'object' || anatomy === null || Array.isArray(anatomy)) {
      throw new Error(
        `DESIGN.md components: '${name}' is ${describe(anatomy)}, not a mapping of anatomy keys.`,
      );
    }
    for (const [key, value] of Object.entries(anatomy)) {
      if (typeof value !== 'string') {
        throw new Error(
          `DESIGN.md components.${name}: '${key}' is ${describe(value)}, not a string. Anatomy ` +
            'values are scanned for `{namespace.key}` token references, which only a string can ' +
            'carry; write `8px`, not `8`.',
        );
      }
    }
  }
}

/** A short, quotable description of a bad value, for the error messages above. */
function describe(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'missing';
  }
  if (Array.isArray(value)) {
    return 'a list';
  }
  return `${typeof value} \`${JSON.stringify(value)}\``;
}

/** A color that survived pairing: one name, its light value, and its dark counterpart. */
type PairedColor = { readonly name: string; readonly light: string; readonly dark: string };

/**
 * Fold the flat `-dark`-suffixed map into one entry per color, in declared order.
 *
 * Both directions are errors, and both name the key: a light color with no `-dark` counterpart
 * would render identically in both modes (a silent contrast failure, not a visible one), and an
 * orphan `-dark` key is a value nothing can ever reach.
 */
function pairColors(colors: Readonly<Record<string, string>>): readonly PairedColor[] {
  const lightNames = Object.keys(colors).filter((key) => !key.endsWith(DARK_SUFFIX));

  for (const key of Object.keys(colors)) {
    if (!key.endsWith(DARK_SUFFIX)) {
      continue;
    }
    const base = key.slice(0, -DARK_SUFFIX.length);
    if (!(base in colors)) {
      throw new Error(
        `DESIGN.md colors: '${key}' is an orphan dark value — no light color '${base}' exists. ` +
          'Every `-dark` key selects the dark value of an existing light token; it is never a ' +
          'token of its own.',
      );
    }
  }

  return lightNames.map((name) => {
    const dark = colors[`${name}${DARK_SUFFIX}`];
    if (dark === undefined) {
      throw new Error(
        `DESIGN.md colors: '${name}' has no dark counterpart — expected a '${name}${DARK_SUFFIX}' ` +
          'key. Every color needs two values; one value would render identically in both modes.',
      );
    }
    return { name, light: colors[name] as string, dark };
  });
}

/**
 * Collapse the typography block's `fontFamily` values into the two families DESIGN actually binds:
 * the mono face for ALL numerals, the proportional face for everything else.
 *
 * A family is classified as monospaced by name. That is a heuristic, but it is the only signal the
 * frontmatter carries, and it is guarded on both sides: exactly one family must land in each
 * bucket, so a third face or a renamed one fails the build by name instead of being silently
 * dropped or silently overwriting the other.
 */
function liftFontFamilies(typography: Readonly<Record<string, TypographyStyle>>): {
  readonly sans: string;
  readonly mono: string;
} {
  const families = [...new Set(Object.values(typography).map((style) => style.fontFamily))];
  const mono = families.filter((family) => /mono/i.test(family));
  const sans = families.filter((family) => !/mono/i.test(family));

  if (mono.length !== 1) {
    throw new Error(
      `DESIGN.md typography: expected exactly one monospaced family, found ${mono.length} ` +
        `(${mono.join(', ') || 'none'}). DESIGN binds ALL numerals to one mono face; ` +
        '`--font-mono` has room for exactly one.',
    );
  }
  if (sans.length !== 1) {
    throw new Error(
      `DESIGN.md typography: expected exactly one proportional family, found ${sans.length} ` +
        `(${sans.join(', ') || 'none'}). \`--font-sans\` has room for exactly one; a second UI ` +
        'face is a design decision, not something this generator may pick between.',
    );
  }

  return { sans: sans[0] as string, mono: mono[0] as string };
}

/** The `--text-*` family for one style: size first, then the v4 sub-properties. */
function typographyDeclarations(name: string, style: TypographyStyle): readonly string[] {
  const declarations = [
    declaration(`--text-${name}`, style.fontSize),
    declaration(`--text-${name}--line-height`, style.lineHeight),
    declaration(`--text-${name}--font-weight`, style.fontWeight),
  ];
  // Emitted only where DESIGN tracks the style (`label-caps` alone today). Emitting `normal`
  // everywhere else would put a value in the theme that DESIGN never stated.
  if (style.letterSpacing !== undefined) {
    declarations.push(declaration(`--text-${name}--letter-spacing`, style.letterSpacing));
  }
  return declarations;
}

/**
 * Fail on any `{namespace.key}` inside `components:` that resolves to no token.
 *
 * The component block is never EMITTED — component anatomy is not a Tailwind theme namespace, and
 * it is story 1-6's to consume. But a dangling reference there is a defect in the source document
 * that would otherwise be discovered only when someone hand-built the component months later, so
 * the generator reads it as a checksum over the rest of the frontmatter.
 */
function validateComponentReferences(frontmatter: DesignFrontmatter): void {
  for (const [componentName, anatomy] of Object.entries(frontmatter.components)) {
    for (const value of Object.values(anatomy)) {
      // Matches an embedded reference, not only a whole-value one: `1px solid {colors.x}` is the
      // common shape in DESIGN.md and a dangling reference hides just as well inside it.
      for (const match of value.matchAll(/\{([a-z-]+)\.([A-Za-z0-9_-]+)\}/g)) {
        const namespace = match[1] as string;
        const key = match[2] as string;

        if (!(REFERENCE_NAMESPACES as readonly string[]).includes(namespace)) {
          throw new Error(
            `DESIGN.md components.${componentName}: '{${namespace}.${key}}' points at '${namespace}', ` +
              `which is not a token namespace. Expected one of: ${REFERENCE_NAMESPACES.join(', ')}.`,
          );
        }

        const section = frontmatter[namespace as (typeof REFERENCE_NAMESPACES)[number]];
        if (!(key in section)) {
          throw new Error(
            `DESIGN.md components.${componentName}: '{${namespace}.${key}}' resolves to no token — ` +
              `there is no '${key}' in the ${namespace} block.`,
          );
        }
      }
    }
  }
}

/** One CSS custom-property declaration. */
function declaration(name: string, value: string): string {
  return `${name}: ${value};`;
}

/** A blank line plus a wrapped `/* … *\/` comment, used to label a run of declarations. */
function section(...lines: readonly string[]): string {
  return ['', '/* ' + lines.join('\n   ') + ' */'].join('\n');
}

/** Indent every non-empty line of a block by `depth` two-space levels. */
function indent(depth: number): (block: string) => string {
  const prefix = '  '.repeat(depth);
  return (block) =>
    block
      .split('\n')
      .map((line) => (line === '' ? line : `${prefix}${line}`))
      .join('\n');
}
