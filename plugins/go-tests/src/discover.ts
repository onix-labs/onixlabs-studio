// Discovers a folder's Go tests by reading its `_test.go` files (#1357). ⛔ Nothing is built or run.
//
// What `go test` runs as a test is a top-level `func TestXxx(t *testing.T)` or `func FuzzXxx(f
// *testing.F)` (a fuzz target runs its seed corpus) in a `_test.go` file, where the name after the prefix
// does not start with a lower-case letter. Subtests (`t.Run`) are known only by running, so they arrive
// with the results and join the tree under their test.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { TestNode } from '../../protocol/testing/protocol';
import { lineIndex, readSource, walkFiles } from '../../protocol/testing/source';

/**
 * Describes one Go module: a folder with a `go.mod`.
 */
export interface GoModule {
  /**
   * Gets the module path `go.mod` declares.
   */
  readonly path: string;

  /**
   * Gets the absolute folder `go.mod` is in.
   */
  readonly directory: string;
}

/**
 * Describes one discovered test.
 */
export interface GoTest {
  /**
   * Gets its node identifier: `<import path>#<name>`.
   */
  readonly id: string;

  /**
   * Gets its function's name, which `-run` matches.
   */
  readonly name: string;

  /**
   * Gets the package it is in.
   */
  readonly pkg: GoPackage;
}

/**
 * Describes one package with tests.
 */
export interface GoPackage {
  /**
   * Gets its import path, which `go test` prints its result line with.
   */
  readonly importPath: string;

  /**
   * Gets its absolute folder.
   */
  readonly directory: string;

  /**
   * Gets the module it is in.
   */
  readonly module: GoModule;
}

/**
 * Describes what a discovery found.
 */
export interface GoDiscovery {
  /**
   * Gets the tree: module → package → test.
   */
  readonly nodes: readonly TestNode[];

  /**
   * Gets every module found.
   */
  readonly modules: readonly GoModule[];

  /**
   * Gets every package with tests, by import path.
   */
  readonly packages: ReadonlyMap<string, GoPackage>;

  /**
   * Gets every test, by node identifier.
   */
  readonly tests: ReadonlyMap<string, GoTest>;
}

/**
 * Matches a test or fuzz target's declaration at the start of a line.
 */
const TEST_FUNCTION: RegExp =
  /^func\s+((?:Test|Fuzz)(?![a-z])\w*)\s*\(\s*\w+\s+\*testing\.(?:T|F)\s*\)/gm;

/**
 * Reads the module path a `go.mod` declares.
 * @param text The file's text.
 * @returns Returns the path, or null when it declares none.
 */
export function readModulePath(text: string): string | null {
  const match: RegExpExecArray | null = /^\s*module\s+("?)([^\s"]+)\1/m.exec(text);
  return match === null ? null : match[2];
}

/**
 * Finds the test functions a `_test.go` file declares.
 * @param text The file's text.
 * @returns Returns each name with its 1-based line.
 */
export function readTestFunctions(text: string): readonly { name: string; line: number }[] {
  // Block comments are blanked, keeping their newlines, so a commented-out test is not one.
  const code: string = text.replace(/\/\*[\s\S]*?\*\//g, (comment: string): string =>
    comment.replace(/[^\n]/g, ' '),
  );
  const line: (offset: number) => number = lineIndex(code);
  return [...code.matchAll(TEST_FUNCTION)].map(
    (match: RegExpMatchArray): { name: string; line: number } => ({
      name: match[1],
      line: line(match.index ?? 0),
    }),
  );
}

/**
 * Finds the modules in a folder.
 * @param root The absolute folder.
 * @returns Returns them, deepest last.
 */
async function findModules(root: string): Promise<readonly GoModule[]> {
  const modules: GoModule[] = [];
  for (const file of await walkFiles(root, {
    accept: (name: string): boolean => name === 'go.mod',
    skip: new Set<string>(['testdata']),
  })) {
    try {
      const modulePath: string | null = readModulePath(await fs.readFile(file, 'utf8'));
      if (modulePath !== null) {
        modules.push({ path: modulePath, directory: path.dirname(file) });
      }
    } catch {
      // Unreadable: not a module Studio can list.
    }
  }
  return modules;
}

/**
 * Discovers every package's tests in a folder.
 * @param root The absolute folder.
 * @returns Returns the tree and its index.
 */
export async function discoverGo(root: string): Promise<GoDiscovery> {
  const modules: readonly GoModule[] = await findModules(root);
  const packages: Map<string, GoPackage> = new Map<string, GoPackage>();
  const tests: Map<string, GoTest> = new Map<string, GoTest>();
  const children: Map<GoModule, Map<string, TestNode[]>> = new Map<
    GoModule,
    Map<string, TestNode[]>
  >();
  const files: readonly string[] = await walkFiles(root, {
    accept: (name: string): boolean => name.endsWith('_test.go'),
    // `go test` ignores `testdata` folders and those starting with `_`.
    skip: new Set<string>(['testdata']),
  });
  for (const file of files) {
    const directory: string = path.dirname(file);
    // The module a package is in is the nearest go.mod above it.
    const module: GoModule | undefined = modules
      .filter(
        (candidate: GoModule): boolean =>
          directory === candidate.directory || directory.startsWith(candidate.directory + path.sep),
      )
      .sort((a: GoModule, b: GoModule): number => b.directory.length - a.directory.length)[0];
    const text: string | null = await readSource(file);
    if (
      module === undefined ||
      text === null ||
      path
        .relative(module.directory, directory)
        .split(path.sep)
        .some((part: string): boolean => part.startsWith('_'))
    ) {
      continue;
    }
    const relative: string = path.relative(module.directory, directory).split(path.sep).join('/');
    const importPath: string = relative.length === 0 ? module.path : `${module.path}/${relative}`;
    const pkg: GoPackage = packages.get(importPath) ?? { importPath, directory, module };
    for (const found of readTestFunctions(text)) {
      const id: string = `${importPath}#${found.name}`;
      if (tests.has(id)) {
        continue;
      }
      packages.set(importPath, pkg);
      tests.set(id, { id, name: found.name, pkg });
      const byPackage: Map<string, TestNode[]> =
        children.get(module) ?? new Map<string, TestNode[]>();
      children.set(module, byPackage);
      const list: TestNode[] = byPackage.get(importPath) ?? [];
      byPackage.set(importPath, list);
      list.push({ id, label: found.name, kind: 'test', location: { file, line: found.line } });
    }
  }
  const nodes: TestNode[] = [];
  for (const module of modules) {
    const byPackage: Map<string, TestNode[]> | undefined = children.get(module);
    if (byPackage === undefined) {
      continue;
    }
    nodes.push({
      id: `module:${module.path}`,
      label: module.path,
      kind: 'project',
      framework: 'go test',
      location: { file: path.join(module.directory, 'go.mod'), line: 1 },
      children: [...byPackage]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([importPath, list]: [string, TestNode[]]): TestNode => ({
          id: importPath,
          label: importPath === module.path ? '.' : importPath.slice(module.path.length + 1),
          kind: 'suite',
          children: list,
        })),
    });
  }
  return { nodes, modules, packages, tests };
}
