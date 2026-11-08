// Discovers a folder's JVM tests by reading each project's `src/test` sources (#1358). ⛔ Nothing is
// built or run.
//
// A project is a folder with a `pom.xml` (Maven) or a `build.gradle` / `build.gradle.kts` (Gradle).
// Its tests are the methods JUnit's annotations mark in `src/test/java` and `src/test/kotlin`.
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { TestNode } from '../../protocol/testing/protocol';
import { readSource, walkFiles } from '../../protocol/testing/source';
import { JvmFileScan, scanJvmFile } from './jvm-source';

/**
 * Names the build tool a project uses.
 */
export type JvmBuildTool = 'gradle' | 'maven';

/**
 * Describes one project: a Maven module or a Gradle (sub)project.
 */
export interface JvmProject {
  /**
   * Gets its node identifier: `jvm:<folder relative to the root>`.
   */
  readonly id: string;

  /**
   * Gets its name: its folder's.
   */
  readonly name: string;

  /**
   * Gets its absolute folder.
   */
  readonly directory: string;

  /**
   * Gets its build tool.
   */
  readonly tool: JvmBuildTool;

  /**
   * Gets the folder a build runs from: the outermost project of the same tool above it, or itself.
   */
  readonly buildRoot: string;
}

/**
 * Describes one discovered test method.
 */
export interface JvmTest {
  /**
   * Gets its node identifier: `<fully qualified binary class name>#<method>`.
   */
  readonly id: string;

  /**
   * Gets its class's fully qualified binary name, such as `com.shop.CartTest$Totals`.
   */
  readonly className: string;

  /**
   * Gets its method's name.
   */
  readonly method: string;

  /**
   * Gets the project it is in.
   */
  readonly project: JvmProject;
}

/**
 * Describes what a discovery found.
 */
export interface JvmDiscovery {
  /**
   * Gets the tree: project → class → (nested class →) test.
   */
  readonly nodes: readonly TestNode[];

  /**
   * Gets every project with tests.
   */
  readonly projects: readonly JvmProject[];

  /**
   * Gets every test, by node identifier.
   */
  readonly tests: ReadonlyMap<string, JvmTest>;

  /**
   * Gets the project each class belongs to, by fully qualified binary name.
   */
  readonly classes: ReadonlyMap<string, JvmProject>;
}

/**
 * The build files that make a folder a project, and the tool each means. Maven's wins where both are.
 */
const BUILD_FILES: readonly [string, JvmBuildTool][] = [
  ['pom.xml', 'maven'],
  ['build.gradle.kts', 'gradle'],
  ['build.gradle', 'gradle'],
];

/**
 * Finds every project in a folder.
 * @param root The absolute folder.
 * @returns Returns the projects, deepest last.
 */
async function findProjects(root: string): Promise<readonly JvmProject[]> {
  const files: readonly string[] = await walkFiles(root, {
    accept: (name: string): boolean => BUILD_FILES.some(([file]) => file === name),
    skip: new Set<string>(['src', 'gradle']),
  });
  const tools: Map<string, JvmBuildTool> = new Map<string, JvmBuildTool>();
  for (const [name, tool] of BUILD_FILES) {
    for (const file of files.filter(
      (candidate: string): boolean => path.basename(candidate) === name,
    )) {
      if (!tools.has(path.dirname(file))) {
        tools.set(path.dirname(file), tool);
      }
    }
  }
  const directories: readonly string[] = [...tools.keys()].sort((a, b) => a.length - b.length);
  return directories.map((directory: string): JvmProject => {
    const tool: JvmBuildTool = tools.get(directory) ?? 'gradle';
    const buildRoot: string =
      (tool === 'gradle' ? gradleSettingsRoot(directory, root) : undefined) ??
      directories.find(
        (candidate: string): boolean =>
          tools.get(candidate) === tool &&
          (candidate === directory || directory.startsWith(candidate + path.sep)),
      ) ??
      directory;
    const relative: string = path.relative(root, directory).split(path.sep).join('/') || '.';
    return { id: `jvm:${relative}`, name: path.basename(directory), directory, tool, buildRoot };
  });
}

