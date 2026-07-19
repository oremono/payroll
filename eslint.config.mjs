import next from 'eslint-config-next/core-web-vitals';
import importPlugin from 'eslint-plugin-import';

// ESLint flat config for Next 16. `next lint` is removed in Next 16, so the `lint` script invokes
// the ESLint CLI (`eslint .`) directly. `eslint-config-next` (v16) exports a native flat config
// array — no FlatCompat shim needed.
//
// This config mechanically enforces the functional-core / imperative-shell boundary (Law 2 / AD-1)
// and the determinism ban (Law 6): the import direction between layers, and the prohibition of the
// clock / randomness / infrastructure inside the pure layers. The layer READMEs document these
// rules; here they become CI gates that block merge.

// Every JS/TS extension Next can compile (tsconfig has `allowJs: true`) — the gates must cover all
// of them, or a stray `.js`/`.mts` file in a layer silently bypasses every rule below.
const SRC_EXTENSIONS = '{js,jsx,ts,tsx,mjs,cjs,mts,cts}';

/**
 * Layer import direction — domain ← application ← adapters ← app/ui (deps point strictly inward).
 *
 * `import/no-restricted-paths` resolves each import to a real file (via the TypeScript alias
 * resolver, so `@/adapters/clock` maps to src/adapters/clock.ts) and forbids a zone's `target`
 * files from importing anything under `from` except the `except` list. External npm packages
 * (react, next, …) live outside src and are governed by the purity ban below, not here.
 */
const importResolverSettings = {
  'import/resolver': {
    typescript: { alwaysTryTypes: true },
    node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] },
  },
};

const layerBoundaryConfig = {
  files: [`src/**/*.${SRC_EXTENSIONS}`],
  plugins: { import: importPlugin },
  settings: importResolverSettings,
  rules: {
    'import/no-restricted-paths': [
      'error',
      {
        zones: [
          {
            target: './src/domain',
            from: './src',
            except: ['./domain'],
            message: 'domain is the pure core: it imports nothing outside src/domain (Law 2 / AD-1).',
          },
          {
            target: './src/application',
            from: './src',
            except: ['./domain', './application'],
            message: 'application may import only domain (AD-1).',
          },
          {
            target: './src/adapters',
            from: './src',
            except: ['./domain', './application', './adapters'],
            message: 'adapters may import application + domain (AD-1).',
          },
          {
            // `app` additionally imports `ui` (pages render components) and `adapters` (the
            // composition root: Server Components / Server Actions construct adapters and inject
            // them into use-cases — the only place shell wiring may happen). Both edges are
            // deliberate, recorded extensions of the base matrix — see story 1-2 review record.
            target: './src/app',
            from: './src',
            except: ['./domain', './application', './ui', './adapters', './app'],
            message: 'app may import application, domain, ui, and adapters (composition root) (AD-1).',
          },
          {
            target: './src/ui',
            from: './src',
            except: ['./domain', './application', './ui'],
            message: 'ui may import application + domain (types only, by convention) (AD-1).',
          },
        ],
      },
    ],
  },
};

/**
 * ## The `no-restricted-syntax` layering — READ THIS BEFORE EDITING ANY BLOCK BELOW
 *
 * Four config blocks in this file set `no-restricted-syntax`. Flat-config rule entries **REPLACE
 * rather than merge**: for any given file, the LAST matching block's selector array is the only one
 * that runs. A narrower block that forgets a selector does not weaken it — it REVOKES it, silently,
 * for every file it matches. Ordering is therefore load-bearing, and every block must carry every
 * selector that should still apply to the files it matches.
 *
 * The order, widest to narrowest:
 *
 *   1. randomnessBanConfig  — no `files`: every linted file. Randomness only.
 *   2. colorLiteralBanConfig — `src/**`: randomness (re-declared) + color literals.
 *   3. prngExemptionConfig  — `src/adapters/prng.ts`: color literals ONLY. The AD-14 exemption.
 *   4. purityConfig         — `src/domain/**` + `src/application/**`: clock/env/randomness/import
 *                             bans + color literals (re-declared).
 *
 * This is not hypothetical: the AD-14 PRNG exemption was lost exactly this way when block 2 was
 * introduced with no `ignores` and no re-declaration accounting. `tests/tokens/eslint-config.test.ts`
 * now pins every intersection through `ESLint.lintText` against this very file.
 */

