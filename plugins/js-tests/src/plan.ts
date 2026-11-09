// Turns the tests a run asks for into the commands that run them (#1354).
//
// One invocation runs one framework in one package. A request that spans several — Run All over a
// monorepo, or a selection across a Vitest package and a Playwright one — becomes several steps, which
// this plugin's own entry point runs one after another in the same terminal (`--run-steps`), so the
// user sees every tool's output in one place and the run's exit code is the worst of theirs.
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { TestCommand, TestDebugLaunch, TestNode } from '../../protocol/testing/protocol';
import {
  FRAMEWORK_NAMES,
  fileId,
  Framework,
  JsDiscovery,
  packageId,
  TestFile,
  TestPackage,
} from './discover';

/**
 * Describes one test or suite a run narrows to.
 */
export interface Selected {
  /**
   * Gets the file it is in.
   */
  readonly file: string;

  /**
   * Gets its titles, outermost first.
   */
  readonly titles: readonly string[];

  /**
   * Gets whether it is a suite, standing for everything inside it.
   */
  readonly suite: boolean;

  /**
   * Gets the line it is declared on, for Playwright's `file:line` filter.
   */
  readonly line: number;
}

/**
 * Describes one invocation of one framework in one package.
 */
export interface Step {
  readonly framework: Framework;
  readonly owner: TestPackage;

  /**
   * Gets the files to run whole; empty with no {@link selected} for the whole package.
   */
  readonly files: readonly string[];

  /**
   * Gets the tests and suites to narrow to.
   */
  readonly selected: readonly Selected[];
}

/**
 * Describes a step ready to run: the program, its arguments, where, and where its report goes.
 */
export interface Invocation {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly label: string;
}

/**
 * The executable each framework installs under `node_modules/.bin`.
 */
const BINARIES: Readonly<Record<Framework, string>> = {
  vitest: 'vitest',
  jest: 'jest',
  playwright: 'playwright',
};

/**
 * The script each framework's command line is, for a debugger to launch under Node.
 */
const SCRIPTS: Readonly<Record<Framework, string>> = {
  vitest: 'vitest/vitest.mjs',
  jest: 'jest/bin/jest.js',
  playwright: '@playwright/test/cli.js',
};

/**
 * Escapes text for a regular expression.
 * @param text The text.
 * @returns Returns it escaped.
 */
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds the `-t` pattern Vitest and Jest narrow a run by. Both match it against a test's full name:
 * its suites' titles and its own, joined by spaces.
 * @param selected The tests and suites.
 * @returns Returns the pattern.
 */
export function namePattern(selected: readonly Selected[]): string {
  return selected
    .map(
      (entry: Selected): string =>
        `^${escape(entry.titles.join(' '))}${entry.suite ? '( |$)' : '$'}`,
    )
    .join('|');
}

/**
 * Reads what a test or suite identifier names.
 * @param id The identifier.
 * @param lines The line each node is declared on, by identifier.
 * @returns Returns the selection, or undefined when the identifier names neither.
 */
function readSelected(id: string, lines: ReadonlyMap<string, number>): Selected | undefined {
  const suite: boolean = id.startsWith('suite:');
  const body: string = suite ? id.slice('suite:'.length) : id;
  const split: number = body.indexOf('::');
  if (split < 0) {
    return undefined;
  }
  return {
    file: body.slice(0, split),
    titles: body.slice(split + 2).split(' > '),
    suite,
    line: lines.get(id) ?? 1,
  };
}

/**
 * Collects the line of every node in a tree.
 * @param nodes The nodes.
 * @param into The map to fill.
 * @returns Returns the map.
 */
function linesOf(
  nodes: readonly TestNode[],
  into: Map<string, number> = new Map<string, number>(),
): Map<string, number> {
  for (const node of nodes) {
    if (node.location !== undefined) {
      into.set(node.id, node.location.line);
    }
    linesOf(node.children ?? [], into);
  }
  return into;
}

/**
 * Turns the identifiers a run asks for into steps, one per package and framework (and, where whole
 * files and single tests are asked for together, one for each, since a name filter would narrow both).
 * @param discovery What discovery found.
 * @param ids The identifiers, or empty for every test.
 * @returns Returns the steps, in the order the packages were found.
 */
