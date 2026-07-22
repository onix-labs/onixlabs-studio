import { Dirent, Stats } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  ProjectCapabilities,
  ProjectEntry,
  ProjectItemNode,
  ProjectItems,
  ProjectModel,
  ProjectNode,
} from '@shared/api/project-system';
import { ProjectSystem } from './project-system';

/**
 * The JVM project system's root-independent capabilities: the Build/Clean/Test actions both Gradle and
 * Maven support, no build-configuration axis (neither tool has a fixed Debug/Release axis the way .NET
 * does), no target axis, and no debug adapter yet — a JVM DAP adapter is a later phase, so the ribbon's
 * Debug button stays inert until one is provisioned.
 */
const JVM_CAPABILITIES: ProjectCapabilities = {
  actions: ['build', 'clean', 'test'],
  buildConfigurations: [],
  target: null,
  debug: null,
};

/**
 * The Gradle build-script names that mark a Gradle project root (Groovy or Kotlin DSL).
 */
const GRADLE_BUILD_FILES: readonly string[] = ['build.gradle', 'build.gradle.kts'];

/**
 * The Gradle settings-script names that carry the root project name and its included modules.
 */
const GRADLE_SETTINGS_FILES: readonly string[] = ['settings.gradle', 'settings.gradle.kts'];

/**
 * The Maven project object model that marks a Maven project root.
 */
const MAVEN_POM: string = 'pom.xml';

/**
 * The directories skipped when listing a module's files: build outputs, tool caches, and IDE metadata
 * are never the sources to open.
 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  'build',
  'target',
  'out',
  'bin',
  'node_modules',
]);

/**
 * Bounds how many files a module listing returns, so a mis-shaped module (one whose directory is
 * effectively the whole repository) cannot balloon the Solution Explorer.
 */
const MAX_ITEMS: number = 5_000;

/**
 * The build tool a JVM root uses. Gradle and Maven are modelled the same way — a root project with
 * declared submodules — but their action and run commands differ, so the tool is carried on the model
 * (as its {@link ProjectModel.kind}, `jvm`, is shared) only implicitly; callers re-detect the tool from
 * the root when compiling a command.
 */
type BuildTool = 'gradle' | 'maven';

/**
 * Reads the root project name from a Gradle settings script (`rootProject.name = '...'`).
 * @param settings The settings-script content, or null when absent.
 * @returns Returns the root project name, or null when not declared.
 */
export function parseGradleRootName(settings: string | null): string | null {
  if (settings === null) {
    return null;
  }
  const match: RegExpExecArray | null = /rootProject\.name\s*=\s*['"]([^'"]+)['"]/.exec(settings);
  return match === null ? null : match[1];
}

/**
 * Extracts the included module paths from a Gradle settings script, from every `include` statement. A
 * leading colon is dropped and nested colon-delimited paths (`:core:api`) become directory paths
 * (`core/api`).
 * @param settings The settings-script content, or null when absent.
 * @returns Returns the module directory paths, relative to the root.
 */
export function parseGradleModules(settings: string | null): readonly string[] {
  if (settings === null) {
    return [];
  }
  const modules: string[] = [];
  for (const statement of settings.matchAll(/include\b([^\n]*)/g)) {
    for (const quoted of statement[1].matchAll(/['"]([^'"]+)['"]/g)) {
      const module: string = quoted[1].replace(/^:/, '').replace(/:/g, '/');
      if (module.length > 0) {
        modules.push(module);
      }
    }
  }
  return modules;
}

/**
 * Reads a Maven project's display name from its pom, preferring `<name>` over the project (not parent)
 * `<artifactId>`.
 * @param pom The pom content, or null when absent.
 * @returns Returns the name, or null when neither is present.
 */
