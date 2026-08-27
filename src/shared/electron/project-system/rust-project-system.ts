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
 * The Rust project system's root-independent capabilities: the Build/Clean/Rebuild actions Cargo
 * supports, its dev/release profiles as build configurations, a target-triple axis, and no debug
 * adapter yet — a Rust DAP adapter (lldb via codelldb) is a later phase, so the ribbon's Debug button
 * stays inert until one is provisioned.
 */
const RUST_CAPABILITIES: ProjectCapabilities = {
  actions: ['build', 'clean', 'rebuild'],
  buildConfigurations: [
    { id: 'dev', name: 'Dev' },
    { id: 'release', name: 'Release' },
  ],
  target: {
    kind: 'target-triple',
    label: 'Target',
    options: [
      { id: 'aarch64-apple-darwin', name: 'macOS (Apple Silicon)' },
      { id: 'x86_64-apple-darwin', name: 'macOS (Intel)' },
      { id: 'x86_64-unknown-linux-gnu', name: 'Linux (x64)' },
      { id: 'x86_64-pc-windows-msvc', name: 'Windows (x64)' },
      { id: 'wasm32-unknown-unknown', name: 'WebAssembly' },
    ],
  },
  debug: null,
  // This ecosystem has no solution folders, so there is nothing to rename.
  renamesSolutionFolders: false,
};

/**
 * The Cargo manifest that marks a Rust project root.
 */
const MANIFEST: string = 'Cargo.toml';

/**
 * The directories skipped when listing a crate's files: the build output and dependency vendor
 * directories are never the sources to open.
 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>(['target', 'node_modules']);

/**
 * Bounds how many files a crate listing returns, so a mis-shaped crate cannot balloon the Solution
 * Explorer.
 */
const MAX_ITEMS: number = 5_000;

/**
 * Reads a crate's name from the `name` key of a Cargo manifest's `[package]` table.
 * @param toml The `Cargo.toml` content, or null when absent.
 * @returns Returns the crate name, or null when the package table declares none (for example a virtual
 * workspace root).
 */
export function parseCargoPackageName(toml: string | null): string | null {
  if (toml === null) {
    return null;
  }
  const lines: readonly string[] = toml.split('\n');
  const start: number = lines.findIndex((line: string): boolean => line.trim() === '[package]');
  if (start === -1) {
    return null;
  }
  for (let index: number = start + 1; index < lines.length; index++) {
    const line: string = lines[index].trim();
    if (line.startsWith('[')) {
      return null;
    }
    const match: RegExpExecArray | null = /^name\s*=\s*['"]([^'"]+)['"]/.exec(line);
    if (match !== null) {
      return match[1];
    }
  }
  return null;
}

/**
 * Extracts the workspace member patterns from a Cargo manifest's `[workspace].members` array (which may
 * span multiple lines). Each entry is a path relative to the root, possibly ending in a `*` wildcard
 * (`crates/*`).
 * @param toml The `Cargo.toml` content, or null when absent.
 * @returns Returns the member patterns, in declaration order.
 */
export function parseCargoWorkspaceMembers(toml: string | null): readonly string[] {
  if (toml === null) {
    return [];
  }
  const block: RegExpExecArray | null = /members\s*=\s*\[([\s\S]*?)\]/.exec(toml);
  if (block === null) {
    return [];
  }
  const members: string[] = [];
  for (const quoted of block[1].matchAll(/['"]([^'"]+)['"]/g)) {
    if (quoted[1].length > 0) {
      members.push(quoted[1]);
    }
  }
  return members;
}

/**
 * Models a Rust workspace built by Cargo: the root crate, plus — when the manifest declares a
 * `[workspace]` — each member crate expanded from its `members` patterns (literal paths and single-level
 * `crates/*` wildcards). A crate's files are listed straight from its directory, skipping the `target`
 * output. Deliberately language-server-agnostic, like the other providers; the workspace view prestarts
 * rust-analyzer for `rust` models.
 */
export class RustProjectSystem implements ProjectSystem {
  /**
   * Gets the kind identifier of this project system.
   */
  public readonly kind: string = 'rust';

  /**
   * Gets the root-independent capabilities this project system declares.
   */
  public readonly capabilities: ProjectCapabilities = RUST_CAPABILITIES;

  /**
   * Determines whether the root holds a Cargo project (a `Cargo.toml` at the root).
   * @param root The absolute workspace root.
   * @returns Returns true when a Cargo manifest is present.
   */
  public async detect(root: string): Promise<boolean> {
    return this.exists(path.join(root, MANIFEST));
  }

  /**
   * Determines whether this provider owns a project file (a `Cargo.toml`).
   * @param projectPath The absolute project-file path.
   * @returns Returns true when the file is a Cargo manifest.
   */
  public ownsProject(projectPath: string): boolean {
    return path.basename(projectPath) === MANIFEST;
  }