export function planSteps(discovery: JsDiscovery, ids: readonly string[]): readonly Step[] {
  const lines: ReadonlyMap<string, number> = linesOf(discovery.tests);
  const byFile: ReadonlyMap<string, TestFile> = new Map<string, TestFile>(
    discovery.files.map((entry: TestFile): [string, TestFile] => [entry.file, entry]),
  );
  interface Group {
    readonly owner: TestPackage;
    readonly framework: Framework;
    whole: boolean;
    readonly files: Set<string>;
    readonly selected: Selected[];
  }
  const groups: Map<string, Group> = new Map<string, Group>();
  const group: (owner: TestPackage, framework: Framework) => Group = (
    owner: TestPackage,
    framework: Framework,
  ): Group => {
    const key: string = `${owner.directory}\u0000${framework}`;
    const existing: Group | undefined = groups.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const created: Group = {
      owner,
      framework,
      whole: false,
      files: new Set<string>(),
      selected: [],
    };
    groups.set(key, created);
    return created;
  };
  const wholePackage: (directory: string | null) => void = (directory: string | null): void => {
    for (const entry of discovery.files) {
      if (directory === null || entry.owner.directory === directory) {
        group(entry.owner, entry.framework).whole = true;
      }
    }
  };
  if (ids.length === 0) {
    wholePackage(null);
  }
  for (const id of ids) {
    if (id.startsWith('package:')) {
      wholePackage(id.slice('package:'.length));
      continue;
    }
    if (id.startsWith('file:')) {
      const entry: TestFile | undefined = byFile.get(id.slice('file:'.length));
      if (entry !== undefined) {
        group(entry.owner, entry.framework).files.add(entry.file);
      }
      continue;
    }
    const selected: Selected | undefined = readSelected(id, lines);
    const entry: TestFile | undefined =
      selected === undefined ? undefined : byFile.get(selected.file);
    if (selected !== undefined && entry !== undefined) {
      group(entry.owner, entry.framework).selected.push(selected);
    }
  }
  const steps: Step[] = [];
  for (const entry of groups.values()) {
    if (entry.whole) {
      steps.push({ framework: entry.framework, owner: entry.owner, files: [], selected: [] });
      continue;
    }
    const files: readonly string[] = [...entry.files].sort();
    const selected: readonly Selected[] = entry.selected.filter(
      (item: Selected): boolean => !entry.files.has(item.file),
    );
    if (files.length > 0) {
      steps.push({ framework: entry.framework, owner: entry.owner, files, selected: [] });
    }
    if (selected.length > 0) {
      const selectedFiles: readonly string[] = [
        ...new Set(selected.map((item: Selected): string => item.file)),
      ].sort();
      steps.push({
        framework: entry.framework,
        owner: entry.owner,
        files: selectedFiles,
        selected,
      });
    }
  }
  return steps;
}

/**
 * Finds an installed file a package can reach: in its own `node_modules`, or a parent's within the
 * folder, as a workspace hoists them.
 * @param owner The package.
 * @param root The folder the run is confined to.
 * @param relative The path under `node_modules`.
 * @returns Returns the absolute path, or undefined when it is not installed.
 */
export function findInstalled(
  owner: TestPackage,
  root: string,
  relative: string,
): string | undefined {
  let directory: string = owner.directory;
  for (;;) {
    const candidate: string = path.join(directory, 'node_modules', relative);
    if (existsSync(candidate)) {
      return candidate;
    }
    if (
      directory === root ||
      !directory.startsWith(root) ||
      path.dirname(directory) === directory
    ) {
      return undefined;
    }
    directory = path.dirname(directory);
  }
}

/**
 * Names a file as a framework is given it: relative to the package, with `/` separators.
 * @param owner The package.
 * @param file The file.
 * @returns Returns the relative path.
 */
function relative(owner: TestPackage, file: string): string {
  return path.relative(owner.directory, file).split(path.sep).join('/');
}

/**
 * Builds a step's arguments, shared by a run and a debug launch.
 * @param step The step.
 * @param report Where its report goes, or undefined for a debug launch, which writes none.
 * @returns Returns the arguments and environment.
 */
export function stepArguments(
  step: Step,
  report: string | undefined,
): { readonly args: readonly string[]; readonly env: Readonly<Record<string, string>> } {
  const files: readonly string[] = step.files.map((file: string): string =>
    relative(step.owner, file),
  );
  const pattern: readonly string[] =
    step.selected.length > 0 ? ['-t', namePattern(step.selected)] : [];
  switch (step.framework) {
    case 'vitest':
      return {
        args: [
          'run',
          ...(report === undefined
            ? ['--no-file-parallelism', '--test-timeout=0']
            : ['--reporter=default', '--reporter=json', `--outputFile.json=${report}`]),
          ...files,
          ...pattern,
        ],
        env: {},
      };
    case 'jest':
      return {
        args: [
          ...(report === undefined
            ? ['--runInBand', '--testTimeout=0']
            : ['--json', `--outputFile=${report}`]),
          ...(files.length > 0 ? ['--runTestsByPath', ...files] : []),
          ...pattern,
        ],
        env: {},
      };
    case 'playwright': {
      // Playwright narrows by `file:line`, which names a test or a describe block directly.
      const locations: readonly string[] =
        step.selected.length > 0
          ? step.selected.map(
              (item: Selected): string => `${relative(step.owner, item.file)}:${item.line}`,
            )
          : files;
      return {
        args: [
          'test',
          ...(report === undefined ? ['--workers=1', '--timeout=0'] : ['--reporter=list,json']),
          ...locations,
        ],
        env: report === undefined ? {} : { PLAYWRIGHT_JSON_OUTPUT_NAME: report },
      };
    }
  }
}

