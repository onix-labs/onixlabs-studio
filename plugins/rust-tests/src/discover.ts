// Discovers a folder's Rust tests by reading its crates' sources (#1356): each target's root file, then
// every module it pulls in with `mod name;`, the way rustc resolves them. ⛔ Nothing is built or run.
import * as path from 'node:path';
import type { TestNode } from '../../protocol/testing/protocol';
import { readSource } from '../../protocol/testing/source';
import { CargoTarget, CargoTargetRoot, Crate, findCrates, targetKey } from './cargo';
import { RustFileModule, RustFileScan, RustTestFunction, scanRustFile } from './rust-source';

/**
 * The deepest a module tree is followed, so a cycle of `#[path]`s cannot loop.
 */
const MAX_MODULE_DEPTH: number = 32;

/**
 * Describes one discovered test, as a run needs it.
 */
export interface RustTest {
  /**
   * Gets its node identifier: `<crate>::<target>::<path>`.
   */
  readonly id: string;

  /**
   * Gets the crate it is in.
   */
  readonly crate: Crate;

  /**
   * Gets the target it is compiled into.
   */
  readonly target: CargoTarget;

  /**
   * Gets its path as libtest names it, such as `tests::adds`.
   */
  readonly path: string;

  /**
   * Gets whether it is marked `#[ignore]`.
   */
  readonly ignored: boolean;
}

/**
 * Describes what a discovery found: the tree, and every test in it by identifier.
 */
export interface RustDiscovery {
  /**
   * Gets the tree, one project node per crate that has tests.
   */
  readonly nodes: readonly TestNode[];

  /**
   * Gets every crate found, with or without tests.
   */
  readonly crates: readonly Crate[];

  /**
   * Gets every test, by node identifier.
   */
  readonly tests: ReadonlyMap<string, RustTest>;

  /**
   * Gets the tests under each node that is not itself a test, by node identifier, so a run can be
   * narrowed to a file or a module.
   */
  readonly groups: ReadonlyMap<string, readonly string[]>;
}

/**
 * Describes one source file and the module path it is compiled at.
 */
interface ModuleFile {
  readonly file: string;
  readonly modulePath: readonly string[];
  readonly scan: RustFileScan;
}

/**
 * Determines whether a file owns a directory of submodules named after its folder rather than itself:
 * a crate root, a `mod.rs`, or a test target's root.
 * @param file The file.
 * @param root Whether it is the target's root file.
 * @returns Returns true when `mod x;` in it resolves beside it.
 */
function ownsItsFolder(file: string, root: boolean): boolean {
  return root || path.basename(file) === 'mod.rs';
}

/**
 * Follows a target's module tree from its root file.
 * @param target The target and its root file.
 * @returns Returns every file in it with the module path it is compiled at.
 */
async function moduleFiles(target: CargoTargetRoot): Promise<readonly ModuleFile[]> {
  const found: ModuleFile[] = [];
  const seen: Set<string> = new Set<string>();
  const visit: (
    file: string,
    modulePath: readonly string[],
    root: boolean,
  ) => Promise<void> = async (
    file: string,
    modulePath: readonly string[],
    root: boolean,
  ): Promise<void> => {
    if (seen.has(file) || modulePath.length > MAX_MODULE_DEPTH) {
      return;
    }
    seen.add(file);
    const text: string | null = await readSource(file);
    if (text === null) {
      return;
    }
    const scan: RustFileScan = scanRustFile(text);
    found.push({ file, modulePath, scan });
    const base: string = ownsItsFolder(file, root)
      ? path.dirname(file)
      : path.join(path.dirname(file), path.basename(file, '.rs'));
    for (const declared of scan.fileModules) {
      for (const candidate of candidatesFor(declared, file, base)) {
        if ((await readSource(candidate)) !== null) {
          await visit(candidate, [...modulePath, ...declared.modules, declared.name], false);
          break;
        }
      }
    }
  };
  await visit(target.file, [], true);
  return found;
}

