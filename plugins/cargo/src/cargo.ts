import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { addCommand, Placement, removeCommand, restoreCommand } from './commands';
import {
  CargoConfig,
  CargoRegistry,
  CRATES_IO,
  EMPTY_CONFIG,
  readCargoConfig,
  readCredentials,
  resolveRegistries,
} from './cargo-config';
import { LockedPackage, lockedVersion, readLockfile } from './cargo-lock';
import {
  CargoDependency,
  CargoManifest,
  DEPENDENCY_TABLES,
  describeRequested,
  resolveInherited,
  scopeOf,
} from './cargo-manifest';
import {
  CRATES_IO_API,
  displayName,
  fetchLatestVersion,
  findApi,
  searchCrates,
} from './cargo-registry';
import {
  FoundManifest,
  findManifests,
  isInside,
  MANIFEST,
  readManifestFile,
} from './cargo-workspace';
import { note } from './log';
import {
  CredentialAsk,
  HttpFetch,
  InstalledPackage,
  PackageCommand,
  PackageManagerModel,
  PackageProject,
  PackageSearchOptions,
  PackageSearchResult,
  PackageSourceInfo,
} from './protocol';
import { parseToml, TomlTable } from './toml';
import { deriveStatus, floorOf, isPrerelease } from './versions';

/**
 * How many index lookups run at once while resolving latest versions.
 */
const REGISTRY_CONCURRENCY: number = 8;

/**
 * The answer to a search that cannot be made.
 */
const NOTHING: PackageSearchResult = { items: [], total: 0, hasMore: false };

/**
 * One latest-version lookup: a crate in a registry, with or without prereleases.
 */
interface Lookup {
  /**
   * Gets the registry.
   */
  readonly registry: CargoRegistry;

  /**
   * Gets the crate.
   */
  readonly crate: string;

  /**
   * Gets whether a prerelease may be the answer.
   */
  readonly prerelease: boolean;
}

/**
 * Models the Cargo ecosystem: reads each crate's `Cargo.toml` (workspaces, inheritance and all), its
 * workspace's `Cargo.lock` for installed versions, and each registry's sparse index for the latest. A
 * write is a command for Studio to run, built in `commands.ts`; this class only reads the manifest to
 * know which entry the command must change.
 */
export class CargoPackageManager {
  /**
   * Holds how to ask Studio for a token saved for a registry.
   */
  private readonly credential: CredentialAsk;

  /**
   * Holds the environment `CARGO_HOME` is read from, which Studio has cut down to an allow-list.
   */
  private readonly env: Record<string, string | undefined>;

  /**
   * Initializes the manager.
   * @param credential Asks Studio for a token saved for a registry.
   * @param env The environment `CARGO_HOME` is read from.
   */
  public constructor(
    credential: CredentialAsk = (): Promise<string | null> => Promise.resolve(null),
    env: Record<string, string | undefined> = process.env,
  ) {
    this.credential = credential;
    this.env = env;
  }

