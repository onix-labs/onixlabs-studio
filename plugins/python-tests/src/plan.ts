// Turns the tests a run asks for into pytest invocations (#1355), and a test into a debugpy launch.
//
// One invocation runs one project, from its own folder, with its own interpreter. A request spanning
// several projects becomes several steps, which this plugin's own entry point runs one after another in
// the same terminal (`--run-steps`).
import { existsSync, promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { TestCommand, TestDebugLaunch } from '../../protocol/testing/protocol';
import { PythonDiscovery } from './discover';

/**
 * Describes one pytest invocation.
 */
export interface Step {
  /**
   * Gets the project's folder, which is pytest's rootdir and the invocation's folder.
   */
  readonly project: string;

  /**
   * Gets the pytest node ids to run, relative to the project, or empty for all of them.
   */
  readonly nodeIds: readonly string[];
}

/**
 * Describes a step ready to run.
 */
export interface Invocation {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly label: string;
}

/**
 * Records, beside a run's reports, which project each was written for, so `results` can name its tests
 * however the plugin was restarted in between.
 */
export const STEPS_FILE: string = 'steps.json';

/**
 * Finds the interpreter a project runs under: a virtual environment in the project or a folder above
 * it within the root (`.venv`, then `venv`), else the `python3` on the PATH (`python` on Windows).
 * @param project The project's folder.
 * @param root The folder the run is confined to.
 * @returns Returns the interpreter, by path or by name.
 */
export function interpreterFor(project: string, root: string): string {
  const relative: string =
    process.platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python');
  let directory: string = project;
  for (;;) {
    for (const environment of ['.venv', 'venv']) {
      const candidate: string = path.join(directory, environment, relative);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    if (
      directory === root ||
      !directory.startsWith(root) ||
      path.dirname(directory) === directory
    ) {
      return process.platform === 'win32' ? 'python' : 'python3';
    }
    directory = path.dirname(directory);
  }
}

/**
 * Finds the project a file belongs to.
 * @param discovery What discovery found.
 * @param file The file.
 * @returns Returns the project's folder, or undefined when the file is not one discovery found.
 */
function projectOfFile(discovery: PythonDiscovery, file: string): string | undefined {
  return discovery.files.find((entry): boolean => entry.file === file)?.project;
}

/**
 * Turns the identifiers a run asks for into steps, one per project.
 * @param discovery What discovery found.
 * @param ids The identifiers, or empty for every test.
 * @returns Returns the steps.
 */
export function planSteps(discovery: PythonDiscovery, ids: readonly string[]): readonly Step[] {
  if (ids.length === 0) {
    return discovery.projects.map((project: string): Step => ({ project, nodeIds: [] }));
  }
  const whole: Set<string> = new Set<string>();
  const selected: Map<string, Set<string>> = new Map<string, Set<string>>();
  const add: (project: string, nodeId: string) => void = (
    project: string,
    nodeId: string,
  ): void => {
    const set: Set<string> = selected.get(project) ?? new Set<string>();
    set.add(nodeId);
    selected.set(project, set);
  };
  for (const id of ids) {
    if (id.startsWith('project:')) {
      whole.add(id.slice('project:'.length));
      continue;
    }
    const file: string = id.startsWith('file:') ? id.slice('file:'.length) : id.split('::')[0];
    const project: string | undefined = projectOfFile(discovery, file);
    if (project === undefined) {
      continue;
    }
    const relative: string = path.relative(project, file).split(path.sep).join('/');
    add(
      project,
      id.startsWith('file:') ? relative : [relative, ...id.split('::').slice(1)].join('::'),
    );
  }
  const projects: readonly string[] = [...new Set([...whole, ...selected.keys()])].sort();
  return projects.map((project: string): Step => ({
    project,
    nodeIds: whole.has(project) ? [] : [...(selected.get(project) ?? [])].sort(),
  }));
}

/**
 * Names the report a step writes.
 * @param outputDirectory The run's output folder.
 * @param index The step's position.
 * @returns Returns the report's path.
 */
export function reportPath(outputDirectory: string, index: number): string {
  return path.join(outputDirectory, `${index + 1}-pytest.xml`);
}

/**
 * Builds pytest's arguments for a step.
 * @param step The step.
 * @param report Where the JUnit report goes, or undefined for a debug launch.
 * @returns Returns the arguments after `-m pytest`.
 */
export function pytestArguments(step: Step, report: string | undefined): readonly string[] {
  return [
    // The rootdir is pinned, so the node ids in the report are relative to the project, as asked.
    `--rootdir=${step.project}`,
    '-p',
    'no:cacheprovider',
    ...(report === undefined ? [] : [`--junitxml=${report}`, '-o', 'junit_family=xunit2']),
    ...step.nodeIds,
  ];
}

/**
 * Builds the command that runs the steps: pytest itself for one, or this plugin's runner for several.
 * Writes, beside the reports, which project each report is for.
 * @param steps The steps.
 * @param root The folder.
 * @param outputDirectory The run's output folder.
 * @param runner How to start this plugin's runner.
 * @returns Returns the command.
 */
export async function commandFor(
  steps: readonly Step[],
  root: string,
  outputDirectory: string,
  runner: {
    readonly executable: string;
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, string>>;
  },
): Promise<TestCommand> {
  if (steps.length === 0) {
    throw new Error('None of those tests is in a project this plugin found.');
  }
  const invocations: readonly Invocation[] = steps.map((step: Step, index: number): Invocation => ({
    executable: interpreterFor(step.project, root),
    args: ['-m', 'pytest', ...pytestArguments(step, reportPath(outputDirectory, index))],
    cwd: step.project,
    env: {},
    label: path.basename(step.project),
  }));
  await fs.writeFile(
    path.join(outputDirectory, STEPS_FILE),
    JSON.stringify(
      steps.map((step: Step, index: number) => ({
        report: path.basename(reportPath(outputDirectory, index)),
        project: step.project,
      })),
    ),
  );
  if (invocations.length === 1) {
    const [only] = invocations;
    return {
      executable: only.executable,
      args: only.args,
      cwd: only.cwd,
      title: `Test ${only.label}`,
    };
  }
  return {
    executable: runner.executable,
    args: [...runner.args, '--run-steps', JSON.stringify(invocations)],
    cwd: root,
    title: `Test ${invocations.length} projects`,
    env: runner.env,
  };
}

/**
 * Builds a debugpy launch for one test, class or file: pytest as a module, under the project's
 * interpreter. No program is named, because debugpy refuses a launch naming both a program and a module.
 * @param discovery What discovery found.
 * @param id The node.
 * @param root The folder.
 * @returns Returns the launch.
 */
export function debugLaunchFor(
  discovery: PythonDiscovery,
  id: string,
  root: string,
): TestDebugLaunch {
  const steps: readonly Step[] = planSteps(discovery, [id]);
  if (steps.length !== 1 || steps[0].nodeIds.length === 0) {
    throw new Error('Pick one test, class or file to debug.');
  }
  const [step] = steps;
  return {
    adapter: 'debugpy',
    title: `Debug ${
      id
        .split('::')
        .at(-1)
        ?.replace(/^file:.*[\\/]/, '') ?? 'test'
    }`,
    args: [...pytestArguments(step, undefined), '-q'],
    cwd: step.project,
    configuration: {
      module: 'pytest',
      justMyCode: true,
      python: interpreterFor(step.project, root),
    },
  };
}
