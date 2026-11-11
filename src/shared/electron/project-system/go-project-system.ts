import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import {
  ProjectCapabilities,
  ProjectEntry,
  ProjectItemNode,
  ProjectItems,
  ProjectModel,
  ProjectNode,
} from '@shared/api/project-system';
import type { DebugResolveResult } from '@shared/api/debug-channels';
import type { RunConfiguration } from '@shared/api/studio';
import { goDebugTarget } from './go-debug-target';
import { buildGoPackageTree, GoPackage, goListArguments, parseGoPackages } from './go-list';
import { listProjectFiles, sourceFilter } from './project-listing';
import { ProjectSystem } from './project-system';
import { logger } from '../logger';

/**
 * The Go project system's root-independent capabilities: the Build/Clean/Rebuild actions the `go`
 * toolchain supports, no build-configuration axis (Go has no Debug/Release profile), a GOOS/GOARCH
 * target axis, and Delve as its debugger (#1211), installed from the Plugin Manager like CodeLLDB for
 * Rust.
 */
const GO_CAPABILITIES: ProjectCapabilities = {
  actions: ['build', 'clean', 'rebuild'],
  buildConfigurations: [],
  target: {
    kind: 'arch',
    label: 'Target',
    options: [
      { id: 'darwin/arm64', name: 'macOS (Apple Silicon)' },
      { id: 'darwin/amd64', name: 'macOS (Intel)' },
      { id: 'linux/amd64', name: 'Linux (x64)' },
      { id: 'linux/arm64', name: 'Linux (arm64)' },
      { id: 'windows/amd64', name: 'Windows (x64)' },
    ],
  },
  debug: { adapter: 'delve' },
  // This ecosystem has no solution folders, so there is nothing to rename.
  renamesSolutionFolders: false,
};

/**
 * The Go modules manifest that marks a Go project root.
 */
const MANIFEST: string = 'go.mod';

/**
 * The directories skipped when listing a module's files: the vendored dependency tree is never the
 * sources to open.
 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>(['vendor', 'node_modules']);

/**
 * Bounds how many files a module listing returns, so a mis-shaped module cannot balloon the Solution
 * Explorer.
 */
const MAX_ITEMS: number = 5_000;

/**
 * Keeps what a module is built from when the fallback lists it (#899): Go and assembly sources, and
 * the module and workspace files with their checksums.
 */
const GO_SOURCE_FILES: (name: string) => boolean = sourceFilter(
  ['.go', '.s'],
  ['go.mod', 'go.sum', 'go.work', 'go.work.sum'],
);

/**
 * The files of a module that belong to it without being in any package.
 */
const MODULE_FILES: readonly string[] = [MANIFEST, 'go.sum', 'go.work', 'go.work.sum'];

/**
 * Bounds how long `go list` may take, so a wedged toolchain cannot hold the Solution Explorer. It reads
 * no dependencies, so it answers in well under a second on any real module.
 */
const LIST_TIMEOUT_MS: number = 30_000;

/**
 * The maximum bytes of `go list` output buffered, generous so a large module is not truncated.
 */
const LIST_BUFFER: number = 64 * 1024 * 1024;

/**
 * Runs a child process and resolves with its standard output.
 */
const execFileAsync: (
  file: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    maxBuffer: number;
    timeout: number;
    killSignal: NodeJS.Signals;
    windowsHide: boolean;
  },
) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);

/**
 * The environment `go list` runs with. Reading a module must not reach out: `go.mod` can name a newer
 * toolchain, which would otherwise be downloaded and then run from inside a scan.
 * @returns Returns the environment.
 */
function goListEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, GOTOOLCHAIN: 'local', GOPROXY: 'off' };
}

/**
 * Reads the module path from the `module` directive of a `go.mod` (for example
 * `module github.com/acme/widget`).
 * @param goMod The `go.mod` content, or null when absent.
 * @returns Returns the module path, or null when the directive is absent.
 */
export function parseGoModulePath(goMod: string | null): string | null {
  if (goMod === null) {
    return null;
  }
  const match: RegExpExecArray | null = /^\s*module\s+(\S+)/m.exec(goMod);
  return match === null ? null : match[1];
}

/**
 * Models a Go module: the single root module, named from the last segment of its `go.mod` module path,
 * with what its build is made of read from `go list` on demand, or its files listed when that cannot be
 * read (skipping the vendored dependency tree). Deliberately language-server-agnostic, like the other providers; the workspace view prestarts gopls for `go`
 * models.
 */
export class GoProjectSystem implements ProjectSystem {
  /**
   * Gets the kind identifier of this project system.
   */
  public readonly kind: string = 'go';

  /**
   * Gets the root-independent capabilities this project system declares.
   */
  public readonly capabilities: ProjectCapabilities = GO_CAPABILITIES;

  /**
   * Determines whether the root holds a Go module (a `go.mod` at the root).
   * @param root The absolute workspace root.
   * @returns Returns true when a module manifest is present.
   */
  public async detect(root: string): Promise<boolean> {
    return this.exists(path.join(root, MANIFEST));
  }

  /**
   * Determines whether this provider owns a project file (a `go.mod`).
   * @param projectPath The absolute project-file path.
   * @returns Returns true when the file is a Go module manifest.
   */
  public ownsProject(projectPath: string): boolean {
    return path.basename(projectPath) === MANIFEST;
  }

