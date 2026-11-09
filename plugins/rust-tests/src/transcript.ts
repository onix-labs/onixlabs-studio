// Reads how a `cargo test` run came out from what it printed (#1356).
//
// libtest's machine-readable output (`--format json`, `--format junit`) is nightly-only, so on a stable
// toolchain the transcript is the record: `Running` headers say which test binary is speaking, `test
// <path> ... ok` lines say how each test came out, and a `---- <path> stdout ----` section holds a
// failure's panic and its location.
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type {
  TestLocation,
  TestResult,
  TestRunResults,
  TestStackFrame,
} from '../../protocol/testing/protocol';
import { frameLocation } from '../../protocol/testing/source';
import { CargoTarget, Crate, targetKey } from './cargo';
import { RustDiscovery, RustTest } from './discover';

/**
 * Describes the test binary a stretch of the transcript comes from.
 */
interface Section {
  /**
   * Gets the target kind and, for a bin or test target, its name.
   */
  readonly target: CargoTarget;

  /**
   * Gets the binary's name as cargo printed it, without its hash: the library's crate name for a
   * library, the target's name otherwise.
   */
  readonly binary: string;
}

/**
 * Describes one test's line, before it is matched to a node.
 */
interface Outcome {
  readonly section: Section;
  readonly path: string;
  readonly outcome: 'passed' | 'failed' | 'skipped';
  readonly reason?: string;
}

/**
 * Reads a `Running` header.
 * @param line The line.
 * @returns Returns the section it starts, or null when it is not a header.
 */
export function readRunningHeader(line: string): Section | null {
  const match: RegExpExecArray | null = /^\s*Running (unittests )?(\S+) \((.+)\)\s*$/.exec(line);
  if (match === null) {
    return null;
  }
  const source: string = match[2].split(/[\\/]/).join('/');
  const binary: string = path
    .basename(match[3].trim())
    .replace(/(\.exe)?$/, '')
    .replace(/-[0-9a-f]{8,}$/, '');
  if (match[1] === undefined) {
    // An integration test: `tests/<name>.rs` or `tests/<name>/main.rs`.
    const parts: readonly string[] = source.split('/');
    const name: string =
      parts[parts.length - 1] === 'main.rs'
        ? parts[parts.length - 2]
        : path.basename(source, '.rs');
    return { target: { kind: 'test', name }, binary };
  }
  if (source.endsWith('src/lib.rs')) {
    return { target: { kind: 'lib' }, binary };
  }
  const bin: RegExpExecArray | null = /src\/bin\/([^/]+?)(?:\.rs|\/main\.rs)$/.exec(source);
  // `src/main.rs` is named after its package, which the binary's name carries with dashes as
  // underscores; that is matched loosely below.
  return { target: { kind: 'bin', name: bin?.[1] ?? binary }, binary };
}

/**
 * Compares two target names as cargo's binaries spell them: dashes and underscores alike.
 * @param a One name.
 * @param b The other.
 * @returns Returns true when they name the same binary.
 */
function sameName(a: string, b: string): boolean {
  return a.replace(/-/g, '_') === b.replace(/-/g, '_');
}

/**
 * Finds which crate and target a section's tests belong to: a crate with that target, whose library or
 * binary the header named, preferring the crates the run was for.
 * @param discovery What discovery found.
 * @param section The section.
 * @param asked The crates the run was for.
 * @returns Returns the crate and its target, or undefined when none matches.
 */
function crateOf(
  discovery: RustDiscovery,
  section: Section,
  asked: ReadonlySet<string>,
): { readonly crate: Crate; readonly target: CargoTarget } | undefined {
  const matches: { readonly crate: Crate; readonly target: CargoTarget }[] = [];
  for (const crate of discovery.crates) {
    for (const { target } of crate.targets) {
      const wanted: CargoTarget = section.target;
      const same: boolean =
        target.kind === 'lib'
          ? wanted.kind === 'lib' && sameName(crate.libName, section.binary)
          : wanted.kind === target.kind && sameName(target.name, wanted.name);
      if (same) {
        matches.push({ crate, target });
      }
    }
  }
  return matches.find((match): boolean => asked.has(match.crate.name)) ?? matches[0];
}

/**
 * Turns a panic's location into a link: cargo prints it relative to the workspace when the crate is a
 * member of one, and relative to the crate otherwise, so whichever names a file that exists wins.
 * @param line The `panicked at …` line.
 * @param crate The crate, when known.
 * @param root The folder.
 * @returns Returns the frame.
 */
