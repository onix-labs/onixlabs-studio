import { Dirent, Stats } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  ProjectAction,
  ProjectCapabilities,
  ProjectEntry,
  ProjectItemNode,
  ProjectItems,
  ProjectModel,
  ProjectNode,
} from '@shared/api/project-system';
import { DebugResolveResult } from '@shared/api/debug-channels';
import { RunConfiguration } from '@shared/api/studio';
import { buildItemTree, EvaluatedItem } from './item-tree';
import { publishedRoots, readTsconfigSources, TsconfigSources } from './node-sources';
import { listProjectFiles, sourceFilter } from './project-listing';
import { ProjectSystem } from './project-system';
import { parseWorkspacePatterns, splitWorkspacePattern } from './node-workspaces';
import { logger } from '../logger';

/**
 * The Node project system's root-independent capabilities: an interpreted ecosystem with no
 * build-configuration axis and no target axis, so the ribbon's Target group disappears. Actions are
 * not fixed here — npm has no intrinsic build step, so each root declares the actions its own
 * manifest scripts back (see {@link parseManifestActions}).
 */
const NODE_CAPABILITIES: ProjectCapabilities = {
  actions: [],
  buildConfigurations: [],
  target: null,
  debug: { adapter: 'js-debug' },
  // This ecosystem has no solution folders, so there is nothing to rename.
  renamesSolutionFolders: false,
};

/**
 * The npm scripts that back a project action, by the conventional name each action runs. Only these
 * exact names count: `npm run build` is what the ribbon's Build dispatches, so declaring the action
 * from a differently-named script would light a button that runs something else (or nothing).
 */
const SCRIPT_ACTIONS: ReadonlyMap<string, ProjectAction> = new Map<string, ProjectAction>([
  ['build', 'build'],
  ['clean', 'clean'],
  ['test', 'test'],
]);

/**
 * Maps a manifest's scripts to the project actions they back, in {@link SCRIPT_ACTIONS} order so the
 * declared list is stable regardless of the order the scripts were authored in. A manifest with no
 * conventional scripts backs no actions at all, and the ribbon's Solution group disappears rather
 * than offering buttons with nothing behind them.
 * @param manifest The parsed manifest, or null when there is none.
 * @returns Returns the backed actions.
 */
export function parseManifestActions(
  manifest: Record<string, unknown> | null,
): readonly ProjectAction[] {
  const scripts: unknown = manifest?.['scripts'];
  if (typeof scripts !== 'object' || scripts === null) {
    return [];
  }
  const names: ReadonlySet<string> = new Set<string>(Object.keys(scripts));
  return [...SCRIPT_ACTIONS]
    .filter(([script]: [string, ProjectAction]): boolean => names.has(script))
    .map(([, action]: [string, ProjectAction]): ProjectAction => action);
}

/**
 * The entry file launched under the debugger when the manifest names none: the conventional Node entry
 * point.
 */
const DEFAULT_ENTRY: string = 'index.js';

/**
 * The manifest file that marks a Node/npm package.
 */
const MANIFEST: string = 'package.json';

/**
 * The directories skipped when listing a package's files: dependencies, VCS internals, and common
 * build outputs are never the sources to open.
 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.turbo',
  '.angular',
]);

/**
 * Bounds how many files a package listing returns, so a mis-shaped package (one whose directory is
 * effectively the whole repository) cannot balloon the Solution Explorer.
 */
const MAX_ITEMS: number = 5_000;

/**
 * Keeps what a package is built from when the fallback lists it (#899): script, style and markup
 * sources, JSON (the manifest and configuration among it), and the lockfiles that are not JSON.
 */
const NODE_SOURCE_FILES: (name: string) => boolean = sourceFilter(
  [
    '.js',
    '.mjs',
    '.cjs',
    '.jsx',
    '.ts',
    '.mts',
    '.cts',
    '.tsx',
    '.vue',
    '.svelte',
    '.astro',
    '.css',
    '.scss',
    '.sass',
    '.less',
    '.html',
    '.json',
  ],
  ['yarn.lock', 'pnpm-lock.yaml', '.npmrc', '.nvmrc'],
);

/**
 * The folders that hold a package's tests, which `files` leaves out because it does not publish them
 * and a `tsconfig.json` often leaves to one of its own.
 */
const TEST_DIRECTORIES: readonly string[] = ['test', 'tests', '__tests__', 'e2e'];

/**
 * Matches the files listed from a package's own folder beside what it declares: sources, the
 * configuration most tools keep there, the page a bundler starts from, and the lock files.
 */
