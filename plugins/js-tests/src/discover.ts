// Finds a folder's JavaScript and TypeScript tests (#1354): the packages that use Vitest, Jest or
// Playwright Test, the test files each owns, and what each file declares.
//
// ⛔ Everything here reads files. `package.json` is parsed as JSON, a Playwright config is read as text
// for its `testDir`, and test files are scanned by `scan.ts`; none of the folder's code is run.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { TestNode } from '../../protocol/testing/protocol';
import { readSource, walkFiles } from '../../protocol/testing/source';
import { Declaration, scanDeclarations } from './scan';

/**
 * Names a framework this adapter runs.
 */
export type Framework = 'vitest' | 'jest' | 'playwright';

/**
 * The name each framework is shown under.
 */
export const FRAMEWORK_NAMES: Readonly<Record<Framework, string>> = {
  vitest: 'Vitest',
  jest: 'Jest',
  playwright: 'Playwright Test',
};

/**
 * Matches a test file: `*.test.*` or `*.spec.*`, in any of the extensions the three frameworks read.
 */
export const TEST_FILE: RegExp = /\.(test|spec)\.(c|m)?[jt]sx?$/;

/**
 * Describes a package that uses a test framework.
 */
export interface TestPackage {
  /**
   * Gets the package's folder.
   */
  readonly directory: string;

  /**
   * Gets its name, from `package.json`, or the folder's.
   */
  readonly name: string;

  /**
   * Gets the frameworks it uses, unit-test framework first.
   */
  readonly frameworks: readonly Framework[];

  /**
   * Gets the folder Playwright's tests live under, when it uses Playwright.
   */
  readonly playwrightDirectory?: string;
}

/**
 * Describes one test file and who runs it.
 */
export interface TestFile {
  /**
   * Gets the file's absolute path.
   */
  readonly file: string;

  /**
   * Gets the package it belongs to.
   */
  readonly owner: TestPackage;

  /**
   * Gets the framework that runs it.
   */
  readonly framework: Framework;
}

/**
 * Describes everything discovery found: the files, and the tree drawn from them.
 */
export interface JsDiscovery {
  readonly files: readonly TestFile[];
  readonly tests: readonly TestNode[];
}

/**
 * Builds a package node's identifier.
 * @param directory The package's folder.
 * @returns Returns the identifier.
 */