export function parseMavenName(pom: string | null): string | null {
  if (pom === null) {
    return null;
  }
  const name: RegExpExecArray | null = /<name>\s*([^<]+?)\s*<\/name>/.exec(pom);
  if (name !== null) {
    return name[1];
  }
  // Strip the parent block so the parent's artifactId is not mistaken for the project's own.
  const body: string = pom.replace(/<parent\b[\s\S]*?<\/parent>/, '');
  const artifact: RegExpExecArray | null = /<artifactId>\s*([^<]+?)\s*<\/artifactId>/.exec(body);
  return artifact === null ? null : artifact[1];
}

/**
 * Extracts the submodule directories from a Maven pom's `<modules>` block.
 * @param pom The pom content, or null when absent.
 * @returns Returns the module directory paths, relative to the root.
 */
export function parseMavenModules(pom: string | null): readonly string[] {
  if (pom === null) {
    return [];
  }
  const modules: string[] = [];
  for (const match of pom.matchAll(/<module>\s*([^<]+?)\s*<\/module>/g)) {
    if (match[1].length > 0) {
      modules.push(match[1]);
    }
  }
  return modules;
}

/**
 * Models a JVM workspace built by Gradle or Maven: the root project, plus each declared submodule
 * (Gradle's `include`d projects, Maven's `<modules>`) expanded from the settings/pom manifest. A
 * module's files are listed straight from its directory, skipping build-output and cache folders.
 * Deliberately language-server-agnostic, like the .NET and Node providers; the workspace view decides to
 * prestart the Java language server (jdtls) for `jvm` models.
 */
export class JvmProjectSystem implements ProjectSystem {
  /**
   * Gets the kind identifier of this project system.
   */
  public readonly kind: string = 'jvm';

  /**
   * Gets the root-independent capabilities this project system declares.
   */
  public readonly capabilities: ProjectCapabilities = JVM_CAPABILITIES;

  /**
   * Determines whether the root holds a Gradle or Maven project.
   * @param root The absolute workspace root.
   * @returns Returns true when a Gradle build script or a Maven pom is present at the root.
   */
  public async detect(root: string): Promise<boolean> {
    return (await this.detectTool(root)) !== null;
  }

  /**
   * Determines whether this provider owns a project file (a Gradle build script or a Maven pom).
   * @param projectPath The absolute project-file path.
   * @returns Returns true when the file is a Gradle or Maven manifest.
   */
  public ownsProject(projectPath: string): boolean {
    const name: string = path.basename(projectPath);
    return GRADLE_BUILD_FILES.includes(name) || name === MAVEN_POM;
  }

  /**
   * Builds the JVM project model: the root project alone, or — for a multi-module build — the root as
   * the solution with each declared submodule as a project.
   * @param root The absolute workspace root.
   * @returns Returns the model, or null when the root is neither a Gradle nor a Maven project.
   */
  public async load(root: string): Promise<ProjectModel | null> {
    const tool: BuildTool | null = await this.detectTool(root);
    if (tool === null) {
      return null;
    }
    return tool === 'gradle' ? this.loadGradle(root) : this.loadMaven(root);
  }

  /**
   * Lists a module's source files straight from its directory, skipping build-output and cache folders
   * and other modules' directories (a nested manifest marks a separate module).
   * @param projectPath The absolute path of the module manifest.
   * @returns Returns the contents, or null when the directory cannot be read.
   */
  public async loadProjectItems(projectPath: string): Promise<ProjectItems | null> {
    const directory: string = path.dirname(projectPath);
    const budget: { remaining: number } = { remaining: MAX_ITEMS };
    const tree: readonly ProjectItemNode[] | null = await this.listDirectory(
      directory,
      budget,
      true,
    );
    return tree === null ? null : { projectPath, tree };
  }

