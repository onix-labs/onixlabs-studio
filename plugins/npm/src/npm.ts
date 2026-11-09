import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { readPackageLock, readPnpmLock, readYarnLock } from './lockfiles';
import { note } from './log';
import { fetchLatestVersion } from './npm-registry';
import { searchRegistry } from './npm-search';
import {
  endpointFor,
  isPublicRegistry,
  NpmSource,
  readNpmConfig,
  sourcesFrom,
} from './npm-sources';
import { mayCarryCredentials, NpmEndpoint, NpmrcConfig } from './npmrc';
import {
  CredentialAsk,
  HttpFetch,
  InstalledPackage,
  PackageDependencyScope,
  PackageManagerModel,
  PackageProject,
  PackageSearchOptions,
  PackageSearchResult,
  PackageSourceInfo,
} from './protocol';
import { deriveStatus } from './versions';
import { parseWorkspacePatterns, splitWorkspacePattern } from './workspaces';

/**
 * The manifest file an npm package is described by.
 */
const MANIFEST: string = 'package.json';

/**
 * The lockfile npm resolves installed versions into.
 */
const LOCKFILE: string = 'package-lock.json';

/**
 * The lockfile pnpm resolves installed versions into.
 */
const PNPM_LOCKFILE: string = 'pnpm-lock.yaml';

/**
 * The lockfile Yarn resolves installed versions into.
 */
const YARN_LOCKFILE: string = 'yarn.lock';

/**
 * The manifest dependency maps read, paired with the scope each one contributes to the model.
 */
const DEPENDENCY_SECTIONS: readonly {
  readonly key: string;
  readonly scope: PackageDependencyScope;
}[] = [
  { key: 'dependencies', scope: 'production' },
  { key: 'devDependencies', scope: 'development' },
  { key: 'peerDependencies', scope: 'peer' },
  { key: 'optionalDependencies', scope: 'optional' },
];

/**
 * How many registry queries run at once while resolving latest versions. Bounded so a large monorepo
 * does not open hundreds of sockets at once, while still resolving quickly.
 */
const REGISTRY_CONCURRENCY: number = 8;

/**
 * Models the npm ecosystem: reads the root package.json (and each npm-workspace package's manifest)
 * for its declared dependencies, resolves installed versions from the lockfile, queries the registry for
 * the latest version of each distinct package, and searches the registries `.npmrc` names. Read-only:
 * a write is a command for Studio to run, built in `commands.ts`.
 */
export class NpmPackageManager {
  /**
   * Holds how to ask Studio for a token saved for a registry.
   */
  private readonly credential: CredentialAsk;

  /**
   * Holds the environment `.npmrc` references are resolved from, which Studio has cut down to an
   * allow-list before this process ever saw it.
   */
  private readonly env: Record<string, string | undefined>;

  /**
   * Initializes the manager.
   * @param credential Asks Studio for a token saved for a registry.
   * @param env The environment `.npmrc` references are resolved from.
   */
  public constructor(
    credential: CredentialAsk = (): Promise<string | null> => Promise.resolve(null),
    env: Record<string, string | undefined> = {},
  ) {
    this.credential = credential;
    this.env = env;
  }

  /**
   * Determines whether the root holds an npm package (a package.json at the root).
   * @param root The absolute workspace root.
   * @returns Returns true when a root package.json is present.
   */
  public async detect(root: string): Promise<boolean> {
    return (await this.readManifest(path.join(root, MANIFEST))) !== null;
  }

  /**
   * Builds the npm package model for a workspace root: the root package plus each workspace package,
   * every declared dependency resolved to its installed and latest versions.
   * @param root The absolute workspace root.
   * @param fetchFn The HTTP fetch used for registry queries.
   * @returns Returns the model, or null when the root has no readable package.json.
   */
  public async load(root: string, fetchFn: HttpFetch): Promise<PackageManagerModel | null> {
    const rootManifest: Record<string, unknown> | null = await this.readManifest(
      path.join(root, MANIFEST),
    );
    if (rootManifest === null) {
      return null;
    }

    const installed: ReadonlyMap<string, string> = await this.readInstalledVersions(root);
    const manifests: readonly ManifestEntry[] = [
      {
        name: this.manifestName(rootManifest, root),
        manifestPath: path.join(root, MANIFEST),
        manifest: rootManifest,
      },
      ...(await this.workspaceManifests(root, rootManifest)),
    ];

    // Resolve every distinct package name once, so a dependency shared across workspace packages costs
    // a single registry query rather than one per project. The `.npmrc` (project and user) is read once
    // so a scoped/private registry and its token route the lookups.
    const config: NpmrcConfig = await readNpmConfig(root, this.env);
    const names: ReadonlySet<string> = this.distinctNames(manifests);
    const latest: ReadonlyMap<string, string | null> = await this.resolveLatest(
      names,
      config,
      fetchFn,
    );

    const projects: PackageProject[] = manifests.map((entry: ManifestEntry): PackageProject => ({
      name: entry.name,
      manifestPath: entry.manifestPath,
      packages: this.readPackages(entry.manifest, installed, latest),
    }));
    note('npm', `Loaded ${projects.length} project(s), ${names.size} distinct package(s)`);
    return { ecosystem: 'npm', root, projects };
  }