/**
 * Lists where a `mod name;` declaration's file may be, in the order rustc tries them.
 * @param declared The declaration.
 * @param file The file it is in.
 * @param base The folder its submodules live in.
 * @returns Returns the candidate paths.
 */
function candidatesFor(declared: RustFileModule, file: string, base: string): readonly string[] {
  if (declared.path !== undefined) {
    return [path.resolve(path.dirname(file), declared.path)];
  }
  const folder: string = path.join(base, ...declared.modules);
  return [path.join(folder, `${declared.name}.rs`), path.join(folder, declared.name, 'mod.rs')];
}

/**
 * Discovers every crate's tests in a folder.
 * @param root The absolute folder.
 * @returns Returns the tree and its index.
 */
export async function discoverRust(root: string): Promise<RustDiscovery> {
  const crates: readonly Crate[] = await findCrates(root);
  const tests: Map<string, RustTest> = new Map<string, RustTest>();
  const groups: Map<string, string[]> = new Map<string, string[]>();
  const nodes: TestNode[] = [];
  const group: (id: string, testId: string) => void = (id: string, testId: string): void => {
    const list: string[] = groups.get(id) ?? [];
    list.push(testId);
    groups.set(id, list);
  };
  for (const crate of [...crates].sort((a, b) => a.name.localeCompare(b.name))) {
    const files: TestNode[] = [];
    for (const target of crate.targets) {
      const key: string = targetKey(target.target);
      for (const module of await moduleFiles(target)) {
        const fileId: string = `${crate.name}::${key}::file:${path.relative(crate.directory, module.file).split(path.sep).join('/')}`;
        const children: TestNode[] = [];
        const suites: Map<string, TestNode & { children: TestNode[] }> = new Map<
          string,
          TestNode & { children: TestNode[] }
        >();
        for (const found of module.scan.tests) {
          const test: RustTest = toTest(crate, target.target, module, found);
          tests.set(test.id, test);
          group(crate.name, test.id);
          group(fileId, test.id);
          const leaf: TestNode = {
            id: test.id,
            label: found.ignored ? `${found.name} (ignored)` : found.name,
            kind: 'test',
            location: { file: module.file, line: found.line },
          };
          if (found.modules.length === 0) {
            children.push(leaf);
            continue;
          }
          const suitePath: string = [...module.modulePath, ...found.modules].join('::');
          const suiteId: string = `${crate.name}::${key}::mod:${suitePath}`;
          group(suiteId, test.id);
          let suite: (TestNode & { children: TestNode[] }) | undefined = suites.get(suiteId);
          if (suite === undefined) {
            suite = { id: suiteId, label: found.modules.join('::'), kind: 'suite', children: [] };
            suites.set(suiteId, suite);
            children.push(suite);
          }
          suite.children.push(leaf);
        }
        if (children.length > 0) {
          files.push({
            id: fileId,
            label: path.relative(crate.directory, module.file).split(path.sep).join('/'),
            kind: 'file',
            location: { file: module.file, line: 1 },
            children,
          });
        }
      }
    }
    if (files.length > 0) {
      nodes.push({
        id: crate.name,
        label: crate.name,
        kind: 'project',
        framework: 'cargo test',
        location: { file: crate.manifest, line: 1 },
        children: files,
      });
    }
  }
  return { nodes, crates, tests, groups };
}

/**
 * Builds a test's record.
 * @param crate The crate.
 * @param target The target.
 * @param module The file it is in.
 * @param found The function.
 * @returns Returns the record.
 */
function toTest(
  crate: Crate,
  target: CargoTarget,
  module: ModuleFile,
  found: RustTestFunction,
): RustTest {
  const testPath: string = [...module.modulePath, ...found.modules, found.name].join('::');
  return {
    id: `${crate.name}::${targetKey(target)}::${testPath}`,
    crate,
    target,
    path: testPath,
    ignored: found.ignored,
  };
}
