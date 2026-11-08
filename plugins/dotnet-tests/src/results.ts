// Reads how a `dotnet test` run came out from the TRX reports it wrote (#1353), and names each result by
// the tree's identifiers: a test method by its fully qualified name, and each case of a data-driven test
// beneath it.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { TestOutcome, TestResult, TestRunResults } from '../../protocol/testing/protocol';
import { readTrx, TrxResult } from '../../protocol/testing/reports';
import { stackFrames } from '../../protocol/testing/source';

/**
 * How many lines of a run's transcript explain a run that wrote no report.
 */
const PROBLEM_LINES: number = 40;

/**
 * Finds the TRX reports under a folder.
 * @param directory The run's output folder.
 * @returns Returns their paths, sorted.
 */
export async function findTrxFiles(directory: string): Promise<readonly string[]> {
  try {
    const entries: readonly string[] = await fs.readdir(directory, { recursive: true });
    return entries
      .filter((entry: string): boolean => entry.toLowerCase().endsWith('.trx'))
      .map((entry: string): string => path.join(directory, entry))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Splits a result's name into its method and, for one case of a data-driven test, the case's arguments.
 *
 * The frameworks name a case differently: NUnit as `Adds(1,2)` in the method itself, MSTest as
 * `Adds (1,2)` in the display name, xUnit as `Namespace.Class.Adds(a: 1, b: 2)`. Each is read back to
 * the method `Namespace.Class.Adds` and the case `Adds(1,2)` or `Adds(a: 1, b: 2)`.
 * @param result The TRX result.
 * @returns Returns the method's fully qualified name, and the case's label when it is one.
 */
export function nameOf(result: TrxResult): {
  readonly method: string;
  readonly caseLabel?: string;
} {
  const method: string = result.fullName.replace(/\s*\(.*$/s, '');
  const shortName: string = method.slice(method.lastIndexOf('.') + 1);
  const display: string = result.displayName;
  const open: number = display.indexOf('(');
  const fromFullName: number = result.fullName.indexOf('(');
  if (open >= 0) {
    return { method, caseLabel: `${shortName}${display.slice(open).trimStart()}` };
  }
  if (fromFullName >= 0) {
    return { method, caseLabel: `${shortName}${result.fullName.slice(fromFullName)}` };
  }
  return { method };
}

/**
 * Combines the outcomes of a data-driven test's cases: a failure is the method's failure, and it was
 * skipped only when every case was.
 * @param outcomes The cases' outcomes.
 * @returns Returns the method's outcome.
 */
function combined(outcomes: readonly TestOutcome[]): TestOutcome {
  if (outcomes.includes('failed')) {
    return 'failed';
  }
  if (outcomes.includes('errored')) {
    return 'errored';
  }
  return outcomes.every((outcome: TestOutcome): boolean => outcome === 'skipped')
    ? 'skipped'
    : 'passed';
}

/**
 * Maps TRX results onto the tree's identifiers. A case of a data-driven test becomes its own result
 * beneath its method, and the method gets a result combining its cases.
 * @param trx The results, from every report of the run.
 * @param root The folder, which relative stack paths are resolved against.
 * @returns Returns the results.
 */
export function toResults(trx: readonly TrxResult[], root: string): readonly TestResult[] {
  const results: TestResult[] = [];
  const cases: Map<string, TestResult[]> = new Map<string, TestResult[]>();
  for (const result of trx) {
    const { method, caseLabel } = nameOf(result);
    const className: string = method.slice(0, method.lastIndexOf('.'));
    const stack: ReturnType<typeof stackFrames> = stackFrames(result.stackTrace, root);
    const detail: Omit<TestResult, 'id'> = {
      outcome: result.outcome,
      ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
      ...(result.message === undefined ? {} : { message: result.message }),
      ...(stack.length === 0 ? {} : { stack }),
      ...(result.output === undefined ? {} : { output: result.output }),
    };
    if (caseLabel === undefined) {
      results.push({
        id: method,
        ...detail,
        ...(className.length > 0 ? { parentId: className } : {}),
        label: method.slice(method.lastIndexOf('.') + 1),
      });
      continue;
    }
    const entry: TestResult = {
      id: `${method}#${caseLabel}`,
      ...detail,
      parentId: method,
      label: caseLabel,
    };
    const list: TestResult[] | undefined = cases.get(method);
    if (list === undefined) {
      cases.set(method, [entry]);
    } else {
      list.push(entry);
    }
  }
  for (const [method, list] of cases) {
    const durations: readonly number[] = list
      .map((entry: TestResult): number | undefined => entry.durationMs)
      .filter((duration: number | undefined): duration is number => duration !== undefined);
    const className: string = method.slice(0, method.lastIndexOf('.'));
    results.push({
      id: method,
      outcome: combined(list.map((entry: TestResult): TestOutcome => entry.outcome)),
      ...(durations.length === 0
        ? {}
        : { durationMs: durations.reduce((sum: number, value: number): number => sum + value, 0) }),
      ...(className.length > 0 ? { parentId: className } : {}),
      label: method.slice(method.lastIndexOf('.') + 1),
    });
    results.push(...list);
  }
  return results;
}

/**
 * Reads a finished run's results.
 * @param root The folder.
 * @param outputDirectory The run's output folder.
 * @param exitCode The command's exit code, or -1 when it was stopped or never started.
 * @param transcript What the command printed.
 * @returns Returns the results, with the reason when no report was written.
 */
export async function readResults(
  root: string,
  outputDirectory: string,
  exitCode: number,
  transcript: string,
): Promise<TestRunResults> {
  const trx: TrxResult[] = [];
  for (const file of await findTrxFiles(outputDirectory)) {
    try {
      trx.push(...readTrx(await fs.readFile(file, 'utf8')));
    } catch {
      // A report that cannot be read reports nothing; the rest still count.
    }
  }
  const results: readonly TestResult[] = toResults(trx, root);
  if (results.length > 0) {
    return { results };
  }
  if (exitCode === -1) {
    return { results, problem: 'The run was stopped before it reported any results.' };
  }
  if (exitCode !== 0) {
    const tail: string = transcript.trimEnd().split(/\r?\n/).slice(-PROBLEM_LINES).join('\n');
    return {
      results,
      problem: tail.length > 0 ? tail : `dotnet test exited with ${exitCode} and wrote no results.`,
    };
  }
  return { results };
}