  /**
   * Lists the registries a folder can search. Names only, whatever else a source carries.
   * @param root The absolute workspace root.
   * @returns Returns the sources.
   */
  public async listSources(root: string): Promise<readonly PackageSourceInfo[]> {
    const config: NpmrcConfig = await readNpmConfig(root, this.env);
    return sourcesFrom(config).map((source: NpmSource): PackageSourceInfo => ({
      name: source.name,
    }));
  }

  /**
   * Searches a named registry.
   * @param root The absolute workspace root.
   * @param sourceName The source to search.
   * @param query The search text.
   * @param options The paging options.
   * @param fetchFn The HTTP fetch used for registry queries.
   * @returns Returns a page of results, empty when the source is unknown.
   */
  public async search(
    root: string,
    sourceName: string,
    query: string,
    options: PackageSearchOptions,
    fetchFn: HttpFetch,
  ): Promise<PackageSearchResult> {
    const config: NpmrcConfig = await readNpmConfig(root, this.env);
    const source: NpmSource | undefined = sourcesFrom(config).find(
      (candidate: NpmSource): boolean => candidate.name === sourceName,
    );
    if (source === undefined) {
      note('npm', 'A search named a source this folder does not have');
      return { items: [], total: 0, hasMore: false };
    }
    const endpoint: NpmEndpoint = await this.authorised(source.endpoint);
    return searchRegistry({ ...source, endpoint }, query, options, fetchFn);
  }

  /**
   * Adds a token saved in Studio to a request the tool's own configuration has no credential for: the
   * tool's configuration comes first. The public registry is left alone, so an ordinary lookup never
   * asks Studio for anything, and so is a registry a credential may not travel to (plain http off
   * loopback).
   * @param endpoint The endpoint.
   * @returns Returns the endpoint, with a token when Studio holds one for it.
   */
  private async authorised(endpoint: NpmEndpoint): Promise<NpmEndpoint> {
    if (
      endpoint.headers['Authorization'] !== undefined ||
      isPublicRegistry(endpoint.registry) ||
      !mayCarryCredentials(endpoint.registry)
    ) {
      return endpoint;
    }
    const token: string | null = await this.credential(endpoint.registry);
    return token === null
      ? endpoint
      : { ...endpoint, headers: { ...endpoint.headers, Authorization: `Bearer ${token}` } };
  }

  /**
   * Reads and parses a package.json, or null when it is absent or unparseable.
   * @param manifestPath The absolute path of the package.json.
   * @returns Returns the parsed manifest, or null.
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
   * Resolves a manifest's display name: its `name` field, falling back to the containing directory.
   * @param manifest The parsed manifest.
   * @param directory The manifest's directory.
   * @returns Returns the display name.
   */
  private manifestName(manifest: Record<string, unknown>, directory: string): string {
    const name: unknown = manifest['name'];
    return typeof name === 'string' && name.length > 0 ? name : path.basename(directory);
  }

  /**
   * Expands the root manifest's npm-workspace patterns to the packages that carry their own manifest,
   * mirroring the Node project system's workspace expansion. Unsupported patterns (deep globs) are
   * skipped rather than mis-expanded.
   * @param root The absolute workspace root.
   * @param rootManifest The parsed root manifest.
   * @returns Returns the workspace package manifests.
   */
  private async workspaceManifests(
    root: string,
    rootManifest: Record<string, unknown>,
  ): Promise<readonly ManifestEntry[]> {
    const entries: ManifestEntry[] = [];
    for (const pattern of parseWorkspacePatterns(rootManifest)) {
      const split: { prefix: string; wildcard: boolean } | null = splitWorkspacePattern(pattern);
      if (split === null) {
        continue;
      }
      const baseDirectory: string = path.join(root, split.prefix);
      const directories: string[] = split.wildcard
        ? await this.subdirectories(baseDirectory)
        : [baseDirectory];
      for (const directory of directories) {
        const manifestPath: string = path.join(directory, MANIFEST);
        const manifest: Record<string, unknown> | null = await this.readManifest(manifestPath);
        if (manifest !== null) {
          entries.push({ name: this.manifestName(manifest, directory), manifestPath, manifest });
        }
      }
    }
    return entries;
  }

  /**
   * Lists the immediate subdirectories of a directory, or an empty list when it cannot be read.
   * @param directory The absolute directory path.
   * @returns Returns the absolute subdirectory paths.
   */
  private async subdirectories(directory: string): Promise<string[]> {
    try {
      const entries: import('node:fs').Dirent[] = await fs.readdir(directory, {
        withFileTypes: true,
      });
      return entries
        .filter((entry: import('node:fs').Dirent): boolean => entry.isDirectory())
        .map((entry: import('node:fs').Dirent): string => path.join(directory, entry.name));
    } catch {
      return [];
    }
  }

