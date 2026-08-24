import { promises as fs } from 'fs';
import * as path from 'path';
import {
  InstalledPackage,
  PackageDependencyScope,
  PackageEcosystem,
  PackageManagerModel,
  PackageProject,
} from '@shared/api/package-management';
import { parseWorkspacePatterns, splitWorkspacePattern } from '../project-system/node-workspaces';
import { fetchLatestVersion } from './npm-registry';
import { endpointFor, readNpmConfig } from './npm-sources';
import { NpmrcConfig } from './npmrc';
import { HttpFetch, PackageManager } from './package-manager';
import { deriveStatus } from './versions';
import { logger } from '../logger';

/**
 * The manifest file an npm package is described by.
 */
const MANIFEST: string = 'package.json';

/**
 * The lockfile npm resolves installed versions into.
 */
const LOCKFILE: string = 'package-lock.json';

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
 * for its declared dependencies, resolves installed versions from the lockfile, and queries the public
 * registry for the latest version of each distinct package. Read-only — it visualises dependency and
 * upgrade state; it does not install or modify anything.
 */
export class NpmPackageManager implements PackageManager {
  /**
   * Gets the ecosystem this manager models.
   */
  public readonly ecosystem: PackageEcosystem = 'npm';

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
    logger.trace('NpmPackageManager', `Loading the npm package model for '${root}'.`);
    const rootManifest: Record<string, unknown> | null = await this.readManifest(
      path.join(root, MANIFEST),
    );
    if (rootManifest === null) {
      logger.warn('NpmPackageManager', `No readable root 'package.json' at '${root}'.`);
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
    const config: NpmrcConfig = await readNpmConfig(root, process.env);
    const names: ReadonlySet<string> = this.distinctNames(manifests);
    logger.debug(
      'NpmPackageManager',
      `Resolving latest versions for ${names.size} distinct package(s) across ${manifests.length} manifest(s).`,
    );
    const latest: ReadonlyMap<string, string | null> = await this.resolveLatest(
      names,
      config,
      fetchFn,
    );

    const projects: PackageProject[] = manifests.map(
      (entry: ManifestEntry): PackageProject => ({
        name: entry.name,
        manifestPath: entry.manifestPath,
        packages: this.readPackages(entry.manifest, installed, latest),
      }),
    );
    logger.info(
      'NpmPackageManager',
      `Loaded npm package model for '${root}' (${projects.length} project(s)).`,
    );
    return { ecosystem: 'npm', root, projects };
  }

  /**
   * Reads and parses a package.json, or null when it is absent or unparseable.
   * @param manifestPath The absolute path of the package.json.
   * @returns Returns the parsed manifest, or null.
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
      const entries: import('fs').Dirent[] = await fs.readdir(directory, { withFileTypes: true });
      return entries
        .filter((entry: import('fs').Dirent): boolean => entry.isDirectory())
        .map((entry: import('fs').Dirent): string => path.join(directory, entry.name));
    } catch {
      return [];
    }
  }

  /**
   * Reads the installed versions from the root lockfile as a name-to-version map, handling both the
   * modern (`packages` keyed by node path) and legacy (`dependencies` keyed by name) lockfile shapes.
   * Absent or unparseable lockfiles yield an empty map, so declared packages simply show no installed
   * version.
   * @param root The absolute workspace root.
   * @returns Returns the installed versions by package name.
   */
  private async readInstalledVersions(root: string): Promise<ReadonlyMap<string, string>> {
    const lock: Record<string, unknown> | null = await this.readManifest(path.join(root, LOCKFILE));
    const versions: Map<string, string> = new Map<string, string>();
    if (lock === null) {
      return versions;
    }
    const packages: unknown = lock['packages'];
    if (typeof packages === 'object' && packages !== null) {
      for (const [key, value] of Object.entries(packages as Record<string, unknown>)) {
        const marker: number = key.lastIndexOf('node_modules/');
        if (marker === -1) {
          continue;
        }
        const name: string = key.slice(marker + 'node_modules/'.length);
        const version: unknown = (value as { version?: unknown }).version;
        if (name.length > 0 && typeof version === 'string') {
          versions.set(name, version);
        }
      }
    }
    const dependencies: unknown = lock['dependencies'];
    if (typeof dependencies === 'object' && dependencies !== null) {
      for (const [name, value] of Object.entries(dependencies as Record<string, unknown>)) {
        const version: unknown = (value as { version?: unknown }).version;
        if (!versions.has(name) && typeof version === 'string') {
          versions.set(name, version);
        }
      }
    }
    return versions;
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
        latest.set(name, await fetchLatestVersion(name, endpointFor(config, name), fetchFn));
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(REGISTRY_CONCURRENCY, queue.length) },
        (): Promise<void> => worker(),
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