  /**
   * Builds the Gradle project model from the root build script and settings.
   * @param root The absolute workspace root.
   * @returns Returns the model.
   */
  private async loadGradle(root: string): Promise<ProjectModel> {
    const settingsPath: string | null = await this.firstPresent(root, GRADLE_SETTINGS_FILES);
    const settings: string | null =
      settingsPath === null ? null : await this.readFile(settingsPath);
    const rootManifest: string =
      (await this.firstPresent(root, GRADLE_BUILD_FILES)) ?? settingsPath ?? root;
    const rootName: string = parseGradleRootName(settings) ?? path.basename(root);
    const moduleDirs: readonly string[] = parseGradleModules(settings).map(
      (module: string): string => path.join(root, module),
    );
    const modules: readonly ProjectNode[] = await this.moduleNodes(moduleDirs, GRADLE_BUILD_FILES);
    return this.model(root, rootName, rootManifest, modules);
  }

  /**
   * Builds the Maven project model from the root pom.
   * @param root The absolute workspace root.
   * @returns Returns the model.
   */
  private async loadMaven(root: string): Promise<ProjectModel> {
    const pomPath: string = path.join(root, MAVEN_POM);
    const pom: string | null = await this.readFile(pomPath);
    const rootName: string = parseMavenName(pom) ?? path.basename(root);
    const moduleDirs: readonly string[] = parseMavenModules(pom).map(
      (module: string): string => path.join(root, module),
    );
    const modules: readonly ProjectNode[] = await this.moduleNodes(moduleDirs, [MAVEN_POM]);
    return this.model(root, rootName, pomPath, modules);
  }

  /**
   * Assembles a project model from its root project and submodules: a single-module build models the
   * root project alone; a multi-module build models the root as the solution with the submodules as
   * projects beneath it.
   * @param root The absolute workspace root.
   * @param rootName The root project's display name.
   * @param rootManifest The absolute path of the root project's manifest.
   * @param modules The submodule project nodes.
   * @returns Returns the model.
   */
  private model(
    root: string,
    rootName: string,
    rootManifest: string,
    modules: readonly ProjectNode[],
  ): ProjectModel {
    const rootProject: ProjectNode = { type: 'project', name: rootName, path: rootManifest };
    if (modules.length === 0) {
      const tree: readonly ProjectNode[] = [rootProject];
      return {
        kind: this.kind,
        root,
        solution: null,
        projects: this.flatten(tree),
        tree,
        capabilities: this.capabilities,
      };
    }
    const tree: readonly ProjectNode[] = [rootProject, ...modules];
    return {
      kind: this.kind,
      root,
      solution: { name: rootName, path: rootManifest },
      projects: this.flatten(tree),
      tree,
      capabilities: this.capabilities,
    };
  }

  /**
   * Builds the project nodes for a set of module directories, reading each module's manifest for its
   * display name. Modules whose directory or manifest cannot be read are skipped.
   * @param moduleDirs The absolute module directories.
   * @param manifests The manifest file names to look for in each module directory.
   * @returns Returns the module project nodes, sorted by name.
   */
  private async moduleNodes(
    moduleDirs: readonly string[],
    manifests: readonly string[],
  ): Promise<readonly ProjectNode[]> {
    const nodes: ProjectNode[] = [];
    for (const directory of moduleDirs) {
      const manifest: string | null = await this.firstPresent(directory, manifests);
      if (manifest === null) {
        continue;
      }
      const name: string =
        manifests[0] === MAVEN_POM
          ? (parseMavenName(await this.readFile(manifest)) ?? path.basename(directory))
          : path.basename(directory);
      nodes.push({ type: 'project', name, path: manifest });
    }
    return nodes.sort((a: ProjectNode, b: ProjectNode): number => a.name.localeCompare(b.name));
  }

  /**
   * Detects the build tool a root uses, preferring Gradle when both are present (a Gradle build with a
   * generated pom is a Gradle build).
   * @param root The absolute workspace root.
   * @returns Returns the build tool, or null when the root is neither.
   */
  private async detectTool(root: string): Promise<BuildTool | null> {
    if ((await this.firstPresent(root, GRADLE_BUILD_FILES)) !== null) {
      return 'gradle';
    }
    if ((await this.firstPresent(root, GRADLE_SETTINGS_FILES)) !== null) {
      return 'gradle';
    }
    if ((await this.exists(path.join(root, MAVEN_POM)))) {
      return 'maven';
    }
    return null;
  }

