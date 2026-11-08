// Plans the `dotnet test` command for a run (#1353): which project or solution it runs, and the filter
// that narrows it to the tests asked for. Pure, so every choice here is specified by a test.
import * as path from 'node:path';
import type { TestCommand, TestNode } from '../../protocol/testing/protocol';

/**
 * Describes what a run is asked to run, read against the tree.
 */
interface Selection {
  /**
   * Gets the project files the run touches.
   */
  readonly projects: ReadonlySet<string>;

  /**
   * Gets the filter terms, or empty when everything in those projects runs.
   */
  readonly terms: readonly string[];
}

/**
 * Escapes a value for a VSTest filter, where `\ ( ) & | = ! ~` mean something.
 * @param value The value.
 * @returns Returns the escaped value.
 */
export function escapeFilterValue(value: string): string {
  return value.replace(/[\\()&|=!~]/g, '\\$&');
}

/**
 * Builds the filter terms for one class: its tests and those of the types nested in it.
 * @param className The fully qualified class name.
 * @returns Returns the terms.
 */
function suiteTerms(className: string): readonly string[] {
  const escaped: string = escapeFilterValue(className);
  return [`FullyQualifiedName~${escaped}.`, `FullyQualifiedName~${escaped}+`];
}

/**
 * Builds the filter terms for one test method. The exact name selects every case of a data-driven test
 * in all three frameworks: xUnit and MSTest leave the arguments out of the name, and NUnit's adapter
 * matches a method's cases by the method. ⚠️ A `~Name\(` term, the obvious way to reach NUnit's cases,
 * crashes NUnit3TestAdapter 5.0 ("Insufficient memory"), checked on the fixture.
 * @param id The test's fully qualified name.
 * @returns Returns the terms.
 */
function testTerms(id: string): readonly string[] {
  return [`FullyQualifiedName=${escapeFilterValue(id)}`];
}

/**
 * Reads what a run is asked for against the tree: the projects involved, and the terms of a filter
 * selecting exactly those tests. An identifier the tree does not hold is ignored.
 * @param tree The discovered tree.
 * @param ids The tests asked for, or empty for all.
 * @returns Returns the selection.
 */
export function select(tree: readonly TestNode[], ids: readonly string[]): Selection {
  if (ids.length === 0) {
    return {
      projects: new Set<string>(tree.map((project: TestNode): string => projectFile(project))),
      terms: [],
    };
  }
  const wanted: ReadonlySet<string> = new Set<string>(ids);
  const projects: Set<string> = new Set<string>();
  const wholeProjects: Set<string> = new Set<string>();
  const terms: string[] = [];
  for (const project of tree) {
    const file: string = projectFile(project);
    if (wanted.has(project.id)) {
      projects.add(file);
      wholeProjects.add(file);
      terms.push(
        ...(project.children ?? []).flatMap((suite: TestNode): readonly string[] =>
          suiteTerms(suite.id),
        ),
      );
      continue;
    }
    for (const suite of project.children ?? []) {
      if (wanted.has(suite.id)) {
        projects.add(file);
        terms.push(...suiteTerms(suite.id));
        continue;
      }
      for (const test of suite.children ?? []) {
        if (wanted.has(test.id)) {
          projects.add(file);
          terms.push(...testTerms(test.id));
        }
      }
    }
  }
  // Projects asked for whole need no filter — when the command's target is one of them, or the solution
  // and every test project is asked for. Otherwise the solution would run projects nobody asked for.
  const everyProjectWhole: boolean =
    projects.size > 0 &&
    [...projects].every((file: string): boolean => wholeProjects.has(file)) &&
    (projects.size === 1 || projects.size === tree.length);
  return { projects, terms: everyProjectWhole ? [] : terms };
}

/**
 * Reads the project file a project node stands for.
 * @param project The node.
 * @returns Returns the absolute path.
 */
function projectFile(project: TestNode): string {
  return project.id.startsWith('project:') ? project.id.slice('project:'.length) : project.id;
}

/**
 * Describes what the planner needs to know about the folder besides its tests.
 */
export interface PlanContext {
  /**
   * Gets the absolute folder.
   */
  readonly root: string;

  /**
   * Gets the solution files in the folder, absolute.
   */
  readonly solutions: readonly string[];

  /**
   * Gets whether the folder opts `dotnet test` into Microsoft.Testing.Platform mode through its
   * `global.json`, where VSTest's logger and filter arguments do not exist.
   */
  readonly testingPlatform: boolean;

  /**
   * Gets the empty folder the run's reports go in.
   */
  readonly outputDirectory: string;
}

/**
 * Plans the command that runs a selection.
 *
 * One project runs on its own. Several run through the folder's solution, which must be the only one, as
 * a command has one target; with none, or more than one, the run is refused rather than run partly.
 * @param tree The discovered tree.
 * @param ids The tests asked for, or empty for all.
 * @param context The folder.
 * @returns Returns the command.
 */
export function planRun(
  tree: readonly TestNode[],
  ids: readonly string[],
  context: PlanContext,
): TestCommand {
  const selection: Selection = select(tree, ids);
  if (selection.projects.size === 0) {
    throw new Error(
      ids.length === 0
        ? 'No test projects were found in this folder.'
        : 'None of those tests is in a test project this folder holds.',
    );
  }
  let target: string;
  if (selection.projects.size === 1) {
    target = [...selection.projects][0];
  } else if (context.solutions.length === 1) {
    target = context.solutions[0];
  } else {
    throw new Error(
      context.solutions.length === 0
        ? 'Those tests are in several projects and no solution holds them all. Run one project at a time.'
        : 'Those tests are in several projects and the folder has more than one solution. Run one project at a time.',
    );
  }
  const name: string = path.basename(target).replace(/\.(sln|slnx|csproj|fsproj)$/i, '');
  const args: string[] = context.testingPlatform
    ? [
        'test',
        /\.slnx?$/i.test(target) ? '--solution' : '--project',
        target,
        '--report-trx',
        '--results-directory',
        context.outputDirectory,
      ]
    : ['test', target, '--logger', 'trx', '--results-directory', context.outputDirectory];
  // Under Microsoft.Testing.Platform each framework filters differently, so a selection runs the
  // whole target there and the results say what ran.
  if (!context.testingPlatform && selection.terms.length > 0) {
    args.push('--filter', selection.terms.join('|'));
  }
  return {
    executable: 'dotnet',
    args,
    cwd: context.root,
    title: ids.length === 0 ? `Test ${name}` : `Test ${name} (selected)`,
    env: { DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1' },
  };
}

/**
 * Determines whether a `global.json` opts `dotnet test` into Microsoft.Testing.Platform mode.
 * @param json The file's text, or null when there is none.
 * @returns Returns true when it names that runner.
 */
export function usesTestingPlatform(json: string | null): boolean {
  if (json === null) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(json);
    const runner: unknown = (parsed as { test?: { runner?: unknown } } | null)?.test?.runner;
    return typeof runner === 'string' && /^Microsoft\.Testing\.Platform$/i.test(runner);
  } catch {
    return false;
  }
}