/**
 * Repo-wide randomness ban (AD-14): `Math.random` is banned everywhere by lint — the seeded PRNG
 * port (src/adapters/prng.ts, the single exemption) is the only randomness source. This block has
 * no `files`, so it applies to every linted file, and `ignores` lifts it for the port itself.
 */
const RANDOMNESS_BAN_SELECTOR = {
  selector: "MemberExpression[object.name='Math'][property.name='random']",
  message:
    'Math.random is banned repo-wide (AD-14). Randomness comes only from the seeded PRNG port (src/adapters/prng.ts).',
};

const randomnessBanConfig = {
  ignores: ['src/adapters/prng.ts'],
  rules: {
    'no-restricted-syntax': ['error', RANDOMNESS_BAN_SELECTOR],
  },
};

/**
 * Color-literal ban (AD-15) — the enforcement half of "no color literal appears in application
 * code".
 *
 * AD-1 and AD-14 both NAME lint as their gate; AD-15's prohibition had none, which made it a wish
 * (review-rubric F). Colors come from the generated theme — `var(--color-…)`, or a Tailwind utility
 * that compiles to one — and the theme comes from DESIGN.md's frontmatter via `npm run tokens:build`.
 * A color literal in a component is a token that has escaped the contract, invisible to the drift
 * gate and to the contrast gate both.
 *
 * ALL CSS color notations, not just hex. AD-15's subject is a color that escaped the token
 * contract, not a color spelled in base 16, and a hex-only ban waves through the exact threat this
 * story names as highest-risk: the shadcn/ui copy-in in story 1-6, whose Tailwind v4 templates ship
 * **oklch**, not hex. `color-mix()` is deliberately absent — it composes existing tokens rather than
 * naming a color, and its arguments are caught on their own if they are literals.
 *
 * Scoped to `src/**` on purpose: the generator, its tests, and the contrast gate under `scripts/`
 * and `tests/` all handle color strings as DATA and must keep being able to. The counterpart ban
 * inside `src/**\/*.css` (which ESLint structurally cannot see) is tests/tokens/no-hex.test.ts; the
 * one sanctioned file, src/app/tokens.generated.css, is not JS/TS and is not matched here.
 *
 * The regexes deliberately catch an EMBEDDED literal (`'1px solid #e2e8f0'`), not only a whole-value
 * one, and hex covers 3/4/6/8-digit forms. Template literals need their own selector because their
 * text lives on TemplateElement, not on a Literal node.
 *
 * ### The known false positive, and its escape hatch
 *
 * `#feed`, `#face`, `#dad`, `#beef`, `#decade` are all valid hex spellings AND valid fragment
 * identifiers, so `<a href="#feed">` and `querySelector('#beef')` are rejected. The two are not
 * separable syntactically, and contorting the selector to guess intent would cost the ban its
 * teeth — so this is an ACCEPTED, tested edge (see tests/tokens/eslint-config.test.ts). When it
 * fires on a genuine fragment identifier, silence that ONE line with a reason:
 *
 *     // eslint-disable-next-line no-restricted-syntax -- fragment identifier, not a color.
 *     <a href="#feed">…</a>
 *
 * Renaming the anchor to something that is not four hex digits is usually the better fix.
 *
 * See the layering note above `randomnessBanConfig`: this block re-declares the randomness selector
 * because it REPLACES that block's array for `src/**`.
 */
const HEX_COLOR_PATTERN = String.raw`#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])`;

/**
 * Every CSS color FUNCTION notation. `\b` keeps `getColor(` and `color-mix(` out; the trailing `\(`
 * keeps the bare words (`lab`, `color`) out — only a call shape is a color.
 */
const CSS_COLOR_FUNCTION_PATTERN = String.raw`\b(rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\(`;

const COLOR_LITERAL_BAN_MESSAGE =
  'No color literal in application code (AD-15) — hex, rgb/rgba, hsl/hsla, hwb, lab/lch, ' +
  'oklab/oklch, and color() alike. Colors come from the generated theme — use a Tailwind token ' +
  'utility or var(--color-…). To change a value, edit DESIGN.md and run `npm run tokens:build`; ' +
  'src/app/tokens.generated.css is the only file in src/ allowed to hold a color literal. For a ' +
  'fragment identifier that merely spells hex (`#feed`), silence this one line with ' +
  '`// eslint-disable-next-line no-restricted-syntax -- fragment identifier, not a color.`';

