import { Dirent } from 'node:fs';
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
import { logger } from '../logger';

/**
 * The C/C++ project system's root-independent capabilities: the Build/Clean/Rebuild actions CMake and
 * Make both support, the conventional CMake build types as build configurations, an architecture target
 * axis, and no debug adapter yet — a C/C++ DAP adapter (lldb/gdb) is a later phase, so the ribbon's
 * Debug button stays inert until one is provisioned.
 */
const CPP_CAPABILITIES: ProjectCapabilities = {
  actions: ['build', 'clean', 'rebuild'],
  buildConfigurations: [
    { id: 'debug', name: 'Debug' },
    { id: 'release', name: 'Release' },
    { id: 'relwithdebinfo', name: 'RelWithDebInfo' },
    { id: 'minsizerel', name: 'MinSizeRel' },
  ],
  target: {
    kind: 'arch',
    label: 'Architecture',
    options: [
      { id: 'x64', name: 'x64' },
      { id: 'arm64', name: 'ARM64' },
    ],
  },
  debug: null,
  // This ecosystem has no solution folders, so there is nothing to rename.
  renamesSolutionFolders: false,
};

/**
 * The CMake project description file that marks a CMake project root.
 */
const CMAKE_MANIFEST: string = 'CMakeLists.txt';

/**
 * Matches a Make build file (GNU or POSIX), used to detect a Make project root.
 */
const MAKEFILE_PATTERN: RegExp = /^(GNUmakefile|[Mm]akefile)$/;

/**
 * The directory a CMake build is configured into, and the working tree the built executables are run
 * from. A single-config generator (Make, Ninja) places an executable at `<BUILD_DIR>/<target>`.
 */
const BUILD_DIR: string = 'build';

/**
 * The directories skipped when listing a project's files: build outputs, CMake's own metadata, and
 * dependency directories are never the sources to open.
 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  BUILD_DIR,
  'cmake-build-debug',
  'cmake-build-release',
  'CMakeFiles',
  'out',
  'bin',
  'obj',
  'node_modules',
]);

/**
 * Bounds how many files a project listing returns, so a mis-shaped project cannot balloon the Solution
 * Explorer.
 */
const MAX_ITEMS: number = 5_000;

/**
 * Reads a CMake project's name from the `project(<name> ...)` command of a `CMakeLists.txt`.
 * @param cmake The `CMakeLists.txt` content, or null when absent.
 * @returns Returns the project name, or null when the command is absent.
 */
