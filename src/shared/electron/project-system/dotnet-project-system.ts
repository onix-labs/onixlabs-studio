import { execFile } from 'node:child_process';
import { Dirent } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import {
  ProjectEntry,
  ProjectItemNode,
  ProjectItems,
  ProjectModel,
  ProjectNode,
} from '@shared/api/project-system';
import { ProjectSystem } from './project-system';

/**
 * Runs a child process and resolves with its standard output and error.
 */
const execFileAsync: (
  file: string,
  args: readonly string[],
  options: { maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);

/**
 * The maximum bytes of `dotnet` output buffered, generous so a large project's item listing is not
 * truncated.
 */
const ITEM_QUERY_BUFFER: number = 64 * 1024 * 1024;

/**
 * The MSBuild item types whose members are shown as a project's files.
 */
const ITEM_TYPES: readonly string[] = ['Compile', 'Content', 'None', 'EmbeddedResource'];

/**
 * The project-file extensions the .NET project system recognises.
 */
const PROJECT_EXTENSIONS: readonly string[] = ['.csproj', '.fsproj', '.vbproj'];

/**
 * The directories skipped when scanning for loose projects: hidden, dependency, and build-output
 * directories never hold the project files to open.
 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>(['node_modules', 'bin', 'obj']);

/**
 * How many directory levels deep to scan for loose projects when there is no solution (1 searches only
 * the root itself).
 */
const PROJECT_SCAN_DEPTH: number = 2;

/**
 * A mutable folder used while assembling a project's contents tree: named sub-folders and named files
 * (mapped to their absolute paths), materialised into the immutable tree once all items are placed.
 */
interface ItemFolder {
  /**
   * Holds the named sub-folders.
   */
  readonly folders: Map<string, ItemFolder>;

  /**
   * Holds the named files, mapped to their absolute paths.
   */
  readonly files: Map<string, string>;
}

/**
 * Models a .NET workspace: an `.slnx` or `.sln` solution when one is present (parsed into its solution
 * folders and projects), or the loose projects discovered under the root otherwise. A project's files
 * are loaded on demand by evaluating its MSBuild items.
 */
export class DotnetProjectSystem implements ProjectSystem {
  /**
   * Gets the kind identifier of this project system.
   */
  public readonly kind: string = 'dotnet';

  /**
   * Caches the detected `dotnet` executable lookup, so detection runs once per session.
   */
  private dotnetProbe: Promise<string | null> | null = null;

  /**
   * Determines whether this provider owns a project file (a .NET project by extension).
   * @param projectPath The absolute project-file path.
   * @returns Returns true when the file is a .NET project.
   */
  public ownsProject(projectPath: string): boolean {
    return PROJECT_EXTENSIONS.includes(path.extname(projectPath).toLowerCase());
  }

  /**
   * Determines whether the root holds a .NET solution or any .NET projects.
   * @param root The absolute workspace root.
   * @returns Returns true when a solution file or at least one project is found.
   */
  public async detect(root: string): Promise<boolean> {
    if ((await this.solutionFile(root)) !== null) {
      return true;
    }
    return (await this.findProjects(root, PROJECT_SCAN_DEPTH)).length > 0;
  }

  /**
   * Builds the .NET project model: from the solution file when present, otherwise from loose projects.
   * @param root The absolute workspace root.
   * @returns Returns the model, or null when no solution or projects are found.
   */
  public async load(root: string): Promise<ProjectModel | null> {
    const solution: { name: string; path: string } | null = await this.solutionFile(root);
    if (solution !== null) {
      const tree: readonly ProjectNode[] = await this.parseSolution(solution.path);
      const projects: readonly ProjectEntry[] = this.flatten(tree);
      return { kind: this.kind, root, solution, projects, tree };
    }
    const files: string[] = await this.findProjects(root, PROJECT_SCAN_DEPTH);
    if (files.length === 0) {
      return null;
    }
    const tree: readonly ProjectNode[] = files.map(
      (file: string): ProjectNode => this.toNode(file),
    );
    return { kind: this.kind, root, solution: null, projects: this.flatten(tree), tree };
  }

  /**
   * Loads a project's logical contents by evaluating its MSBuild file items (Compile, Content, None,
   * EmbeddedResource), honouring linked files. A multi-targeted project is evaluated against one of its
   * frameworks, since its items live in the per-framework inner build.
   * @param projectPath The absolute path of the project file.
   * @returns Returns the contents, or null when `dotnet` is unavailable or evaluation fails.
   */
  public async loadProjectItems(projectPath: string): Promise<ProjectItems | null> {
    const dotnet: string | null = await this.resolveDotnet();
    if (dotnet === null) {
      return null;
    }
    const tfm: string | null = await this.effectiveFramework(dotnet, projectPath);
    const items: { identity: string; link: string }[] | null = await this.queryItems(
      dotnet,
      projectPath,
      tfm,
    );
    if (items === null) {
      return null;
    }
    return { projectPath, tree: this.buildItemTree(projectPath, items) };
  }

  /**
   * Detects a usable `dotnet` executable, caching the result. A GUI-launched app does not inherit the
   * shell `PATH`, so the platform's default install location is tried in addition to the PATH.
   * @returns Returns the `dotnet` executable, or null when none is found.
   */
  private resolveDotnet(): Promise<string | null> {
    this.dotnetProbe ??= this.probeDotnet();
    return this.dotnetProbe;
  }

  /**
   * Probes for a usable `dotnet` executable without consulting the cache.
   * @returns Returns the `dotnet` executable, or null when none runs.
   */
  private async probeDotnet(): Promise<string | null> {
    const exe: string = process.platform === 'win32' ? 'dotnet.exe' : 'dotnet';
    const root: string | undefined = process.env['DOTNET_ROOT'];
    const candidates: string[] = [];
    if (root !== undefined && root.length > 0) {
      candidates.push(path.join(root, exe));
    }
    candidates.push('dotnet');
    candidates.push(
      process.platform === 'win32'
        ? path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'dotnet', exe)
        : '/usr/local/share/dotnet/dotnet',
    );
    for (const candidate of candidates) {
      try {
        await execFileAsync(candidate, ['--version'], { maxBuffer: ITEM_QUERY_BUFFER });
        return candidate;
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  }

  /**
   * Resolves the framework to evaluate a project against: its single `TargetFramework`, or the first of
   * its `TargetFrameworks` when multi-targeted, or null when neither is set.
   * @param dotnet The `dotnet` executable.
   * @param projectPath The absolute path of the project file.
   * @returns Returns the framework moniker, or null.
   */
  private async effectiveFramework(dotnet: string, projectPath: string): Promise<string | null> {
    try {
      const { stdout }: { stdout: string } = await execFileAsync(
        dotnet,
        ['build', projectPath, '--getProperty:TargetFramework', '--getProperty:TargetFrameworks'],
        { maxBuffer: ITEM_QUERY_BUFFER },
      );
      const parsed: { Properties?: { TargetFramework?: string; TargetFrameworks?: string } } =
        JSON.parse(stdout) as {
          Properties?: { TargetFramework?: string; TargetFrameworks?: string };
        };
      const single: string = parsed.Properties?.TargetFramework?.trim() ?? '';
      if (single.length > 0) {
        return single;
      }
      const many: string = parsed.Properties?.TargetFrameworks?.trim() ?? '';
      return many.length > 0 ? many.split(';')[0].trim() : null;
    } catch {
      return null;
    }
  }

  /**
   * Evaluates a project's file items, optionally against a specific framework.
   * @param dotnet The `dotnet` executable.
   * @param projectPath The absolute path of the project file.
   * @param framework The framework to evaluate against, or null for the default evaluation.
   * @returns Returns the items (identity and link), or null when evaluation fails.
   */
  private async queryItems(
    dotnet: string,
    projectPath: string,
    framework: string | null,
  ): Promise<{ identity: string; link: string }[] | null> {
    const args: string[] = ['build', projectPath];
    for (const type of ITEM_TYPES) {
      args.push(`--getItem:${type}`);
    }
    if (framework !== null) {
      args.push(`-p:TargetFramework=${framework}`);
    }
    try {
      const { stdout }: { stdout: string } = await execFileAsync(dotnet, args, {
        maxBuffer: ITEM_QUERY_BUFFER,
      });
      const parsed: { Items?: Record<string, { Identity?: string; Link?: string }[]> } = JSON.parse(
        stdout,
      ) as { Items?: Record<string, { Identity?: string; Link?: string }[]> };
      const items: { identity: string; link: string }[] = [];
      for (const type of ITEM_TYPES) {
        for (const item of parsed.Items?.[type] ?? []) {
          if (item.Identity !== undefined && item.Identity.length > 0) {
            items.push({ identity: item.Identity, link: item.Link ?? '' });
          }
        }
      }
      return items;
    } catch {
      return null;
    }
  }

  /**
   * Builds a project's logical contents tree from its items: each item is placed by its link (when set)
   * or its identity, so linked files appear at their logical location while still opening their real
   * file. Items that resolve outside the project directory are placed at the root by their file name.
   * @param projectPath The absolute path of the project file.
   * @param items The evaluated items.
   * @returns Returns the contents tree.
   */
  private buildItemTree(
    projectPath: string,
    items: readonly { identity: string; link: string }[],
  ): readonly ProjectItemNode[] {
    const directory: string = path.dirname(projectPath);
    const root: ItemFolder = {
      folders: new Map<string, ItemFolder>(),
      files: new Map<string, string>(),
    };
    const seen: Set<string> = new Set<string>();
    for (const item of items) {
      const logical: string = (item.link.length > 0 ? item.link : item.identity).replace(
        /\\/g,
        '/',
      );
      if (seen.has(logical)) {
        continue;
      }
      seen.add(logical);
      const segments: string[] = logical
        .split('/')
        .filter((segment: string): boolean => segment.length > 0);
      // A path that climbs out of the project (a linked file with no Link metadata) is shown at the root.
      const placement: string[] = logical.startsWith('../') ? segments.slice(-1) : segments;
      const absolute: string = path.resolve(directory, item.identity.replace(/\\/g, '/'));
      this.insertItem(root, placement, absolute);
    }
    return this.materialise(root);
  }

  /**
   * Inserts a file into the mutable folder structure under its path segments, creating folders as
   * needed.
   * @param folder The folder to insert into.
   * @param segments The file's path segments (the last is the file name).
   * @param absolute The file's absolute path.
   */
  private insertItem(folder: ItemFolder, segments: readonly string[], absolute: string): void {
    if (segments.length <= 1) {
      folder.files.set(segments[0] ?? path.basename(absolute), absolute);
      return;
    }
    const [head, ...rest]: readonly string[] = segments;
    let child: ItemFolder | undefined = folder.folders.get(head);
    if (child === undefined) {
      child = { folders: new Map<string, ItemFolder>(), files: new Map<string, string>() };
      folder.folders.set(head, child);
    }
    this.insertItem(child, rest, absolute);
  }

  /**
   * Converts the mutable folder structure into a sorted contents tree, folders before files and each
   * alphabetical.
   * @param folder The folder to convert.
   * @returns Returns the folder's children as tree nodes.
   */
  private materialise(folder: ItemFolder): readonly ProjectItemNode[] {
    const folders: ProjectItemNode[] = [...folder.folders.entries()]
      .sort((a: [string, ItemFolder], b: [string, ItemFolder]): number => a[0].localeCompare(b[0]))
      .map(
        ([name, child]: [string, ItemFolder]): ProjectItemNode => ({
          type: 'folder',
          name,
          children: this.materialise(child),
        }),
      );
    const files: ProjectItemNode[] = [...folder.files.entries()]
      .sort((a: [string, string], b: [string, string]): number => a[0].localeCompare(b[0]))
      .map(
        ([name, filePath]: [string, string]): ProjectItemNode => ({
          type: 'file',
          name,
          path: filePath,
        }),
      );
    return [...folders, ...files];
  }

  /**
   * Finds the solution file at the root, preferring the modern `.slnx` over a classic `.sln`.
   * @param root The absolute workspace root.
   * @returns Returns the solution name and path, or null when none is present at the root.
   */
  private async solutionFile(root: string): Promise<{ name: string; path: string } | null> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      return null;
    }
    const names: string[] = entries
      .filter((entry: Dirent): boolean => entry.isFile())
      .map((entry: Dirent): string => entry.name);
    const file: string | undefined =
      names.find((name: string): boolean => name.endsWith('.slnx')) ??
      names.find((name: string): boolean => name.endsWith('.sln'));
    if (file === undefined) {
      return null;
    }
    return { name: path.basename(file, path.extname(file)), path: path.join(root, file) };
  }

  /**
   * Parses a solution file into its logical tree, dispatching on its format.
   * @param solutionPath The absolute path of the solution file.
   * @returns Returns the tree of folders and projects.
   */
  private async parseSolution(solutionPath: string): Promise<readonly ProjectNode[]> {
    let content: string;
    try {
      content = await fs.readFile(solutionPath, 'utf8');
    } catch {
      return [];
    }
    const directory: string = path.dirname(solutionPath);
    return solutionPath.endsWith('.slnx')
      ? this.parseSlnx(content, directory)
      : this.parseSln(content, directory);
  }

  /**
   * Parses the XML `.slnx` solution format into a tree, preserving its solution folders. Folders are
   * declared as flat elements whose hierarchy is encoded in a slash-delimited `Name` path (for example
   * `/Core/Abstractions/`), so each name is split into segments and nested under shared parents, and a
   * folder's projects are attached to its deepest segment.
   * @param content The file content.
   * @param directory The solution's directory, project paths are resolved against.
   * @returns Returns the tree of folders and projects.
   */
  private parseSlnx(content: string, directory: string): readonly ProjectNode[] {
    const root: { children: ProjectNode[] } = { children: [] };
    const byPath: Map<string, { children: ProjectNode[] }> = new Map<
      string,
      { children: ProjectNode[] }
    >();
    // Walk the Folder/Project tags in order, tracking the open folder's path so a project is attached to
    // the folder it sits in. The format is simple, well-formed XML, so a tag scan suffices.
    const open: string[] = [];
    const tags: RegExpMatchArray[] = [
      ...content.matchAll(/<(\/?)(Folder|Project)\b([^>]*?)(\/?)>/g),
    ];
    for (const tag of tags) {
      const closing: boolean = tag[1] === '/';
      const element: string = tag[2];
      const attributes: string = tag[3];
      const selfClosing: boolean = tag[4] === '/';
      if (element === 'Project') {
        const relative: string | null = this.attribute(attributes, 'Path');
        if (relative !== null) {
          const parent: { children: ProjectNode[] } =
            open.length > 0 ? this.ensureFolder(root, byPath, open[open.length - 1]) : root;
          parent.children.push(this.toNode(this.resolve(directory, relative)));
        }
        continue;
      }
      if (closing) {
        open.pop();
        continue;
      }
      const name: string = this.attribute(attributes, 'Name') ?? '';
      this.ensureFolder(root, byPath, name);
      if (!selfClosing) {
        open.push(name);
      }
    }
    return root.children;
  }

  /**
   * Resolves the folder a slash-delimited `.slnx` folder path names, creating the nested folder chain on
   * the way down and reusing any segment already created by an earlier declaration, so folders shared
   * across declarations (an empty parent and its later-populated children) become one node.
   * @param root The synthetic tree root the top-level folders hang from.
   * @param byPath The folders created so far, keyed by their normalised cumulative path.
   * @param name The raw folder path (for example `/Core/Abstractions/`).
   * @returns Returns the deepest folder named by the path, or the root when the path is empty.
   */
  private ensureFolder(
    root: { children: ProjectNode[] },
    byPath: Map<string, { children: ProjectNode[] }>,
    name: string,
  ): { children: ProjectNode[] } {
    const segments: string[] = name
      .split('/')
      .filter((segment: string): boolean => segment.length > 0);
    let parent: { children: ProjectNode[] } = root;
    let cumulative: string = '';
    for (const segment of segments) {
      cumulative += `/${segment}`;
      let node: { children: ProjectNode[] } | undefined = byPath.get(cumulative);
      if (node === undefined) {
        const folder: ProjectNode & { type: 'folder'; children: ProjectNode[] } = {
          type: 'folder',
          name: segment,
          children: [],
        };
        parent.children.push(folder);
        node = folder;
        byPath.set(cumulative, node);
      }
      parent = node;
    }
    return parent;
  }

  /**
   * Parses the classic `.sln` solution format into a flat list of project nodes. Solution folders
   * (whose entry names a folder rather than a project file) are skipped; the classic format records
   * folder nesting separately, which is not reconstructed here.
   * @param content The file content.
   * @param directory The solution's directory, project paths are resolved against.
   * @returns Returns the project nodes.
   */
  private parseSln(content: string, directory: string): readonly ProjectNode[] {
    const pattern: RegExp = /^Project\("\{[^}]+\}"\)\s*=\s*"[^"]+",\s*"([^"]+)"/gm;
    const nodes: ProjectNode[] = [];
    for (const match of content.matchAll(pattern)) {
      const relative: string = match[1];
      if (PROJECT_EXTENSIONS.includes(path.extname(relative).toLowerCase())) {
        nodes.push(this.toNode(this.resolve(directory, relative)));
      }
    }
    return nodes;
  }

  /**
   * Reads a double-quoted XML attribute value from a tag's attribute text.
   * @param attributes The attribute text.
   * @param name The attribute name.
   * @returns Returns the value, or null when the attribute is absent.
   */
  private attribute(attributes: string, name: string): string | null {
    const match: RegExpExecArray | null = new RegExp(`${name}="([^"]*)"`).exec(attributes);
    return match === null ? null : match[1];
  }

  /**
   * Resolves a solution-relative project path (which may use either slash) to an absolute path.
   * @param directory The solution's directory.
   * @param relative The relative project path.
   * @returns Returns the absolute path.
   */
  private resolve(directory: string, relative: string): string {
    return path.resolve(directory, relative.replace(/\\/g, '/'));
  }

  /**
   * Builds a project node from an absolute project-file path.
   * @param file The absolute project-file path.
   * @returns Returns the project node.
   */
  private toNode(file: string): ProjectNode {
    return { type: 'project', name: path.basename(file, path.extname(file)), path: file };
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

  /**
   * Finds project files under a directory, descending at most `depth` levels and skipping hidden,
   * dependency, and build-output directories.
   * @param directory The directory to search.
   * @param depth The number of directory levels to descend (1 searches only the directory itself).
   * @returns Returns the matching absolute project-file paths.
   */
  private async findProjects(directory: string, depth: number): Promise<string[]> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }
    const results: string[] = [];
    for (const entry of entries) {
      const full: string = path.join(directory, entry.name);
      if (entry.isFile() && PROJECT_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
        results.push(full);
      } else if (entry.isDirectory() && depth > 1 && !this.isSkipped(entry.name)) {
        results.push(...(await this.findProjects(full, depth - 1)));
      }
    }
    return results;
  }

  /**
   * Determines whether a directory is skipped when scanning for loose projects.
   * @param name The directory name.
   * @returns Returns true when the directory should be skipped.
   */
  private isSkipped(name: string): boolean {
    return name.startsWith('.') || SKIPPED_DIRECTORIES.has(name);
  }
}