  /**
   * Builds the model for a folder: one project per crate, each with every dependency it declares.
   * @param root The absolute folder.
   * @param fetchFn The fetch registry requests go through.
   * @returns Returns the model, or null when the folder holds no crate.
   */
  public async load(root: string, fetchFn: HttpFetch): Promise<PackageManagerModel | null> {
    const found: readonly FoundManifest[] = await findManifests(root);
    const crates: readonly FoundManifest[] = found.filter(
      (entry: FoundManifest): boolean => entry.manifest.name !== null,
    );
    if (crates.length === 0) {
      return null;
    }
    const byPath: ReadonlyMap<string, CargoManifest> = new Map<string, CargoManifest>(
      found.map((entry: FoundManifest): [string, CargoManifest] => [
        entry.manifestPath,
        entry.manifest,
      ]),
    );
    const registries: readonly CargoRegistry[] = await this.registries(root);
    const tokens: Map<string, Promise<string | null>> = new Map<string, Promise<string | null>>();
    const locks: Map<string, readonly LockedPackage[]> = new Map<
      string,
      readonly LockedPackage[]
    >();

    const declared: Map<string, readonly CargoDependency[]> = new Map<
      string,
      readonly CargoDependency[]
    >();
    const installed: Map<string, ReadonlyMap<CargoDependency, string | null>> = new Map<
      string,
      ReadonlyMap<CargoDependency, string | null>
    >();
    const lookups: Map<string, Lookup> = new Map<string, Lookup>();
    for (const crate of crates) {
      const workspace: CargoManifest | undefined =
        crate.workspacePath === null ? undefined : byPath.get(crate.workspacePath);
      const dependencies: readonly CargoDependency[] = crate.manifest.dependencies.map(
        (dependency: CargoDependency): CargoDependency =>
          resolveInherited(dependency, workspace?.workspace?.dependencies ?? null),
      );
      const lock: readonly LockedPackage[] = await this.lockfile(
        path.dirname(crate.workspacePath ?? crate.manifestPath),
        locks,
      );
      const versions: Map<CargoDependency, string | null> = new Map<
        CargoDependency,
        string | null
      >();
      for (const dependency of dependencies) {
        const version: string | null = lockedVersion(
          lock,
          { name: crate.manifest.name ?? '', version: crate.manifest.version },
          dependency.package,
        );
        versions.set(dependency, version);
        const lookup: Lookup | null = this.lookupFor(dependency, version, registries);
        if (lookup !== null) {
          lookups.set(lookupKey(lookup), lookup);
        }
      }
      declared.set(crate.manifestPath, dependencies);
      installed.set(crate.manifestPath, versions);
    }

    const latest: ReadonlyMap<string, string | null> = await this.resolveLatest(
      [...lookups.values()],
      tokens,
      fetchFn,
    );
    const projects: PackageProject[] = crates.map((crate: FoundManifest): PackageProject => ({
      name: crate.manifest.name ?? path.basename(path.dirname(crate.manifestPath)),
      manifestPath: crate.manifestPath,
      packages: (declared.get(crate.manifestPath) ?? []).map(
        (dependency: CargoDependency): InstalledPackage =>
          this.row(
            dependency,
            installed.get(crate.manifestPath)?.get(dependency) ?? null,
            registries,
            latest,
          ),
      ),
    }));
    note('cargo', `Loaded ${projects.length} crate(s), ${lookups.size} registry lookup(s)`);
    return { ecosystem: 'cargo', root, projects };
  }

  /**
   * Lists the registries a folder can search, by name: crates.io, then each configured registry.
   * @param root The absolute folder.
   * @returns Returns the sources.
   */
  public async listSources(root: string): Promise<readonly PackageSourceInfo[]> {
    return (await this.registries(root)).map((registry: CargoRegistry): PackageSourceInfo => ({
      name: displayName(registry),
    }));
  }

  /**
   * Searches a registry. A registry whose index declares no web API cannot be searched, and answers an
   * empty page rather than pretending; crates.io, or a mirror standing in for it, falls back to
   * crates.io's own API.
   * @param root The absolute folder.
   * @param sourceName The source to search, as `sources` named it.
   * @param query The search text, empty to browse.
   * @param options The paging and prerelease options.
   * @param fetchFn The fetch registry requests go through.
   * @returns Returns the page.
   */
  public async search(
    root: string,
    sourceName: string,
    query: string,
    options: PackageSearchOptions,
    fetchFn: HttpFetch,
  ): Promise<PackageSearchResult> {
    const registry: CargoRegistry | undefined = (await this.registries(root)).find(
      (candidate: CargoRegistry): boolean => displayName(candidate) === sourceName,
    );
    if (registry === undefined) {
      note('cargo', 'A search named a registry this folder does not have');
      return NOTHING;
    }
    const token: string | null = await this.tokenFor(
      registry,
      new Map<string, Promise<string | null>>(),
    );
    const declared: string | null = await findApi(registry, token, fetchFn);
    const api: string | null = declared ?? (registry.name === CRATES_IO ? CRATES_IO_API : null);
    if (api === null) {
      note('cargo', 'A registry with no web API was asked to search');
      return NOTHING;
    }
    // A token belongs to the registry it is configured for; crates.io's own API needs none.
    return searchCrates(
      api,
      sourceName,
      query,
      options,
      api === CRATES_IO_API ? null : token,
      fetchFn,
    );
  }

