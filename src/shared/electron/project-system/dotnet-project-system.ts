import { execFile } from 'node:child_process';
import { Dirent } from 'node:fs';
import * as fs from 'node:fs/promises';
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
import { DebugResolveResult } from '@shared/api/debug-channels';
import { RunConfiguration } from '@shared/api/studio';
import { ProjectSystem } from './project-system';

/**
 * The .NET project system's root-independent capabilities: Build/Clean/Rebuild, the conventional
 * Debug/Release build configurations, the CPU platform axis, and debugging through netcoredbg (which the
 * debug adapter registry provisions on first use).
 */
const DOTNET_CAPABILITIES: ProjectCapabilities = {
  actions: ['build', 'clean', 'rebuild'],
  buildConfigurations: [
    { id: 'debug', name: 'Debug' },
    { id: 'release', name: 'Release' },
  ],
  target: {
    kind: 'platform',
    label: 'Platform',
    options: [
      { id: 'any-cpu', name: 'Any CPU' },
      { id: 'x64', name: 'x64' },
      { id: 'arm64', name: 'ARM64' },
    ],
  },
  debug: { adapter: 'netcoredbg' },
};

/**
 * Runs a child process and resolves with its standard output and error.
 */
const execFileAsync: (
  file: string,
  args: readonly string[],
  options: {
    maxBuffer: number;
    timeout?: number;
    killSignal?: NodeJS.Signals;
    env?: NodeJS.ProcessEnv;
  },
) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);

/**
 * The maximum bytes of `dotnet` output buffered, generous so a large project's item listing is not
 * truncated.
 */
const ITEM_QUERY_BUFFER: number = 64 * 1024 * 1024;

/**
 * How long, in milliseconds, an evaluation-only `dotnet` query (properties, items, target path) may
 * run before it is killed. Evaluation takes seconds even on heavyweight projects; a query still
 * running after this long is wedged, and without a bound it would hold CPU with no cancel path.
 */
const EVALUATION_TIMEOUT_MS: number = 60_000;

/**
 * How long, in milliseconds, a real compilation (resolving a debug target) may run before it is
 * killed. Generous, since a cold build of a large project legitimately takes minutes.
 */
const BUILD_TIMEOUT_MS: number = 600_000;

/**
 * How long, in milliseconds, a `dotnet --version` probe may run before the candidate is rejected.
 */
const PROBE_TIMEOUT_MS: number = 10_000;

/**
 * The environment `dotnet` children run with: MSBuild worker-node reuse and the persistent MSBuild
 * server are disabled, so an invocation leaves no background processes behind — reused worker nodes
 * live ~15 minutes by design and survive the application, which is how a force-killed session kept
 * stalling the machine afterwards.
 */
