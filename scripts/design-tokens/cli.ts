/**
 * The token build's DECISION logic, with its effects handed in.
 *
 * `scripts/generate-design-tokens.ts` used to hold both this and the effects themselves, which
 * made the drift gate — the thing acceptance criterion 1 is written about, and the thing every
 * other gate in the repo trusts — the one artifact in the story with no test at all. An inverted
 * comparison in here would make `npm run tokens:check` exit 0 forever while the theme drifted away
 * from DESIGN.md, and nothing downstream could notice.
 *
 * So the four effects (argv, read, write, print) are parameters, the outcome is a RETURNED exit
 * code rather than a `process.exit`, and `tests/tokens/token-cli.test.ts` walks every branch. The
 * entry file is left as pure wiring: `node:fs`, `console`, `process` — nothing to get wrong.
 *
 * Still shell, not domain: it decides about the filesystem. It simply no longer *performs* it.
 */

import { DESIGN_MD_RELATIVE_PATH } from './design-source.ts';

/** The generated artifact, relative to the repository root. */
export const OUTPUT_RELATIVE_PATH = 'src/app/tokens.generated.css';

/** Exit code for drift. Distinct from an unexpected crash so CI can tell the two apart. */
export const DRIFT_EXIT_CODE = 1;

/** The flag that turns the build into a comparison. */
const CHECK_FLAG = '--check';

export type TokenBuildIO = {
  /** Process arguments, already stripped of the node/script entries. */
  readonly argv: readonly string[];
  /** The stylesheet DESIGN.md renders to. Computed by the caller — a throw there kills the build. */
  readonly generated: string;
  /** The committed artifact, or `null` when it has never been generated. */
  readonly readCommitted: () => string | null;
  readonly writeOutput: (contents: string) => void;
  readonly log: (message: string) => void;
  readonly error: (message: string) => void;
};

/**
 * Run the build (or the check) and return the process exit code.
 *
 * `--check` COMPARES and never writes: repairing the drift it is meant to report would make the
 * gate unfalsifiable, which is the same reason generation is not wired into `prebuild`. The
 * comparison is verbatim — any byte difference, whitespace included, is drift, because the
 * artifact is byte-reproducible from the same frontmatter by construction.
 */
export function runTokenBuild(io: TokenBuildIO): number {
  if (!io.argv.includes(CHECK_FLAG)) {
    io.writeOutput(io.generated);
    io.log(`Wrote ${OUTPUT_RELATIVE_PATH} from ${DESIGN_MD_RELATIVE_PATH}.`);
    return 0;
  }

  const committed = io.readCommitted();

  // A missing artifact IS drift, but reporting it as drift would send the reader looking for a
  // diff that does not exist. It gets its own sentence.
  if (committed === null) {
    io.error(
      `${OUTPUT_RELATIVE_PATH} does not exist. It is a COMMITTED build artifact — run ` +
        '`npm run tokens:build` and commit the result.',
    );
    return DRIFT_EXIT_CODE;
  }

  if (committed !== io.generated) {
    io.error(
      `${OUTPUT_RELATIVE_PATH} is out of sync with ${DESIGN_MD_RELATIVE_PATH}.\n` +
        'Run `npm run tokens:build` and commit the result. Do not edit the generated file by ' +
        'hand — DESIGN.md is the single source of visual truth (AD-15).',
    );
    return DRIFT_EXIT_CODE;
  }

  io.log(`${OUTPUT_RELATIVE_PATH} is in sync with ${DESIGN_MD_RELATIVE_PATH}.`);
  return 0;
}
