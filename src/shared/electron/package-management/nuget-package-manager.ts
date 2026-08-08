import { Dirent } from 'node:fs';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  InstalledPackage,
  PackageEcosystem,
  PackageManagerModel,
  PackageProject,
} from '@shared/api/package-management';
import {
  NuGetReference,
  parseAssetsInstalled,
  parseLockInstalled,
  parsePackageReferences,
  parsePackageVersions,
  parsePackagesConfig,
} from './nuget-manifests';
import { fetchLatestVersion, FlatContainerCache } from './nuget-registry';
import { NuGetSource, readNuGetSources } from './nuget-sources';
import { HttpFetch, PackageManager } from './package-manager';
import { compareReleaseVersions, deriveStatus } from './versions';

/**
 * The project-file extensions the NuGet package manager reads.
 */
const PROJECT_EXTENSIONS: readonly string[] = ['.csproj', '.fsproj', '.vbproj'];

/**
 * The Central Package Management props file whose `PackageVersion` items supply versions for a
 * project's version-less `PackageReference`s.
 */
const CENTRAL_PROPS: string = 'Directory.Packages.props';

/**
 * The legacy per-project dependency manifest.
 */
const PACKAGES_CONFIG: string = 'packages.config';

/**
 * The NuGet lockfile, when a project restores with one.
 */
const LOCKFILE: string = 'packages.lock.json';

/**
 * The restore output whose `libraries` give resolved versions when there is no lockfile.
 */
const ASSETS: string = path.join('obj', 'project.assets.json');

/**
 * The directories skipped when scanning for projects: hidden, dependency, and build-output directories
 * never hold the project files to read.
 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>(['node_modules', 'bin', 'obj']);

/**
 * How deep to scan for project files when loading the model (1 searches only the root itself). Deep
 * enough for the conventional `src/Project/Project.csproj` layouts, bounded so a large tree cannot run
 * away.
 */
const LOAD_SCAN_DEPTH: number = 6;

/**
 * How shallow to scan when merely detecting whether the root is a .NET workspace.
 */
const DETECT_SCAN_DEPTH: number = 2;

/**
 * How many registry queries run at once while resolving latest versions.
 */
const REGISTRY_CONCURRENCY: number = 8;

/**
 * Models the NuGet ecosystem: reads each .NET project's declared `PackageReference`s (resolving
 * Central Package Management versions and legacy `packages.config`), resolves installed versions from
 * the restore output (`packages.lock.json` or `obj/project.assets.json`), and queries nuget.org for the
 * latest stable version of each distinct package. Read-only — it visualises dependency and upgrade
 * state; it does not install or modify anything.
 */
export class NuGetPackageManager implements PackageManager {
  /**
   * Gets the ecosystem this manager models.
   */
  public readonly ecosystem: PackageEcosystem = 'nuget';

  /**
   * Caches parsed Central Package Management versions by props-file path, so a repo-wide props file is
   * read once rather than per project.
   */
  private readonly centralCache: Map<string, ReadonlyMap<string, string>> = new Map<
    string,
    ReadonlyMap<string, string>
  >();

  /**
   * Determines whether the root holds a .NET solution or any .NET projects.
   * @param root The absolute workspace root.
   * @returns Returns true when a solution file or at least one project is found.
   */
  public async detect(root: string): Promise<boolean> {
    if (await this.hasSolutionFile(root)) {
      return true;
    }
    return (await this.findProjects(root, DETECT_SCAN_DEPTH)).length > 0;
  }

