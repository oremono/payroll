/**
 * The design-token build (AD-15). Reads DESIGN.md's frontmatter, renders the Tailwind v4 theme, and
 * writes `src/app/tokens.generated.css`.
 *
 *     node scripts/generate-design-tokens.ts            # write
 *     node scripts/generate-design-tokens.ts --check    # compare, write NOTHING, exit 1 on drift
 *
 * Run through `npm run tokens:build` / `npm run tokens:check`. Node 24 executes this file directly
 * via native type-stripping — no `tsx`, no `ts-node`, no build step to build the build step.
 *
 * ## Why the output is committed, and why this is NOT wired into `prebuild`
 *
 * The Prisma client is gitignored and regenerated in `postinstall`; this artifact deliberately goes
 * the other way. It is ONE small file that `next dev`, `next build`, and Playwright all need present
 * with no pre-step, and whose every change is exactly what a human reviewer should see in a diff —
 * a token moving is a visual-contract change, not noise.
 *
 * Drift is caught the way schema drift is, with an `--exit-code` check in CI
 * (`prisma migrate diff --exit-code` is the direct analogue). Regenerating inside `prebuild` would
 * make that gate UNFALSIFIABLE: the build would quietly repair the drift it is supposed to report.
 *
 * This is the imperative shell of the token build — all the rules live in the pure modules under
 * `scripts/design-tokens/`, and the shell's own DECISIONS live in `./design-tokens/cli.ts` so the
 * drift gate is testable. What remains here is argv, two filesystem calls, and the console.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { OUTPUT_RELATIVE_PATH, runTokenBuild } from './design-tokens/cli.ts';
import { readDesignFrontmatter } from './design-tokens/design-source.ts';
import { toThemeCss } from './design-tokens/to-css.ts';

const outputPath = fileURLToPath(new URL(`../${OUTPUT_RELATIVE_PATH}`, import.meta.url));

// Any throw from here — a malformed color, an unpaired one, a dangling component reference, a
// missing section — propagates and kills the process with its own message. That is deliberate: a
// partial or stale token file is worse than a stopped build, and DESIGN.md is not this build's to
// repair.
const generated = toThemeCss(readDesignFrontmatter());

// Everything that DECIDES lives in ./design-tokens/cli.ts, under test. What is left here is the
// four effects themselves: argv, the two filesystem calls, and the console.
//
// `process.exitCode`, NOT `process.exit()`. Node's console writes to a PIPE — which is what CI
// gives you — asynchronously, and `process.exit()` does not flush them. The drift message is the
// entire point of the `--check` gate, and exiting hard truncated it at exactly the moment it
// mattered: a red step with no explanation. Setting the code lets Node exit naturally once stdout
// and stderr have drained. (Code review 2026-07-19.)
process.exitCode = runTokenBuild({
  argv: process.argv.slice(2),
  generated,
  // ENOENT here IS the answer when the file has never been generated; the bare error names neither
  // the contract nor the fix, so it is flattened to `null` and restated by the caller. Every OTHER
  // failure — EACCES, EISDIR, EIO — is NOT that answer, and reporting it as "run tokens:build"
  // sends the reader to a command that cannot help. Those propagate with their own message.
  readCommitted: () => {
    try {
      return readFileSync(outputPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  },
  writeOutput: (contents) => writeFileSync(outputPath, contents, 'utf8'),
  log: (message) => console.log(message),
  error: (message) => console.error(message),
});