  /**
   * Builds the Rust project model: the root crate alone, or — for a workspace — the root manifest as
   * the solution with each expanded member crate as a project.
   * @param root The absolute workspace root.
   * @returns Returns the model, or null when the root has no Cargo manifest.
   */
  public async load(root: string): Promise<ProjectModel | null> {
    logger.trace('RustProjectSystem', `Loading the Rust model for '${root}'.`);
    const manifestPath: string = path.join(root, MANIFEST);
    const toml: string | null = await this.readFile(manifestPath);
    if (toml === null) {
      logger.debug('RustProjectSystem', `No readable 'Cargo.toml' at '${root}'.`);
      return null;
    }
    const rootName: string = parseCargoPackageName(toml) ?? path.basename(root);
    const memberDirs: readonly string[] = await this.expandMembers(
      root,
      parseCargoWorkspaceMembers(toml),
    );
    if (memberDirs.length === 0) {
      const tree: readonly ProjectNode[] = [
        { type: 'project', name: rootName, path: manifestPath },
      ];
      return this.model(root, tree, null);
    }
    const members: ProjectNode[] = [];
    for (const directory of memberDirs) {
      const memberManifest: string = path.join(directory, MANIFEST);
      const memberToml: string | null = await this.readFile(memberManifest);
      if (memberToml !== null) {
        members.push({
          type: 'project',
          name: parseCargoPackageName(memberToml) ?? path.basename(directory),
          path: memberManifest,
        });
      }
    }
    members.sort((a: ProjectNode, b: ProjectNode): number => a.name.localeCompare(b.name));
    // A virtual workspace root (no [package]) contributes no crate of its own; a root that is both a
    // package and a workspace contributes itself too.
    const rootIsCrate: boolean = parseCargoPackageName(toml) !== null;
    const tree: readonly ProjectNode[] = rootIsCrate
      ? [{ type: 'project', name: rootName, path: manifestPath }, ...members]
      : members;
    return this.model(root, tree, { name: rootName, path: manifestPath });
  }

  /**
   * Lists a crate's files straight from its directory, skipping the build-output folder.
   * @param projectPath The absolute path of the crate manifest.
   * @returns Returns the contents, or null when the directory cannot be read.
   */
  public async loadProjectItems(projectPath: string): Promise<ProjectItems | null> {
    const directory: string = path.dirname(projectPath);
    const budget: { remaining: number } = { remaining: MAX_ITEMS };
    const tree: readonly ProjectItemNode[] | null = await this.listDirectory(directory, budget);
    return tree === null ? null : { projectPath, tree };
  }

  /**
   * Assembles a project model from its crate tree and optional workspace solution.
   * @param root The absolute workspace root.
   * @param tree The crate tree.
   * @param solution The workspace solution, or null for a single-crate root.
   * @returns Returns the model.
   */
  private model(
    root: string,
    tree: readonly ProjectNode[],
    solution: { name: string; path: string } | null,
  ): ProjectModel {
    const projects: readonly ProjectEntry[] = this.flatten(tree);
    logger.info(
      'RustProjectSystem',
      `Loaded Rust ${solution === null ? 'crate' : 'workspace'} at '${root}' with ${projects.length} crate(s).`,
    );
    return {
      kind: this.kind,
      root,
      solution,
      projects,
      tree,
      capabilities: this.capabilities,
    };
  }

  /**
   * Expands Cargo workspace member patterns into crate directories, supporting literal paths and the
   * single-level `crates/*` wildcard.
   * @param root The absolute workspace root.
   * @param patterns The declared member patterns.
   * @returns Returns the absolute crate directories.
   */
  private async expandMembers(
    root: string,
    patterns: readonly string[],
  ): Promise<readonly string[]> {
    const directories: string[] = [];
    for (const pattern of patterns) {
      if (!pattern.endsWith('/*')) {
        directories.push(path.join(root, pattern));
        continue;
      }
      const base: string = path.join(root, pattern.slice(0, -2));
      try {
        const entries: Dirent[] = await fs.readdir(base, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            directories.push(path.join(base, entry.name));
          }
        }
      } catch {
        // A member glob with no matching directory contributes nothing.
      }
    }
    return directories;
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
   * Determines whether a directory is skipped when listing a crate's files.
   * @param name The directory name.
   * @returns Returns true when the directory should be skipped.
   */
  private isSkipped(name: string): boolean {
    return name.startsWith('.') || SKIPPED_DIRECTORIES.has(name);
  }

  /**
   * Flattens a tree into its crates, in tree order.
   * @param tree The tree to flatten.
   * @returns Returns the crates.
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
