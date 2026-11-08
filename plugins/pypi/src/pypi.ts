import { Dirent, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { PythonTool } from './commands';
import {
  findVirtualEnvironment,
  readPipfileLock,
  readTomlLock,
  readVirtualEnvironment,
} from './installed';
import { note } from './log';
import {
  DeclaredPackage,
  Pyproject,
  readPipfile,
  readPyproject,
  readSetupCfg,
  readSetupPy,
  scopeOf,
} from './manifests';
import { basicAuthorization, PipIndex, readPipIndexes } from './pip-config';
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
import { lookUpPackage, PackageFacts } from './registry';
import {
  isPackageName,
  normaliseName,
  readRequirementsFile,
  Requirement,
  RequirementsFile,
} from './requirements';
import { compareVersions, deriveStatus } from './versions';

/**
 * The kinds of manifest a Python project is declared in.
 */
export type ManifestKind = 'pyproject' | 'pipfile' | 'setup.cfg' | 'setup.py' | 'requirements';

/**
 * A project found in a folder: its manifest, what it declares, and the tool that manages it.
 */
export interface PythonProject {
  /**
   * Gets the project's display name.
   */
  readonly name: string;

  /**
   * Gets the absolute path of its manifest.
   */
  readonly manifestPath: string;

  /**
   * Gets the kind of manifest it is.
   */
  readonly kind: ManifestKind;

  /**
   * Gets the packages it declares, with the scope each is under.
   */
  readonly declared: readonly ScopedPackage[];

  /**
   * Gets the tool that manages it, or null when nothing says which does.
   */
  readonly tool: PythonTool | null;

  /**
   * Gets the lockfile beside it or above it that its tool keeps, or null.
   */
  readonly lockfile: string | null;

  /**
   * Gets the virtual environment beside it or above it, or null.
   */
  readonly venv: string | null;
}

/**
 * A declared package with the scope it is shown under.
 */
export type ScopedPackage = DeclaredPackage & {
  /**
   * Gets the scope.
   */
  readonly scope: InstalledPackage['scope'];
};

/**
 * The lockfiles a `pyproject.toml` project's tool keeps, with the tool each says it is.
 */
const PYPROJECT_LOCKS: readonly { readonly file: string; readonly tool: PythonTool }[] = [
  { file: 'uv.lock', tool: 'uv' },
  { file: 'poetry.lock', tool: 'poetry' },
];

/**
 * The files a folder's package metadata can be in, the one preferred first.
 */
const METADATA_MANIFESTS: readonly (readonly [string, ManifestKind])[] = [
  ['pyproject.toml', 'pyproject'],
  ['setup.cfg', 'setup.cfg'],
  ['setup.py', 'setup.py'],
];

/**
 * The lockfile Pipenv keeps.
 */
const PIPFILE_LOCK: string = 'Pipfile.lock';

/**
 * Matches a requirements file's name, as the plugin's marker does.
 */
const REQUIREMENTS_FILE: RegExp = /^requirements.*\.txt$/i;

/**
 * Matches a requirements file meant for development rather than for running the project, by the names
 * people give them: `requirements-dev.txt`, `requirements_test.txt`, `requirements-docs.txt`, ….
 */
const DEVELOPMENT_REQUIREMENTS: RegExp =
  /(^|[-_.])(dev|develop|development|test|tests|testing|lint|docs?|ci)([-_.]|$)/i;

/**
 * The folders never looked in for projects: dependency, cache and build output.
 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  'node_modules',
  '__pycache__',
  'site-packages',
  'build',
  'dist',
]);

/**
 * How deep projects are looked for (1 is the folder itself): deep enough for a monorepo's
 * `packages/name/pyproject.toml`, bounded so a large tree cannot run away.
 */
const LOAD_SCAN_DEPTH: number = 5;

/**
 * How many folders the scan reads at most.
 */
const MAX_SCANNED_DIRECTORIES: number = 2_000;

/**
 * How many index requests run at once while resolving latest versions.
 */
const REGISTRY_CONCURRENCY: number = 8;

/**
 * Models Python projects: finds each in a folder, reads what it declares, what its lockfile or virtual
 * environment has installed, and what the configured indexes offer. Read-only: a write is a command
 * for Studio to run, built in `commands.ts`.
 */
export class PypiPackageManager {
  /**
   * Holds how to ask Studio for a token saved for an index.
   */
  private readonly credential: CredentialAsk;

  /**
   * Holds the plugin's environment, which Studio has cut down to an allow-list.
   */
  private readonly env: Readonly<Record<string, string | undefined>>;

  /**
   * Initializes the manager.
   * @param credential Asks Studio for a token saved for an index.
   * @param env The plugin's environment.
   */
  public constructor(
    credential: CredentialAsk = (): Promise<string | null> => Promise.resolve(null),
    env: Readonly<Record<string, string | undefined>> = {},
  ) {
    this.credential = credential;
    this.env = env;
  }

  /**
   * Builds the model of a folder: each Python project in it, each declared package resolved to its
   * installed and latest versions.
   * @param root The absolute folder.
   * @param fetchFn The fetch index requests go through.
   * @returns Returns the model, or null when the folder holds no Python project.
   */
  public async load(root: string, fetchFn: HttpFetch): Promise<PackageManagerModel | null> {
    const projects: readonly PythonProject[] = await this.findProjects(root);
    if (projects.length === 0) {
      return null;
    }
    const names: Map<string, string> = new Map<string, string>();
    for (const project of projects) {
      for (const declared of project.declared) {
        if (declared.fromIndex) {
          names.set(normaliseName(declared.name), declared.name);
        }
      }
    }
    const indexes: readonly PipIndex[] = await this.authorisedIndexes();
    const latest: ReadonlyMap<string, string | null> = await this.resolveLatest(
      [...names.values()],
      indexes,
      fetchFn,
    );

    const installedCache: Map<string, Promise<ReadonlyMap<string, string>>> = new Map<
      string,
      Promise<ReadonlyMap<string, string>>
    >();
    const modelled: PackageProject[] = [];
    for (const project of projects) {
      const source: string | null = project.lockfile ?? project.venv;
      if (source !== null && !installedCache.has(source)) {
        installedCache.set(source, this.readInstalled(source));
      }
      const installed: ReadonlyMap<string, string> =
        source === null ? new Map<string, string>() : await installedCache.get(source)!;
      modelled.push({
        name: project.name,
        manifestPath: project.manifestPath,
        packages: project.declared.map((declared: ScopedPackage): InstalledPackage => {
          const key: string = normaliseName(declared.name);
          const installedVersion: string | null = installed.get(key) ?? null;
          const latestVersion: string | null = declared.fromIndex
            ? (latest.get(key) ?? null)
            : null;
          return {
            name: declared.name,
            requested: declared.requested,
            installed: installedVersion,
            latest: latestVersion,
            status: deriveStatus(installedVersion, latestVersion),
            scope: declared.scope,
          };
        }),
      });
    }
    note('pypi', `Loaded ${modelled.length} project(s), ${names.size} distinct package(s)`);
    return { ecosystem: 'pypi', root, projects: modelled };
  }

  /**
   * Lists the indexes a folder can look names up in. Names only.
   * @returns Returns the sources.
   */
  public async listSources(): Promise<readonly PackageSourceInfo[]> {
    return (await readPipIndexes(this.env)).map((index: PipIndex): PackageSourceInfo => ({
      name: index.name,
    }));
  }

  /**
   * Looks one exact name up in a named index: no index this plugin speaks to has a search, so the
   * answer is that package or nothing.
   * @param sourceName The index.
   * @param query The name.
   * @param options The paging; anything past the first page is empty, since there is one answer.
   * @param fetchFn The fetch index requests go through.
   * @returns Returns the page.
   */
  public async search(
    sourceName: string,
    query: string,
    options: PackageSearchOptions,
    fetchFn: HttpFetch,
  ): Promise<PackageSearchResult> {
    const none: PackageSearchResult = { items: [], total: 0, hasMore: false };
    const name: string = query.trim();
    if (options.skip > 0 || options.take < 1 || !isPackageName(name)) {
      return none;
    }
    const index: PipIndex | undefined = (await this.authorisedIndexes()).find(
      (candidate: PipIndex): boolean => candidate.name === sourceName,
    );
    if (index === undefined) {
      note('pypi', 'A search named an index this folder does not have');
      return none;
    }
    const facts: PackageFacts | null = await lookUpPackage(name, index, fetchFn);
    if (facts === null) {
      return none;
    }
    if (facts.latest === null) {
      return none;
    }
    return {
      items: [
        {
          name: facts.name,
          version: facts.latest,
          description: facts.summary,
          downloads: null,
          verified: false,
          sourceName: index.name,
        },
      ],
      total: 1,
      hasMore: false,
    };
  }

  /**
   * Finds every Python project in a folder.
   * @param root The absolute folder.
   * @returns Returns the projects, in the order their folders were found.
   */
  public async findProjects(root: string): Promise<readonly PythonProject[]> {
    const projects: PythonProject[] = [];
    let level: readonly string[] = [root];
    let read: number = 0;
    for (let depth: number = 1; depth <= LOAD_SCAN_DEPTH && level.length > 0; depth += 1) {
      const next: string[] = [];
      for (const directory of level) {
        if (read >= MAX_SCANNED_DIRECTORIES) {
          return projects;
        }
        read += 1;
        const entries: readonly Dirent[] = await list(directory);
        const files: ReadonlySet<string> = new Set<string>(
          entries
            .filter((entry: Dirent): boolean => entry.isFile())
            .map((entry: Dirent): string => entry.name),
        );
        if (files.has('pyvenv.cfg')) {
          // A virtual environment under its own name: its packages are installed, not declared.
          continue;
        }
        projects.push(...(await this.projectsIn(directory, files, root)));
        for (const entry of entries) {
          if (
            entry.isDirectory() &&
            !entry.name.startsWith('.') &&
            !SKIPPED_DIRECTORIES.has(entry.name)
          ) {
            next.push(path.join(directory, entry.name));
          }
        }
      }
      level = next;
    }
    return projects;
  }

  /**
   * Reads the project a manifest path names, as a write needs it.
   * @param root The absolute folder.
   * @param manifestPath The absolute manifest path.
   * @returns Returns the project, or null when the path is not a manifest this plugin reads.
   */
  public async projectAt(root: string, manifestPath: string): Promise<PythonProject | null> {
    const directory: string = path.dirname(manifestPath);
    const file: string = path.basename(manifestPath);
    const files: ReadonlySet<string> = new Set<string>(
      (await list(directory))
        .filter((entry: Dirent): boolean => entry.isFile())
        .map((entry: Dirent): string => entry.name),
    );
    if (!files.has(file)) {
      return null;
    }
    const kind: ManifestKind | null = kindOf(file);
    return kind === null ? null : this.readProject(directory, file, kind, root);
  }

  /**
   * Reads the projects one folder holds: its package metadata (`pyproject.toml`, else `setup.cfg`,
   * else `setup.py`, whichever declares something) as one project, its `Pipfile` as another, and each
   * requirements file as one more, since each is installed on its own.
   * @param directory The absolute folder.
   * @param files The file names in it.
   * @param root The absolute folder the request names.
   * @returns Returns the projects.
   */
  private async projectsIn(
    directory: string,
    files: ReadonlySet<string>,
    root: string,
  ): Promise<readonly PythonProject[]> {
    const projects: PythonProject[] = [];
    const metadata: readonly (readonly [string, ManifestKind])[] = METADATA_MANIFESTS.filter(
      ([file]: readonly [string, ManifestKind]): boolean => files.has(file),
    );
    let chosen: PythonProject | null = null;
    for (const [file, kind] of metadata) {
      const project: PythonProject | null = await this.readProject(directory, file, kind, root);
      if (
        project !== null &&
        (chosen === null || (chosen.declared.length === 0 && project.declared.length > 0))
      ) {
        chosen = project;
      }
    }
    if (chosen !== null) {
      projects.push(chosen);
    }
    if (files.has('Pipfile')) {
      const pipfile: PythonProject | null = await this.readProject(
        directory,
        'Pipfile',
        'pipfile',
        root,
      );
      if (pipfile !== null) {
        projects.push(pipfile);
      }
    }
    for (const file of [...files]
      .filter((name: string): boolean => REQUIREMENTS_FILE.test(name))
      .sort()) {
      const requirements: PythonProject | null = await this.readProject(
        directory,
        file,
        'requirements',
        root,
      );
      if (requirements !== null) {
        projects.push(requirements);
      }
    }
    return projects;
  }

  /**
   * Reads one project from its manifest.
   * @param directory The absolute folder it is in.
   * @param file The manifest's file name.
   * @param kind The kind of manifest.
   * @param root The absolute folder the request names.
   * @returns Returns the project, or null when the manifest cannot be read.
   */
  private async readProject(
    directory: string,
    file: string,
    kind: ManifestKind,
    root: string,
  ): Promise<PythonProject | null> {
    const manifestPath: string = path.join(directory, file);
    const folder: string = path.basename(directory);
    const base: Omit<PythonProject, 'declared' | 'tool' | 'lockfile' | 'name'> = {
      manifestPath,
      kind,
      venv: await this.nearest(directory, root, findVirtualEnvironment),
    };
    if (kind === 'requirements') {
      const read: RequirementsFile | null = await readRequirementsFile(
        manifestPath,
        root,
        readText,
      );
      if (read === null) {
        return null;
      }
      if (read.skipped > 0) {
        note(
          'pypi',
          `Skipped ${read.skipped} line(s) of ${file} that are not packages from an index`,
        );
      }
      const scope: InstalledPackage['scope'] = DEVELOPMENT_REQUIREMENTS.test(
        file.replace(/\.txt$/i, ''),
      )
        ? 'development'
        : 'production';
      return {
        ...base,
        name: `${folder} (${file})`,
        declared: read.requirements.map((requirement: Requirement): ScopedPackage => ({
          name: requirement.name,
          requested: requirement.requested,
          fromIndex: requirement.kind === 'index',
          placement: { kind: 'main' },
          scope,
        })),
        tool: 'pip',
        lockfile: null,
      };
    }
    const text: string | null = await readText(manifestPath);
    if (text === null) {
      return null;
    }
    if (kind === 'pipfile') {
      const declared: readonly DeclaredPackage[] | null = readPipfile(text);
      if (declared === null) {
        note('pypi', `${file} could not be read`);
        return null;
      }
      const lock: string = path.join(directory, PIPFILE_LOCK);
      return {
        ...base,
        name: `${folder} (${file})`,
        declared: declared.map(scoped),
        tool: 'pipenv',
        lockfile: (await exists(lock)) ? lock : null,
      };
    }
    if (kind === 'pyproject') {
      const pyproject: Pyproject | null = readPyproject(text);
      if (pyproject === null) {
        note('pypi', `${file} could not be read`);
        return null;
      }
      const lock: { readonly file: string; readonly tool: PythonTool } | null =
        await this.nearestLock(directory, root);
      const tool: PythonTool | null =
        lock?.tool ?? (pyproject.usesUv ? 'uv' : pyproject.usesPoetry ? 'poetry' : null);
      return {
        ...base,
        name: pyproject.name ?? folder,
        declared: pyproject.packages.map(scoped),
        tool,
        lockfile: lock?.file ?? null,
      };
    }
    return {
      ...base,
      name: `${folder} (${file})`,
      declared: (kind === 'setup.cfg' ? readSetupCfg(text) : readSetupPy(text)).map(scoped),
      tool: null,
      lockfile: null,
    };
  }

  /**
   * Finds the nearest `uv.lock` or `poetry.lock` from a project's folder up to the root: a uv
   * workspace keeps one lockfile at its top for every member.
   * @param directory The project's folder.
   * @param root The absolute folder the request names.
   * @returns Returns the lockfile and the tool it says manages the project, or null.
   */
  private async nearestLock(
    directory: string,
    root: string,
  ): Promise<{ readonly file: string; readonly tool: PythonTool } | null> {
    return this.nearest(
      directory,
      root,
      async (
        folder: string,
      ): Promise<{ readonly file: string; readonly tool: PythonTool } | null> => {
        for (const lock of PYPROJECT_LOCKS) {
          const file: string = path.join(folder, lock.file);
          if (await exists(file)) {
            return { file, tool: lock.tool };
          }
        }
        return null;
      },
    );
  }

  /**
   * Looks for something in a folder and each folder above it, up to and including the root.
   * @param directory The folder to start in.
   * @param root The absolute folder the request names, the highest looked in.
   * @param find Looks in one folder.
   * @returns Returns the first found, or null.
   */
  private async nearest<T>(
    directory: string,
    root: string,
    find: (folder: string) => Promise<T | null>,
  ): Promise<T | null> {
    for (let folder: string = directory; ; folder = path.dirname(folder)) {
      const found: T | null = await find(folder);
      if (found !== null) {
        return found;
      }
      if (folder === root || !folder.startsWith(root + path.sep)) {
        return null;
      }
    }
  }

  /**
   * Reads the installed versions from a lockfile or a virtual environment.
   * @param source The absolute path of the lockfile or environment.
   * @returns Returns the versions by normalised name.
   */
  private async readInstalled(source: string): Promise<ReadonlyMap<string, string>> {
    const file: string = path.basename(source);
    if (file === PIPFILE_LOCK || file.endsWith('.lock')) {
      const text: string | null = await readText(source);
      if (text === null) {
        return new Map<string, string>();
      }
      return file === PIPFILE_LOCK ? readPipfileLock(text) : readTomlLock(text);
    }
    return readVirtualEnvironment(source);
  }

  /**
   * Reads the configured indexes and adds a token saved in Studio to a private https index whose
   * configuration holds no credential. PyPI is left alone, so an ordinary lookup never asks Studio for
   * anything, and so is any index that is not https (the host would refuse the ask in any case).
   * @returns Returns the indexes.
   */
  private async authorisedIndexes(): Promise<readonly PipIndex[]> {
    const indexes: PipIndex[] = [];
    for (const index of await readPipIndexes(this.env)) {
      if (
        index.isPypi ||
        index.headers['Authorization'] !== undefined ||
        !index.url.startsWith('https://')
      ) {
        indexes.push(index);
        continue;
      }
      const token: string | null = await this.credential(index.url);
      // Python indexes take a token as the password of HTTP basic authorization; `__token__` is the
      // user name PyPI-style indexes expect, and the others ignore it.
      indexes.push(
        token === null ? index : { ...index, headers: basicAuthorization('__token__', token) },
      );
    }
    return indexes;
  }

  /**
   * Resolves the newest release of each name across every configured index, as pip would choose
   * among them, a bounded number of requests at once.
   * @param names The package names.
   * @param indexes The indexes.
   * @param fetchFn The fetch.
   * @returns Returns the latest version by normalised name, null where no index answered.
   */
  private async resolveLatest(
    names: readonly string[],
    indexes: readonly PipIndex[],
    fetchFn: HttpFetch,
  ): Promise<ReadonlyMap<string, string | null>> {
    const latest: Map<string, string | null> = new Map<string, string | null>();
    const queue: string[] = [...names];
    const worker: () => Promise<void> = async (): Promise<void> => {
      for (let name: string | undefined = queue.shift(); name !== undefined; name = queue.shift()) {
        let best: string | null = null;
        for (const index of indexes) {
          const version: string | null =
            (await lookUpPackage(name, index, fetchFn))?.latest ?? null;
          if (version !== null && (best === null || compareVersions(version, best) > 0)) {
            best = version;
          }
        }
        latest.set(normaliseName(name), best);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(REGISTRY_CONCURRENCY, queue.length) }, (): Promise<void> =>
        worker(),
      ),
    );
    return latest;
  }
}

/**
 * Says which kind of manifest a file name is.
 * @param file The file name.
 * @returns Returns the kind, or null when it is not a manifest this plugin reads.
 */
export function kindOf(file: string): ManifestKind | null {
  switch (file) {
    case 'pyproject.toml':
      return 'pyproject';
    case 'Pipfile':
      return 'pipfile';
    case 'setup.cfg':
      return 'setup.cfg';
    case 'setup.py':
      return 'setup.py';
    default:
      return REQUIREMENTS_FILE.test(file) ? 'requirements' : null;
  }
}

/**
 * Gives a declared package the scope its placement maps to.
 * @param declared The package.
 * @returns Returns it with its scope.
 */
function scoped(declared: DeclaredPackage): ScopedPackage {
  return { ...declared, scope: scopeOf(declared.placement) };
}

/**
 * Lists a folder, or nothing when it cannot be read.
 * @param directory The folder.
 * @returns Returns its entries.
 */
async function list(directory: string): Promise<readonly Dirent[]> {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Reads a text file, or null when it is absent or unreadable.
 * @param filePath The path.
 * @returns Returns the text, or null.
 */
async function readText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Determines whether a file exists.
 * @param filePath The path.
 * @returns Returns true when it does.
 */
async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
