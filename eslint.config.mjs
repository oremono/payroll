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
 * Repo-wide randomness ban (AD-14): `Math.random` is banned everywhere by lint — the seeded PRNG
 * port (src/adapters/prng.ts, the single exemption) is the only randomness source. This block has
 * no `files`, so it applies to every linted file. NOTE: it sits BEFORE purityConfig on purpose —
 * flat-config rule entries replace (not merge), so for the pure layers purityConfig's fuller
 * selector array (which re-includes this ban) wins, and this block covers everything else.
 */
const randomnessBanConfig = {
  ignores: ['src/adapters/prng.ts'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: "MemberExpression[object.name='Math'][property.name='random']",
        message:
          'Math.random is banned repo-wide (AD-14). Randomness comes only from the seeded PRNG port (src/adapters/prng.ts).',
      },
    ],
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
          { name: 'next', message: 'No Next.js in the pure core (Law 2).' },
        ],
        patterns: [
          {
            group: ['fs/*', 'node:fs/*', 'next/*', '@prisma/*', 'prisma/*'],
            message: 'No filesystem / Next / Prisma imports in the pure core (Law 2).',
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
  randomnessBanConfig,
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