const COLOR_LITERAL_BAN_SELECTORS = [
  {
    selector: `Literal[value=/${HEX_COLOR_PATTERN}/]`,
    message: COLOR_LITERAL_BAN_MESSAGE,
  },
  {
    selector: `TemplateElement[value.raw=/${HEX_COLOR_PATTERN}/]`,
    message: COLOR_LITERAL_BAN_MESSAGE,
  },
  {
    selector: `Literal[value=/${CSS_COLOR_FUNCTION_PATTERN}/]`,
    message: COLOR_LITERAL_BAN_MESSAGE,
  },
  {
    selector: `TemplateElement[value.raw=/${CSS_COLOR_FUNCTION_PATTERN}/]`,
    message: COLOR_LITERAL_BAN_MESSAGE,
  },
];

const colorLiteralBanConfig = {
  files: [`src/**/*.${SRC_EXTENSIONS}`],
  rules: {
    'no-restricted-syntax': ['error', RANDOMNESS_BAN_SELECTOR, ...COLOR_LITERAL_BAN_SELECTORS],
  },
};

/**
 * The AD-14 exemption, restored (code review 2026-07-19).
 *
 * `randomnessBanConfig` lifts the randomness ban for the seeded PRNG port via `ignores` — but
 * `colorLiteralBanConfig` above matches `src/**`, which INCLUDES prng.ts, and its array re-declares
 * the randomness selector. Because rule entries replace rather than merge, that silently put the
 * ban back for the one file AD-14 exempts. It went unnoticed only because prng.ts is still a
 * throwing stub; story 1-12 (the seeded PRNG itself) would have hit it.
 *
 * Adding prng.ts to `colorLiteralBanConfig.ignores` would have traded the randomness hole for a
 * color hole — the port has no more business holding a color literal than any other file. So the
 * exemption is a block of its own, LAST-matching for prng.ts, carrying the color selectors and
 * omitting only the randomness one.
 */
const prngExemptionConfig = {
  files: ['src/adapters/prng.ts'],
  rules: {
    'no-restricted-syntax': ['error', ...COLOR_LITERAL_BAN_SELECTORS],
  },
};

/**
 * Purity ban (Law 6 / Law 2): no clock, no randomness, no env, no infrastructure inside the pure
 * layers. Applies to BOTH domain and application — Law 6 forbids reading the clock in either; the
 * only sanctioned "now" is the clock port, implemented in an adapter. Clock/randomness reads are
 * global/member expressions (not imports), so they need syntax selectors, while `fs` / Prisma /
 * Next / crypto are caught as imports. (Full aliasing — `const D = Date` — is not statically
 * catchable; review owns that residue.)
 */