export function packageId(directory: string): string {
  return `package:${directory}`;
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
 * Builds a test's identifier from its file and the titles that lead to it, the way every reporter
 * names it: its `describe` blocks' titles, then its own.
 * @param file The file.
 * @param titles The titles, outermost first.
 * @returns Returns the identifier.
 */
export function testId(file: string, titles: readonly string[]): string {
  return `${file}::${titles.join(' > ')}`;
}

/**
 * Builds a suite's identifier.
 * @param file The file.
 * @param titles The titles, outermost first.
 * @returns Returns the identifier.
 */
export function suiteId(file: string, titles: readonly string[]): string {
  return `suite:${testId(file, titles)}`;
}

/**
 * Reads which frameworks a package uses: what it depends on, or a config file beside it.
 * @param manifest The parsed `package.json`.
 * @param siblings The names of the files beside it.
 * @returns Returns the frameworks, unit-test framework first. Vitest wins over Jest when a package
 * names both and configures neither, because a package moving to Vitest keeps Jest a while.
 */
export function frameworksOf(
  manifest: Record<string, unknown>,
  siblings: readonly string[],
): readonly Framework[] {
  const dependencies: Record<string, unknown> = {
    ...(manifest['dependencies'] as Record<string, unknown> | undefined),
    ...(manifest['devDependencies'] as Record<string, unknown> | undefined),
  };
  const has: (name: string) => boolean = (name: string): boolean => name in dependencies;
  const configured: (stem: string) => boolean = (stem: string): boolean =>
    siblings.some((name: string): boolean => name.startsWith(`${stem}.config.`));
  const frameworks: Framework[] = [];
  const vitest: boolean = has('vitest') || configured('vitest');
  const jest: boolean = has('jest') || configured('jest') || 'jest' in manifest;
  if (vitest && (!jest || !configured('jest') || configured('vitest'))) {
    frameworks.push('vitest');
  } else if (jest) {
    frameworks.push('jest');
  }
  if (has('@playwright/test') || configured('playwright')) {
    frameworks.push('playwright');
  }
  return frameworks;
}

/**
 * Reads the `testDir` a Playwright config names, when it names one as a plain string.
 * @param config The config's text.
 * @returns Returns the folder as written, or undefined.
 */
export function playwrightTestDir(config: string): string | undefined {
  return /\btestDir\s*:\s*['"`]([^'"`$]+)['"`]/.exec(config)?.[1];
}

/**
 * Reads the packages under a folder that use a test framework.
 * @param root The folder.
 * @returns Returns the packages, deepest last.
 */
async function readPackages(root: string): Promise<readonly TestPackage[]> {
  const manifests: readonly string[] = await walkFiles(root, {
    accept: (name: string): boolean => name === 'package.json',
  });
  const packages: TestPackage[] = [];
  for (const manifestPath of manifests) {
    const text: string | null = await readSource(manifestPath);
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(text ?? '') as Record<string, unknown>;
    } catch {
      continue;
    }
    const directory: string = path.dirname(manifestPath);
    const siblings: readonly string[] = await fs.readdir(directory).catch((): string[] => []);
    const frameworks: readonly Framework[] = frameworksOf(manifest, siblings);
    if (frameworks.length === 0) {
      continue;
    }
    let playwrightDirectory: string | undefined;
    if (frameworks.includes('playwright')) {
      const config: string | undefined = siblings.find((name: string): boolean =>
        name.startsWith('playwright.config.'),
      );
      const written: string | undefined =
        config === undefined
          ? undefined
          : playwrightTestDir((await readSource(path.join(directory, config))) ?? '');
      // Playwright's own default is the config's folder. Beside a unit-test framework that would take
      // every unit test too, so there it is taken to be `e2e/`, the folder Playwright's scaffold makes.
      playwrightDirectory =
        written !== undefined
          ? path.resolve(directory, written)
          : frameworks.length > 1
            ? path.join(directory, 'e2e')
            : directory;
    }
    const name: unknown = manifest['name'];
    packages.push({
      directory,
      name: typeof name === 'string' && name.length > 0 ? name : path.basename(directory),
      frameworks,
      ...(playwrightDirectory === undefined ? {} : { playwrightDirectory }),
    });
  }
  return packages.sort(
    (a: TestPackage, b: TestPackage): number => a.directory.length - b.directory.length,
  );
}

/**
 * Determines whether a path lies within a folder.
 * @param file The path.
 * @param directory The folder.
 * @returns Returns true when it does.
 */
function within(file: string, directory: string): boolean {
  return file === directory || file.startsWith(directory + path.sep);
}

/**
 * Finds the package and framework a test file belongs to: the nearest package above it that uses a
 * framework, and within it Playwright when the file lies in Playwright's folder.
 * @param file The file.
 * @param packages The packages, deepest last.
 * @returns Returns the owner, or undefined when no package claims it.
 */
export function ownerOf(file: string, packages: readonly TestPackage[]): TestFile | undefined {
  const owner: TestPackage | undefined = [...packages]
    .reverse()
    .find((candidate: TestPackage): boolean => within(file, candidate.directory));
  if (owner === undefined) {
    return undefined;
  }
  const playwright: boolean =
    owner.playwrightDirectory !== undefined && within(file, owner.playwrightDirectory);
  const unit: Framework | undefined = owner.frameworks.find(
    (framework: Framework): boolean => framework !== 'playwright',
  );
  const framework: Framework | undefined = playwright ? 'playwright' : unit;
  return framework === undefined ? undefined : { file, owner, framework };
}

/**
 * Turns a file's declarations into nodes.
 * @param file The file.
 * @param declarations Its declarations.
 * @param titles The titles of the suites they sit in.
 * @returns Returns the nodes.
 */
function toNodes(
  file: string,
  declarations: readonly Declaration[],
  titles: readonly string[],
): TestNode[] {
  return declarations.map((declaration: Declaration): TestNode => {
    const trail: readonly string[] = [...titles, declaration.name];
    const location: { file: string; line: number } = { file, line: declaration.line };
    return declaration.kind === 'suite'
      ? {
          id: suiteId(file, trail),
          label: declaration.name,
          kind: 'suite',
          location,
          children: toNodes(file, declaration.children, trail),
        }
      : { id: testId(file, trail), label: declaration.name, kind: 'test', location };
  });
}

/**
 * Finds a folder's tests.
 * @param root The folder.
 * @returns Returns the files found and the tree: package → file → suite → test.
 */
export async function discoverJs(root: string): Promise<JsDiscovery> {
  const packages: readonly TestPackage[] = await readPackages(root);
  if (packages.length === 0) {
    return { files: [], tests: [] };
  }
  const candidates: readonly string[] = await walkFiles(root, {
    accept: (name: string): boolean => TEST_FILE.test(name),
  });
  const files: TestFile[] = candidates
    .map((file: string): TestFile | undefined => ownerOf(file, packages))
    .filter((file: TestFile | undefined): file is TestFile => file !== undefined);
  const tests: TestNode[] = [];
  for (const owner of packages) {
    const children: TestNode[] = [];
    for (const entry of files.filter((file: TestFile): boolean => file.owner === owner)) {
      const source: string | null = await readSource(entry.file);
      children.push({
        id: fileId(entry.file),
        label: path.relative(owner.directory, entry.file).split(path.sep).join('/'),
        kind: 'file',
        framework: FRAMEWORK_NAMES[entry.framework],
        location: { file: entry.file, line: 1 },
        children: source === null ? [] : toNodes(entry.file, scanDeclarations(source), []),
      });
    }
    if (children.length === 0) {
      continue;
    }
    tests.push({
      id: packageId(owner.directory),
      label: owner.name,
      kind: 'project',
      ...(owner.frameworks.length === 1 ? { framework: FRAMEWORK_NAMES[owner.frameworks[0]] } : {}),
      location: { file: path.join(owner.directory, 'package.json'), line: 1 },
      children,
    });
  }
  return { files, tests };
}