  /**
   * Answers an install: `cargo add` on a crate. A virtual manifest has no crate to add to.
   * @param root The absolute folder.
   * @param project The manifest.
   * @param name The crate.
   * @param version The version requirement, or null for the newest.
   * @returns Returns the command.
   */
  public async install(
    root: string,
    project: string,
    name: string,
    version: string | null,
  ): Promise<PackageCommand> {
    const manifest: CargoManifest = await this.manifestFor(root, project);
    if (manifest.name === null) {
      throw new Error(
        `This Cargo.toml is a workspace with no crate of its own. Add ${name} to one of its members.`,
      );
    }
    return addCommand(project, name, version, `Install ${name}`, null);
  }

  /**
   * Answers an update: `cargo add name@version` against the entry that declares it, so it moves in
   * place. With no version the registry's latest is looked up, because `cargo add` given no version
   * leaves an existing requirement alone.
   * @param root The absolute folder.
   * @param project The manifest.
   * @param name The key the dependency is declared under.
   * @param version The version requirement, or null for the latest.
   * @param fetchFn The fetch registry requests go through.
   * @returns Returns the command.
   * @throws When the dependency cannot be moved by `cargo add`: inherited, a path, or a git repository.
   */
  public async update(
    root: string,
    project: string,
    name: string,
    version: string | null,
    fetchFn: HttpFetch,
  ): Promise<PackageCommand> {
    const manifest: CargoManifest = await this.manifestFor(root, project);
    const dependency: CargoDependency = this.declared(manifest, name);
    if (dependency.inherited) {
      throw new Error(
        `${name} takes its version from the workspace. Change it under [workspace.dependencies] in the workspace's Cargo.toml.`,
      );
    }
    if (dependency.source.kind === 'path' || dependency.source.kind === 'git') {
      throw new Error(
        `${name} comes from a ${dependency.source.kind === 'path' ? 'path' : 'git repository'}, not a registry, so it has no version to move to.`,
      );
    }
    let target: string | null = version;
    if (target === null) {
      const registry: CargoRegistry | undefined = this.registryFor(
        dependency,
        await this.registries(root),
      );
      target =
        registry === undefined
          ? null
          : await fetchLatestVersion(
              dependency.package,
              registry,
              await this.tokenFor(registry, new Map<string, Promise<string | null>>()),
              false,
              fetchFn,
            );
      if (target === null) {
        throw new Error(`The latest version of ${name} could not be found.`);
      }
    }
    return addCommand(project, name, target, `Update ${name}`, placementOf(dependency));
  }

  /**
   * Answers a remove: `cargo remove` against the table the dependency is declared in.
   * @param root The absolute folder.
   * @param project The manifest.
   * @param name The key the dependency is declared under.
   * @returns Returns the command.
   */
  public async remove(root: string, project: string, name: string): Promise<PackageCommand> {
    const manifest: CargoManifest = await this.manifestFor(root, project);
    return removeCommand(project, placementOf(this.declared(manifest, name)));
  }

  /**
   * Answers a restore: `cargo fetch`, which fetches the whole workspace the manifest is in.
   * @param root The absolute folder.
   * @param project The manifest.
   * @returns Returns the command.
   */
  public async restore(root: string, project: string): Promise<PackageCommand> {
    await this.manifestFor(root, project);
    return restoreCommand(project);
  }

  /**
   * Reads the manifest a write names.
   * @param root The absolute folder.
   * @param project The manifest's path.
   * @returns Returns the manifest.
   * @throws When it is not a `Cargo.toml` inside the folder, or cannot be read.
   */
  private async manifestFor(root: string, project: string): Promise<CargoManifest> {
    if (
      !path.isAbsolute(project) ||
      path.basename(project) !== MANIFEST ||
      !isInside(project, root)
    ) {
      throw new Error('That is not a Cargo.toml in this folder.');
    }
    const manifest: CargoManifest | null = await readManifestFile(project);
    if (manifest === null) {
      throw new Error('That Cargo.toml could not be read.');
    }
    return manifest;
  }