const purityConfig = {
  files: [`src/domain/**/*.${SRC_EXTENSIONS}`, `src/application/**/*.${SRC_EXTENSIONS}`],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: "NewExpression[callee.name='Date']",
        message:
          'No `new Date()` in the pure core (Law 6). Take the as-of date as a parameter; the clock lives only in src/adapters/clock.ts.',
      },
      {
        selector: "CallExpression[callee.name='Date']",
        message:
          'No `Date()` in the pure core (Law 6) — called bare it returns the current time. The clock port is the only source of "now".',
      },
      {
        selector: "MemberExpression[object.name='Date'][property.name='now']",
        message:
          'No `Date.now` in the pure core (Law 6). The clock port (src/adapters/clock.ts) is the only source of "now".',
      },
      {
        selector: "MemberExpression[object.name=/^(globalThis|window|self)$/][property.name='Date']",
        message: 'No qualified `Date` access in the pure core (Law 6) — same clock, different door.',
      },
      {
        selector: "MemberExpression[object.name='Math'][property.name='random']",
        message:
          'No `Math.random` in the pure core (AD-14). Randomness comes from the seeded PRNG port (src/adapters/prng.ts).',
      },
      {
        selector: "MemberExpression[object.name='crypto'][property.name=/^(randomUUID|getRandomValues)$/]",
        message:
          'No crypto randomness in the pure core (AD-14). IDs and randomness come in through ports (src/application/ports/).',
      },
      {
        selector: "MemberExpression[object.name='performance'][property.name='now']",
        message: 'No `performance.now()` in the pure core (Law 6) — it is a clock.',
      },
      {
        selector: "MemberExpression[object.name='process'][property.name='env']",
        message:
          'No `process.env` in the pure core (Law 2) — config is passed in as arguments at the boundary.',
      },
      {
        selector: 'ImportExpression',
        message:
          'No dynamic import() in the pure core (Law 2) — the pure layers are static, synchronous logic; dynamic loading is shell business.',
      },
      // Re-declared, not inherited: this array REPLACES colorLiteralBanConfig's for domain and
      // application files. Dropping them here would make the pure core the one corner of src/
      // where a color literal lints clean.
      ...COLOR_LITERAL_BAN_SELECTORS,
    ],
    'no-restricted-imports': [
      'error',
      {
        paths: [
          { name: 'fs', message: 'No filesystem access in the pure core (Law 2).' },
          { name: 'node:fs', message: 'No filesystem access in the pure core (Law 2).' },
          { name: 'crypto', message: 'No crypto randomness in the pure core (AD-14). Use the PRNG/id ports.' },
          { name: 'node:crypto', message: 'No crypto randomness in the pure core (AD-14). Use the PRNG/id ports.' },
          { name: 'child_process', message: 'No process spawning in the pure core (Law 2).' },
          { name: 'node:child_process', message: 'No process spawning in the pure core (Law 2).' },
          { name: 'perf_hooks', message: 'No perf_hooks in the pure core (Law 6) — it is a clock.' },
          { name: 'node:perf_hooks', message: 'No perf_hooks in the pure core (Law 6) — it is a clock.' },
          { name: '@prisma/client', message: 'No Prisma in the pure core (Law 2). Reach the DB through a port + adapter.' },
          { name: '@prisma/adapter-pg', message: 'No Prisma driver adapter in the pure core (Law 2). Reach the DB through a port + adapter.' },
          { name: 'next', message: 'No Next.js in the pure core (Law 2).' },
        ],
        patterns: [
          {
            group: ['fs/*', 'node:fs/*', 'next/*', '@prisma/*', 'prisma/*'],
            message: 'No filesystem / Next / Prisma imports in the pure core (Law 2).',
          },
          {
            // Under Prisma 7 the generator emits TypeScript source to a path inside src/ — so a
            // domain leak no longer imports the literal specifier `@prisma/client` (which the
            // `paths` list above bans) but the GENERATED PATH, which would otherwise lint clean.
            // Cover every way to spell it: the alias, and relative paths that climb out of the
            // pure layers into the adapters tree.
            group: [
              '@/adapters/db/generated',
              '@/adapters/db/generated/*',
              '@/adapters/*',
              '**/adapters/db/generated',
              '**/adapters/db/generated/*',
            ],
            message:
              'No Prisma generated client in the pure core (Law 2). The DB is reached through a port declared in src/application/ports/ and implemented in src/adapters/db/.',
          },
        ],
      },
    ],
  },
};

/** @type {import('eslint').Linter.Config[]} */
const config = [
  ...next,
  layerBoundaryConfig,
  // Order matters — see the `no-restricted-syntax` layering note above randomnessBanConfig.
  // Widest block first, narrowest last; each narrower one re-declares every selector that should
  // still apply to the files it matches, because rule entries REPLACE rather than merge.
  randomnessBanConfig,
  colorLiteralBanConfig,
  prngExemptionConfig,
  purityConfig,
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'coverage/**',
      'reports/**',
      '.stryker-tmp/**',
      'test-results/**',
      'playwright-report/**',
      'next-env.d.ts',
      // Prisma generated client — the v7 generator emits TypeScript SOURCE under src/, so ESLint
      // would otherwise lint thousands of generated files. One of five exclusions (see also
      // .gitignore, vitest coverage, stryker.config.json, tsconfig.json `exclude`).
      'src/adapters/db/generated/**',
      // Tooling / planning artifacts — not application source.
      '.claude/**',
      '_bmad/**',
      '.bmad-loop/**',
      'design-artifacts/**',
      'docs/**',
    ],
  },
];

export default config;
