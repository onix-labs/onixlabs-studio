// Builds the `ctest` command a run asks for, and reads the JUnit report it writes (#1359).
//
// `ctest --output-junit` (CMake 3.21) writes a report of every test it ran, so results are read from it
// rather than from the transcript. ctest runs what the build directory holds: it builds nothing, so a
// test whose source changed since the last build runs the old binary.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type {
  TestCommand,
  TestResult,
  TestRunResults,
  TestStackFrame,
} from '../../protocol/testing/protocol';
import { JUnitCase, readJUnit } from '../../protocol/testing/reports';
import { stackFrames } from '../../protocol/testing/source';
import { CMakeProject, CTestDiscovery, CTestTest } from './discover';

/**
 * The report's name inside a run's output folder.
 */
export const REPORT_NAME: string = 'ctest.xml';

/**
 * Escapes a test name for ctest's `-R` regular expression.
 * @param name The name.
 * @returns Returns the escaped name.
 */
function escapeRegex(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolves the tests a run names: a test stands for itself, a project or a file for every test in it.
 * @param discovery What discovery found.
 * @param ids The node identifiers.
 * @returns Returns the tests, and the projects asked for whole.
 */
function resolveSelection(
  discovery: CTestDiscovery,
  ids: readonly string[],
): { readonly tests: readonly CTestTest[]; readonly whole: ReadonlySet<CMakeProject> } {
  const tests: Map<string, CTestTest> = new Map<string, CTestTest>();
  const whole: Set<CMakeProject> = new Set<CMakeProject>();
  for (const id of ids) {
    const test: CTestTest | undefined = discovery.tests.get(id);
    if (test !== undefined) {
      tests.set(id, test);
      continue;
    }
    const project: CMakeProject | undefined = discovery.projects.find(
      (candidate: CMakeProject): boolean => candidate.id === id,
    );
    if (project !== undefined) {
      whole.add(project);
      continue;
    }
    for (const member of discovery.tests.values()) {
      if (member.fileId === id) {
        tests.set(member.id, member);
      }
    }
  }
  return { tests: [...tests.values()], whole };
}

/**
 * Builds the command for a run.
 * @param discovery What discovery found.
 * @param ids The node identifiers asked for, empty for every test.
 * @param outputDirectory The run's output folder, where the report is written.
 * @returns Returns the command.
 * @throws When the project is not configured, or the tests span several projects.
 */
export function ctestCommand(
  discovery: CTestDiscovery,
  ids: readonly string[],
  outputDirectory: string,
): TestCommand {
  const { tests, whole } = resolveSelection(discovery, ids);
  const projects: Set<CMakeProject> = new Set<CMakeProject>(
    ids.length === 0
      ? discovery.projects.filter((project: CMakeProject): boolean =>
          [...discovery.tests.values()].some(
            (test: CTestTest): boolean => test.project === project,
          ),
        )
      : [...whole, ...tests.map((test: CTestTest): CMakeProject => test.project)],
  );
  if (projects.size === 0) {
    throw new Error(
      ids.length === 0
        ? 'There are no CTest tests in this folder.'
        : 'None of those tests was found.',
    );
  }
  if (projects.size > 1) {
    throw new Error(
      'Those tests are in several CMake projects, so one ctest cannot run them. Run one project at a time.',
    );
  }
  const project: CMakeProject = [...projects][0];
  if (project.buildDirectory === undefined) {
    throw new Error(
      `${project.name} has not been configured, so there is nothing for ctest to run. Configure and build it first.`,
    );
  }
  const args: string[] = [
    '--test-dir',
    project.buildDirectory,
    '--output-on-failure',
    '--output-junit',
    path.join(outputDirectory, REPORT_NAME),
  ];
  if (ids.length > 0 && whole.size === 0) {
    args.push(
      '-R',
      `^(${tests.map((test: CTestTest): string => escapeRegex(test.name)).join('|')})$`,
    );
  }
  return { executable: 'ctest', args, cwd: project.buildDirectory, title: `Test ${project.name}` };
}

/**
 * Turns the report's cases into results.
 * @param discovery What discovery found.
 * @param ids The node identifiers the run was asked for.
 * @param cases The report's cases.
 * @returns Returns the results.
 */
export function toResults(
  discovery: CTestDiscovery,
  ids: readonly string[],
  cases: readonly JUnitCase[],
): readonly TestResult[] {
  // A run is of one project, so its cases are that project's.
  const { tests, whole } = resolveSelection(discovery, ids);
  const project: CMakeProject | undefined =
    tests[0]?.project ?? [...whole][0] ?? [...discovery.tests.values()][0]?.project;
  const byName: Map<string, CTestTest> = new Map<string, CTestTest>(
    [...discovery.tests.values()]
      .filter((test: CTestTest): boolean => project === undefined || test.project === project)
      .map((test: CTestTest): [string, CTestTest] => [test.name, test]),
  );
  return cases.map((found: JUnitCase): TestResult => {
    const known: CTestTest | undefined = byName.get(found.name);
    const located: readonly TestStackFrame[] =
      found.outcome === 'failed' || found.outcome === 'errored'
        ? stackFrames(found.output, project?.directory ?? '/').filter(
            (frame: TestStackFrame): boolean => frame.location !== undefined,
          )
        : [];
    // A test the listing did not name joins the tree under its project.
    return {
      id: known?.id ?? `${project?.id ?? 'ctest:.'}::${found.name}`,
      ...(known === undefined ? { parentId: project?.id ?? 'ctest:.', label: found.name } : {}),
      outcome: found.outcome,
      ...(found.durationMs === undefined ? {} : { durationMs: found.durationMs }),
      ...(found.message === undefined ? {} : { message: found.message }),
      ...(located.length > 0 ? { stack: located } : {}),
      ...(found.output === undefined ? {} : { output: found.output }),
    };
  });
}

/**
 * Reads how a run came out.
 * @param discovery What discovery found.
 * @param ids The node identifiers the run was asked for.
 * @param outputDirectory The run's output folder.
 * @param output The transcript, for when there is no report.
 * @param exitCode The command's exit code.
 * @returns Returns the results.
 */
export async function ctestResults(
  discovery: CTestDiscovery,
  ids: readonly string[],
  outputDirectory: string,
  output: string,
  exitCode: number,
): Promise<TestRunResults> {
  let report: string | null = null;
  try {
    report = await fs.readFile(path.join(outputDirectory, REPORT_NAME), 'utf8');
  } catch {
    // ctest wrote none: it did not run, or stopped before writing.
  }
  if (report === null) {
    const tail: string = output.trim().split(/\r?\n/).slice(-10).join('\n');
    return {
      results: [],
      problem: `ctest wrote no report (exit code ${exitCode}).${tail.length > 0 ? `\n${tail}` : ''}`,
    };
  }
  return { results: toResults(discovery, ids, readJUnit(report)) };
}
