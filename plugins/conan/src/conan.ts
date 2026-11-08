import { Dirent, promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  Conanfile,
  ConanReference,
  ConanRequirement,
  isExactVersion,
  parseConanfilePy,
  parseConanfileTxt,
  parseLock,
} from './conanfile';
import { note } from './log';
import {
  CredentialAsk,
  HttpFetch,
  InstalledPackage,
  PackageManagerModel,
  PackageProject,
  PackageSearchItem,
  PackageSearchOptions,
  PackageSearchResult,
  PackageSourceInfo,
} from './protocol';
import { cleanQuery, searchReferences } from './registry';
import {
  basicHeaders,
  bearerHeaders,
  ConanCredential,
  conanHome,
  ConanRemote,
  isHttps,
  isPublicRemote,
  readCredentials,
  readRemotes,
} from './remotes';
import { compareVersions, deriveStatus, newestVersion } from './versions';

/**
 * The recipe file Conan prefers when a folder has both.
 */
export const CONANFILE_PY: string = 'conanfile.py';

/**
 * The plain-text conanfile.
 */
export const CONANFILE_TXT: string = 'conanfile.txt';

/**
 * The lockfile beside a conanfile.
 */
const LOCKFILE: string = 'conan.lock';

/**
 * The directories never scanned for conanfiles: dependency and build output.
 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>(['node_modules', 'build', 'out']);

/**
 * How deep to scan for conanfiles (1 searches only the root itself).
 */
const LOAD_SCAN_DEPTH: number = 6;

/**
 * How many remote queries run at once while resolving latest versions.
 */
const REGISTRY_CONCURRENCY: number = 8;

/**
 * Models Conan: reads each conanfile in a folder, resolves versions from the `conan.lock` beside it,
 * and asks the configured remotes for the latest version of each package. Read-only: a write is a
 * command for Studio to run, built in `commands.ts`.
 */
export class ConanPackageManager {
  /**
   * Holds how to ask Studio for a token saved for a remote.
   */
  private readonly credential: CredentialAsk;

  /**
   * Holds the environment the Conan home is found from.
   */
  private readonly env: Record<string, string | undefined>;

  /**
   * Holds the fetch remote requests go through.
   */
  private readonly fetchFn: HttpFetch;

  /**
   * Initializes the manager.
   * @param fetchFn The fetch remote requests go through.
   * @param credential Asks Studio for a token saved for a remote.
   * @param env The environment the Conan home is found from.
   */
  public constructor(
    fetchFn: HttpFetch,
    credential: CredentialAsk,
    env: Record<string, string | undefined>,
  ) {
    this.fetchFn = fetchFn;
    this.credential = credential;
    this.env = env;
  }

  /**
   * Builds the model for a folder: one project per folder holding a conanfile.
   * @param root The absolute folder.
   * @returns Returns the model, or null when the folder holds no conanfile.
   */
  public async load(root: string): Promise<PackageManagerModel | null> {
    const files: readonly string[] = await this.findConanfiles(root, LOAD_SCAN_DEPTH);
    if (files.length === 0) {
      return null;
    }
    const declared: Map<string, Conanfile> = new Map<string, Conanfile>();
    const names: Set<string> = new Set<string>();
    for (const file of files) {
      const text: string = (await this.readText(file)) ?? '';
      const conanfile: Conanfile =
        path.basename(file) === CONANFILE_PY ? parseConanfilePy(text) : parseConanfileTxt(text);
      declared.set(file, conanfile);
      for (const requirement of conanfile.requirements) {
        names.add(requirement.name);
      }
    }

    const remotes: readonly ConanRemote[] = await this.authorisedRemotes();
    const latest: ReadonlyMap<string, string | null> = await this.resolveLatest(names, remotes);

    const projects: PackageProject[] = [];
    for (const [file, conanfile] of declared) {
      const lockText: string | null = await this.readText(path.join(path.dirname(file), LOCKFILE));
      let lock: unknown = null;
      try {
        lock = lockText === null ? null : (JSON.parse(lockText) as unknown);
      } catch {
        note('conan', 'A conan.lock is not JSON, so it was not read');
      }
      const locked: ReadonlyMap<string, string> = parseLock(lock, compareVersions);
      projects.push({
        name: conanfile.name ?? path.basename(path.dirname(file)),
        manifestPath: file,
        packages: conanfile.requirements.map((requirement: ConanRequirement): InstalledPackage =>
          this.buildPackage(requirement, locked, latest),
        ),
      });
    }
    note('conan', `Loaded ${projects.length} conanfile(s), ${names.size} distinct package(s)`);
    return { ecosystem: 'conan', root, projects };
  }

