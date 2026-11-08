// Builds the Gradle or Maven command a run asks for (#1358).
//
// One command per run, from the build's root: the project's wrapper when it has one (`gradlew`,
// `mvnw`), else the tool on the PATH. Gradle runs each project's `test` task with `--rerun`, since an
// up-to-date task runs nothing and writes no new report, and `--tests` filters; Maven runs `test` with
// `-pl` for the modules and `-Dtest` naming the classes and methods.
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { TestCommand } from '../../protocol/testing/protocol';
import { JvmDiscovery, JvmProject, JvmTest } from './discover';

/**
 * Describes what a run selects in one project.
 */
interface ProjectSelection {
  /**
   * Gets whether the whole project runs.
   */
  whole: boolean;

  /**
   * Gets the classes that run whole, by fully qualified binary name.
   */
  readonly classes: Set<string>;

  /**
   * Gets the methods that run, by class.
   */
  readonly methods: Map<string, Set<string>>;
}

/**
 * Resolves what a run selects in each project.
 * @param discovery What discovery found.
 * @param ids The node identifiers asked for, empty for every test.
 * @returns Returns the selection by project.
 */
export function resolveSelection(
  discovery: JvmDiscovery,
  ids: readonly string[],
): ReadonlyMap<JvmProject, ProjectSelection> {
  const selection: Map<JvmProject, ProjectSelection> = new Map<JvmProject, ProjectSelection>();
  const of: (project: JvmProject) => ProjectSelection = (project: JvmProject): ProjectSelection => {
    let entry: ProjectSelection | undefined = selection.get(project);
    if (entry === undefined) {
      entry = { whole: false, classes: new Set<string>(), methods: new Map<string, Set<string>>() };
      selection.set(project, entry);
    }
    return entry;
  };
  if (ids.length === 0) {
    for (const project of discovery.projects) {
      of(project).whole = true;
    }
  }
  for (const id of ids) {
    const project: JvmProject | undefined = discovery.projects.find(
      (candidate: JvmProject): boolean => candidate.id === id,
    );
    if (project !== undefined) {
      of(project).whole = true;
      continue;
    }
    const classProject: JvmProject | undefined = discovery.classes.get(id);
    if (classProject !== undefined) {
      of(classProject).classes.add(id);
      continue;
    }
    // A parametrised invocation (`Class#method[2]`) runs with its method.
    const test: JvmTest | undefined = discovery.tests.get(id.replace(/\[[^\]]*\]$/, ''));
    if (test !== undefined) {
      const methods: Set<string> =
        of(test.project).methods.get(test.className) ?? new Set<string>();
      methods.add(test.method);
      of(test.project).methods.set(test.className, methods);
    }
  }
  return selection;
}

/**
 * Finds the program to run a build with: the root's wrapper, else the tool on the PATH.
 * @param root The build's root.
 * @param tool The build tool.
 * @returns Returns the program.
 */
function buildProgram(root: string, tool: 'gradle' | 'maven'): string {
  const wrapper: string = path.join(
    root,
    `${tool === 'gradle' ? 'gradlew' : 'mvnw'}${process.platform === 'win32' ? (tool === 'gradle' ? '.bat' : '.cmd') : ''}`,
  );
  return existsSync(wrapper) ? wrapper : tool === 'gradle' ? 'gradle' : 'mvn';
}

/**
 * Builds the command for a run.
 * @param discovery What discovery found.
 * @param ids The node identifiers asked for, empty for every test.
 * @returns Returns the command.
 * @throws When the tests asked for are in projects no single build runs.
 */
export function jvmTestCommand(discovery: JvmDiscovery, ids: readonly string[]): TestCommand {
  const selection: ReadonlyMap<JvmProject, ProjectSelection> = resolveSelection(discovery, ids);
  if (selection.size === 0) {
    throw new Error(
      ids.length === 0
        ? 'There are no JUnit tests in this folder.'
        : 'None of those tests was found.',
    );
  }
  const projects: readonly JvmProject[] = [...selection.keys()];
  const builds: ReadonlySet<string> = new Set<string>(
    projects.map((project: JvmProject): string => `${project.tool}\u0000${project.buildRoot}`),
  );
  if (builds.size > 1) {
    throw new Error(
      'Those tests are in projects of separate builds, so one command cannot run them. Run one build at a time.',
    );
  }
  const { tool, buildRoot } = projects[0];
  const args: string[] =
    tool === 'gradle' ? gradleArgs(selection, buildRoot) : mavenArgs(selection, buildRoot);
  return {
    executable: buildProgram(buildRoot, tool),
    args,
    cwd: buildRoot,
    title: `Test ${projects.length === 1 ? projects[0].name : path.basename(buildRoot)}`,
  };
}

/**
 * Builds Gradle's arguments: per project, its `test` task, `--rerun`, and its `--tests` filters.
 * @param selection What runs in each project.
 * @param root The build's root.
 * @returns Returns the arguments.
 */
function gradleArgs(selection: ReadonlyMap<JvmProject, ProjectSelection>, root: string): string[] {
  const args: string[] = [];
  for (const [project, selected] of selection) {
    const relative: string = path
      .relative(root, project.directory)
      .split(path.sep)
      .filter(Boolean)
      .join(':');
    args.push(relative.length === 0 ? 'test' : `:${relative}:test`, '--rerun');
    if (selected.whole) {
      continue;
    }
    for (const className of selected.classes) {
      args.push('--tests', className);
    }
    for (const [className, methods] of selected.methods) {
      if (selected.classes.has(className)) {
        continue;
      }
      for (const method of methods) {
        args.push('--tests', `${className}.${method}`);
      }
    }
  }
  // A failing project does not stop the others' tests.
  args.push('--continue');
  return args;
}

/**
 * Builds Maven's arguments: `test`, the modules with `-pl` (and what they depend on, `-am`), and a
 * `-Dtest` naming what runs. Surefire is told not to fail a module where nothing matches, which is every
 * module but the one a test is in.
 * @param selection What runs in each project.
 * @param root The build's root.
 * @returns Returns the arguments.
 */
function mavenArgs(selection: ReadonlyMap<JvmProject, ProjectSelection>, root: string): string[] {
  const args: string[] = ['test'];
  const modules: readonly string[] = [...selection.keys()]
    .map((project: JvmProject): string =>
      path.relative(root, project.directory).split(path.sep).join('/'),
    )
    .filter((relative: string): boolean => relative.length > 0);
  const everyModule: boolean = [...selection.keys()].some(
    (project: JvmProject): boolean => project.directory === root,
  );
  if (modules.length > 0 && !everyModule) {
    args.push('-pl', modules.join(','), '-am');
  }
  const whole: boolean = [...selection.values()].some(
    (selected: ProjectSelection): boolean => selected.whole,
  );
  if (!whole) {
    const patterns: string[] = [];
    for (const selected of selection.values()) {
      patterns.push(...selected.classes);
      for (const [className, methods] of selected.methods) {
        if (!selected.classes.has(className)) {
          patterns.push(`${className}#${[...methods].join('+')}`);
        }
      }
    }
    args.push(`-Dtest=${patterns.join(',')}`);
  }
  args.push('-DfailIfNoTests=false', '-Dsurefire.failIfNoSpecifiedTests=false');
  return args;
}
