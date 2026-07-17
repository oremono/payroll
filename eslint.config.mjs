import next from 'eslint-config-next/core-web-vitals';

// Baseline ESLint flat config for Next 16. `next lint` is removed in Next 16, so the `lint` script
// invokes the ESLint CLI (`eslint .`) directly. `eslint-config-next` (v16) exports a native flat
// config array — no FlatCompat shim needed.
//
// NOTE: the import-boundary rule that mechanically enforces the layer dependency direction is
// Story 1-2's Definition of Done, NOT this one. Do not add it here.

/** @type {import('eslint').Linter.Config[]} */
const config = [
  ...next,
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'coverage/**',
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