/**
 * Finds the Gradle build a project belongs to: the nearest folder at or above it, within the root, with
 * a settings file, which is where Gradle itself looks.
 * @param directory The project's folder.
 * @param root The folder discovery was asked about.
 * @returns Returns the build's folder, or undefined when there is no settings file.
 */
function gradleSettingsRoot(directory: string, root: string): string | undefined {
  for (let folder: string = directory; ; folder = path.dirname(folder)) {
    if (
      existsSync(path.join(folder, 'settings.gradle')) ||
      existsSync(path.join(folder, 'settings.gradle.kts'))
    ) {
      return folder;
    }
    if (folder === root || path.dirname(folder) === folder || !folder.startsWith(root)) {
      return undefined;
    }
  }
}

/**
 * Discovers every project's tests in a folder.
 * @param root The absolute folder.
 * @returns Returns the tree and its index.
 */
export async function discoverJvm(root: string): Promise<JvmDiscovery> {
  const projects: readonly JvmProject[] = await findProjects(root);
  const tests: Map<string, JvmTest> = new Map<string, JvmTest>();
  const classes: Map<string, JvmProject> = new Map<string, JvmProject>();
  const nodes: TestNode[] = [];
  const withTests: JvmProject[] = [];
  for (const project of projects) {
    const sources: string[] = [];
    for (const language of ['java', 'kotlin']) {
      const folder: string = path.join(project.directory, 'src', 'test', language);
      if (existsSync(folder)) {
        sources.push(
          ...(await walkFiles(folder, {
            accept: (name: string): boolean => name.endsWith('.java') || name.endsWith('.kt'),
          })),
        );
      }
    }
    const children: TestNode[] = [];
    for (const file of sources) {
      const text: string | null = await readSource(file);
      if (text === null) {
        continue;
      }
      const scan: JvmFileScan = scanJvmFile(text);
      const prefix: string = scan.packageName.length > 0 ? `${scan.packageName}.` : '';
      const built: Map<string, TestNode & { children: TestNode[] }> = new Map<
        string,
        TestNode & { children: TestNode[] }
      >();
      for (const cls of scan.classes) {
        const className: string = `${prefix}${cls.binaryName}`;
        const node: TestNode & { children: TestNode[] } = {
          id: className,
          label: cls.outer === undefined ? className : cls.simpleName,
          kind: 'suite',
          framework: 'JUnit',
          location: { file, line: cls.line },
          children: [],
        };
        built.set(cls.binaryName, node);
        for (const test of cls.tests) {
          const id: string = `${className}#${test.name}`;
          tests.set(id, { id, className, method: test.name, project });
          node.children.push({
            id,
            label: test.disabled ? `${test.name} (disabled)` : test.name,
            kind: 'test',
            location: { file, line: test.line },
          });
        }
        classes.set(className, project);
      }
      // Nested classes sit under their outer class; classes with no tests anywhere beneath are left out.
      for (const cls of [...scan.classes].reverse()) {
        const node: (TestNode & { children: TestNode[] }) | undefined = built.get(cls.binaryName);
        if (node === undefined || node.children.length === 0) {
          continue;
        }
        if (cls.outer !== undefined && built.has(cls.outer)) {
          built.get(cls.outer)?.children.unshift(node);
        } else if (cls.outer === undefined) {
          children.push(node);
        }
      }
    }
    if (children.length > 0) {
      withTests.push(project);
      nodes.push({
        id: project.id,
        label: project.name,
        kind: 'project',
        framework: project.tool === 'maven' ? 'JUnit (Maven)' : 'JUnit (Gradle)',
        location: {
          file: path.join(
            project.directory,
            project.tool === 'maven'
              ? 'pom.xml'
              : existsSync(path.join(project.directory, 'build.gradle.kts'))
                ? 'build.gradle.kts'
                : 'build.gradle',
          ),
          line: 1,
        },
        children: children.sort((a: TestNode, b: TestNode): number =>
          a.label.localeCompare(b.label),
        ),
      });
    }
  }
  nodes.sort((a: TestNode, b: TestNode): number => a.id.localeCompare(b.id));
  return { nodes, projects: withTests, tests, classes };
}
