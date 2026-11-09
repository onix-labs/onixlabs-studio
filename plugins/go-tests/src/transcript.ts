// Reads how a `go test -v` run came out from what it printed (#1357).
//
// `go test` prints each package's output together, ending with its result line (`ok`, `FAIL` or `?`
// and the import path), so a package's tests are known by the line that closes them. Within it, `===
// RUN` says which test is speaking, `--- PASS|FAIL|SKIP: Name (0.00s)` how each came out, indented
// `file_test.go:13: message` lines what it logged, and a `panic:` block what killed it.
import type {
  TestLocation,
  TestOutcome,
  TestResult,
  TestRunResults,
  TestStackFrame,
} from '../../protocol/testing/protocol';
import { frameLocation, stackFrames } from '../../protocol/testing/source';
import { GoDiscovery, GoPackage } from './discover';

/**
 * Describes what one test printed, until its package's result line names the package.
 */
interface Pending {
  readonly name: string;
  outcome?: TestOutcome;
  durationMs?: number;
  readonly logs: string[];
  readonly links: TestStackFrame[];
  panic?: string[];
}

/**
 * Matches a package's result line.
 */
const PACKAGE_RESULT: RegExp = /^(ok|FAIL|\?)\s+(\S+)(?:\s+(?:[\d.]+s|\(cached\)|\[[^\]]+\]|.*))?$/;

/**
 * Matches a test's result line, at any depth of subtest.
 */
const TEST_RESULT: RegExp = /^\s*--- (PASS|FAIL|SKIP): (\S+) \(([\d.]+)s\)$/;

/**
 * Reads a run's transcript into results.
 * @param root The folder.
 * @param discovery What discovery found.
 * @param output The transcript.
 * @param exitCode The command's exit code.
 * @returns Returns the results.
 */
export function readGoTranscript(
  root: string,
  discovery: GoDiscovery,
  output: string,
  exitCode: number,
): TestRunResults {
  const lines: readonly string[] = output
    .split(/\r?\n/)
    .map((line: string): string => line.split('\r').pop() ?? '');
  const results: TestResult[] = [];
  const problems: string[] = [];
  let tests: Map<string, Pending> = new Map<string, Pending>();
  let current: Pending | null = null;
  let lastFailed: Pending | null = null;
  let building: string | null = null;
  const pending: (name: string) => Pending = (name: string): Pending => {
    let entry: Pending | undefined = tests.get(name);
    if (entry === undefined) {
      entry = { name, logs: [], links: [] };
      tests.set(name, entry);
    }
    return entry;
  };
  for (const line of lines) {
    const started: RegExpExecArray | null = /^=== (?:RUN|CONT|PAUSE|NAME)\s+(\S+)/.exec(line);
    if (started !== null) {
      current = pending(started[1]);
      building = null;
      continue;
    }
    const finished: RegExpExecArray | null = TEST_RESULT.exec(line);
    if (finished !== null) {
      const entry: Pending = pending(finished[2]);
      entry.outcome =
        finished[1] === 'PASS' ? 'passed' : finished[1] === 'FAIL' ? 'failed' : 'skipped';
      entry.durationMs = Math.round(Number(finished[3]) * 1000);
      lastFailed = entry.outcome === 'failed' ? entry : lastFailed;
      current = null;
      continue;
    }
    const closed: RegExpExecArray | null = PACKAGE_RESULT.exec(line);
    if (closed !== null && !/^(PASS|FAIL)$/.test(line.trim())) {
      const pkg: GoPackage | undefined = discovery.packages.get(closed[2]);
      if (/\[(build|setup) failed\]/.test(line)) {
        problems.push(line.trim());
      }
      results.push(...toResults(closed[2], pkg, tests, discovery, root));
      tests = new Map<string, Pending>();
      current = null;
      lastFailed = null;
      building = null;
      continue;
    }
    if (line.startsWith('# ')) {
      // The header of a package's build errors.
      building = line.slice(2).trim();
      continue;
    }
    if (building !== null && line.trim().length > 0) {
      problems.push(line.trim());
      continue;
    }
    if (lastFailed !== null && (line.startsWith('panic: ') || lastFailed.panic !== undefined)) {
      lastFailed.panic = [...(lastFailed.panic ?? []), line];
      continue;
    }
    const logged: RegExpExecArray | null = /^\s{4,}(\S+\.go):(\d+): (.*)$/.exec(line);
    if (logged !== null && current !== null) {
      current.logs.push(logged[3]);
      current.links.push({ text: `${logged[1]}:${logged[2]}: ${logged[3]}` });
      continue;
    }
    if (current !== null && /^\s{8,}\S/.test(line) && current.logs.length > 0) {
      // A logged message's continuation lines.
      current.logs[current.logs.length - 1] += `\n${line.trim()}`;
    }
  }
  if (results.length === 0 && exitCode !== 0) {
    return {
      results,
      problem:
        problems.length > 0
          ? `The tests did not build:\n${problems.slice(0, 20).join('\n')}`
          : `go test exited with code ${exitCode} before any test reported.`,
    };
  }
  return problems.length > 0
    ? { results, problem: `Some packages did not build:\n${problems.slice(0, 20).join('\n')}` }
    : { results };
}

/**
 * Turns one package's tests into results.
 * @param importPath The package's import path.
 * @param pkg The package, when discovery found it.
 * @param tests What each of its tests printed.
 * @param discovery What discovery found, to tell a known test from one only the run found.
 * @param root The folder, which relative log paths fall back to.
 * @returns Returns the results.
 */
function toResults(
  importPath: string,
  pkg: GoPackage | undefined,
  tests: ReadonlyMap<string, Pending>,
  discovery: GoDiscovery,
  root: string,
): readonly TestResult[] {
  const base: string = pkg?.directory ?? root;
  const results: TestResult[] = [];
  for (const entry of tests.values()) {
    if (entry.outcome === undefined) {
      continue;
    }
    const id: string = `${importPath}#${entry.name}`;
    const slash: number = entry.name.lastIndexOf('/');
    const frames: TestStackFrame[] = entry.links.map((frame: TestStackFrame): TestStackFrame => {
      const location: TestLocation | undefined = frameLocation(frame.text, base);
      return location === undefined ? frame : { text: frame.text, location };
    });
    if (entry.panic !== undefined) {
      frames.push(...stackFrames(entry.panic.join('\n'), base));
    }
    const message: string = [
      ...(entry.panic === undefined ? [] : [entry.panic[0]]),
      ...entry.logs,
    ].join('\n');
    results.push({
      id,
      outcome: entry.outcome,
      ...(entry.durationMs === undefined ? {} : { durationMs: entry.durationMs }),
      ...(message.length > 0 ? { message } : {}),
      ...(frames.length > 0 ? { stack: frames } : {}),
      ...(entry.panic === undefined ? {} : { output: entry.panic.join('\n') }),
      // A subtest is known only by running: it joins the tree under the test that ran it.
      ...(slash < 0
        ? discovery.tests.has(id)
          ? {}
          : { parentId: importPath, label: entry.name }
        : {
            parentId: `${importPath}#${entry.name.slice(0, slash)}`,
            label: entry.name.slice(slash + 1),
          }),
    });
  }
  return results;
}