  /**
   * Lists the remotes Conan is configured with, by name.
   * @returns Returns the sources.
   */
  public async listSources(): Promise<readonly PackageSourceInfo[]> {
    const remotes: readonly { readonly name: string }[] = await readRemotes(conanHome(this.env));
    return remotes.map((remote: { readonly name: string }): PackageSourceInfo => ({
      name: remote.name,
    }));
  }

  /**
   * Searches a remote for recipes whose name holds the query: one result per recipe at its newest
   * version, the exact name first, then names starting with it, then the rest.
   * @param sourceName The remote to search.
   * @param query The search text.
   * @param options The paging.
   * @returns Returns a page of results.
   * @throws When the remote could not answer.
   */
  public async search(
    sourceName: string,
    query: string,
    options: PackageSearchOptions,
  ): Promise<PackageSearchResult> {
    const needle: string = cleanQuery(query);
    const remote: ConanRemote | undefined = (await this.authorisedRemotes()).find(
      (candidate: ConanRemote): boolean => candidate.name === sourceName,
    );
    if (remote === undefined || needle.length === 0) {
      return { items: [], total: 0, hasMore: false };
    }
    const references: readonly ConanReference[] | null = await searchReferences(
      remote,
      `*${needle}*`,
      this.fetchFn,
    );
    if (references === null) {
      throw new Error(`The Conan remote ${remote.name} could not be searched.`);
    }
    const versions: Map<string, string[]> = new Map<string, string[]>();
    for (const reference of references) {
      versions.set(reference.name, [...(versions.get(reference.name) ?? []), reference.version]);
    }
    const rank: (name: string) => number = (name: string): number =>
      name === needle ? 0 : name.startsWith(needle) ? 1 : 2;
    const names: readonly string[] = [...versions.keys()].sort(
      (a: string, b: string): number => rank(a) - rank(b) || a.localeCompare(b),
    );
    const page: readonly PackageSearchItem[] = names
      .slice(options.skip, options.skip + options.take)
      .map((name: string): PackageSearchItem => ({
        name,
        version: newestVersion(versions.get(name) ?? []) ?? '',
        description: '',
        downloads: null,
        verified: false,
        sourceName: remote.name,
      }));
    return { items: page, total: names.length, hasMore: options.skip + page.length < names.length };
  }

  /**
   * Builds one requirement's row. The resolved version is the one `conan.lock` locked; with no lock, an
   * exact version is what Conan will resolve, and a range resolves to nothing knowable here.
   * @param requirement The requirement.
   * @param locked The locked versions by name.
   * @param latest The latest versions by name.
   * @returns Returns the row.
   */
  private buildPackage(
    requirement: ConanRequirement,
    locked: ReadonlyMap<string, string>,
    latest: ReadonlyMap<string, string | null>,
  ): InstalledPackage {
    const resolved: string | null =
      locked.get(requirement.name) ??
      (isExactVersion(requirement.version) ? requirement.version : null);
    const newest: string | null = latest.get(requirement.name) ?? null;
    return {
      name: requirement.name,
      requested: requirement.version,
      installed: resolved,
      latest: newest,
      status: deriveStatus(resolved, newest),
      scope: requirement.scope,
    };
  }