const ROOT_FILE_PATTERN: RegExp =
  /\.(?:[cm]?[jt]sx?|json|html)$|^(?:yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/;

/**
 * Models a Node/npm workspace: the root package, plus — when the root manifest declares npm/yarn
 * workspaces — each workspace package expanded from the declared patterns (`packages/*` and literal
 * directory forms). A package's contents are what its `tsconfig.json` and `files` field declare, or
 * its files listed straight from its directory, skipping dependency and build-output folders, when
 * they declare nothing narrower. Deliberately language-server-agnostic, like the .NET provider; the
 * workspace view decides to prestart the TypeScript server for `node` models.
 */
export class NodeProjectSystem implements ProjectSystem {
  /**
   * Gets the kind identifier of this project system.
   */
  public readonly kind: string = 'node';

  /**
   * Gets the capability baseline this project system declares. A loaded root narrows the actions to
   * those its manifest scripts back.
   */
  public readonly capabilities: ProjectCapabilities = NODE_CAPABILITIES;

  /**
   * Determines whether the root holds a Node package (a package.json at the root).
   * @param root The absolute workspace root.
   * @returns Returns true when a root manifest is present.
   */
  public async detect(root: string): Promise<boolean> {
    return (await this.readManifest(path.join(root, MANIFEST))) !== null;
  }

  /**
   * Determines whether this provider owns a project file (a package.json).
   * @param projectPath The absolute project-file path.
   * @returns Returns true when the file is a package manifest.
   */
  public ownsProject(projectPath: string): boolean {
    return path.basename(projectPath) === MANIFEST;
  }

  /**
   * Builds the Node project model: the root package alone, or — for a workspaces monorepo — the root
   * manifest as the solution with each expanded workspace package as a project.
   * @param root The absolute workspace root.
   * @returns Returns the model, or null when the root has no manifest.
   */
  public async load(root: string): Promise<ProjectModel | null> {
    logger.trace('NodeProjectSystem', `Loading the Node model for '${root}'.`);
    const manifestPath: string = path.join(root, MANIFEST);
    const manifest: Record<string, unknown> | null = await this.readManifest(manifestPath);
    if (manifest === null) {
      logger.debug('NodeProjectSystem', `No readable 'package.json' at '${root}'.`);
      return null;
    }
    const rootName: string = this.packageName(manifest, root);
    const capabilities: ProjectCapabilities = this.capabilitiesFor(manifest);
    logger.debug(
      'NodeProjectSystem',
      `Root '${rootName}' declares actions [${capabilities.actions.join(', ')}].`,
    );
    const workspaceDirs: readonly string[] = await this.expandWorkspaces(root, manifest);
    if (workspaceDirs.length === 0) {
      logger.info('NodeProjectSystem', `Loaded Node package '${rootName}' (no workspaces).`);
      const tree: readonly ProjectNode[] = [
        { type: 'project', name: rootName, path: manifestPath },
      ];
      return {
        kind: this.kind,
        root,
        solution: null,
        projects: this.flatten(tree),
        tree,
        capabilities,
      };
    }
    const projects: ProjectNode[] = [];
    for (const directory of workspaceDirs) {
      const packagePath: string = path.join(directory, MANIFEST);
      const packageManifest: Record<string, unknown> | null = await this.readManifest(packagePath);
      if (packageManifest !== null) {
        projects.push({
          type: 'project',
          name: this.packageName(packageManifest, directory),
          path: packagePath,
        });
      }
    }
    projects.sort((a: ProjectNode, b: ProjectNode): number => a.name.localeCompare(b.name));
    logger.info(
      'NodeProjectSystem',
      `Loaded Node workspaces monorepo '${rootName}' with ${projects.length} package(s).`,
    );
    const tree: readonly ProjectNode[] = [
      { type: 'project', name: rootName, path: manifestPath },
      ...projects,
    ];
    return {
      kind: this.kind,
      root,
      solution: { name: rootName, path: manifestPath },
      projects: this.flatten(tree),
      tree,
      capabilities,
    };
  }

  /**
   * Derives the capabilities in force for a root: the ecosystem baseline, with the actions its root
   * manifest actually backs. A workspaces monorepo is driven by its root manifest's scripts, since
   * that is the manifest the ribbon's Build terminal runs `npm` against.
   * @param manifest The parsed root manifest.
   * @returns Returns the root's capabilities.
   */
  private capabilitiesFor(manifest: Record<string, unknown>): ProjectCapabilities {
    return { ...NODE_CAPABILITIES, actions: parseManifestActions(manifest) };
  }

  /**
   * Resolves a run configuration into a js-debug launch target: the JavaScript entry point to run under
   * the debugger. The configuration's explicit `program` wins; otherwise the root manifest's `main`
   * field is used, falling back to the conventional entry. The resolved program is confined to the open
   * workspace root, since it originates from renderer-supplied configuration. No build step is needed —
   * Node is interpreted — so this only locates the entry.
   * @param configuration The run configuration being launched under the debugger.
   * @param root The absolute workspace root, which the program must lie within.
   * @returns Returns the launch target, or a reason it could not be resolved.
   */
  public async resolveDebugTarget(
    configuration: RunConfiguration,
    root: string,
  ): Promise<DebugResolveResult> {
    const manifest: Record<string, unknown> | null = await this.readManifest(
      path.join(root, MANIFEST),
    );
    const main: string = typeof manifest?.['main'] === 'string' ? manifest['main'] : DEFAULT_ENTRY;
    // A configuration says how it RUNS — `node --inspect=9229 src/main.ts` — so its program may be the
    // runtime rather than the script (#882). Read it that way: the script is the first argument that
    // is not a flag, the flags before it go to the runtime, and the debugger's own inspector replaces
    // any the configuration asked for.
    const command: NodeCommand = splitNodeCommand(configuration.program, configuration.args ?? []);
    if (command.runtime !== undefined && command.script === undefined) {
      return {
        target: null,
        error: `"${configuration.name}" runs ${command.runtime} without naming a script to debug.`,
      };
    }
    const program: string = path.resolve(root, command.script ?? main);
    // Confine the launch to the open workspace: the program originates from renderer-supplied
    // configuration, so a hostile one must not point the debugger outside the root.
    if (program !== root && !program.startsWith(path.resolve(root) + path.sep)) {
      logger.warn(
        'NodeProjectSystem',
        `Refused a debug program outside the workspace: '${program}' not under '${root}'.`,
      );
      return { target: null, error: 'The program is outside the workspace.' };
    }
    logger.debug('NodeProjectSystem', `Resolved debug program '${program}'.`);
    return {
      target: {
        program,
        cwd: configuration.cwd !== undefined ? path.resolve(root, configuration.cwd) : root,
        ...(command.runtime === undefined
          ? {}
          : {
              args: command.scriptArgs,
              launchExtras: {
                runtimeExecutable: command.runtime,
                runtimeArgs: command.runtimeArgs,
              },
            }),
      },
      error: null,
    };
  }

  /**
   * Loads what a package is made of (#899): what its `tsconfig.json` compiles and its `files` field
   * publishes, its tests, and the files in its own folder, so outputs and assets that share the tree
   * stay out of the Solution Explorer; the File Explorer shows everything. Both are only read, so
   * nothing a package's scripts would do happens here. A package that declares nothing narrower than
   * its whole folder has its files listed from its directory instead, skipping dependency and
   * build-output folders and other packages' directories (a nested package.json marks a separate
   * package).
   * @param projectPath The absolute path of the package manifest.
   * @returns Returns the contents, or null when the directory cannot be read.
   */
  public async loadProjectItems(projectPath: string): Promise<ProjectItems | null> {
    const directory: string = path.dirname(projectPath);
    const tree: readonly ProjectItemNode[] | null =
      (await this.declaredTree(projectPath, directory)) ??
      (await listProjectFiles(
        directory,
        { remaining: MAX_ITEMS },
        {
          skipDirectory: (name: string): boolean => this.isSkipped(name),
          keepFile: NODE_SOURCE_FILES,
          // A nested package.json below the package's own folder marks another workspace package.
          isSeparate: (full: string, depth: number): Promise<boolean> =>
            depth > 0 ? this.holdsManifest(full) : Promise.resolve(false),
        },
      ));
    return tree === null ? null : { projectPath, tree };
  }

  /**
   * Builds a package's contents from what it declares. `files` says what is published, which is often
   * the output, so anything the configuration writes to, or that is named like an output, is dropped.
   * @param projectPath The absolute path of the package manifest.
   * @param directory The package's directory.
   * @returns Returns the contents, or null when nothing narrower than the package is declared.
   */
  private async declaredTree(
    projectPath: string,
    directory: string,
  ): Promise<readonly ProjectItemNode[] | null> {
    const manifest: Record<string, unknown> | null = await this.readManifest(projectPath);
    const tsconfig: TsconfigSources | null = await readTsconfigSources(directory);
    if (tsconfig?.coversPackage === true) {
      return null;
    }
    const outputs: readonly string[] = tsconfig?.outputs ?? [];
    const budget: { remaining: number } = { remaining: MAX_ITEMS };
    const sources: string[] = [];
    for (const root of [...(tsconfig?.roots ?? []), ...publishedRoots(manifest?.['files'])]) {
      const output: boolean =
        SKIPPED_DIRECTORIES.has(root.split('/')[0]) ||
        outputs.some((entry: string): boolean => root === entry || root.startsWith(`${entry}/`));
      if (!output) {
        sources.push(...(await this.declaredFiles(directory, root, budget)));
      }
    }
    if (sources.length === 0) {
      return null;
    }
    const tests: string[] = [];
    for (const name of TEST_DIRECTORIES) {
      tests.push(...(await this.declaredFiles(directory, name, budget)));
    }
    logger.debug(
      'NodeProjectSystem',
      `Listed ${sources.length} declared file(s) for '${projectPath}' from its manifests.`,
    );
    const files: readonly string[] = [...(await this.rootFiles(directory)), ...sources, ...tests];
    return buildItemTree(
      projectPath,
      files.map((file: string): EvaluatedItem => ({
        identity: path.relative(directory, file),
        link: '',
      })),
    );
  }

  /**
   * Lists what a declared path holds. The path comes from a file in the workspace, so one that leaves
   * the package, or is the package itself, holds nothing, and a link is not followed. A folder that is
   * a package of its own is left to its own node.
   * @param directory The package's directory.
   * @param declared The declared path, relative to the package.
   * @param budget The remaining file budget.
   * @returns Returns the absolute paths of its files.
   */
  private async declaredFiles(
    directory: string,
    declared: string,
    budget: { remaining: number },
  ): Promise<readonly string[]> {
    const full: string = path.resolve(directory, declared);
    const relative: string = path.relative(directory, full);
    if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
      return [];
    }
    let kind: Stats;
    try {
      kind = await fs.lstat(full);
    } catch {
      return [];
    }
    if (kind.isFile()) {
      return [full];
    }
    if (!kind.isDirectory() || (await this.readManifest(path.join(full, MANIFEST))) !== null) {
      return [];
    }
    return this.filesOf(
      (await listProjectFiles(full, budget, {
        // Inside a declared source folder a name like `build` is a folder of sources, not an output.
        skipDirectory: (name: string): boolean => name.startsWith('.') || name === 'node_modules',
        isSeparate: (directory: string): Promise<boolean> => this.holdsManifest(directory),
      })) ?? [],
    );
  }

  /**
   * Finds the files listed from a package's own folder.
   * @param directory The package's directory.
   * @returns Returns the absolute paths.
   */
  private async rootFiles(directory: string): Promise<readonly string[]> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((entry: Dirent): boolean => entry.isFile() && ROOT_FILE_PATTERN.test(entry.name))
      .map((entry: Dirent): string => path.join(directory, entry.name));
  }

  /**
   * Flattens a listing into its files.
   * @param nodes The listing.
   * @returns Returns the absolute paths.
   */
  private filesOf(nodes: readonly ProjectItemNode[]): readonly string[] {
    return nodes.flatMap((node: ProjectItemNode): readonly string[] =>
      node.type === 'file' ? [node.path] : this.filesOf(node.children),
    );
  }

  /**
   * Expands the root manifest's workspace patterns into package directories. Supports the literal
   * (`tools/site`) and single-level wildcard (`packages/*`) forms; other globs are skipped.
   * @param root The absolute workspace root.
   * @param manifest The parsed root manifest.
   * @returns Returns the absolute directories that hold a package manifest.
   */
  private async expandWorkspaces(
    root: string,
    manifest: Record<string, unknown>,
  ): Promise<readonly string[]> {
    const directories: Set<string> = new Set<string>();
    for (const pattern of parseWorkspacePatterns(manifest)) {
      const split: { prefix: string; wildcard: boolean } | null = splitWorkspacePattern(pattern);
      if (split === null) {
        continue;
      }
      const base: string = path.join(root, split.prefix);
      if (!split.wildcard) {
        directories.add(base);
        continue;
      }
      let entries: Dirent[];
      try {
        entries = await fs.readdir(base, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !this.isSkipped(entry.name)) {
          directories.add(path.join(base, entry.name));
        }
      }
    }
    return [...directories];
  }

  /**
   * Determines whether a directory holds its own package.json, which makes it another package.
   * @param directory The directory's absolute path.
   * @returns Returns true when it holds a readable manifest.
   */
  private async holdsManifest(directory: string): Promise<boolean> {
    return (await this.readManifest(path.join(directory, MANIFEST))) !== null;
  }

  /**
   * Reads and parses a JSON manifest.
   * @param manifestPath The absolute manifest path.
   * @returns Returns the parsed object, or null when missing or malformed.
   */
  private async readManifest(manifestPath: string): Promise<Record<string, unknown> | null> {
    try {
      const content: string = await fs.readFile(manifestPath, 'utf8');
      // JSON has no byte order mark, but editors on Windows write one and npm reads past it.
      const parsed: unknown = JSON.parse(content.replace(/^\uFEFF/, ''));
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Resolves a package's display name: its manifest `name`, or its directory's base name.
   * @param manifest The parsed manifest.
   * @param directory The package directory (used for the fallback).
   * @returns Returns the display name.
   */
  private packageName(manifest: Record<string, unknown>, directory: string): string {
    const name: unknown = manifest['name'];
    return typeof name === 'string' && name.trim().length > 0
      ? name.trim()
      : path.basename(directory);
  }

  /**
   * Determines whether a directory is skipped when listing or expanding packages.
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

/**
 * A Node command line read for debugging: the runtime, when the configuration names one, and the script
 * it runs, with the arguments split between them.
 */
export interface NodeCommand {
  /**
   * Gets the runtime the configuration runs (for example `node`), or undefined when its program is
   * the script itself.
   */
  readonly runtime?: string;

  /**
   * Gets the flags for the runtime, without any inspector flag — the debugger attaches its own.
   */
  readonly runtimeArgs: readonly string[];

  /**
   * Gets the script to debug, relative to the root, or undefined when the configuration names none.
   */
  readonly script?: string;

  /**
   * Gets the arguments for the script.
   */
  readonly scriptArgs: readonly string[];
}

/**
 * The runtimes a configuration's program may name rather than naming its script.
 */
const NODE_RUNTIMES: ReadonlySet<string> = new Set<string>(['node', 'nodejs']);

/**
 * The runtime flags that take their value as the next argument, so the value is not mistaken for the
 * script.
 */
const FLAGS_WITH_A_VALUE: ReadonlySet<string> = new Set<string>([
  '-r',
  '--require',
  '--import',
  '--loader',
  '--experimental-loader',
  '--env-file',
  '-C',
  '--conditions',
]);

/**
 * Matches an inspector flag, which a debug launch must not pass on: the debugger runs its own
 * inspector, and a second one on a fixed port would at best be ignored and at worst refuse to bind.
 */
const INSPECTOR_FLAG: RegExp = /^--inspect(-brk|-wait|-port)?(=.*)?$/;

/**
 * Reads a run configuration's program and arguments as a Node command line, for debugging it (#882).
 * A program that names a runtime — `node` — is the runtime, and the script is found among its
 * arguments; any other program is the script.
 * @param program The configuration's program, or undefined for none.
 * @param args The configuration's arguments.
 * @returns Returns the command, split.
 */
export function splitNodeCommand(
  program: string | undefined,
  args: readonly string[],
): NodeCommand {
  if (program === undefined || program.length === 0) {
    return { runtimeArgs: [], scriptArgs: [...args] };
  }
  // Either separator: a configuration written on Windows names `C:\nodejs\node.exe`.
  const name: string = (program.split(/[\\/]/).pop() ?? program)
    .toLowerCase()
    .replace(/\.exe$/, '');
  if (!NODE_RUNTIMES.has(name)) {
    return { runtimeArgs: [], script: program, scriptArgs: [...args] };
  }
  const runtimeArgs: string[] = [];
  for (let index: number = 0; index < args.length; index++) {
    const arg: string = args[index];
    if (!arg.startsWith('-')) {
      return {
        runtime: program,
        runtimeArgs,
        script: arg,
        scriptArgs: args.slice(index + 1),
      };
    }
    if (FLAGS_WITH_A_VALUE.has(arg) && index + 1 < args.length) {
      runtimeArgs.push(arg, args[index + 1]);
      index++;
      continue;
    }
    if (!INSPECTOR_FLAG.test(arg)) {
      runtimeArgs.push(arg);
    }
  }
  return { runtime: program, runtimeArgs, scriptArgs: [] };
}
