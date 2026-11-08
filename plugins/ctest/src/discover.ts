// Discovers a folder's CTest tests (#1359).
//
// A CTest test is whatever CMake's `add_test` declared, and the only complete account of them is a
// configured build directory: names can be computed, and modules such as GoogleTest's add tests CMake
// never sees in the source. So discovery asks `ctest --show-only=json-v1` about the build directory,
// which reads the files CMake generated and runs no test. A project that has not been configured falls
// back to reading `add_test(…)` calls from its `CMakeLists.txt` files, and cannot be run until it is.
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { TestNode } from '../../protocol/testing/protocol';
import { lineIndex, readSource, walkFiles } from '../../protocol/testing/source';

/**
 * Describes one CMake project: a `CMakeLists.txt` that calls `project()`.
 */
export interface CMakeProject {
  /**
   * Gets its node identifier: `ctest:<folder relative to the root>`.
   */
  readonly id: string;

  /**
   * Gets the name `project()` gives it, or its folder's name.
   */
  readonly name: string;

  /**
   * Gets its absolute source folder.
   */
  readonly directory: string;

  /**
   * Gets the configured build directory its tests are read from, or undefined when there is none.
   */
  readonly buildDirectory?: string;
}

/**
 * Describes one discovered test.
 */
export interface CTestTest {
  /**
   * Gets its node identifier.
   */
  readonly id: string;

  /**
   * Gets its CTest name, which `-R` matches.
   */
  readonly name: string;

  /**
   * Gets the project it is in.
   */
  readonly project: CMakeProject;

  /**
   * Gets the identifier of the file node it is listed under.
   */
  readonly fileId: string;
}

/**
 * Describes what a discovery found.
 */
export interface CTestDiscovery {
  /**
   * Gets the tree: project → CMakeLists.txt → test.
   */
  readonly nodes: readonly TestNode[];

  /**
   * Gets every project found.
   */
  readonly projects: readonly CMakeProject[];

  /**
   * Gets every test, by node identifier.
   */
  readonly tests: ReadonlyMap<string, CTestTest>;
}

/**
 * Describes a test as a listing or a source read found it.
 */
export interface ListedTest {
  readonly name: string;
  readonly file?: string;
  readonly line?: number;
}

/**
 * Lists the tests a build directory declares, by asking ctest.
 */
export type ShowOnly = (buildDirectory: string) => Promise<string | null>;

/**
 * Asks the ctest on the PATH for a build directory's tests as JSON. Runs no test.
 * @param buildDirectory The build directory.
 * @returns Returns ctest's JSON, or null when ctest is missing or failed.
 */
export const ctestShowOnly: ShowOnly = (buildDirectory: string): Promise<string | null> =>
  new Promise<string | null>((resolve: (json: string | null) => void): void => {
    execFile(
      'ctest',
      ['--show-only=json-v1', '--test-dir', buildDirectory],
      { timeout: 30_000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout: string): void => resolve(error === null ? stdout : null),
    );
  });

/**
 * Reads the tests a `--show-only=json-v1` listing names, with where each was declared.
 * @param json ctest's output.
 * @returns Returns the tests, or null when it is not a listing.
 */
export function readShowOnly(json: string): readonly ListedTest[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  /**
   * The parts of a listing read here.
   */
  interface Listing {
    tests?: unknown;
    backtraceGraph?: { files?: unknown; nodes?: unknown };
  }
  const record: Listing = parsed ?? {};
  if (!Array.isArray(record.tests)) {
    return null;
  }
  const files: readonly unknown[] = Array.isArray(record.backtraceGraph?.files)
    ? record.backtraceGraph.files
    : [];
  const nodes: readonly unknown[] = Array.isArray(record.backtraceGraph?.nodes)
    ? record.backtraceGraph.nodes
    : [];
  return record.tests
    .map((test: unknown): ListedTest | null => {
      const entry: { name?: unknown; backtrace?: unknown } = test ?? {};
      if (typeof entry.name !== 'string' || entry.name.length === 0) {
        return null;
      }
      const node: { file?: unknown; line?: unknown } =
        typeof entry.backtrace === 'number' ? (nodes[entry.backtrace] ?? {}) : {};
      const file: unknown = typeof node.file === 'number' ? files[node.file] : undefined;
      return {
        name: entry.name,
        ...(typeof file === 'string' ? { file } : {}),
        ...(typeof node.line === 'number' ? { line: node.line } : {}),
      };
    })
    .filter((test: ListedTest | null): test is ListedTest => test !== null);
}