  /**
   * Reads the installed versions from the root's lockfile as a name-to-version map, npm's first, then
   * pnpm's, then Yarn's. An absent or unparseable lockfile yields an empty map, so declared packages
   * simply show no installed version.
   * @param root The absolute workspace root.
   * @returns Returns the installed versions by package name.
   */
  private async readInstalledVersions(root: string): Promise<ReadonlyMap<string, string>> {
    const lock: Record<string, unknown> | null = await this.readManifest(path.join(root, LOCKFILE));
    if (lock !== null) {
      return readPackageLock(lock);
    }
    const pnpm: string | null = await this.readText(path.join(root, PNPM_LOCKFILE));
    if (pnpm !== null) {
      return readPnpmLock(pnpm);
    }
    const yarn: string | null = await this.readText(path.join(root, YARN_LOCKFILE));
    return yarn === null ? new Map<string, string>() : readYarnLock(yarn);
  }

  /**
   * Reads a text file, or null when it is absent or unreadable.
   * @param filePath The absolute path.
   * @returns Returns the text, or null.
   */
  private async readText(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Collects every distinct dependency name declared across a set of manifests.
   * @param manifests The manifests to scan.
   * @returns Returns the distinct package names.
   */
  private distinctNames(manifests: readonly ManifestEntry[]): ReadonlySet<string> {
    const names: Set<string> = new Set<string>();
    for (const entry of manifests) {
      for (const section of DEPENDENCY_SECTIONS) {
        for (const name of Object.keys(this.dependencyMap(entry.manifest, section.key))) {
          names.add(name);
        }
      }
    }
    return names;
  }

  /**
   * Resolves the latest registry version of each name, running a bounded number of queries at once,
   * routing each lookup to the registry (and auth) its scope resolves to.
   * @param names The distinct package names.
   * @param config The merged `.npmrc` configuration driving registry and auth routing.
   * @param fetchFn The HTTP fetch used for registry queries.
   * @returns Returns the latest version by name, null where it could not be resolved.
   */
  private async resolveLatest(
    names: ReadonlySet<string>,
    config: NpmrcConfig,
    fetchFn: HttpFetch,
  ): Promise<ReadonlyMap<string, string | null>> {
    const latest: Map<string, string | null> = new Map<string, string | null>();
    const queue: string[] = [...names];
    const worker: () => Promise<void> = async (): Promise<void> => {
      for (let name: string | undefined = queue.shift(); name !== undefined; name = queue.shift()) {
        const endpoint: NpmEndpoint = await this.authorised(endpointFor(config, name));
        latest.set(name, await fetchLatestVersion(name, endpoint, fetchFn));
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
   * Builds the package rows for one manifest, across every dependency scope, resolving each to its
   * installed and latest versions and the derived upgrade status.
   * @param manifest The parsed manifest.
   * @param installed The installed versions by name.
   * @param latest The latest versions by name.
   * @returns Returns the manifest's packages.
   */
  private readPackages(
    manifest: Record<string, unknown>,
    installed: ReadonlyMap<string, string>,
    latest: ReadonlyMap<string, string | null>,
  ): readonly InstalledPackage[] {
    const packages: InstalledPackage[] = [];
    for (const section of DEPENDENCY_SECTIONS) {
      for (const [name, requested] of Object.entries(this.dependencyMap(manifest, section.key))) {
        const installedVersion: string | null = installed.get(name) ?? null;
        const latestVersion: string | null = latest.get(name) ?? null;
        packages.push({
          name,
          requested,
          installed: installedVersion,
          latest: latestVersion,
          status: deriveStatus(installedVersion, latestVersion),
          scope: section.scope,
        });
      }
    }
    return packages;
  }

  /**
   * Reads a manifest's dependency map for a section as a name-to-range record, ignoring non-string
   * ranges and non-object sections.
   * @param manifest The parsed manifest.
   * @param key The dependency section key.
   * @returns Returns the name-to-range record.
   */
  private dependencyMap(manifest: Record<string, unknown>, key: string): Record<string, string> {
    const section: unknown = manifest[key];
    if (typeof section !== 'object' || section === null) {
      return {};
    }
    const map: Record<string, string> = {};
    for (const [name, range] of Object.entries(section as Record<string, unknown>)) {
      if (typeof range === 'string') {
        map[name] = range;
      }
    }
    return map;
  }
}

/**
 * A manifest paired with its resolved display name and path, threaded through the load so each project
 * row carries both.
 */
interface ManifestEntry {
  /**
   * Gets the manifest's display name.
   */
  readonly name: string;

  /**
   * Gets the absolute path of the manifest.
   */
  readonly manifestPath: string;

  /**
   * Gets the parsed manifest.
   */
  readonly manifest: Record<string, unknown>;
}