  /**
   * Finds the entry a write names: the first declaring the key, every-target tables before
   * target-specific ones and in the order `[dependencies]`, `[dev-dependencies]`,
   * `[build-dependencies]`.
   * @param manifest The manifest.
   * @param key The key.
   * @returns Returns the entry.
   * @throws When the manifest does not declare it.
   */
  private declared(manifest: CargoManifest, key: string): CargoDependency {
    const matches: readonly CargoDependency[] = manifest.dependencies.filter(
      (dependency: CargoDependency): boolean => dependency.key === key,
    );
    const rank: (dependency: CargoDependency) => number = (dependency: CargoDependency): number =>
      (dependency.target === null ? 0 : 10) + DEPENDENCY_TABLES.indexOf(dependency.table);
    const first: CargoDependency | undefined = [...matches].sort(
      (a: CargoDependency, b: CargoDependency): number => rank(a) - rank(b),
    )[0];
    if (first === undefined) {
      throw new Error(`${key} is not declared in this Cargo.toml.`);
    }
    return first;
  }

  /**
   * Reads the registries a folder reaches: `$CARGO_HOME` (or `~/.cargo`) for the user's config and
   * credentials, and the folder's own `.cargo/config.toml`.
   * @param root The absolute folder.
   * @returns Returns the registries.
   */
  private async registries(root: string): Promise<readonly CargoRegistry[]> {
    const home: string = this.env['CARGO_HOME'] ?? path.join(os.homedir(), '.cargo');
    const user: CargoConfig = await readConfigIn(home);
    const project: CargoConfig = await readConfigIn(path.join(root, '.cargo'));
    const credentials: TomlTable =
      (await readToml(path.join(home, 'credentials.toml'))) ??
      (await readToml(path.join(home, 'credentials'))) ??
      {};
    return resolveRegistries(user, project, readCredentials(credentials));
  }

  /**
   * Gets the token to send a registry: the one its configuration binds to it, otherwise one saved in
   * Studio — asked for at most once per request, never for crates.io, and only for an https index.
   * @param registry The registry.
   * @param asked The asks already made in this request, by registry name.
   * @returns Returns the token, or null.
   */
  private tokenFor(
    registry: CargoRegistry,
    asked: Map<string, Promise<string | null>>,
  ): Promise<string | null> {
    if (registry.token !== null) {
      return Promise.resolve(registry.token);
    }
    if (registry.isPublic || !registry.index?.startsWith('https://')) {
      return Promise.resolve(null);
    }
    const pending: Promise<string | null> | undefined = asked.get(registry.name);
    if (pending !== undefined) {
      return pending;
    }
    const ask: Promise<string | null> = this.credential(registry.index).catch(
      (): string | null => null,
    );
    asked.set(registry.name, ask);
    return ask;
  }

  /**
   * Reads a workspace's lockfile once.
   * @param directory The directory it sits in.
   * @param cache The lockfiles already read, by directory.
   * @returns Returns its packages, empty when there is none.
   */
  private async lockfile(
    directory: string,
    cache: Map<string, readonly LockedPackage[]>,
  ): Promise<readonly LockedPackage[]> {
    const cached: readonly LockedPackage[] | undefined = cache.get(directory);
    if (cached !== undefined) {
      return cached;
    }
    const document: TomlTable | null = await readToml(path.join(directory, 'Cargo.lock'));
    const packages: readonly LockedPackage[] = document === null ? [] : readLockfile(document);
    cache.set(directory, packages);
    return packages;
  }

  /**
   * Finds the registry a dependency comes from.
   * @param dependency The dependency.
   * @param registries The registries.
   * @returns Returns the registry, or undefined when it is not a registry dependency or names a
   * registry the configuration does not define.
   */
  private registryFor(
    dependency: CargoDependency,
    registries: readonly CargoRegistry[],
  ): CargoRegistry | undefined {
    if (dependency.source.kind !== 'registry') {
      return undefined;
    }
    const name: string = dependency.source.registry ?? CRATES_IO;
    return registries.find((registry: CargoRegistry): boolean => registry.name === name);
  }

