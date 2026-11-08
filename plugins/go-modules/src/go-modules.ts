import { Dirent, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { GoEnvironment, readGoEnvironment } from './go-env';
import { GoProxyClient, ProxyEndpoint } from './go-proxy';
import {
  GoExclusion,
  GoModFile,
  GoReplacement,
  GoRequirement,
  GoWorkFile,
  parseGoMod,
  parseGoSum,
  parseGoWork,
} from './gomod';
import { note } from './log';
import { NetrcEntry, parseNetrc } from './netrc';
import {
  CredentialAsk,
  HttpFetch,
  InstalledPackage,
  PackageManagerModel,
  PackageProject,
  PackageSearchOptions,
  PackageSearchResult,
  PackageSourceInfo,
} from './protocol';
import { compareGoVersions, deriveStatus } from './versions';

/**
 * The file a Go module is described by.
 */
const GO_MOD: string = 'go.mod';

/**
 * The file a Go workspace is described by.
 */
const GO_WORK: string = 'go.work';

/**
 * How many directory levels under the folder are searched for modules: the same depth Studio searches
 * for a marker, so a folder the panel offers this plugin for is one it finds a module in.
 */
const SEARCH_DEPTH: number = 3;

/**
 * Directories never searched: a vendored copy of dependencies, and folders the go command itself
 * ignores (`testdata`, and names starting with `.` or `_`).
 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  'vendor',
  'testdata',
  'node_modules',
]);

/**
 * How many proxy lookups run at once while resolving latest versions.
 */
const PROXY_CONCURRENCY: number = 8;

/**
 * The answer to a search that finds nothing.
 */
const NOTHING: PackageSearchResult = { items: [], total: 0, hasMore: false };

/**
 * One module of a group, read.
 */
interface ModuleEntry {
  /**
   * Gets the absolute path of its go.mod.
   */
  readonly manifestPath: string;

  /**
   * Gets what its go.mod declares.
   */
  readonly file: GoModFile;
}

/**
 * Modules whose versions are selected together: one module on its own, or every module a go.work
 * uses. Every module of a workspace is a main module, so their requirements, replacements and
 * exclusions all apply to each other.
 */
interface ModuleGroup {
  /**
   * Gets the modules, in the order they are shown.
   */
  readonly modules: readonly ModuleEntry[];

  /**
   * Gets the workspace's own replacements, which win over the modules': none for a lone module.
   */
  readonly workReplaces: readonly GoReplacement[];

  /**
   * Gets the module versions go.sum (and go.work.sum) record, as `path@version`.
   */
  readonly sums: ReadonlySet<string>;
}

/**
 * One latest-version lookup to make.
 */
interface Lookup {
  /**
   * Gets the module path looked up.
   */
  readonly path: string;

  /**
   * Gets the versions excluded for it.
   */
  readonly excluded: ReadonlySet<string>;

  /**
   * Gets the version selected now.
   */
  readonly current: string;
}

/**
 * What one requirement resolves to before its latest version is known.
 */
interface Resolution {
  /**
   * Gets the version the go command selects, confirmed by go.sum, or null when it is not.
   */
  readonly installed: string | null;

  /**
   * Gets the lookup that finds its latest version, or null when it is not looked up: it comes from a
   * directory on disk, or from another module of the workspace.
   */
  readonly lookup: Lookup | null;
}

/**
 * Models Go modules: finds the modules in a folder (and the workspaces a go.work makes of them), reads
 * what each requires, works out the version the go command selects, and asks the module proxy for the
 * latest. Read-only: a write is a command for Studio to run, built in `commands.ts`.
 *
 * Only direct requirements are listed. A `// indirect` requirement is one the go command records for a
 * dependency's sake and `go mod tidy` adds and drops by itself; it is moved by moving the dependency
 * that needs it, and removing it by hand is undone by the next tidy.
 */
export class GoModulesPackageManager {
  /**
   * Holds how to ask Studio for a token saved for a proxy.
   */
  private readonly credential: CredentialAsk;

  /**
   * Holds the environment the Go settings are read from, which Studio has cut down to an allow-list.
   */
  private readonly env: Record<string, string | undefined>;

  /**
   * Initializes the manager.
   * @param credential Asks Studio for a token saved for a proxy.
   * @param env The environment the Go settings are read from.
   */
  public constructor(
    credential: CredentialAsk = (): Promise<string | null> => Promise.resolve(null),
    env: Record<string, string | undefined> = {},
  ) {
    this.credential = credential;
    this.env = env;
  }

  /**
   * Builds the model for a folder: every module in it, each direct requirement with its selected and
   * latest versions.
   * @param root The absolute folder.
   * @param fetchFn The fetch proxy requests go through.
   * @returns Returns the model, or null when the folder holds no module.
   */
  public async load(root: string, fetchFn: HttpFetch): Promise<PackageManagerModel | null> {
    const groups: readonly ModuleGroup[] = await this.groups(root);
    if (groups.length === 0) {
      return null;
    }
    const client: GoProxyClient = await this.client(fetchFn);
    const resolved: Map<string, Resolution>[] = groups.map(
      (group: ModuleGroup): Map<string, Resolution> => this.resolve(group),
    );
    // Only what is listed is looked up: an indirect requirement takes part in selection, but is not a
    // row, so the proxy is not asked about it.
    const lookups: Map<string, Lookup> = new Map<string, Lookup>();
    groups.forEach((group: ModuleGroup, index: number): void => {
      for (const requirement of directRequirements(group)) {
        const lookup: Lookup | null = resolved[index].get(requirement.path)?.lookup ?? null;
        if (lookup !== null) {
          lookups.set(lookupKey(lookup), lookup);
        }
      }
    });
    const latest: ReadonlyMap<string, string | null> = await this.resolveLatest(lookups, client);

    const projects: PackageProject[] = [];
    groups.forEach((group: ModuleGroup, index: number): void => {
      for (const module of group.modules) {
        projects.push({
          name: module.file.module ?? path.basename(path.dirname(module.manifestPath)),
          manifestPath: module.manifestPath,
          packages: module.file.requires
            .filter((requirement: GoRequirement): boolean => !requirement.indirect)
            .map((requirement: GoRequirement): InstalledPackage =>
              this.row(requirement, resolved[index].get(requirement.path), latest),
            ),
        });
      }
    });
    note('go', `Loaded ${projects.length} module(s), ${lookups.size} lookup(s)`);
    return { ecosystem: 'go', root, projects };
  }

  /**
   * Lists the module proxies a lookup can be made on. The Go settings are the user's, not the folder's,
   * so every folder has the same.
   * @returns Returns their names.
   */
  public async listSources(): Promise<readonly PackageSourceInfo[]> {
    const client: GoProxyClient = await this.client((): Promise<never> =>
      Promise.reject(new Error('Listing sources makes no request.')),
    );
    return (await client.proxies()).map((endpoint: ProxyEndpoint): PackageSourceInfo => ({
      name: endpoint.name,
    }));
  }

  /**
   * Looks a module up by its exact path on a named proxy. There is no search: pkg.go.dev has no public
   * API, and a module proxy answers only for a path it is given.
   * @param source The proxy's name.
   * @param query The module path.
   * @param options The paging options; a page after the first is always empty.
   * @param fetchFn The fetch proxy requests go through.
   * @returns Returns the module, or nothing.
   */
  public async search(
    source: string,
    query: string,
    options: PackageSearchOptions,
    fetchFn: HttpFetch,
  ): Promise<PackageSearchResult> {
    const modulePath: string = query.trim();
    if (modulePath.length === 0 || options.skip > 0) {
      return NOTHING;
    }
    const client: GoProxyClient = await this.client(fetchFn);
    const version: string | null = await client.lookUp(source, modulePath);
    if (version === null) {
      return NOTHING;
    }
    return {
      items: [
        {
          name: modulePath,
          version,
          description: '',
          downloads: null,
          verified: false,
          sourceName: source,
        },
      ],
      total: 1,
      hasMore: false,
    };
  }

  /**
   * Builds a proxy client under the current Go settings, which are read afresh each time so a
   * `go env -w` takes effect without restarting anything.
   * @param fetchFn The fetch proxy requests go through.
   * @returns Returns the client.
   */
  private async client(fetchFn: HttpFetch): Promise<GoProxyClient> {
    const environment: GoEnvironment = await readGoEnvironment(this.env);
    let netrc: readonly NetrcEntry[] = [];
    if (environment.netrc) {
      const text: string | null = await readText(environment.netrcPath);
      netrc = text === null ? [] : parseNetrc(text);
    }
    return new GoProxyClient(environment, netrc, this.credential, fetchFn);
  }

  /**
   * Finds the folder's modules and groups them: each go.work's modules together, and every other
   * go.mod on its own. A module a go.work uses from outside the folder is left out, because a write to
   * it would run outside the folder.
   * @param root The absolute folder.
   * @returns Returns the groups, workspaces first.
   */
  private async groups(root: string): Promise<readonly ModuleGroup[]> {
    const found: { readonly mods: string[]; readonly works: string[] } = { mods: [], works: [] };
    await this.find(root, SEARCH_DEPTH, found);
    const grouped: Set<string> = new Set<string>();
    const groups: ModuleGroup[] = [];
    for (const work of found.works.sort()) {
      const group: ModuleGroup | null = await this.workspace(root, work, grouped);
      if (group !== null) {
        groups.push(group);
      }
    }
    for (const manifestPath of found.mods.sort()) {
      if (grouped.has(manifestPath)) {
        continue;
      }
      const module: ModuleEntry | null = await readModule(manifestPath);
      if (module !== null) {
        grouped.add(manifestPath);
        groups.push({
          modules: [module],
          workReplaces: [],
          sums: await readSums(path.join(path.dirname(manifestPath), 'go.sum')),
        });
      }
    }
    return groups;
  }

  /**
   * Reads one go.work into a group of the modules it uses.
   * @param root The absolute folder.
   * @param work The go.work's path.
   * @param grouped The go.mod paths already in a group, added to.
   * @returns Returns the group, or null when the file cannot be read or uses no module here.
   */
  private async workspace(
    root: string,
    work: string,
    grouped: Set<string>,
  ): Promise<ModuleGroup | null> {
    const text: string | null = await readText(work);
    if (text === null) {
      return null;
    }
    const parsed: GoWorkFile = parseGoWork(text);
    const directory: string = path.dirname(work);
    const modules: ModuleEntry[] = [];
    const sums: Set<string> = new Set<string>(await readSums(path.join(directory, 'go.work.sum')));
    for (const use of parsed.uses) {
      const manifestPath: string = path.resolve(directory, use, GO_MOD);
      if (!isInside(manifestPath, root)) {
        note('go', 'A go.work uses a module outside the folder, which is left out');
        continue;
      }
      if (grouped.has(manifestPath)) {
        continue;
      }
      const module: ModuleEntry | null = await readModule(manifestPath);
      if (module === null) {
        continue;
      }
      grouped.add(manifestPath);
      modules.push(module);
      for (const sum of await readSums(path.join(path.dirname(manifestPath), 'go.sum'))) {
        sums.add(sum);
      }
    }
    return modules.length === 0 ? null : { modules, workReplaces: parsed.replaces, sums };
  }

  /**
   * Finds go.mod and go.work files under a directory.
   * @param directory The directory.
   * @param depth How many more levels to descend.
   * @param found The paths found, added to.
   */
  private async find(
    directory: string,
    depth: number,
    found: { readonly mods: string[]; readonly works: string[] },
  ): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full: string = path.join(directory, entry.name);
      if (entry.isFile() && entry.name === GO_MOD) {
        found.mods.push(full);
      } else if (entry.isFile() && entry.name === GO_WORK) {
        found.works.push(full);
      } else if (
        entry.isDirectory() &&
        depth > 0 &&
        !entry.name.startsWith('.') &&
        !entry.name.startsWith('_') &&
        !SKIPPED_DIRECTORIES.has(entry.name)
      ) {
        await this.find(full, depth - 1, found);
      }
    }
  }

  /**
   * Works out, for every module a group requires, the version the go command selects and where its
   * latest version is looked up.
   *
   * The selected version is minimal version selection over the group's main modules: the highest
   * version any of them requires. Since Go 1.17 a go.mod lists every module its build needs, so this is
   * the version the build uses; go.sum recording it is what says it has been resolved. A replacement
   * then decides where the code comes from — the workspace's own first, then a module's, a
   * version-specific one before one for every version — and an excluded version is one the go command
   * moves past, so what it lands on is not known here.
   * @param group The group.
   * @returns Returns each required module's resolution, by path.
   */
  private resolve(group: ModuleGroup): Map<string, Resolution> {
    const selected: Map<string, string> = new Map<string, string>();
    const excluded: Map<string, Set<string>> = new Map<string, Set<string>>();
    const ownPaths: Set<string> = new Set<string>();
    for (const module of group.modules) {
      if (module.file.module !== null) {
        ownPaths.add(module.file.module);
      }
      for (const requirement of module.file.requires) {
        const current: string | undefined = selected.get(requirement.path);
        if (current === undefined || compareGoVersions(requirement.version, current) > 0) {
          selected.set(requirement.path, requirement.version);
        }
      }
      for (const exclusion of module.file.excludes) {
        addExclusion(excluded, exclusion);
      }
    }
    // A workspace's modules are used from disk whatever version another of them requires.
    const fromDisk: ReadonlySet<string> = ownPaths;
    const replaces: readonly GoReplacement[] = [
      ...group.workReplaces,
      ...group.modules.flatMap(
        (module: ModuleEntry): readonly GoReplacement[] => module.file.replaces,
      ),
    ];
    const resolutions: Map<string, Resolution> = new Map<string, Resolution>();
    for (const [modulePath, version] of selected) {
      resolutions.set(
        modulePath,
        fromDisk.has(modulePath)
          ? { installed: null, lookup: null }
          : resolution(modulePath, version, replaces, excluded, group.sums),
      );
    }
    return resolutions;
  }

  /**
   * Resolves the latest version of every lookup, a bounded number at once.
   * @param lookups The lookups, by key.
   * @param client The proxy client.
   * @returns Returns each lookup's latest version, by key.
   */
  private async resolveLatest(
    lookups: ReadonlyMap<string, Lookup>,
    client: GoProxyClient,
  ): Promise<ReadonlyMap<string, string | null>> {
    const latest: Map<string, string | null> = new Map<string, string | null>();
    const queue: [string, Lookup][] = [...lookups];
    const worker: () => Promise<void> = async (): Promise<void> => {
      for (
        let next: [string, Lookup] | undefined = queue.shift();
        next !== undefined;
        next = queue.shift()
      ) {
        const lookup: Lookup = next[1];
        latest.set(next[0], await client.latest(lookup.path, lookup.excluded, lookup.current));
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(PROXY_CONCURRENCY, queue.length) }, (): Promise<void> =>
        worker(),
      ),
    );
    return latest;
  }

  /**
   * Builds one requirement's row.
   * @param requirement The requirement.
   * @param resolution What it resolves to.
   * @param latest The latest versions, by lookup key.
   * @returns Returns the row. Every requirement is a production dependency: a go.mod has no other kind.
   */
  private row(
    requirement: GoRequirement,
    resolution: Resolution | undefined,
    latest: ReadonlyMap<string, string | null>,
  ): InstalledPackage {
    const installed: string | null = resolution?.installed ?? null;
    const latestVersion: string | null =
      resolution?.lookup === null || resolution === undefined
        ? null
        : (latest.get(lookupKey(resolution.lookup)) ?? null);
    return {
      name: requirement.path,
      requested: requirement.version,
      installed,
      latest: latestVersion,
      status: deriveStatus(installed, latestVersion),
      scope: 'production',
    };
  }
}