/**
 * Reads the `add_test` calls one `CMakeLists.txt` makes: `add_test(NAME <name> …)` and the older
 * `add_test(<name> <command>)`. A name built from a variable cannot be known without configuring, so it
 * is left out.
 * @param text The file's text.
 * @returns Returns each test's name and line.
 */
export function readAddTests(text: string): readonly { name: string; line: number }[] {
  // Comments are blanked, keeping offsets: a `#` to the end of the line, outside a quoted argument.
  const code: string = text.replace(/"(?:\\.|[^"\\])*"|#[^\n]*/g, (span: string): string =>
    span.startsWith('#') ? ' '.repeat(span.length) : span,
  );
  const line: (offset: number) => number = lineIndex(code);
  const found: { name: string; line: number }[] = [];
  for (const match of code.matchAll(/\badd_test\s*\(\s*(?:NAME\s+)?("[^"]*"|[^\s)]+)/gi)) {
    const name: string = match[1].replace(/^"|"$/g, '');
    if (name.length > 0 && !name.includes('${') && name.toUpperCase() !== 'NAME') {
      found.push({ name, line: line(match.index ?? 0) });
    }
  }
  return found;
}

/**
 * Reads the name a `project()` call gives.
 * @param text The file's text.
 * @returns Returns the name, or null when the file calls no `project()`.
 */
export function readProjectName(text: string): string | null {
  const match: RegExpExecArray | null = /^\s*project\s*\(\s*"?([^\s")]+)/im.exec(text);
  return match === null ? null : match[1];
}

/**
 * Determines whether a folder is a configured CTest build directory of a project.
 * @param directory The candidate.
 * @param source The project's source folder.
 * @returns Returns its CMakeCache's modification time, or null when it is not one.
 */
