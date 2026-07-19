import { describe, expect, it } from 'vitest';

import { runTokenBuild } from '../../scripts/design-tokens/cli.ts';

// Test-first (Law 1 / AD-23): this suite lands red, before `scripts/design-tokens/cli.ts` exists.
//
// Acceptance criterion 1 is written about `tokens:check`, and the whole story rests on "CI proves
// the generated file is in sync" — yet the prover itself shipped with zero tests (code review
// 2026-07-19). That is the most dangerous shape a gate can have: an INVERTED comparison here would
// make `tokens:check` exit 0 unconditionally, and every gate in the repo would keep passing while
// the theme silently drifted away from DESIGN.md. Nothing downstream could notice.
//
// `runTokenBuild` is the shell's decision logic with fs, argv, and exit codes handed in, so each
// branch — in sync, drift, never generated, write — is exercisable without touching the disk or
// the real DESIGN.md. `scripts/generate-design-tokens.ts` supplies the real implementations of
// those four; it is now a wiring file with nothing left to get wrong.

/** A recording double for the four effects `runTokenBuild` is allowed to have. */
function harness(committed: string | null) {
  const writes: string[] = [];
  const logs: string[] = [];
  const errors: string[] = [];

  return {
    writes,
    logs,
    errors,
    run(argv: readonly string[], generated: string): number {
      return runTokenBuild({
        argv,
        generated,
        readCommitted: () => committed,
        writeOutput: (contents) => writes.push(contents),
        log: (message) => logs.push(message),
        error: (message) => errors.push(message),
      });
    },
  };
}

const IN_SYNC = '/* generated */\n:root { --color-ink: #191c1e; }\n';
const DRIFTED = '/* generated */\n:root { --color-ink: #000000; }\n';

describe('tokens:check — the drift gate acceptance criterion 1 is written about', () => {
  it('exits 0 when the committed artifact matches what DESIGN.md renders', () => {
    const io = harness(IN_SYNC);

    expect(io.run(['--check'], IN_SYNC)).toBe(0);
  });

  it('writes NOTHING when in sync — `--check` compares, it never repairs', () => {
    const io = harness(IN_SYNC);
    io.run(['--check'], IN_SYNC);

    expect(io.writes).toEqual([]);
  });

  it('exits 1 on drift', () => {
    const io = harness(DRIFTED);

    expect(io.run(['--check'], IN_SYNC)).toBe(1);
  });

  it('writes NOTHING on drift — repairing it would make the gate unfalsifiable', () => {
    const io = harness(DRIFTED);
    io.run(['--check'], IN_SYNC);

    expect(io.writes).toEqual([]);
  });

  it('names the rebuild command on drift, so the failure is actionable in CI logs', () => {
    const io = harness(DRIFTED);
    io.run(['--check'], IN_SYNC);

    expect(io.errors.join('\n')).toContain('npm run tokens:build');
  });

  it('names both files on drift — the artifact and the source of truth', () => {
    const io = harness(DRIFTED);
    io.run(['--check'], IN_SYNC);

    const reported = io.errors.join('\n');
    expect(reported).toContain('src/app/tokens.generated.css');
    expect(reported).toContain('DESIGN.md');
  });

  it('reports drift on stderr, never on stdout — a green log line must mean green', () => {
    const io = harness(DRIFTED);
    io.run(['--check'], IN_SYNC);

    expect(io.logs).toEqual([]);
    expect(io.errors.length).toBeGreaterThan(0);
  });

  it('exits 1 when the artifact has never been generated', () => {
    const io = harness(null);

    expect(io.run(['--check'], IN_SYNC)).toBe(1);
  });

  it('says the file does not exist rather than reporting it as drift', () => {
    const io = harness(null);
    io.run(['--check'], IN_SYNC);

    expect(io.errors.join('\n')).toMatch(/does not exist/i);
    expect(io.errors.join('\n')).toContain('npm run tokens:build');
  });

  it('writes nothing in the missing-file branch either', () => {
    const io = harness(null);
    io.run(['--check'], IN_SYNC);

    expect(io.writes).toEqual([]);
  });

  // Drift is any byte difference: the artifact is compared verbatim, not normalised.
  it('treats a whitespace-only difference as drift', () => {
    const io = harness(`${IN_SYNC}\n`);

    expect(io.run(['--check'], IN_SYNC)).toBe(1);
  });
});

describe('tokens:build — the write path', () => {
  it('writes the rendered stylesheet when `--check` is absent', () => {
    const io = harness(null);
    io.run([], IN_SYNC);

    expect(io.writes).toEqual([IN_SYNC]);
  });

  it('exits 0 after writing', () => {
    const io = harness(null);

    expect(io.run([], IN_SYNC)).toBe(0);
  });

  it('overwrites a drifted artifact — this is the branch that REPAIRS drift', () => {
    const io = harness(DRIFTED);
    io.run([], IN_SYNC);

    expect(io.writes).toEqual([IN_SYNC]);
  });

  it('reports what it wrote on stdout', () => {
    const io = harness(null);
    io.run([], IN_SYNC);

    expect(io.logs.join('\n')).toContain('src/app/tokens.generated.css');
    expect(io.errors).toEqual([]);
  });
});

describe('argv parsing — the flag the two npm scripts differ by', () => {
  it('recognises `--check` among other arguments', () => {
    const io = harness(DRIFTED);

    expect(io.run(['--verbose', '--check'], IN_SYNC)).toBe(1);
    expect(io.writes).toEqual([]);
  });

  // The failure this pins: a flag test that never matches turns `tokens:check` into a silent
  // `tokens:build`, which would repair drift in CI and report success forever.
  it('does not treat an unrelated flag as `--check`', () => {
    const io = harness(DRIFTED);
    io.run(['--checksum'], IN_SYNC);

    expect(io.writes).toEqual([IN_SYNC]);
  });
});