/**
 * Resolves one selected module: where its code comes from, whether go.sum records it, and what to look
 * up.
 * @param modulePath The module path.
 * @param version The selected version.
 * @param replaces The replacements in force, the workspace's first.
 * @param excluded The excluded versions, by module path.
 * @param sums The recorded versions.
 * @returns Returns the resolution.
 */
function resolution(
  modulePath: string,
  version: string,
  replaces: readonly GoReplacement[],
  excluded: ReadonlyMap<string, ReadonlySet<string>>,
  sums: ReadonlySet<string>,
): Resolution {
  const replacement: GoReplacement | undefined =
    replaces.find(
      (candidate: GoReplacement): boolean =>
        candidate.path === modulePath && candidate.version === version,
    ) ??
    replaces.find(
      (candidate: GoReplacement): boolean =>
        candidate.path === modulePath && candidate.version === null,
    );
  if (replacement?.newVersion === null) {
    // Replaced by a directory: the code is on disk, and no proxy has a version of it.
    return { installed: null, lookup: null };
  }
  const target: string = replacement?.newPath ?? modulePath;
  const targetVersion: string = replacement?.newVersion ?? version;
  const isExcluded: boolean = excluded.get(modulePath)?.has(version) === true;
  return {
    installed: !isExcluded && sums.has(`${target}@${targetVersion}`) ? targetVersion : null,
    lookup: {
      path: target,
      excluded: excluded.get(target) ?? new Set<string>(),
      current: targetVersion,
    },
  };
}

