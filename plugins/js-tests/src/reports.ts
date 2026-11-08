// Reads the reports a run's steps wrote into its output folder (#1354): Vitest's and Jest's JSON, which
// share Jest's shape, and Playwright's JSON reporter's.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type {
  TestOutcome,
  TestResult,
  TestRunResults,
  TestStackFrame,
} from '../../protocol/testing/protocol';
import { stackFrames } from '../../protocol/testing/source';
import { testId } from './discover';

/**
 * Removes colour codes, which Playwright writes into its errors.
 * @param text The text.
 * @returns Returns it plain.
 */
export function plain(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Splits a failure into its message and its stack: the stack is the lines from the first `at …`.
 * @param failure The failure's text.
 * @param base The folder relative paths are resolved against.
 * @returns Returns the message and the frames.
 */
export function splitFailure(
  failure: string,
  base: string,
): { readonly message: string; readonly stack: readonly TestStackFrame[] } {
  const lines: readonly string[] = plain(failure).split(/\r?\n/);
  const first: number = lines.findIndex((line: string): boolean => /^\s+at /.test(line));
  const message: string = (first < 0 ? lines : lines.slice(0, first)).join('\n').trim();
  return {
    message,
    stack: first < 0 ? [] : stackFrames(lines.slice(first).join('\n'), base),
  };
}

/**
 * Maps a Jest or Vitest status onto the protocol's outcome.
 * @param status The status.
 * @returns Returns the outcome.
 */
function jestOutcome(status: unknown): TestOutcome {
  switch (status) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'pending':
    case 'skipped':
    case 'todo':
    case 'disabled':
      return 'skipped';
    default:
      return 'errored';
  }
}

/**
 * Reads a record.
 * @param value The candidate.
 * @returns Returns it, or an empty record.
 */
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Reads text.
 * @param value The candidate.
 * @returns Returns it, or an empty string when it is not text.
 */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Reads a list.
 * @param value The candidate.
 * @returns Returns it, or an empty list.
 */
function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Reads a Vitest or Jest JSON report.
 * @param report The parsed report.
 * @returns Returns each test's result, and the problems of files that could not run.
 */
export function readJestReport(report: unknown): { results: TestResult[]; problems: string[] } {
  const results: TestResult[] = [];
  const problems: string[] = [];
  for (const fileValue of list(record(report)['testResults'])) {
    const file: Record<string, unknown> = record(fileValue);
    const name: string = typeof file['name'] === 'string' ? file['name'] : '';
    const assertions: readonly unknown[] = list(file['assertionResults']);
    if (
      assertions.length === 0 &&
      typeof file['message'] === 'string' &&
      file['message'].length > 0
    ) {
      problems.push(`${path.basename(name)}: ${plain(file['message']).trim()}`);
    }
    for (const assertionValue of assertions) {
      const assertion: Record<string, unknown> = record(assertionValue);
      const titles: string[] = [
        ...list(assertion['ancestorTitles']).filter(
          (title: unknown): title is string => typeof title === 'string',
        ),
        typeof assertion['title'] === 'string' ? assertion['title'] : '',
      ];
      const failures: readonly string[] = list(assertion['failureMessages']).filter(
        (message: unknown): message is string => typeof message === 'string',
      );
      const failure: { message: string; stack: readonly TestStackFrame[] } | undefined =
        failures.length > 0 ? splitFailure(failures.join('\n'), path.dirname(name)) : undefined;
      const duration: unknown = assertion['duration'];
      const location: Record<string, unknown> = record(assertion['location']);
      results.push({
        id: testId(name, titles),
        outcome: jestOutcome(assertion['status']),
        ...(typeof duration === 'number' ? { durationMs: Math.round(duration) } : {}),
        ...(failure === undefined || failure.message.length === 0
          ? {}
          : { message: failure.message }),
        ...(failure === undefined || failure.stack.length === 0 ? {} : { stack: failure.stack }),
        // A test discovery could not name — one case of `it.each` — is placed under its file.
        parentId: `file:${name}`,
        label: titles[titles.length - 1],
        ...(typeof location['line'] === 'number'
          ? { location: { file: name, line: location['line'] } }
          : {}),
      });
    }
  }
  return { results, problems };
}

/**
 * Maps a Playwright result status onto the protocol's outcome.
 * @param status The status of the test's last attempt.
 * @returns Returns the outcome.
 */
function playwrightOutcome(status: unknown): TestOutcome {
  switch (status) {
    case 'passed':
      return 'passed';
    case 'failed':
    case 'timedOut':
      return 'failed';
    case 'skipped':
      return 'skipped';
    default:
      return 'errored';
  }
}

/**
 * Reads a Playwright JSON report. Its files are named relative to the test folder (`rootDir`), and its
 * suites nest: one per file, then one per `test.describe`.
 * @param report The parsed report.
 * @returns Returns each test's result, and the run's own errors.
 */
