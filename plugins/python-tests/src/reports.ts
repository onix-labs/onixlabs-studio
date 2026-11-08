// Reads the JUnit reports pytest wrote into a run's output folder (#1355) and names each case as
// discovery named its test.
//
// pytest writes a case's `classname` from its node id: the path relative to the rootdir with `/` turned
// to `.` and `.py` dropped, then any classes. So the file is the test file whose module path is the
// longest prefix of it, and the rest are classes. A parametrised case (`test_x[1-2]`) is a test only the
// run could name; it is placed under the test it is a case of.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { TestResult, TestRunResults } from '../../protocol/testing/protocol';
import { JUnitCase, readJUnit } from '../../protocol/testing/reports';
import { stackFrames } from '../../protocol/testing/source';
import { nodeId, PythonDiscovery } from './discover';
import { STEPS_FILE } from './plan';

/**
 * Turns a test file into the module path pytest's `classname` begins with.
 * @param project The project's folder.
 * @param file The file.
 * @returns Returns the module path, such as `tests.test_math`.
 */
export function modulePath(project: string, file: string): string {
  return path.relative(project, file).replace(/\.py$/, '').split(path.sep).join('.');
}

/**
 * Names a JUnit case as discovery names tests.
 * @param testCase The case.
 * @param project The project the report is for.
 * @param files The project's test files.
 * @returns Returns the identifier, and the identifier of the test a parametrised case belongs to; or
 * undefined when no file of the project matches.
 */
export function caseId(
  testCase: JUnitCase,
  project: string,
  files: readonly string[],
): { readonly id: string; readonly parentId?: string; readonly file: string } | undefined {
  let best: { file: string; module: string } | undefined;
  for (const file of files) {
    const module: string = modulePath(project, file);
    if (
      (testCase.classname === module || testCase.classname.startsWith(`${module}.`)) &&
      (best === undefined || module.length > best.module.length)
    ) {
      best = { file, module };
    }
  }
  if (best === undefined) {
    return undefined;
  }
  const classes: readonly string[] = testCase.classname
    .slice(best.module.length)
    .split('.')
    .filter((part: string): boolean => part.length > 0);
  const id: string = nodeId(best.file, [...classes, testCase.name]);
  const bracket: number = testCase.name.indexOf('[');
  return bracket > 0
    ? {
        id,
        parentId: nodeId(best.file, [...classes, testCase.name.slice(0, bracket)]),
        file: best.file,
      }
    : { id, file: best.file };
}

/**
 * Turns a project's report into results.
 * @param report The report's text.
 * @param project The project it is for.
 * @param files The project's test files.
 * @returns Returns the results.
 */
export function resultsFromReport(
  report: string,
  project: string,
  files: readonly string[],
): TestResult[] {
  const results: TestResult[] = [];
  for (const testCase of readJUnit(report)) {
    const named: { id: string; parentId?: string; file: string } | undefined = caseId(
      testCase,
      project,
      files,
    );
    if (named === undefined) {
      continue;
    }
    const failed: boolean = testCase.outcome === 'failed' || testCase.outcome === 'errored';
    const stack: ReturnType<typeof stackFrames> = failed
      ? stackFrames(testCase.details, project)
      : [];
    results.push({
      id: named.id,
      outcome: testCase.outcome,
      ...(testCase.durationMs === undefined ? {} : { durationMs: testCase.durationMs }),
      ...(testCase.message === undefined ? {} : { message: testCase.message }),
      ...(stack.length === 0 ? {} : { stack }),
      ...(testCase.output === undefined ? {} : { output: testCase.output }),
      ...(named.parentId === undefined ? {} : { parentId: named.parentId, label: testCase.name }),
    });
  }
  return results;
}

/**
 * Reads every report a run wrote.
 * @param discovery What discovery finds in the folder now.
 * @param outputDirectory The run's output folder.
 * @param exitCode The run's exit code.
 * @param transcript What the run printed.
 * @returns Returns the results.
 */
export async function readRunReports(
  discovery: PythonDiscovery,
  outputDirectory: string,
  exitCode: number,
  transcript: string,
): Promise<TestRunResults> {
  let steps: readonly { report: string; project: string }[] = [];
  try {
    steps = JSON.parse(
      await fs.readFile(path.join(outputDirectory, STEPS_FILE), 'utf8'),
    ) as typeof steps;
  } catch {
    steps = [];
  }
  const results: TestResult[] = [];
  const problems: string[] = [];
  const missing: string[] = [];
  for (const step of steps) {
    let report: string;
    try {
      report = await fs.readFile(path.join(outputDirectory, path.basename(step.report)), 'utf8');
    } catch {
      missing.push(path.basename(step.project));
      continue;
    }
    const files: readonly string[] = discovery.files
      .filter((entry): boolean => entry.project === step.project)
      .map((entry): string => entry.file);
    results.push(...resultsFromReport(report, step.project, files));
  }
  // A project whose pytest never started writes no report; say which, and why when the transcript does.
  if (missing.length > 0 || (steps.length === 0 && exitCode !== 0)) {
    const names: string = missing.length > 0 ? `${missing.join(', ')}: ` : '';
    problems.push(
      transcript.includes('No module named pytest')
        ? `${names}pytest is not installed in the project's Python. Install it (pip install pytest) and run again.`
        : `${names}${names.length > 0 ? 'the' : 'The'} run wrote no report. The terminal says why.`,
    );
  }
  return { results, ...(problems.length > 0 ? { problem: problems.join('\n\n') } : {}) };
}