/**
 * Lists the direct requirements of every module in a group: the ones shown.
 * @param group The group.
 * @returns Returns them, module by module.
 */
function directRequirements(group: ModuleGroup): readonly GoRequirement[] {
  return group.modules.flatMap((module: ModuleEntry): readonly GoRequirement[] =>
    module.file.requires.filter((requirement: GoRequirement): boolean => !requirement.indirect),
  );
}

/**
 * Records one exclusion.
 * @param excluded The exclusions by module path, added to.
 * @param exclusion The exclusion.
 */
function addExclusion(excluded: Map<string, Set<string>>, exclusion: GoExclusion): void {
  const versions: Set<string> = excluded.get(exclusion.path) ?? new Set<string>();
  versions.add(exclusion.version);
  excluded.set(exclusion.path, versions);
}

/**
 * Keys a lookup, so the same question is asked once however many modules ask it.
 * @param lookup The lookup.
 * @returns Returns the key.
 */
function lookupKey(lookup: Lookup): string {
  return `${lookup.path}@${lookup.current}#${[...lookup.excluded].sort().join(',')}`;
}

/**
 * Reads one go.mod.
 * @param manifestPath Its path.
 * @returns Returns the module, or null when the file cannot be read.
 */
async function readModule(manifestPath: string): Promise<ModuleEntry | null> {
  const text: string | null = await readText(manifestPath);
  return text === null ? null : { manifestPath, file: parseGoMod(text) };
}

/**
 * Reads a go.sum or go.work.sum.
 * @param filePath Its path.
 * @returns Returns the versions it records, none when it is absent.
 */
async function readSums(filePath: string): Promise<ReadonlySet<string>> {
  const text: string | null = await readText(filePath);
  return text === null ? new Set<string>() : parseGoSum(text);
}

/**
 * Reads a text file.
 * @param filePath Its path.
 * @returns Returns the text, or null when it is absent or unreadable.
 */
async function readText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Determines whether a path lies within a folder.
 * @param target The path.
 * @param root The folder.
 * @returns Returns true when it does.
 */
function isInside(target: string, root: string): boolean {
  const relative: string = path.relative(root, target);
  return (
    relative.length > 0 &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