  /**
   * Lists one directory level as item nodes, recursing into subdirectories. A subdirectory holding its
   * own manifest is skipped below the module root (it belongs to another module).
   * @param directory The directory to list.
   * @param budget The remaining file budget, decremented as files are added.
   * @param isRoot Whether this is the module's own directory (nested manifests only prune below it).
   * @returns Returns the nodes, or null when the directory cannot be read.
   */
  private async listDirectory(
    directory: string,
    budget: { remaining: number },
    isRoot: boolean,
  ): Promise<readonly ProjectItemNode[] | null> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return null;
    }
    const directories: Dirent[] = entries
      .filter((entry: Dirent): boolean => entry.isDirectory() && !this.isSkipped(entry.name))
      .sort((a: Dirent, b: Dirent): number => a.name.localeCompare(b.name));
    const files: Dirent[] = entries
      .filter((entry: Dirent): boolean => entry.isFile())
      .sort((a: Dirent, b: Dirent): number => a.name.localeCompare(b.name));
    const nodes: ProjectItemNode[] = [];
    for (const child of directories) {
      const full: string = path.join(directory, child.name);
      // A nested manifest marks another module; leave its contents to its own node.
      if (!isRoot && (await this.holdsManifest(full))) {
        continue;
      }
      const children: readonly ProjectItemNode[] | null = await this.listDirectory(
        full,
        budget,
        false,
      );
      if (children !== null && children.length > 0) {
        nodes.push({ type: 'folder', name: child.name, children });
      }
    }
    for (const file of files) {
      if (budget.remaining <= 0) {
        break;
      }
      budget.remaining -= 1;
      nodes.push({ type: 'file', name: file.name, path: path.join(directory, file.name) });
    }
    return nodes;
  }

  /**
   * Determines whether a directory holds a Gradle or Maven manifest (marking a separate module).
   * @param directory The directory to test.
   * @returns Returns true when a manifest is present.
   */
  private async holdsManifest(directory: string): Promise<boolean> {
    return (await this.firstPresent(directory, [...GRADLE_BUILD_FILES, MAVEN_POM])) !== null;
  }

  /**
   * Finds the first of a set of candidate files present in a directory.
   * @param directory The directory to search.
   * @param names The candidate file names, in preference order.
   * @returns Returns the absolute path of the first present file, or null when none is present.
   */
  private async firstPresent(directory: string, names: readonly string[]): Promise<string | null> {
    for (const name of names) {
      const full: string = path.join(directory, name);
      if (await this.exists(full)) {
        return full;
      }
    }
    return null;
  }

  /**
   * Determines whether a file exists.
   * @param filePath The absolute file path.
   * @returns Returns true when the file exists and is a regular file.
   */
  private async exists(filePath: string): Promise<boolean> {
    try {
      const stat: Stats = await fs.stat(filePath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  /**
   * Reads a file's UTF-8 content.
   * @param filePath The absolute file path.
   * @returns Returns the content, or null when the file cannot be read.
   */
  private async readFile(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Determines whether a directory is skipped when listing a module's files.
   * @param name The directory name.
   * @returns Returns true when the directory should be skipped.
   */
  private isSkipped(name: string): boolean {
    return name.startsWith('.') || SKIPPED_DIRECTORIES.has(name);
  }

  /**
   * Flattens a tree into its projects, in tree order.
   * @param tree The tree to flatten.
   * @returns Returns the projects.
   */
  private flatten(tree: readonly ProjectNode[]): readonly ProjectEntry[] {
    const projects: ProjectEntry[] = [];
    for (const node of tree) {
      if (node.type === 'project') {
        projects.push({ name: node.name, path: node.path });
      } else {
        projects.push(...this.flatten(node.children));
      }
    }
    return projects;
  }
}