export function readPlaywrightReport(report: unknown): {
  results: TestResult[];
  problems: string[];
} {
  const source: Record<string, unknown> = record(report);
  const rootDir: string =
    typeof record(source['config'])['rootDir'] === 'string'
      ? (record(source['config'])['rootDir'] as string)
      : '';
  const results: TestResult[] = [];
  const visit: (suiteValue: unknown, titles: readonly string[], top: boolean) => void = (
    suiteValue: unknown,
    titles: readonly string[],
    top: boolean,
  ): void => {
    const suite: Record<string, unknown> = record(suiteValue);
    // The top suite of each file is titled with the file itself, which no test's name includes.
    const here: readonly string[] = top ? titles : [...titles, text(suite['title'])];
    for (const specValue of list(suite['specs'])) {
      const spec: Record<string, unknown> = record(specValue);
      const file: string = path.resolve(
        rootDir,
        typeof spec['file'] === 'string' ? spec['file'] : '',
      );
      const trail: readonly string[] = [...here, text(spec['title'])];
      for (const testValue of list(spec['tests'])) {
        const attempts: readonly unknown[] = list(record(testValue)['results']);
        const last: Record<string, unknown> = record(attempts[attempts.length - 1]);
        const error: Record<string, unknown> = record(last['error']);
        const failure: { message: string; stack: readonly TestStackFrame[] } | undefined =
          typeof error['stack'] === 'string' || typeof error['message'] === 'string'
            ? splitFailure(text(error['stack']) || text(error['message']), path.dirname(file))
            : undefined;
        const output: string = [...list(last['stdout']), ...list(last['stderr'])]
          .map((chunk: unknown): string => text(record(chunk)['text']))
          .join('');
        const line: unknown = spec['line'];
        results.push({
          id: testId(file, trail),
          outcome: attempts.length === 0 ? 'skipped' : playwrightOutcome(last['status']),
          ...(typeof last['duration'] === 'number' ? { durationMs: last['duration'] } : {}),
          ...(failure === undefined || failure.message.length === 0
            ? {}
            : { message: failure.message }),
          ...(failure === undefined || failure.stack.length === 0 ? {} : { stack: failure.stack }),
          ...(output.length > 0 ? { output } : {}),
          parentId: `file:${file}`,
          label: trail[trail.length - 1],
          ...(typeof line === 'number' ? { location: { file, line } } : {}),
        });
      }
    }
    for (const child of list(suite['suites'])) {
      visit(child, here, false);
    }
  };
  for (const suite of list(source['suites'])) {
    visit(suite, [], true);
  }
  const problems: string[] = list(source['errors']).map((error: unknown): string =>
    plain(text(record(error)['message'])).trim(),
  );
  return { results, problems: problems.filter((problem: string): boolean => problem.length > 0) };
}

/**
 * Determines whether a test is one a run asked for: the test itself, or inside a suite, file or package
 * it named.
 * @param asked The identifiers the run was asked for.
 * @param id The test's identifier.
 * @returns Returns true when the run asked for it, or asked for everything.
 */
export function wasAskedFor(asked: readonly string[], id: string): boolean {
  if (asked.length === 0) {
    return true;
  }
  return asked.some((entry: string): boolean => {
    if (entry === id) {
      return true;
    }
    if (entry.startsWith('file:')) {
      return id.startsWith(`${entry.slice('file:'.length)}::`);
    }
    if (entry.startsWith('suite:')) {
      const suite: string = entry.slice('suite:'.length);
      return id === suite || id.startsWith(`${suite} > `);
    }
    if (entry.startsWith('package:')) {
      return id.startsWith(`${entry.slice('package:'.length)}${path.sep}`);
    }
    return false;
  });
}

/**
 * Reads every report a run's steps wrote. A narrowed run's report also lists the tests its filter left
 * out, as skipped; those are dropped, so a test keeps its last real result.
 * @param outputDirectory The run's output folder.
 * @param exitCode The run's exit code.
 * @param asked The identifiers the run was asked for, or empty for every test.
 * @returns Returns the results.
 */
export async function readRunReports(
  outputDirectory: string,
  exitCode: number,
  asked: readonly string[] = [],
): Promise<TestRunResults> {
  const names: readonly string[] = (
    await fs.readdir(outputDirectory).catch((): string[] => [])
  ).sort();
  const results: TestResult[] = [];
  const problems: string[] = [];
  for (const name of names) {
    const match: RegExpExecArray | null = /^\d+-(vitest|jest|playwright)\.json$/.exec(name);
    if (match === null) {
      continue;
    }
    let report: unknown;
    try {
      report = JSON.parse(await fs.readFile(path.join(outputDirectory, name), 'utf8'));
    } catch {
      problems.push(`The ${match[1]} report could not be read.`);
      continue;
    }
    const read: { results: TestResult[]; problems: string[] } =
      match[1] === 'playwright' ? readPlaywrightReport(report) : readJestReport(report);
    results.push(
      ...read.results.filter((result: TestResult): boolean => wasAskedFor(asked, result.id)),
    );
    problems.push(...read.problems);
  }
  if (results.length === 0 && problems.length === 0 && exitCode !== 0) {
    problems.push('The run wrote no report. The terminal says why.');
  }
  return { results, ...(problems.length > 0 ? { problem: problems.join('\n\n') } : {}) };
}