  /**
   * Builds the NuGet package model for a workspace root: one project per discovered .NET project file,
   * each with its declared packages resolved to their installed and latest versions.
   * @param root The absolute workspace root.
   * @param fetchFn The HTTP fetch used for registry queries.
   * @returns Returns the model, or null when no projects are found.
   */
  public async load(root: string, fetchFn: HttpFetch): Promise<PackageManagerModel | null> {
    this.centralCache.clear();
    const files: readonly string[] = await this.findProjects(root, LOAD_SCAN_DEPTH);
    if (files.length === 0) {
      return null;
    }

    const declared: Map<string, readonly NuGetReference[]> = new Map<
      string,
      readonly NuGetReference[]
    >();
    const names: Set<string> = new Set<string>();
    for (const file of files) {
      const references: readonly NuGetReference[] = await this.referencesFor(file, root);
      declared.set(file, references);
      for (const reference of references) {
        names.add(reference.id);
      }
    }

    // Read the configured sources (user + repo-root nuget.config) once, so private feeds and their
    // credentials route the latest-version lookups.
    const sources: readonly NuGetSource[] = await readNuGetSources(root, process.env);
    const latest: ReadonlyMap<string, string | null> = await this.resolveLatest(
      names,
      sources,
      fetchFn,
    );

    const projects: PackageProject[] = [];
    for (const file of files) {
      const installed: ReadonlyMap<string, string> = await this.installedVersions(
        path.dirname(file),
      );
      projects.push({
        name: path.basename(file, path.extname(file)),
        manifestPath: file,
        packages: this.buildPackages(declared.get(file) ?? [], installed, latest),
      });
    }
    return { ecosystem: 'nuget', root, projects };
  }

  /**
   * Reads a project's declared references: its `PackageReference`s (with Central Package Management
   * versions filled in) plus any legacy `packages.config` entries beside it.
   * @param projectPath The absolute project-file path.
   * @param root The workspace root, the props-file search stops at.
   * @returns Returns the declared references.
   */
  private async referencesFor(
    projectPath: string,
    root: string,
  ): Promise<readonly NuGetReference[]> {
    const directory: string = path.dirname(projectPath);
    const xml: string | null = await this.readText(projectPath);
    const references: NuGetReference[] = [];
    if (xml !== null) {
      const central: ReadonlyMap<string, string> = await this.centralVersions(directory, root);
      for (const reference of parsePackageReferences(xml)) {
        references.push(
          reference.version !== null
            ? reference
            : { ...reference, version: central.get(reference.id.toLowerCase()) ?? null },
        );
      }
    }
    const config: string | null = await this.readText(path.join(directory, PACKAGES_CONFIG));
    if (config !== null) {
      references.push(...parsePackagesConfig(config));
    }
    return references;
  }

  /**
   * Resolves the Central Package Management versions in force for a project directory: the nearest
   * `Directory.Packages.props` found walking up from the directory to (and including) the workspace
   * root. Cached by props-file path. Absent props yield an empty map.
   * @param directory The project directory to search up from.
   * @param root The workspace root, the search stops at.
   * @returns Returns the central versions, keyed by lower-cased id.
   */
  private async centralVersions(
    directory: string,
    root: string,
  ): Promise<ReadonlyMap<string, string>> {
    const resolvedRoot: string = path.resolve(root);
    let current: string = path.resolve(directory);
    for (;;) {
      const propsPath: string = path.join(current, CENTRAL_PROPS);
      const cached: ReadonlyMap<string, string> | undefined = this.centralCache.get(propsPath);
      if (cached !== undefined) {
        return cached;
      }
      const xml: string | null = await this.readText(propsPath);
      if (xml !== null) {
        const versions: ReadonlyMap<string, string> = parsePackageVersions(xml);
        this.centralCache.set(propsPath, versions);
        return versions;
      }
      if (current === resolvedRoot || !current.startsWith(resolvedRoot)) {
        break;
      }
      const parent: string = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
    return new Map<string, string>();
  }

  /**
   * Reads a project's resolved (installed) versions from its restore output: the `packages.lock.json`
   * beside it when present, otherwise `obj/project.assets.json`. Absent restore output yields an empty
   * map, so declared packages simply show no installed version.
   * @param directory The project directory.
   * @returns Returns the installed versions, keyed by lower-cased id.
   */
  private async installedVersions(directory: string): Promise<ReadonlyMap<string, string>> {
    const lock: unknown = await this.readJson(path.join(directory, LOCKFILE));
    if (lock !== null) {
      const parsed: ReadonlyMap<string, string> = parseLockInstalled(lock, compareReleaseVersions);
      if (parsed.size > 0) {
        return parsed;
      }
    }
    const assets: unknown = await this.readJson(path.join(directory, ASSETS));
    return assets !== null
      ? parseAssetsInstalled(assets, compareReleaseVersions)
      : new Map<string, string>();
  }

  /**
   * Resolves the latest registry version of each id, running a bounded number of queries at once,
   * trying each configured source (private feeds first) with a shared flat-container resolution cache.
   * @param names The distinct package ids.
   * @param sources The resolved package sources, in precedence order.
   * @param fetchFn The HTTP fetch used for registry queries.
   * @returns Returns the latest version by id, null where it could not be resolved.
   */
  private async resolveLatest(
    names: ReadonlySet<string>,
    sources: readonly NuGetSource[],
    fetchFn: HttpFetch,
  ): Promise<ReadonlyMap<string, string | null>> {
    const latest: Map<string, string | null> = new Map<string, string | null>();
    const cache: FlatContainerCache = new Map<string, string | null>();
    const queue: string[] = [...names];
    const worker: () => Promise<void> = async (): Promise<void> => {
      for (let id: string | undefined = queue.shift(); id !== undefined; id = queue.shift()) {
        latest.set(id, await fetchLatestVersion(id, sources, fetchFn, cache));
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(REGISTRY_CONCURRENCY, queue.length) }, (): Promise<void> =>
        worker(),
      ),
    );
    return latest;
  }