function dotnetEnv(): NodeJS.ProcessEnv {
  return { ...process.env, MSBUILDDISABLENODEREUSE: '1', DOTNET_CLI_USE_MSBUILD_SERVER: '0' };
}

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
   * Gets the root-independent capabilities this project system declares.
   */
  public readonly capabilities: ProjectCapabilities = DOTNET_CAPABILITIES;

  /**
   * Caches the detected `dotnet` executable lookup, so detection runs once per session.
   */
  private dotnetProbe: Promise<string | null> | null = null;

  /**
   * Holds the in-flight item evaluations, keyed by project path, so concurrent requests for the same
   * project (several views over one root, overlapping reloads) share one `dotnet` invocation instead
   * of stacking duplicates.
   */
  private readonly inFlightItems: Map<string, Promise<ProjectItems | null>> = new Map<
    string,
    Promise<ProjectItems | null>
  >();

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
      return {
        kind: this.kind,
        root,
        solution,
        projects,
        tree,
        capabilities: this.capabilities,
      };
    }
    const files: string[] = await this.findProjects(root, PROJECT_SCAN_DEPTH);
    if (files.length === 0) {
      return null;
    }
    const tree: readonly ProjectNode[] = files.map(
      (file: string): ProjectNode => this.toNode(file),
    );
    const projects: readonly ProjectEntry[] = this.flatten(tree);
    return {
      kind: this.kind,
      root,
      solution: null,
      projects,
      tree,
      capabilities: this.capabilities,
    };
  }

  /**
   * Loads a project's logical contents by evaluating its MSBuild file items (Compile, Content, None,
   * EmbeddedResource), honouring linked files. Concurrent requests for the same project share one
   * evaluation.
   * @param projectPath The absolute path of the project file.
   * @returns Returns the contents, or null when `dotnet` is unavailable or evaluation fails.
   */
  public loadProjectItems(projectPath: string): Promise<ProjectItems | null> {
    const existing: Promise<ProjectItems | null> | undefined = this.inFlightItems.get(projectPath);
    if (existing !== undefined) {
      return existing;
    }
    const load: Promise<ProjectItems | null> = this.evaluateProjectItems(projectPath).finally(
      (): void => {
        this.inFlightItems.delete(projectPath);
      },
    );
    this.inFlightItems.set(projectPath, load);
    return load;
  }

  /**
   * Evaluates a project's items and frameworks in a single `dotnet` invocation. A multi-targeted
   * project needs a second, framework-pinned evaluation — its items live in the per-framework inner
   * build — but the common single-target project resolves in one process.
   * @param projectPath The absolute path of the project file.
   * @returns Returns the contents, or null when `dotnet` is unavailable or evaluation fails.
   */
  private async evaluateProjectItems(projectPath: string): Promise<ProjectItems | null> {
    const dotnet: string | null = await this.resolveDotnet();
    if (dotnet === null) {
      return null;
    }
    const combined: {
      frameworks: { single: string; many: string };
      items: { identity: string; link: string }[];
    } | null = await this.queryProject(dotnet, projectPath);
    if (combined === null) {
      return null;
    }
    let items: { identity: string; link: string }[] | null = combined.items;
    if (combined.frameworks.single.length === 0 && combined.frameworks.many.length > 0) {
      const framework: string = combined.frameworks.many.split(';')[0].trim();
      items = await this.queryItems(dotnet, projectPath, framework);
      if (items === null) {
        return null;
      }
    }
    return { projectPath, tree: this.buildItemTree(projectPath, items) };
  }

  /**
   * Resolves a run configuration into a netcoredbg launch target: compiles the project in the selected
   * (defaulting to Debug) configuration so an up-to-date assembly with symbols exists, then locates the
   * produced assembly. The run descriptor's id is the project file path.
   * @param configuration The run configuration being launched under the debugger.
   * @param root The absolute workspace root, which the project must lie within.
   * @returns Returns the launch target, or a reason it could not be resolved.
   */
  public async resolveDebugTarget(
    configuration: RunConfiguration,
    root: string,
  ): Promise<DebugResolveResult> {
    const projectPath: string = path.resolve(configuration.id);
    // Confine the build to the open workspace: the project path arrives from the renderer, so a hostile
    // one must not be able to drive `dotnet build` against an arbitrary file.
    if (projectPath !== root && !projectPath.startsWith(path.resolve(root) + path.sep)) {
      return { target: null, error: 'The project is outside the workspace.' };
    }
    const dotnet: string | null = await this.resolveDotnet();
    if (dotnet === null) {
      return { target: null, error: 'The `dotnet` command could not be found on this machine.' };
    }
    const configurationName: string = this.buildConfigurationName(configuration.buildConfiguration);
    try {
      await execFileAsync(dotnet, ['build', projectPath, '-c', configurationName, '--nologo'], {
        maxBuffer: ITEM_QUERY_BUFFER,
        timeout: BUILD_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        env: dotnetEnv(),
      });
    } catch (error: unknown) {
      return { target: null, error: `Build failed.\n${buildErrorText(error)}` };
    }
    const targetPath: string | null = await this.queryTargetPath(
      dotnet,
      projectPath,
      configurationName,
    );
    if (targetPath === null) {
      return {
        target: null,
        error: 'The build succeeded but its output assembly could not be found.',
      };
    }
    return { target: { program: targetPath, cwd: path.dirname(projectPath) }, error: null };
  }

  /**
   * Maps a build-configuration id to its MSBuild configuration name, defaulting to `Debug` (so a debug
   * session always has symbols) when none is selected or the id is unknown.
   * @param id The selected build-configuration id, or undefined.
   * @returns Returns the MSBuild configuration name.
   */
  private buildConfigurationName(id: string | undefined): string {
    const match: { id: string; name: string } | undefined =
      DOTNET_CAPABILITIES.buildConfigurations.find(
        (candidate: { id: string; name: string }): boolean => candidate.id === id,
      );
    return match?.name ?? 'Debug';
  }

  /**
   * Reads a built project's output assembly path from MSBuild.
   * @param dotnet The `dotnet` executable.
   * @param projectPath The absolute path of the project file.
   * @param configurationName The MSBuild configuration to evaluate against.
   * @returns Returns the assembly path, or null when it is empty or the query fails.
   */
  private async queryTargetPath(
    dotnet: string,
    projectPath: string,
    configurationName: string,
  ): Promise<string | null> {
    try {
      const { stdout }: { stdout: string } = await execFileAsync(
        dotnet,
        ['build', projectPath, '-c', configurationName, '--no-restore', '--getProperty:TargetPath'],
        {
          maxBuffer: ITEM_QUERY_BUFFER,
          timeout: EVALUATION_TIMEOUT_MS,
          killSignal: 'SIGKILL',
          env: dotnetEnv(),
        },
      );
      const targetPath: string = stdout.trim();
      return targetPath.length > 0 ? targetPath : null;
    } catch {
      return null;
    }
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
        await execFileAsync(candidate, ['--version'], {
          maxBuffer: ITEM_QUERY_BUFFER,
          timeout: PROBE_TIMEOUT_MS,
          killSignal: 'SIGKILL',
        });
        return candidate;
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  }

  /**
   * Evaluates a project's frameworks and file items in one `dotnet` invocation. Evaluation-only
   * (`--no-restore`, so no implicit restore can write into `obj/` and re-trigger the tree watcher),
   * bounded by a timeout, and run with MSBuild's background-process reuse disabled.
   * @param dotnet The `dotnet` executable.
   * @param projectPath The absolute path of the project file.
   * @returns Returns the frameworks and items, or null when evaluation fails.
   */
  private async queryProject(
    dotnet: string,
    projectPath: string,
  ): Promise<{
    frameworks: { single: string; many: string };
    items: { identity: string; link: string }[];
  } | null> {
    const args: string[] = [
      'build',
      projectPath,
      '--no-restore',
      '--getProperty:TargetFramework',
      '--getProperty:TargetFrameworks',
    ];
    for (const type of ITEM_TYPES) {
      args.push(`--getItem:${type}`);
    }
    try {
      const { stdout }: { stdout: string } = await execFileAsync(dotnet, args, {
        maxBuffer: ITEM_QUERY_BUFFER,
        timeout: EVALUATION_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        env: dotnetEnv(),
      });
      const parsed: {
        Properties?: { TargetFramework?: string; TargetFrameworks?: string };
        Items?: Record<string, { Identity?: string; Link?: string }[]>;
      } = JSON.parse(stdout) as {
        Properties?: { TargetFramework?: string; TargetFrameworks?: string };
        Items?: Record<string, { Identity?: string; Link?: string }[]>;
      };
      return {
        frameworks: {
          single: parsed.Properties?.TargetFramework?.trim() ?? '',
          many: parsed.Properties?.TargetFrameworks?.trim() ?? '',
        },
        items: this.collectItems(parsed.Items),
      };
    } catch {
      return null;
    }
  }

  /**
   * Evaluates a project's file items against a specific framework — the second pass a multi-targeted
   * project needs, since its items live in the per-framework inner build.
   * @param dotnet The `dotnet` executable.
   * @param projectPath The absolute path of the project file.
   * @param framework The framework to evaluate against.
   * @returns Returns the items (identity and link), or null when evaluation fails.
   */
  private async queryItems(
    dotnet: string,
    projectPath: string,
    framework: string,
  ): Promise<{ identity: string; link: string }[] | null> {
    const args: string[] = ['build', projectPath, '--no-restore'];
    for (const type of ITEM_TYPES) {
      args.push(`--getItem:${type}`);
    }
    args.push(`-p:TargetFramework=${framework}`);
    try {
      const { stdout }: { stdout: string } = await execFileAsync(dotnet, args, {
        maxBuffer: ITEM_QUERY_BUFFER,
        timeout: EVALUATION_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        env: dotnetEnv(),
      });
      const parsed: { Items?: Record<string, { Identity?: string; Link?: string }[]> } = JSON.parse(
        stdout,
      ) as { Items?: Record<string, { Identity?: string; Link?: string }[]> };
      return this.collectItems(parsed.Items);
    } catch {
      return null;
    }
  }

  /**
   * Collects the recognised item types from a parsed evaluation into identity/link pairs.
   * @param parsed The parsed `Items` payload, or undefined.
   * @returns Returns the items in item-type order.
   */
  private collectItems(
    parsed: Record<string, { Identity?: string; Link?: string }[]> | undefined,
  ): { identity: string; link: string }[] {
    const items: { identity: string; link: string }[] = [];
    for (const type of ITEM_TYPES) {
      for (const item of parsed?.[type] ?? []) {
        if (item.Identity !== undefined && item.Identity.length > 0) {
          items.push({ identity: item.Identity, link: item.Link ?? '' });
        }
      }
    }
    return items;
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

/**
 * The most tail bytes of build output to surface in a build-failure message, so the reported reason
 * carries the MSBuild error lines (printed last) without an unbounded dump.
 */
const BUILD_ERROR_TAIL: number = 2000;

/**
 * Extracts a concise, bounded failure message from an `execFile` rejection, preferring the process
 * output (where MSBuild prints its errors) over the generic exit-code message.
 * @param error The rejection value.
 * @returns Returns the trimmed message tail.
 */
function buildErrorText(error: unknown): string {
  const parts: string[] = [];
  if (error !== null && typeof error === 'object') {
    const record: { stdout?: unknown; stderr?: unknown; message?: unknown } = error;
    if (typeof record.stdout === 'string' && record.stdout.trim().length > 0) {
      parts.push(record.stdout.trim());
    }
    if (typeof record.stderr === 'string' && record.stderr.trim().length > 0) {
      parts.push(record.stderr.trim());
    }
    if (parts.length === 0 && typeof record.message === 'string') {
      parts.push(record.message);
    }
  }
  const text: string = parts.join('\n').trim();
  return text.length > BUILD_ERROR_TAIL ? text.slice(-BUILD_ERROR_TAIL) : text;
}
