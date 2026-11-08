// Reads how a Gradle or Maven test run came out from the JUnit XML reports the build writes (#1358).
//
// Gradle writes `build/test-results/test/TEST-<class>.xml` and Maven Surefire
// `target/surefire-reports/TEST-<class>.xml`, inside each project, and neither can be pointed elsewhere
// from the command line. So `run` stamps the run's output folder with when it started, and `results`
// reads only reports written since: an old report of a test this run did not reach is not this run's.
import { existsSync, promises as fs } from 'node:fs';
import * as path from 'node:path';
import type {
  TestLocation,
  TestResult,
  TestRunResults,
  TestStackFrame,
} from '../../protocol/testing/protocol';
import { JUnitCase, readJUnit } from '../../protocol/testing/reports';
import { JvmDiscovery, JvmProject } from './discover';

/**
 * The file `run` stamps the output folder with.
 */
export const STARTED_FILE: string = 'started';

/**
 * How far before the stamp a report may have been written and still count, for a clock that is
 * slightly behind the filesystem's.
 */
const CLOCK_SLACK_MS: number = 2_000;

/**
 * Records when a run started, in its output folder.
 * @param outputDirectory The run's output folder.
 * @param now The time, in milliseconds.
 */
export async function stampStart(outputDirectory: string, now: number = Date.now()): Promise<void> {
  if (outputDirectory.length > 0) {
    await fs.writeFile(path.join(outputDirectory, STARTED_FILE), String(now), 'utf8');
  }
}

/**
 * Gets where a project's build writes its JUnit reports.
 * @param project The project.
 * @returns Returns the folder.
 */
export function reportDirectory(project: JvmProject): string {
  return project.tool === 'maven'
    ? path.join(project.directory, 'target', 'surefire-reports')
    : path.join(project.directory, 'build', 'test-results', 'test');
}

/**
 * Turns a Java or Kotlin stack frame into a link to the project's source, when the file is there:
 * `at app//com.shop.CartTest.fails(CartTest.java:17)` names `src/test/java/com/shop/CartTest.java`.
 * @param line The frame.
 * @param project The project.
 * @param exists Tells whether a file exists.
 * @returns Returns the location, or undefined when it is not one of the project's files.
 */
export function javaFrameLocation(
  line: string,
  project: JvmProject,
  exists: (file: string) => boolean,
): TestLocation | undefined {
  const match: RegExpExecArray | null =
    /\bat (?:[\w.$-]+\/\/?)?([\w$.]+)\.[\w$<>-]+\(([\w$-]+\.(?:java|kt)):(\d+)\)/.exec(line);
  if (match === null) {
    return undefined;
  }
  const className: string = match[1].replace(/\$.*$/, '');
  const packagePath: string[] = className.split('.').slice(0, -1);
  for (const set of ['test', 'main']) {
    for (const language of ['java', 'kotlin']) {
      const file: string = path.join(
        project.directory,
        'src',
        set,
        language,
        ...packagePath,
        match[2],
      );
      if (exists(file)) {
        return { file, line: Number(match[3]) };
      }
    }
  }
  return undefined;
}

/**
 * Turns one report case into a result.
 * @param found The case.
 * @param discovery What discovery found.
 * @param project The project whose report it came from.
 * @param exists Tells whether a file exists.
 * @returns Returns the result.
 */
export function toResult(
  found: JUnitCase,
  discovery: JvmDiscovery,
  project: JvmProject,
  exists: (file: string) => boolean,
): TestResult {
  const stack: readonly TestStackFrame[] = (found.details ?? '')
    .split(/\r?\n/)
    .map((line: string): string => line.trim())
    .filter((line: string): boolean => line.length > 0)
    .map((text: string): TestStackFrame => {
      const location: TestLocation | undefined = javaFrameLocation(text, project, exists);
      return location === undefined ? { text } : { text, location };
    });
  const common: Omit<TestResult, 'id'> = {
    outcome: found.outcome,
    ...(found.durationMs === undefined ? {} : { durationMs: found.durationMs }),
    ...(found.message === undefined ? {} : { message: found.message }),
    ...(stack.length > 0 ? { stack } : {}),
    ...(found.output === undefined ? {} : { output: found.output }),
  };
  // Gradle names a method `adds()`; Surefire `adds`, or `sum(int, int)[2]` for an invocation.
  const method: RegExpExecArray | null = /^([\w$]+)(?:\([^)]*\))?(\[\d+\])?$/.exec(found.name);
  const classId: string = found.classname;
  if (method !== null && discovery.tests.has(`${classId}#${method[1]}`)) {
    return method[2] === undefined
      ? { id: `${classId}#${method[1]}`, ...common }
      : {
          id: `${classId}#${method[1]}${method[2]}`,
          ...common,
          parentId: `${classId}#${method[1]}`,
          label: method[2],
        };
  }
  // A display name (a Gradle parametrised case, `@DisplayName`) or a test discovery did not see joins
  // its class.
  return { id: `${classId}#${found.name}`, ...common, parentId: classId, label: found.name };
}

/**
 * Reads how a run came out.
 * @param discovery What discovery found.
 * @param ids The node identifiers the run was asked for.
 * @param outputDirectory The run's output folder.
 * @param output The transcript, for when no report was written.
 * @param exitCode The command's exit code.
 * @returns Returns the results.
 */
export async function jvmResults(
  discovery: JvmDiscovery,
  ids: readonly string[],
  outputDirectory: string,
  output: string,
  exitCode: number,
): Promise<TestRunResults> {
  let started: number = 0;
  try {
    started = Number(await fs.readFile(path.join(outputDirectory, STARTED_FILE), 'utf8')) || 0;
  } catch {
    // No stamp: every report counts, which is the best that can be done.
  }
  const asked: ReadonlySet<JvmProject> = new Set<JvmProject>(
    ids.length === 0
      ? discovery.projects
      : discovery.projects.filter(
          (project: JvmProject): boolean =>
            ids.includes(project.id) ||
            ids.some(
              (id: string): boolean => discovery.classes.get(id.replace(/#.*$/, '')) === project,
            ),
        ),
  );
  const results: TestResult[] = [];
  const known: Set<string> = new Set<string>();
  for (const project of asked) {
    const directory: string = reportDirectory(project);
    let names: readonly string[];
    try {
      names = (await fs.readdir(directory)).filter((name: string): boolean =>
        /^TEST-.*\.xml$/.test(name),
      );
    } catch {
      continue;
    }
    for (const name of [...names].sort()) {
      const file: string = path.join(directory, name);
      try {
        if ((await fs.stat(file)).mtimeMs < started - CLOCK_SLACK_MS) {
          continue;
        }
        for (const found of readJUnit(await fs.readFile(file, 'utf8'))) {
          const result: TestResult = toResult(found, discovery, project, existsSync);
          if (!known.has(result.id)) {
            known.add(result.id);
            results.push(result);
          }
        }
      } catch {
        // A report being rewritten as it is read: skipped.
      }
    }
  }
  if (results.length === 0) {
    const tail: string = output.trim().split(/\r?\n/).slice(-12).join('\n');
    return {
      results,
      problem: `The build wrote no test report (exit code ${exitCode}).${tail.length > 0 ? `\n${tail}` : ''}`,
    };
  }
  return { results };
}
