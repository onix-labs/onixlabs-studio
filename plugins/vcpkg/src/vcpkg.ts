import { Dirent, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { note } from './log';
import {
  parseManifest,
  sourceOf,
  VcpkgDependency,
  VcpkgManifest,
  VcpkgPortSource,
} from './manifest';
import {
  InstalledPackage,
  PackageManagerModel,
  PackageProject,
  PackageSearchItem,
  PackageSearchOptions,
  PackageSearchResult,
  PackageSourceInfo,
} from './protocol';
import { Baseline, BaselineStore } from './registry';
import { compareVersions, deriveStatus } from './versions';

/**
 * The manifest file vcpkg reads in manifest mode.
 */
export const MANIFEST: string = 'vcpkg.json';

/**
 * The registry configuration beside a manifest.
 */
const CONFIGURATION: string = 'vcpkg-configuration.json';

/**
 * The file at the top of a vcpkg checkout. A folder holding one is vcpkg itself — often a submodule —
 * whose `ports/` holds thousands of `vcpkg.json`s that are not the user's projects.
 */
const VCPKG_ROOT_MARKER: string = '.vcpkg-root';

/**
 * The one source this plugin searches: vcpkg's built-in registry.
 */
export const BUILTIN_SOURCE: string = 'vcpkg';

/**
 * The directories never scanned for manifests: dependency, install and build output.
 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  'node_modules',
  'vcpkg_installed',
  'build',
  'out',
]);

/**
 * How deep to scan for manifests (1 searches only the root itself).
 */
const LOAD_SCAN_DEPTH: number = 6;

/**
 * What `requested` says for a dependency that asks for no version: vcpkg then takes the version at the
 * baseline, and saying so is more use than an empty cell.
 */
const AT_BASELINE: string = 'baseline';

/**
 * Models vcpkg's manifest mode: reads each `vcpkg.json` in a folder, resolves each dependency to the
 * version its baseline (or an override) gives, and compares that with the registry's current baseline.
 * Read-only: a write is a command for Studio to run, built in `commands.ts`.
 */
export class VcpkgPackageManager {
  /**
   * Holds the built-in registry's baselines.
   */
  private readonly baselines: BaselineStore;

  /**
   * Initializes the manager.
   * @param baselines The built-in registry's baselines.
   */
  public constructor(baselines: BaselineStore) {
    this.baselines = baselines;
  }

  /**
   * Builds the model for a folder: one project per manifest.
   * @param root The absolute folder.
   * @returns Returns the model, or null when the folder holds no manifest.
   */
  public async load(root: string): Promise<PackageManagerModel | null> {
    const files: readonly string[] = await this.findManifests(root, LOAD_SCAN_DEPTH);
    if (files.length === 0) {
      return null;
    }
    const manifests: Map<string, VcpkgManifest> = new Map<string, VcpkgManifest>();
    for (const file of files) {
      const manifest: VcpkgManifest | null = await this.readManifest(file);
      // A manifest that is not JSON is still a project the user has; it shows with nothing in it.
      manifests.set(
        file,
        manifest ?? {
          name: null,
          dependencies: [],
          overrides: new Map<string, string>(),
          defaultSource: { kind: 'other' },
          registries: [],
        },
      );
    }

    // Every baseline any manifest names, fetched once and at the same time as the latest.
    const commits: Set<string> = new Set<string>();
    for (const manifest of manifests.values()) {
      for (const dependency of manifest.dependencies) {
        const source: VcpkgPortSource = sourceOf(manifest, dependency.name);
        if (source.kind === 'builtin' && source.baseline !== null) {
          commits.add(source.baseline);
        }
      }
    }
    const [latest, ...pinned]: readonly (Baseline | null)[] = await Promise.all([
      this.baselines.latest(),
      ...[...commits].map((commit: string): Promise<Baseline | null> => this.baselines.at(commit)),
    ]);
    const atCommit: Map<string, Baseline | null> = new Map<string, Baseline | null>();
    [...commits].forEach((commit: string, index: number): void => {
      atCommit.set(commit, pinned[index] ?? null);
    });

    const projects: PackageProject[] = [];
    for (const [file, manifest] of manifests) {
      projects.push({
        name: manifest.name ?? path.basename(path.dirname(file)),
        manifestPath: file,
        packages: manifest.dependencies.map((dependency: VcpkgDependency): InstalledPackage =>
          this.buildPackage(manifest, dependency, atCommit, latest),
        ),
      });
    }
    note('vcpkg', `Loaded ${projects.length} manifest(s)`);
    return { ecosystem: 'vcpkg', root, projects };
  }

  /**
   * Lists the sources a folder can search: vcpkg's built-in registry. A Git or folder registry has no
   * port list this plugin can read without cloning it, so it is not offered.
   * @returns Returns the sources.
   */
  public listSources(): readonly PackageSourceInfo[] {
    return [{ name: BUILTIN_SOURCE }];
  }

  /**
   * Searches the built-in registry's ports: the names in its current baseline that hold the query, the
   * exact name first, then names starting with it, then the rest, each group alphabetical. An empty
   * query lists every port. The baseline carries no descriptions, so none are given.
   * @param sourceName The source to search.
   * @param query The search text.
   * @param options The paging.
   * @returns Returns a page of results.
   */
  public async search(
    sourceName: string,
    query: string,
    options: PackageSearchOptions,
  ): Promise<PackageSearchResult> {
    if (sourceName !== BUILTIN_SOURCE) {
      note('vcpkg', 'A search named a source this plugin does not have');
      return { items: [], total: 0, hasMore: false };
    }
    const latest: Baseline | null = await this.baselines.latest();
    if (latest === null) {
      throw new Error('The vcpkg registry could not be reached.');
    }
    const needle: string = query.trim().toLowerCase();
    const rank: (name: string) => number = (name: string): number =>
      name === needle ? 0 : name.startsWith(needle) ? 1 : 2;
    const matches: readonly string[] = [...latest.keys()]
      .filter((name: string): boolean => name.includes(needle))
      .sort((a: string, b: string): number => rank(a) - rank(b) || a.localeCompare(b));
    const page: readonly PackageSearchItem[] = matches
      .slice(options.skip, options.skip + options.take)
      .map((name: string): PackageSearchItem => ({
        name,
        version: latest.get(name) ?? '',
        description: '',
        downloads: null,
        verified: false,
        sourceName: BUILTIN_SOURCE,
      }));
    return {
      items: page,
      total: matches.length,
      hasMore: options.skip + page.length < matches.length,
    };
  }

  /**
   * Builds one dependency's row. The resolved version is the override when there is one; otherwise the
   * baseline's version, raised to the dependency's `version>=` when that is newer, which is what vcpkg
   * itself picks. A port from a registry this plugin cannot read has no resolved or latest version
   * unless an override names one.
   * @param manifest The manifest.
   * @param dependency The dependency.
   * @param atCommit The baselines by commit.
   * @param latest The current baseline, or null when it could not be fetched.
   * @returns Returns the row.
   */
  private buildPackage(
    manifest: VcpkgManifest,
    dependency: VcpkgDependency,
    atCommit: ReadonlyMap<string, Baseline | null>,
    latest: Baseline | null,
  ): InstalledPackage {
    const override: string | null = manifest.overrides.get(dependency.name) ?? null;
    const source: VcpkgPortSource = sourceOf(manifest, dependency.name);
    let resolved: string | null = override;
    let newest: string | null = null;
    if (source.kind === 'builtin') {
      newest = latest?.get(dependency.name) ?? null;
      if (resolved === null && source.baseline !== null) {
        const pinned: string | null = atCommit.get(source.baseline)?.get(dependency.name) ?? null;
        resolved =
          pinned !== null &&
          dependency.minimum !== null &&
          compareVersions(dependency.minimum, pinned) > 0
            ? dependency.minimum
            : (pinned ?? dependency.minimum);
      }
    }
    const requested: string =
      override ?? (dependency.minimum === null ? AT_BASELINE : `>= ${dependency.minimum}`);
    return {
      name: dependency.name,
      requested,
      installed: resolved,
      latest: newest,
      status: deriveStatus(resolved, newest),
      // A host dependency is a tool the build runs, not a library the project ships.
      scope: dependency.host ? 'development' : 'production',
    };
  }

  /**
   * Reads one manifest and the configuration beside it.
   * @param file The manifest's absolute path.
   * @returns Returns the manifest, or null when it is not readable JSON.
   */
  private async readManifest(file: string): Promise<VcpkgManifest | null> {
    const manifest: unknown = await this.readJson(file);
    if (manifest === undefined) {
      return null;
    }
    const configuration: unknown = await this.readJson(
      path.join(path.dirname(file), CONFIGURATION),
    );
    return parseManifest(manifest, configuration ?? null);
  }

  /**
   * Finds manifests under a folder, skipping hidden, output and vcpkg-checkout folders.
   * @param directory The folder.
   * @param depth How many levels to descend (1 searches only the folder itself).
   * @returns Returns the manifests' absolute paths.
   */
  private async findManifests(directory: string, depth: number): Promise<string[]> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }
    if (entries.some((entry: Dirent): boolean => entry.name === VCPKG_ROOT_MARKER)) {
      return [];
    }
    const results: string[] = [];
    for (const entry of entries) {
      const full: string = path.join(directory, entry.name);
      if (entry.isFile() && entry.name === MANIFEST) {
        results.push(full);
      } else if (
        entry.isDirectory() &&
        depth > 1 &&
        !entry.name.startsWith('.') &&
        !entry.name.startsWith('cmake-build-') &&
        !SKIPPED_DIRECTORIES.has(entry.name)
      ) {
        results.push(...(await this.findManifests(full, depth - 1)));
      }
    }
    return results;
  }

  /**
   * Reads and parses a JSON file.
   * @param file The absolute path.
   * @returns Returns the parsed content, or undefined when it is absent or not JSON.
   */
  private async readJson(file: string): Promise<unknown> {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
    } catch {
      return undefined;
    }
  }
}