  /**
   * Works out the latest-version lookup a dependency needs. Prereleases are looked for only when the
   * dependency is already on one: someone on `1.0.0-rc.1` wants to hear of `rc.2`, nobody else does.
   * @param dependency The dependency.
   * @param installed Its installed version, or null.
   * @param registries The registries.
   * @returns Returns the lookup, or null when there is nothing to look up.
   */
  private lookupFor(
    dependency: CargoDependency,
    installed: string | null,
    registries: readonly CargoRegistry[],
  ): Lookup | null {
    const registry: CargoRegistry | undefined = this.registryFor(dependency, registries);
    if (registry === undefined || dependency.source.kind !== 'registry') {
      return null;
    }
    const baseline: string | null = installed ?? floorOf(dependency.source.requirement);
    return {
      registry,
      crate: dependency.package,
      prerelease: baseline !== null && isPrerelease(baseline),
    };
  }

  /**
   * Resolves the latest version of each lookup, a bounded number at once.
   * @param lookups The lookups.
   * @param tokens The credential asks made in this request.
   * @param fetchFn The fetch to use.
   * @returns Returns the latest versions, by lookup key.
   */
  private async resolveLatest(
    lookups: readonly Lookup[],
    tokens: Map<string, Promise<string | null>>,
    fetchFn: HttpFetch,
  ): Promise<ReadonlyMap<string, string | null>> {
    const latest: Map<string, string | null> = new Map<string, string | null>();
    const queue: Lookup[] = [...lookups];
    const worker: () => Promise<void> = async (): Promise<void> => {
      for (
        let lookup: Lookup | undefined = queue.shift();
        lookup !== undefined;
        lookup = queue.shift()
      ) {
        const token: string | null = await this.tokenFor(lookup.registry, tokens);
        latest.set(
          lookupKey(lookup),
          await fetchLatestVersion(
            lookup.crate,
            lookup.registry,
            token,
            lookup.prerelease,
            fetchFn,
          ),
        );
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
   * Builds one row. A path or git dependency has no registry, so it shows where it comes from and no
   * latest version rather than one borrowed from a crate of the same name on crates.io.
   * @param dependency The dependency.
   * @param installed Its installed version, or null.
   * @param registries The registries.
   * @param latest The latest versions, by lookup key.
   * @returns Returns the row.
   */
  private row(
    dependency: CargoDependency,
    installed: string | null,
    registries: readonly CargoRegistry[],
    latest: ReadonlyMap<string, string | null>,
  ): InstalledPackage {
    const lookup: Lookup | null = this.lookupFor(dependency, installed, registries);
    const newest: string | null = lookup === null ? null : (latest.get(lookupKey(lookup)) ?? null);
    const baseline: string | null =
      installed ??
      (dependency.source.kind === 'registry' ? floorOf(dependency.source.requirement) : null);
    return {
      name: dependency.key,
      requested: describeRequested(dependency.source),
      installed,
      latest: newest,
      status: lookup === null ? 'unknown' : deriveStatus(baseline, newest),
      scope: scopeOf(dependency),
    };
  }
}

/**
 * Keys a lookup, so a crate several crates depend on is looked up once.
 * @param lookup The lookup.
 * @returns Returns the key.
 */
function lookupKey(lookup: Lookup): string {
  return `${lookup.registry.name}\u0000${lookup.crate.toLowerCase()}\u0000${lookup.prerelease}`;
}

/**
 * Turns a declared dependency into where a write must change it.
 * @param dependency The dependency.
 * @returns Returns its placement.
 */
function placementOf(dependency: CargoDependency): Placement {
  return {
    table: dependency.table,
    target: dependency.target,
    key: dependency.key,
    package: dependency.package,
  };
}

/**
 * Reads the config in a `.cargo` directory (or `$CARGO_HOME`): `config.toml`, or the older `config`.
 * @param directory The directory.
 * @returns Returns the config, empty when there is none.
 */
async function readConfigIn(directory: string): Promise<CargoConfig> {
  const document: TomlTable | null =
    (await readToml(path.join(directory, 'config.toml'))) ??
    (await readToml(path.join(directory, 'config')));
  return document === null ? EMPTY_CONFIG : readCargoConfig(document);
}

/**
 * Reads and parses a TOML file.
 * @param file The absolute path.
 * @returns Returns the document, or null when it is absent or cannot be read.
 */
async function readToml(file: string): Promise<TomlTable | null> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
  try {
    return parseToml(text);
  } catch {
    note('cargo', `Skipped ${path.basename(file)}: it is not TOML this plugin can read`);
    return null;
  }
}