  /**
   * Builds the package rows for one project, resolving each reference to its installed and latest
   * versions and the derived upgrade status. When a project has not been restored (no installed
   * version), the declared version's floor is used as the comparison baseline so outdated detection
   * still works against the manifest.
   * @param references The project's declared references.
   * @param installed The installed versions by id.
   * @param latest The latest versions by id.
   * @returns Returns the project's packages.
   */
  private buildPackages(
    references: readonly NuGetReference[],
    installed: ReadonlyMap<string, string>,
    latest: ReadonlyMap<string, string | null>,
  ): readonly InstalledPackage[] {
    return references.map((reference: NuGetReference): InstalledPackage => {
      const installedVersion: string | null = installed.get(reference.id.toLowerCase()) ?? null;
      const latestVersion: string | null = latest.get(reference.id) ?? null;
      const baseline: string | null = installedVersion ?? this.floorVersion(reference.version);
      return {
        name: reference.id,
        requested: reference.version ?? '',
        installed: installedVersion,
        latest: latestVersion,
        status: deriveStatus(baseline, latestVersion),
        scope: reference.scope,
      };
    });
  }

  /**
   * Extracts the first concrete version from a NuGet version string (which may be an exact version like
   * `8.0.0` or a range like `[8.0.0,)`), for use as an upgrade-comparison baseline. Returns null when
   * no version can be found.
   * @param requested The declared version string, or null.
   * @returns Returns the floor version, or null.
   */
  private floorVersion(requested: string | null): string | null {
    if (requested === null) {
      return null;
    }
    const match: RegExpExecArray | null = /\d+(?:\.\d+)*/.exec(requested);
    return match === null ? null : match[0];
  }

  /**
   * Determines whether the root holds a solution file (`.sln` or `.slnx`).
   * @param root The absolute workspace root.
   * @returns Returns true when a solution file is present at the root.
   */
  private async hasSolutionFile(root: string): Promise<boolean> {
    try {
      const entries: Dirent[] = await fs.readdir(root, { withFileTypes: true });
      return entries.some(
        (entry: Dirent): boolean =>
          entry.isFile() && (entry.name.endsWith('.sln') || entry.name.endsWith('.slnx')),
      );
    } catch {
      return false;
    }
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
   * Determines whether a directory is skipped when scanning for projects.
   * @param name The directory name.
   * @returns Returns true when the directory should be skipped.
   */
  private isSkipped(name: string): boolean {
    return name.startsWith('.') || SKIPPED_DIRECTORIES.has(name);
  }

  /**
   * Reads a text file, or null when it is absent or unreadable.
   * @param filePath The absolute file path.
   * @returns Returns the file content, or null.
   */
  private async readText(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Reads and parses a JSON file, or null when it is absent or unparseable.
   * @param filePath The absolute file path.
   * @returns Returns the parsed content, or null.
   */
  private async readJson(filePath: string): Promise<unknown> {
    const text: string | null = await this.readText(filePath);
    if (text === null) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
}
