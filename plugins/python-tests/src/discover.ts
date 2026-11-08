// Finds a folder's Python tests (#1355): the projects, the test files each holds, and the test functions,
// classes and `unittest.TestCase` methods each file declares, named as pytest names them.
//
// ⛔ Everything here reads files. Python is never started to collect: collection imports every test
// module, which runs the project's code.
import { existsSync, promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { TestNode } from '../../protocol/testing/protocol';
import { readSource, walkFiles } from '../../protocol/testing/source';

/**
 * The files that mark a Python project, as the manifest declares them. `requirements*.txt` is matched by
 * its pattern.
 */
export const MARKERS: readonly string[] = [
  'pyproject.toml',
  'pytest.ini',
  'setup.cfg',
  'setup.py',
  'tox.ini',
  'conftest.py',
];

/**
 * The directories no walk enters for Python, beyond the shared list: virtual environments and tool caches.
 */
const SKIPPED: ReadonlySet<string> = new Set<string>([
  'venv',
  'env',
  'site-packages',
  'htmlcov',
  'node_modules',
]);

/**
 * Matches a test file pytest collects by default.
 */
export const TEST_FILE: RegExp = /^(test_.*|.*_test)\.py$/;

/**
 * Says what a declaration is.
 */
export interface PythonDeclaration {
  readonly kind: 'suite' | 'test';
  readonly name: string;
  readonly line: number;
  readonly children: readonly PythonDeclaration[];
}

/**
 * Describes one test file and the project it runs in.
 */
export interface PythonTestFile {
  readonly file: string;
  readonly project: string;
}

/**
 * Describes everything discovery found.
 */
export interface PythonDiscovery {
  readonly projects: readonly string[];
  readonly files: readonly PythonTestFile[];
  readonly tests: readonly TestNode[];
}

/**
 * Determines whether a class's bases make it a `unittest.TestCase`.
 * @param bases The text between the class's parentheses.
 * @returns Returns true when it names a TestCase.
 */
function isTestCase(bases: string): boolean {
  return /\b(TestCase|IsolatedAsyncioTestCase)\b/.test(bases);
}

/**
 * Finds the tests a Python file declares: top-level `test*` functions, and `test*` methods of classes
 * named `Test*` or deriving from `unittest.TestCase`, nested classes included — what pytest collects
 * with its default `python_files`, `python_classes` and `python_functions`.
 * @param source The file's text.
 * @returns Returns the top-level declarations.
 */
export function scanPython(source: string): readonly PythonDeclaration[] {
  interface Open {
    readonly indent: number;
    readonly collect: boolean;
    readonly declaration: {
      kind: 'suite';
      name: string;
      line: number;
      children: PythonDeclaration[];
    };
  }
  const roots: PythonDeclaration[] = [];
  const stack: Open[] = [];
  const lines: readonly string[] = source.split(/\r?\n/);
  let quote: string | null = null;
  for (let index: number = 0; index < lines.length; index += 1) {
    const line: string = lines[index];
    if (quote !== null) {
      // Inside a triple-quoted string, which may hold anything that looks like code.
      if (line.split(quote).length % 2 === 0) {
        quote = null;
      }
      continue;
    }
    const trimmed: string = line.trimStart();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }
    const indent: number = line.length - trimmed.length;
    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const opened: RegExpMatchArray | null = /("""|''')/.exec(trimmed);
    if (opened !== null && trimmed.split(opened[1]).length % 2 === 0) {
      quote = opened[1];
    }
    const parent: Open | undefined = stack[stack.length - 1];
    const siblings: PythonDeclaration[] =
      parent === undefined ? roots : parent.declaration.children;
    const definition: RegExpExecArray | null = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(
      trimmed,
    );
    if (definition !== null) {
      if ((parent === undefined || parent.collect) && definition[1].startsWith('test')) {
        siblings.push({ kind: 'test', name: definition[1], line: index + 1, children: [] });
      }
      // A function's body declares nothing pytest collects; it is a scope that is entered and skipped.
      stack.push({
        indent,
        collect: false,
        declaration: { kind: 'suite', name: '', line: 0, children: [] },
      });
      continue;
    }
    const klass: RegExpExecArray | null = /^class\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?\s*:/.exec(
      trimmed,
    );
    if (klass !== null) {
      const collect: boolean =
        (parent === undefined || parent.collect) &&
        (klass[1].startsWith('Test') || isTestCase(klass[2] ?? ''));
      const declaration: {
        kind: 'suite';
        name: string;
        line: number;
        children: PythonDeclaration[];
      } = {
        kind: 'suite',
        name: klass[1],
        line: index + 1,
        children: [],
      };
      if (collect) {
        siblings.push(declaration);
      }
      stack.push({ indent, collect, declaration });
    }
  }
  return prune(roots);
}

/**
 * Drops classes that declare no tests.
 * @param declarations The declarations.
 * @returns Returns them without empty suites.
 */
function prune(declarations: readonly PythonDeclaration[]): readonly PythonDeclaration[] {
  return declarations
    .map((declaration: PythonDeclaration): PythonDeclaration =>
      declaration.kind === 'suite'
        ? { ...declaration, children: prune(declaration.children) }
        : declaration,
    )
    .filter(
      (declaration: PythonDeclaration): boolean =>
        declaration.kind === 'test' || declaration.children.length > 0,
    );
}

/**
 * Determines whether a folder holds a project marker.
 * @param directory The folder.
 * @returns Returns true when it does.
 */
async function holdsMarker(directory: string): Promise<boolean> {
  const names: readonly string[] = await fs.readdir(directory).catch((): string[] => []);
  return names.some(
    (name: string): boolean => MARKERS.includes(name) || /^requirements.*\.txt$/.test(name),
  );
}

/**
 * Finds the project a test file runs in: the nearest folder above it, within the root, that holds a
 * marker. The outermost one is not preferred: in a repository of several projects, each is run in its
 * own folder, with its own environment.
 * @param file The file.
 * @param root The folder discovery was asked about.
 * @param cache Answers already found, by folder.
 * @returns Returns the project's folder; the root when none holds a marker.
 */
async function projectOf(file: string, root: string, cache: Map<string, boolean>): Promise<string> {
  let directory: string = path.dirname(file);
  for (;;) {
    let marked: boolean | undefined = cache.get(directory);
    if (marked === undefined) {
      marked = await holdsMarker(directory);
      cache.set(directory, marked);
    }
    // A `conftest.py` beside the tests marks a test folder, not a project: pytest's rootdir is the
    // folder of the project's configuration above it.
    if (marked && !(await onlyConftest(directory))) {
      return directory;
    }
    if (
      directory === root ||
      path.dirname(directory) === directory ||
      !directory.startsWith(root)
    ) {
      return root;
    }
    directory = path.dirname(directory);
  }
}

/**
 * Determines whether the only marker a folder holds is a `conftest.py`.
 * @param directory The folder.
 * @returns Returns true when it is.
 */
async function onlyConftest(directory: string): Promise<boolean> {
  const names: readonly string[] = await fs.readdir(directory).catch((): string[] => []);
  return !names.some(
    (name: string): boolean =>
      (MARKERS.includes(name) && name !== 'conftest.py') || /^requirements.*\.txt$/.test(name),
  );
}

/**
 * Reads a project's name from its `pyproject.toml`, or its folder's.
 * @param project The project's folder.
 * @returns Returns the name.
 */
async function projectName(project: string): Promise<string> {
  const toml: string | null = await readSource(path.join(project, 'pyproject.toml'));
  const name: string | undefined = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(toml ?? '')?.[1];
  return name ?? path.basename(project);
}

/**
 * Builds a project node's identifier.
 * @param project The project's folder.
 * @returns Returns the identifier.
 */
export function projectId(project: string): string {
  return `project:${project}`;
}

/**
 * Builds a file node's identifier.
 * @param file The file.
 * @returns Returns the identifier.
 */
export function fileId(file: string): string {
  return `file:${file}`;
}

/**
 * Builds a test's or class's identifier: its absolute file, then pytest's `::`-separated names. Joined
 * to the project's folder, a pytest node id is exactly this.
 * @param file The file.
 * @param names The class names and the test's, outermost first.
 * @returns Returns the identifier.
 */
export function nodeId(file: string, names: readonly string[]): string {
  return [file, ...names].join('::');
}

/**
 * Turns a file's declarations into nodes.
 * @param file The file.
 * @param declarations Its declarations.
 * @param names The names of the classes they sit in.
 * @returns Returns the nodes.
 */
function toNodes(
  file: string,
  declarations: readonly PythonDeclaration[],
  names: readonly string[],
): TestNode[] {
  return declarations.map((declaration: PythonDeclaration): TestNode => {
    const trail: readonly string[] = [...names, declaration.name];
    const location: { file: string; line: number } = { file, line: declaration.line };
    return declaration.kind === 'suite'
      ? {
          id: nodeId(file, trail),
          label: declaration.name,
          kind: 'suite',
          location,
          children: toNodes(file, declaration.children, trail),
        }
      : { id: nodeId(file, trail), label: declaration.name, kind: 'test', location };
  });
}

/**
 * Finds a folder's Python tests.
 * @param root The folder.
 * @returns Returns the projects, files and tree: project → file → class → test.
 */
export async function discoverPython(root: string): Promise<PythonDiscovery> {
  const candidates: readonly string[] = await walkFiles(root, {
    accept: (name: string): boolean => TEST_FILE.test(name),
    skip: SKIPPED,
  });
  const cache: Map<string, boolean> = new Map<string, boolean>();
  const files: PythonTestFile[] = [];
  for (const file of candidates) {
    files.push({ file, project: await projectOf(file, root, cache) });
  }
  const projects: string[] = [
    ...new Set(files.map((entry: PythonTestFile): string => entry.project)),
  ].sort();
  const tests: TestNode[] = [];
  for (const project of projects) {
    const children: TestNode[] = [];
    for (const entry of files.filter(
      (candidate: PythonTestFile): boolean => candidate.project === project,
    )) {
      const source: string | null = await readSource(entry.file);
      const nodes: TestNode[] = source === null ? [] : toNodes(entry.file, scanPython(source), []);
      if (nodes.length === 0) {
        continue;
      }
      children.push({
        id: fileId(entry.file),
        label: path.relative(project, entry.file).split(path.sep).join('/'),
        kind: 'file',
        location: { file: entry.file, line: 1 },
        children: nodes,
      });
    }
    if (children.length > 0) {
      const pyproject: string = path.join(project, 'pyproject.toml');
      tests.push({
        id: projectId(project),
        label: await projectName(project),
        kind: 'project',
        framework: 'pytest',
        ...(existsSync(pyproject) ? { location: { file: pyproject, line: 1 } } : {}),
        children,
      });
    }
  }
  return { projects, files, tests };
}
