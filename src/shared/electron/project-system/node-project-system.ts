import { Dirent } from 'node:fs';
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
 * Models a Node/npm workspace: the root package, plus — when the root manifest declares npm/yarn
 * workspaces — each workspace package expanded from the declared patterns (`packages/*` and literal
 * directory forms). A package's files are listed straight from its directory, skipping dependency
 * and build-output folders. Deliberately language-server-agnostic, like the .NET provider; the
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
    const program: string = path.resolve(
      root,
      configuration.program !== undefined && configuration.program.length > 0
        ? configuration.program
        : main,
    );
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
      },
      error: null,
    };
  }

  /**
   * Lists a package's files straight from its directory, skipping dependency and build-output
   * folders and other packages' directories (a nested package.json marks a separate package).
   * @param projectPath The absolute path of the package manifest.
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
   * Lists one directory level as item nodes, recursing into subdirectories. A subdirectory holding
   * its own package.json is skipped (it belongs to another workspace package) unless this is the
   * package's own root level's direct child scan starting point.
   * @param directory The directory to list.
   * @param budget The remaining file budget, decremented as files are added.
   * @param isRoot Whether this is the package's own directory (nested manifests only prune below it).
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
      // A nested manifest marks another workspace package; leave its contents to its own node.
      if (!isRoot && (await this.readManifest(path.join(full, MANIFEST))) !== null) {
        continue;
      }
      const children: readonly ProjectItemNode[] | null = await this.listDirectory(
        full,
        budget,
        false,
      );
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
   * Reads and parses a JSON manifest.
   * @param manifestPath The absolute manifest path.
   * @returns Returns the parsed object, or null when missing or malformed.
   */
  private async readManifest(manifestPath: string): Promise<Record<string, unknown> | null> {
    try {
      const content: string = await fs.readFile(manifestPath, 'utf8');
      const parsed: unknown = JSON.parse(content);
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