function panicFrame(line: string, crate: Crate | undefined, root: string): TestStackFrame {
  const bases: readonly string[] = [
    ...(crate?.workspace === undefined ? [] : [path.dirname(crate.workspace)]),
    ...(crate === undefined ? [] : [crate.directory]),
    root,
  ];
  for (const base of bases) {
    const location: TestLocation | undefined = frameLocation(line, base);
    if (location !== undefined && existsSync(location.file)) {
      return { text: line, location };
    }
  }
  return { text: line };
}

/**
 * Reads a run's transcript into results.
 * @param root The folder.
 * @param discovery What discovery found, to match each line to a node.
 * @param askedIds The node identifiers the run was asked for.
 * @param output The transcript.
 * @param exitCode The command's exit code.
 * @returns Returns the results.
 */
export function readCargoTranscript(
  root: string,
  discovery: RustDiscovery,
  askedIds: readonly string[],
  output: string,
  exitCode: number,
): TestRunResults {
  // A terminal's progress bars redraw a line with carriage returns; only what was drawn last stays.
  const lines: readonly string[] = output
    .split(/\r?\n/)
    .map((line: string): string => line.split('\r').pop() ?? '');
  const asked: ReadonlySet<string> = new Set<string>(
    askedIds.map((id: string): string => id.split('::')[0]),
  );
  const outcomes: Outcome[] = [];
  const failures: Map<string, string[]> = new Map<string, string[]>();
  let section: Section | null = null;
  let capturing: string | null = null;
  const compileErrors: string[] = [];
  for (const line of lines) {
    const header: Section | null = readRunningHeader(line);
    if (header !== null) {
      section = header;
      capturing = null;
      continue;
    }
    if (/^\s*Doc-tests /.test(line)) {
      // Doc tests are not discovered, so their lines are not read.
      section = null;
      capturing = null;
      continue;
    }
    if (
      /^error(\[E\d+\])?: /.test(line) &&
      !line.startsWith('error: test failed') &&
      !/targets? failed/.test(line)
    ) {
      compileErrors.push(line.trim());
    }
    if (section === null) {
      continue;
    }
    const failureHeader: RegExpExecArray | null = /^---- (\S+) stdout ----$/.exec(line);
    if (failureHeader !== null) {
      capturing = `${JSON.stringify(section.target)}\u0000${section.binary}\u0000${failureHeader[1]}`;
      failures.set(capturing, []);
      continue;
    }
    if (capturing !== null) {
      if (/^(failures:|successes:|test result: )/.test(line)) {
        capturing = null;
      } else {
        failures.get(capturing)?.push(line);
        continue;
      }
    }
    const result: RegExpExecArray | null =
      /^test (\S+) \.\.\. (ok|FAILED|ignored)(?:, (.+))?$/.exec(line.trim());
    if (result !== null) {
      outcomes.push({
        section,
        path: result[1],
        outcome: result[2] === 'ok' ? 'passed' : result[2] === 'FAILED' ? 'failed' : 'skipped',
        ...(result[3] === undefined ? {} : { reason: result[3] }),
      });
    }
  }
  const results: TestResult[] = [];
  for (const found of outcomes) {
    const owner: { readonly crate: Crate; readonly target: CargoTarget } | undefined = crateOf(
      discovery,
      found.section,
      asked,
    );
    const crate: Crate | undefined = owner?.crate;
    const crateName: string = crate?.name ?? found.section.binary;
    const id: string = `${crateName}::${targetKey(owner?.target ?? found.section.target)}::${found.path}`;
    const known: RustTest | undefined = discovery.tests.get(id);
    const body: readonly string[] =
      failures.get(
        `${JSON.stringify(found.section.target)}\u0000${found.section.binary}\u0000${found.path}`,
      ) ?? [];
    const panic: string | undefined = body.find((line: string): boolean =>
      line.includes('panicked at '),
    );
    const message: string = body
      .filter(
        (line: string): boolean =>
          line !== panic && !line.startsWith('note: run with `RUST_BACKTRACE'),
      )
      .join('\n')
      .trim();
    results.push({
      id,
      outcome: found.outcome,
      ...(message.length > 0
        ? { message }
        : found.reason === undefined
          ? {}
          : { message: found.reason }),
      ...(panic === undefined ? {} : { stack: [panicFrame(panic.trim(), crate, root)] }),
      ...(body.length > 0 ? { output: body.join('\n').trim() } : {}),
      // A test discovery did not find — one a macro wrote — joins the tree under its crate.
      ...(known === undefined ? { parentId: crateName, label: found.path } : {}),
    });
  }
  if (results.length === 0 && exitCode !== 0) {
    return {
      results,
      problem:
        compileErrors.length > 0
          ? `The tests did not build:\n${compileErrors.slice(0, 20).join('\n')}`
          : `cargo test exited with code ${exitCode} before any test reported.`,
    };
  }
  return { results };
}