  /**
   * Reads the remotes with the credential each one's requests carry. Conan's own `credentials.json`
   * comes first; a token saved in Studio is asked for only for an https remote that has none and is not
   * ConanCenter. ⛔ Nothing is attached to a plain-http remote.
   * @returns Returns the remotes.
   */
  private async authorisedRemotes(): Promise<readonly ConanRemote[]> {
    const home: string = conanHome(this.env);
    const credentials: ReadonlyMap<string, ConanCredential> = await readCredentials(home);
    const remotes: readonly { readonly name: string; readonly url: string }[] =
      await readRemotes(home);
    return Promise.all(
      remotes.map(
        async (remote: { readonly name: string; readonly url: string }): Promise<ConanRemote> => {
          if (!isHttps(remote.url)) {
            return { ...remote, headers: {} };
          }
          const configured: ConanCredential | undefined = credentials.get(remote.name);
          if (configured !== undefined) {
            return { ...remote, headers: basicHeaders(configured) };
          }
          if (isPublicRemote(remote.url)) {
            return { ...remote, headers: {} };
          }
          const token: string | null = await this.credential(remote.url);
          return { ...remote, headers: token === null ? {} : bearerHeaders(token) };
        },
      ),
    );
  }

  /**
   * Resolves the newest version of each package from the first remote that has it, as Conan itself
   * tries its remotes in order, running a bounded number of queries at once.
   * @param names The distinct package names.
   * @param remotes The remotes, in order.
   * @returns Returns the latest version by name, null where none could be found.
   */
  private async resolveLatest(
    names: ReadonlySet<string>,
    remotes: readonly ConanRemote[],
  ): Promise<ReadonlyMap<string, string | null>> {
    const latest: Map<string, string | null> = new Map<string, string | null>();
    const queue: string[] = [...names];
    const worker: () => Promise<void> = async (): Promise<void> => {
      for (let name: string | undefined = queue.shift(); name !== undefined; name = queue.shift()) {
        latest.set(name, await this.latestOf(name, remotes));
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
   * Finds one package's newest version.
   * @param name The package name.
   * @param remotes The remotes, in order.
   * @returns Returns the newest version, or null when no remote has the package.
   */
  private async latestOf(name: string, remotes: readonly ConanRemote[]): Promise<string | null> {
    const pattern: string = cleanQuery(name);
    if (pattern !== name.toLowerCase()) {
      return null;
    }
    for (const remote of remotes) {
      const references: readonly ConanReference[] | null = await searchReferences(
        remote,
        pattern,
        this.fetchFn,
      );
      const newest: string | null = newestVersion(
        (references ?? [])
          .filter((reference: ConanReference): boolean => reference.name === name)
          .map((reference: ConanReference): string => reference.version),
      );
      if (newest !== null) {
        return newest;
      }
    }
    return null;
  }

  /**
   * Finds conanfiles under a folder, one per folder (`conanfile.py` when it has both, as Conan picks),
   * skipping hidden and output folders.
   * @param directory The folder.
   * @param depth How many levels to descend (1 searches only the folder itself).
   * @returns Returns the conanfiles' absolute paths.
   */
  private async findConanfiles(directory: string, depth: number): Promise<string[]> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }
    const files: ReadonlySet<string> = new Set<string>(
      entries
        .filter((entry: Dirent): boolean => entry.isFile())
        .map((entry: Dirent): string => entry.name),
    );
    const results: string[] = [];
    if (files.has(CONANFILE_PY)) {
      results.push(path.join(directory, CONANFILE_PY));
    } else if (files.has(CONANFILE_TXT)) {
      results.push(path.join(directory, CONANFILE_TXT));
    }
    if (depth <= 1) {
      return results;
    }
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        !entry.name.startsWith('cmake-build-') &&
        !SKIPPED_DIRECTORIES.has(entry.name)
      ) {
        results.push(...(await this.findConanfiles(path.join(directory, entry.name), depth - 1)));
      }
    }
    return results;
  }

  /**
   * Reads a text file.
   * @param file The absolute path.
   * @returns Returns its text, or null when it is absent or unreadable.
   */
  private async readText(file: string): Promise<string | null> {
    try {
      return await fs.readFile(file, 'utf8');
    } catch {
      return null;
    }
  }
}