  /**
   * Builds the Go project model: the single root module, named from its module path.
   * @param root The absolute workspace root.
   * @returns Returns the model, or null when the root has no `go.mod`.
   */
  public async load(root: string): Promise<ProjectModel | null> {
    logger.trace('GoProjectSystem', `Loading the Go model for '${root}'.`);
    const manifestPath: string = path.join(root, MANIFEST);
    const goMod: string | null = await this.readFile(manifestPath);
    if (goMod === null) {
      logger.debug('GoProjectSystem', `No readable 'go.mod' at '${root}'.`);
      return null;
    }
    const modulePath: string | null = parseGoModulePath(goMod);
    const name: string = modulePath === null ? path.basename(root) : path.basename(modulePath);
    logger.info('GoProjectSystem', `Loaded Go module '${name}' from '${manifestPath}'.`);
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
   * Loads what the module's build is made of (#899): its packages' files as `go list` reports them, and
   * the module's own `go.mod` and `go.sum`, so outputs and assets that share the tree stay out of the
   * Solution Explorer; the File Explorer shows everything. When the toolchain is missing or cannot
   * answer, the module's files are listed from the root directory instead, skipping the vendored
   * dependency tree.
   * @param projectPath The absolute path of the module manifest.
   * @returns Returns the contents, or null when the directory cannot be read.
   */
  public async loadProjectItems(projectPath: string): Promise<ProjectItems | null> {
    const directory: string = path.dirname(projectPath);
    const tree: readonly ProjectItemNode[] | null =
      (await this.packageTree(projectPath, directory)) ?? (await this.listing(directory));
    return tree === null ? null : { projectPath, tree };
  }

  /**
   * Resolves a run configuration into what Delve launches (#1211): see {@link goDebugTarget}. Delve
   * builds the program itself, so nothing is built here first.
   * @param configuration The run configuration being launched under the debugger.
   * @param root The absolute workspace root.
   * @returns Returns the launch target, or a reason it could not be resolved.
   */
  public resolveDebugTarget(
    configuration: RunConfiguration,
    root: string,
  ): Promise<DebugResolveResult> {
    return Promise.resolve(goDebugTarget(configuration, root));
  }

  /**
   * Builds the module's contents from its packages.
   * @param projectPath The absolute path of the module manifest.
   * @param directory The module's directory.
   * @returns Returns the contents, or null when the toolchain has no answer or the module no packages.
   */
  private async packageTree(
    projectPath: string,
    directory: string,
  ): Promise<readonly ProjectItemNode[] | null> {
    let moduleDirectory: string;
    try {
      // The toolchain answers with resolved paths, so the root is resolved first to compare like with
      // like: otherwise a workspace reached through a symbolic link would have every file climb out.
      moduleDirectory = await fs.realpath(directory);
    } catch {
      return null;
    }
    const packages: readonly GoPackage[] | null = await this.packages(moduleDirectory);
    if (packages === null || packages.every((entry: GoPackage) => entry.files.length === 0)) {
      return null;
    }
    const moduleFiles: string[] = [];
    for (const file of MODULE_FILES) {
      if (await this.exists(path.join(directory, file))) {
        moduleFiles.push(file);
      }
    }
    logger.debug(
      'GoProjectSystem',
      `Listed ${packages.length} Go package(s) for '${projectPath}' from \`go list\`.`,
    );
    return buildGoPackageTree(projectPath, moduleDirectory, packages, moduleFiles);
  }

  /**
   * Asks the toolchain for a module's packages, trying each `go` in turn. `go list` runs nothing from
   * the module: it parses the sources and stops.
   * @param moduleDirectory The module's directory.
   * @returns Returns the packages, or null when no toolchain could answer.
   */
  private async packages(moduleDirectory: string): Promise<readonly GoPackage[] | null> {
    for (const go of this.goExecutables()) {
      try {
        const { stdout }: { stdout: string } = await execFileAsync(
          go,
          goListArguments(moduleDirectory),
          {
            // Anywhere but the module: see goListArguments.
            cwd: tmpdir(),
            env: goListEnvironment(),
            maxBuffer: LIST_BUFFER,
            timeout: LIST_TIMEOUT_MS,
            killSignal: 'SIGKILL',
            windowsHide: true,
          },
        );
        return parseGoPackages(stdout);
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          continue;
        }
        logger.warn(
          'GoProjectSystem',
          `\`go list\` failed for '${moduleDirectory}'; listing the files instead.`,
          error,
        );
        return null;
      }
    }
    logger.debug('GoProjectSystem', 'No `go` to read the module with; listing the files instead.');
    return null;
  }

  /**
   * Gets the `go` executables to try: the one under `GOROOT`, then the one on the `PATH`.
   * @returns Returns the executables, in order.
   */
  private goExecutables(): readonly string[] {
    const root: string | undefined = process.env['GOROOT'];
    const exe: string = process.platform === 'win32' ? 'go.exe' : 'go';
    return root === undefined || root.length === 0 ? ['go'] : [path.join(root, 'bin', exe), 'go'];
  }

  /**
   * Lists the module's files straight from its directory when `go` cannot describe it (#899): Go
   * sources and the module's own manifests only, skipping the vendored dependency tree, so an output
   * folder the skip list does not name can never crowd the sources out of the budget.
   * @param directory The module's directory.
   * @returns Returns the contents, or null when the directory cannot be read.
   */
  private async listing(directory: string): Promise<readonly ProjectItemNode[] | null> {
    return listProjectFiles(
      directory,
      { remaining: MAX_ITEMS },
      {
        skipDirectory: (name: string): boolean => this.isSkipped(name),
        keepFile: GO_SOURCE_FILES,
      },
    );
  }

  /**
   * Determines whether a file exists.
   * @param filePath The absolute file path.
   * @returns Returns true when the file exists and is a regular file.
   */
  private async exists(filePath: string): Promise<boolean> {
    try {
      return (await fs.stat(filePath)).isFile();
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
   * Determines whether a directory is skipped when listing the module's files.
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