export function parseCmakeProjectName(cmake: string | null): string | null {
  if (cmake === null) {
    return null;
  }
  const match: RegExpExecArray | null = /\bproject\s*\(\s*([A-Za-z0-9_.-]+)/i.exec(cmake);
  return match === null ? null : match[1];
}

/**
 * Models a C/C++ workspace built by CMake or Make: a single root project named from its
 * `CMakeLists.txt` (or the directory otherwise), with its source files listed on demand. Deliberately
 * language-server-agnostic, like the other providers; the workspace view prestarts clangd for `cpp`
 * models.
 */
export class CppProjectSystem implements ProjectSystem {
  /**
   * Gets the kind identifier of this project system.
   */
  public readonly kind: string = 'cpp';

  /**
   * Gets the root-independent capabilities this project system declares.
   */
  public readonly capabilities: ProjectCapabilities = CPP_CAPABILITIES;

  /**
   * Determines whether the root holds a CMake or Make project.
   * @param root The absolute workspace root.
   * @returns Returns true when a `CMakeLists.txt` or a makefile is present at the root.
   */
  public async detect(root: string): Promise<boolean> {
    const entries: Dirent[] | null = await this.readDir(root);
    if (entries === null) {
      return false;
    }
    return entries.some((entry: Dirent): boolean => entry.isFile() && this.isManifest(entry.name));
  }

  /**
   * Determines whether this provider owns a project file (a `CMakeLists.txt` or a makefile).
   * @param projectPath The absolute project-file path.
   * @returns Returns true when the file is a CMake or Make manifest.
   */
  public ownsProject(projectPath: string): boolean {
    return this.isManifest(path.basename(projectPath));
  }

  /**
   * Builds the C/C++ project model: the single root project, named from its `CMakeLists.txt` when
   * present.
   * @param root The absolute workspace root.
   * @returns Returns the model, or null when the root holds no CMake or Make manifest.
   */
  public async load(root: string): Promise<ProjectModel | null> {
    logger.trace('CppProjectSystem', `Loading the C/C++ model for '${root}'.`);
    const manifestPath: string | null = await this.manifest(root);
    if (manifestPath === null) {
      logger.debug('CppProjectSystem', `No CMake or Make manifest found at '${root}'.`);
      return null;
    }
    const cmake: string | null =
      path.basename(manifestPath) === CMAKE_MANIFEST ? await this.readFile(manifestPath) : null;
    const name: string = parseCmakeProjectName(cmake) ?? path.basename(root);
    logger.info('CppProjectSystem', `Loaded C/C++ project '${name}' from '${manifestPath}'.`);
    const tree: readonly ProjectNode[] = [{ type: 'project', name, path: manifestPath }];
    return {
      kind: this.kind,
      root,
      solution: null,
      projects: this.flatten(tree),
      tree,
      capabilities: this.capabilities,
    };
  }

  /**
   * Lists the project's files straight from the root directory, skipping build-output and metadata
   * folders.
   * @param projectPath The absolute path of the project manifest.
   * @returns Returns the contents, or null when the directory cannot be read.
   */
  public async loadProjectItems(projectPath: string): Promise<ProjectItems | null> {
    const directory: string = path.dirname(projectPath);
    const budget: { remaining: number } = { remaining: MAX_ITEMS };
    const tree: readonly ProjectItemNode[] | null = await this.listDirectory(directory, budget);
    return tree === null ? null : { projectPath, tree };
  }

  /**
   * Finds the manifest that identifies the project, preferring CMake over Make (a CMake project may
   * also carry a generated makefile).
   * @param root The absolute workspace root.
   * @returns Returns the absolute manifest path, or null when none is present.
   */
  private async manifest(root: string): Promise<string | null> {
    const entries: Dirent[] | null = await this.readDir(root);
    if (entries === null) {
      return null;
    }
    const names: ReadonlySet<string> = new Set<string>(
      entries
        .filter((entry: Dirent): boolean => entry.isFile())
        .map((entry: Dirent): string => entry.name),
    );
    if (names.has(CMAKE_MANIFEST)) {
      return path.join(root, CMAKE_MANIFEST);
    }
    const makefile: string | undefined = [...names].find((name: string): boolean =>
      MAKEFILE_PATTERN.test(name),
    );
    return makefile === undefined ? null : path.join(root, makefile);
  }

  /**
   * Lists one directory level as item nodes, recursing into subdirectories.
   * @param directory The directory to list.
   * @param budget The remaining file budget, decremented as files are added.
   * @returns Returns the nodes, or null when the directory cannot be read.
   */
  private async listDirectory(
    directory: string,
    budget: { remaining: number },
  ): Promise<readonly ProjectItemNode[] | null> {
    const entries: Dirent[] | null = await this.readDir(directory);
    if (entries === null) {
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
      const children: readonly ProjectItemNode[] | null = await this.listDirectory(full, budget);
      if (children !== null && children.length > 0) {
        nodes.push({ type: 'folder', name: child.name, path: full, children });
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
   * Reads a directory's entries, or null when it cannot be read.
   * @param directory The directory to read.
   * @returns Returns the entries, or null.
   */
  private async readDir(directory: string): Promise<Dirent[] | null> {
    try {
      return await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return null;
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
   * Determines whether a file name is a CMake or Make manifest.
   * @param name The file name.
   * @returns Returns true when the name is a recognised manifest.
   */
  private isManifest(name: string): boolean {
    return name === CMAKE_MANIFEST || MAKEFILE_PATTERN.test(name);
  }

  /**
   * Determines whether a directory is skipped when listing the project's files.
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
      }
    }
    return projects;
  }
}