async function buildDirectoryAge(directory: string, source: string): Promise<number | null> {
  try {
    const cache: string = path.join(directory, 'CMakeCache.txt');
    const [stat, text] = await Promise.all([fs.stat(cache), fs.readFile(cache, 'utf8')]);
    await fs.stat(path.join(directory, 'CTestTestfile.cmake'));
    const home: string | undefined = /^CMAKE_HOME_DIRECTORY:INTERNAL=(.*)$/m
      .exec(text)?.[1]
      ?.trim();
    if (home !== undefined && path.resolve(home) !== path.resolve(source)) {
      return null;
    }
    return stat.mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Lists the subfolders of a folder.
 * @param directory The folder.
 * @returns Returns their absolute paths.
 */
async function subfolders(directory: string): Promise<readonly string[]> {
  try {
    return (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

/**
 * Finds a project's build directory where CMake's conventions put one — `build`, `build/<preset>`,
 * `out/build/<preset>`, `cmake-build-<type>` — or the source folder itself for an in-source build.
 * Of several, the one configured most recently wins.
 * @param source The project's source folder.
 * @returns Returns the build directory, or undefined when it has none.
 */
export async function findBuildDirectory(source: string): Promise<string | undefined> {
  const candidates: string[] = [
    source,
    path.join(source, 'build'),
    ...(await subfolders(path.join(source, 'build'))),
    ...(await subfolders(path.join(source, 'out', 'build'))),
    ...(await subfolders(source)).filter((folder: string): boolean =>
      path.basename(folder).startsWith('cmake-build-'),
    ),
  ];
  let best: { readonly directory: string; readonly age: number } | undefined;
  for (const candidate of candidates) {
    const age: number | null = await buildDirectoryAge(candidate, source);
    if (age !== null && (best === undefined || age > best.age)) {
      best = { directory: candidate, age };
    }
  }
  return best?.directory;
}

/**
 * Discovers every project's tests in a folder.
 * @param root The absolute folder.
 * @param showOnly Lists a build directory's tests; defaults to the ctest on the PATH.
 * @returns Returns the tree and its index.
 */
export async function discoverCTest(
  root: string,
  showOnly: ShowOnly = ctestShowOnly,
): Promise<CTestDiscovery> {
  const lists: readonly string[] = await walkFiles(root, {
    accept: (name: string): boolean => name === 'CMakeLists.txt',
  });
  const sources: Map<string, string> = new Map<string, string>();
  for (const file of lists) {
    const text: string | null = await readSource(file);
    if (text !== null) {
      sources.set(file, text);
    }
  }
  // A project is a CMakeLists.txt with a project() call and no project above it.
  const roots: string[] = [];
  for (const [file, text] of [...sources].sort(([a], [b]) => a.length - b.length)) {
    const directory: string = path.dirname(file);
    if (
      readProjectName(text) !== null &&
      !roots.some((top: string): boolean => directory.startsWith(top + path.sep))
    ) {
      roots.push(directory);
    }
  }
  const projects: CMakeProject[] = [];
  const tests: Map<string, CTestTest> = new Map<string, CTestTest>();
  const nodes: TestNode[] = [];
  for (const directory of roots) {
    const text: string = sources.get(path.join(directory, 'CMakeLists.txt')) ?? '';
    const buildDirectory: string | undefined = await findBuildDirectory(directory);
    const relative: string = path.relative(root, directory).split(path.sep).join('/') || '.';
    const projectId: string = `ctest:${relative}`;
    const project: CMakeProject = {
      id: projectId,
      name: readProjectName(text) ?? path.basename(directory),
      directory,
      ...(buildDirectory === undefined ? {} : { buildDirectory }),
    };
    projects.push(project);
    const listing: readonly ListedTest[] | null =
      buildDirectory === undefined ? null : readShowOnly((await showOnly(buildDirectory)) ?? '');
    const listed: readonly ListedTest[] =
      listing ??
      [...sources]
        .filter(
          ([file]) => path.dirname(file) === directory || file.startsWith(directory + path.sep),
        )
        .flatMap(([file, body]): readonly ListedTest[] =>
          readAddTests(body).map((found): ListedTest => ({
            name: found.name,
            file,
            line: found.line,
          })),
        );
    const byFile: Map<string, TestNode[]> = new Map<string, TestNode[]>();
    for (const test of listed) {
      const id: string = `${projectId}::${test.name}`;
      if (tests.has(id)) {
        continue;
      }
      const file: string = test.file ?? path.join(directory, 'CMakeLists.txt');
      tests.set(id, {
        id,
        name: test.name,
        project,
        fileId: fileNodeId(projectId, directory, file),
      });
      const list: TestNode[] = byFile.get(file) ?? [];
      byFile.set(file, list);
      list.push({
        id,
        label: test.name,
        kind: 'test',
        ...(test.file !== undefined && test.line !== undefined
          ? { location: { file: test.file, line: test.line } }
          : {}),
      });
    }
    if (byFile.size === 0) {
      continue;
    }
    nodes.push({
      id: projectId,
      label: buildDirectory === undefined ? `${project.name} (not configured)` : project.name,
      kind: 'project',
      framework: 'CTest',
      location: { file: path.join(directory, 'CMakeLists.txt'), line: 1 },
      children: [...byFile].map(([file, children]: [string, TestNode[]]): TestNode => ({
        id: fileNodeId(projectId, directory, file),
        label: path.relative(directory, file).split(path.sep).join('/'),
        kind: 'file',
        location: { file, line: 1 },
        children,
      })),
    });
  }
  return { nodes, projects, tests };
}

/**
 * Names a file node: its project and its path relative to the project.
 * @param projectId The project's identifier.
 * @param directory The project's folder.
 * @param file The file.
 * @returns Returns the identifier.
 */
function fileNodeId(projectId: string, directory: string, file: string): string {
  return `${projectId}::file:${path.relative(directory, file).split(path.sep).join('/')}`;
}
