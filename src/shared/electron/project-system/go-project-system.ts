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
  RunConfigurationDescriptor,
} from '@shared/api/project-system';
import { ProjectSystem } from './project-system';

/**
 * The Go project system's root-independent capabilities: the Build/Clean/Rebuild actions the `go`
 * toolchain supports, no build-configuration axis (Go has no Debug/Release profile), a GOOS/GOARCH
 * target axis, and no debug adapter yet — a Go DAP adapter (Delve) is a later phase, so the ribbon's
 * Debug button stays inert until one is provisioned.
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
  debug: null,
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
 * with its source files listed on demand (skipping the vendored dependency tree). Deliberately
 * language-server-agnostic, like the other providers; the workspace view prestarts gopls for `go`
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
    const manifestPath: string = path.join(root, MANIFEST);
    const goMod: string | null = await this.readFile(manifestPath);
    if (goMod === null) {
      return null;
    }
    const modulePath: string | null = parseGoModulePath(goMod);
    const name: string = modulePath === null ? path.basename(root) : path.basename(modulePath);
    const tree: readonly ProjectNode[] = [{ type: 'project', name, path: manifestPath }];
    return {
      kind: this.kind,
      root,
      solution: null,
      projects: this.flatten(tree),
      tree,
      capabilities: this.capabilities,
      runConfigurations: [
        // `go run .` runs the main package at the module root; the id names the module.
        { id: name, name, kind: 'project', detail: 'go run .' } satisfies RunConfigurationDescriptor,
      ],
    };
  }

  /**
   * Lists the module's files straight from the root directory, skipping the vendored dependency tree.
   * @param projectPath The absolute path of the module manifest.
   * @returns Returns the contents, or null when the directory cannot be read.
   */
  public async loadProjectItems(projectPath: string): Promise<ProjectItems | null> {
    const directory: string = path.dirname(projectPath);
    const budget: { remaining: number } = { remaining: MAX_ITEMS };
    const tree: readonly ProjectItemNode[] | null = await this.listDirectory(directory, budget);
    return tree === null ? null : { projectPath, tree };
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
      const children: readonly ProjectItemNode[] | null = await this.listDirectory(
        path.join(directory, child.name),
        budget,
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