/**
 * Builds the invocation that runs a step.
 * @param step The step.
 * @param root The folder.
 * @param report Where its report goes.
 * @returns Returns the invocation.
 */
export function invocationFor(step: Step, root: string, report: string): Invocation {
  const binary: string =
    process.platform === 'win32' ? `${BINARIES[step.framework]}.cmd` : BINARIES[step.framework];
  const executable: string | undefined = findInstalled(step.owner, root, path.join('.bin', binary));
  if (executable === undefined) {
    throw new Error(
      `${step.owner.name} has no ${FRAMEWORK_NAMES[step.framework]} installed. Install its dependencies first.`,
    );
  }
  const { args, env } = stepArguments(step, report);
  return {
    executable,
    args,
    cwd: step.owner.directory,
    env,
    label: `${step.owner.name} (${FRAMEWORK_NAMES[step.framework]})`,
  };
}

/**
 * Names the report a step writes.
 * @param outputDirectory The run's output folder.
 * @param index The step's position.
 * @param framework The step's framework.
 * @returns Returns the report's path. Its name says which reader reads it.
 */
export function reportPath(outputDirectory: string, index: number, framework: Framework): string {
  return path.join(outputDirectory, `${index + 1}-${framework}.json`);
}

/**
 * Builds the command that runs the steps: the tool itself for one step, or this plugin's runner for
 * several.
 * @param steps The steps.
 * @param root The folder.
 * @param outputDirectory The run's output folder.
 * @param runner How to start this plugin's runner: the program and the arguments before its own.
 * @returns Returns the command.
 */
export function commandFor(
  steps: readonly Step[],
  root: string,
  outputDirectory: string,
  runner: {
    readonly executable: string;
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, string>>;
  },
): TestCommand {
  if (steps.length === 0) {
    throw new Error('None of those tests is in a package this plugin can run.');
  }
  const invocations: readonly Invocation[] = steps.map((step: Step, index: number): Invocation =>
    invocationFor(step, root, reportPath(outputDirectory, index, step.framework)),
  );
  if (invocations.length === 1) {
    const [only] = invocations;
    return {
      executable: only.executable,
      args: only.args,
      cwd: only.cwd,
      title: `Test ${only.label}`,
      ...(Object.keys(only.env).length > 0 ? { env: only.env } : {}),
    };
  }
  return {
    executable: runner.executable,
    args: [...runner.args, '--run-steps', JSON.stringify(invocations)],
    cwd: root,
    title: `Test ${invocations.length} packages`,
    env: runner.env,
  };
}

/**
 * Builds a debug launch for one test, suite or file under js-debug: the framework's own script under
 * Node, run in band so the debugger sees the test's code in the process it launches.
 * @param discovery What discovery found.
 * @param id The node.
 * @param root The folder.
 * @returns Returns the launch.
 */
export function debugLaunchFor(discovery: JsDiscovery, id: string, root: string): TestDebugLaunch {
  const steps: readonly Step[] = planSteps(discovery, [id]);
  if (steps.length !== 1) {
    throw new Error('Pick one test, suite or file to debug.');
  }
  const [step] = steps;
  const program: string | undefined = findInstalled(step.owner, root, SCRIPTS[step.framework]);
  if (program === undefined) {
    throw new Error(
      `${step.owner.name} has no ${FRAMEWORK_NAMES[step.framework]} installed. Install its dependencies first.`,
    );
  }
  const { args } = stepArguments(step, undefined);
  const name: string =
    id === packageId(step.owner.directory) || id === fileId(step.files[0] ?? '')
      ? path.basename(step.files[0] ?? step.owner.directory)
      : (step.selected[0]?.titles.at(-1) ?? step.owner.name);
  return {
    adapter: 'js-debug',
    title: `Debug ${name}`,
    program,
    args,
    cwd: step.owner.directory,
    configuration: { autoAttachChildProcesses: true },
  };
}
