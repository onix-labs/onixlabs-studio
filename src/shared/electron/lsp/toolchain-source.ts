import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { Launcher, launchStudioOwned } from '../process/launch';
import { metadataAsSourcePath } from './metadata-as-source';

/**
 * Starts the `go env` that says where Go keeps its files, as a process Studio owns.
 */
const launch: Launcher = launchStudioOwned('server-provisioning');

/**
 * Runs a program and resolves with what it printed.
 */
const execFileAsync: (
  file: string,
  args: readonly string[],
  options?: { timeout?: number },
) => Promise<{ stdout: string; stderr: string }> = promisify(launch.execFile);

/**
 * Where the Rust toolchain keeps source a language server answers Go to Definition with (#1210).
 */
export interface ToolchainFolders {
  /**
   * Gets rustup's folder: `RUSTUP_HOME`, or `.rustup` in the home folder.
   */
  readonly rustup: string;

  /**
   * Gets Cargo's folder: `CARGO_HOME`, or `.cargo` in the home folder.
   */
  readonly cargo: string;
}

/**
 * Gets the toolchain's folders as the language server sees them: it inherits Studio's environment.
 * @returns Returns the folders.
 */
function toolchainFolders(): ToolchainFolders {
  return {
    rustup: process.env['RUSTUP_HOME'] ?? path.join(homedir(), '.rustup'),
    cargo: process.env['CARGO_HOME'] ?? path.join(homedir(), '.cargo'),
  };
}

/**
 * Gets a path's parts below a folder, or null when it is not inside it.
 * @param folder The folder, which need not exist.
 * @param real The path, real already.
 * @returns Returns the parts, or null.
 */
async function partsBelow(folder: string, real: string): Promise<readonly string[] | null> {
  // An empty or relative folder would resolve against the working folder, `/` when packaged.
  if (!path.isAbsolute(folder)) {
    return null;
  }
  let root: string;
  try {
    root = await fs.realpath(folder);
  } catch {
    return null;
  }
  const relative: string = path.relative(root, real);
  return relative === '' || relative.startsWith('..') || path.isAbsolute(relative)
    ? null
    : relative.split(path.sep);
}

/**
 * Decides whether a path is Rust source that belongs to the toolchain: a `.rs` file whose **real** path
 * lies in a toolchain's standard library (`<rustup>/toolchains/<name>/lib/rustlib/src/`) or in a crate
 * Cargo downloaded (`<cargo>/registry/src/`, `<cargo>/git/checkouts/`). Go to Definition lands there
 * for anything from `std` or a dependency.
 *
 * Deliberately narrow, as it lets a file outside every workspace be read: only source, in only those
 * folders, resolved first so a link planted in one cannot name a file elsewhere. Cargo's folder holds
 * more than sources, its credentials among them, and none of that is reachable from here.
 * @param filePath The path, untrusted.
 * @param folders Where the toolchain keeps its files; overridable for tests.
 * @returns Returns the resolved real path when it is toolchain source, otherwise null.
 */
export async function toolchainSourcePath(
  filePath: unknown,
  folders: ToolchainFolders = toolchainFolders(),
): Promise<string | null> {
  if (
    typeof filePath !== 'string' ||
    !path.isAbsolute(filePath) ||
    path.extname(filePath) !== '.rs'
  ) {
    return null;
  }
  let real: string;
  try {
    real = await fs.realpath(filePath);
  } catch {
    return null;
  }
  if (path.extname(real) !== '.rs') {
    return null;
  }
  const rustup: readonly string[] | null = await partsBelow(folders.rustup, real);
  if (
    rustup !== null &&
    rustup[0] === 'toolchains' &&
    rustup.slice(2, 5).join('/') === 'lib/rustlib/src'
  ) {
    return real;
  }
  const cargo: readonly string[] | null = await partsBelow(folders.cargo, real);
  const area: string | undefined = cargo?.slice(0, 2).join('/');
  return area === 'registry/src' || area === 'git/checkouts' ? real : null;
}

/**
 * Where Go keeps source gopls answers Go to Definition with (#1211).
 */
export interface GoFolders {
  /**
   * Gets the Go installations whose standard library may be read (each a `GOROOT`).
   */
  readonly roots: readonly string[];

  /**
   * Gets the module cache, where the dependencies Go downloaded are unpacked (`GOMODCACHE`), or null
   * when it is not known.
   */
  readonly modules: string | null;
}

/**
 * What `go env` says of where Go keeps its files, or null when no Go answered.
 */
export interface GoEnvAnswer {
  /**
   * Gets the installation (`GOROOT`), as Go reported it.
   */
  readonly GOROOT?: unknown;

  /**
   * Gets the module cache (`GOMODCACHE`), as Go reported it.
   */
  readonly GOMODCACHE?: unknown;
}

/**
 * Asks a Go for its folders.
 */
export type GoEnvReader = () => Promise<GoEnvAnswer | null>;

/**
 * Holds how long `go env` is given to answer before the environment is used instead.
 */
const GO_ENV_TIMEOUT_MS: number = 5000;

/**
 * Holds the folders once found: Go's installation and module cache do not move while Studio runs.
 */
let cachedGoFolders: Promise<GoFolders> | null = null;

/**
 * Reads a setting that names a folder: an absolute path, or nothing. An empty or relative value is
 * treated as unset, as a folder resolved from one would be the process's own working folder (`/` when
 * packaged), and everything below it would pass for Go's source.
 * @param value The value.
 * @returns Returns the folder, or null.
 */
function folderOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' && path.isAbsolute(value) ? value : null;
}

/**
 * Asks the Go Studio would run for its installation and module cache, with `go env`: `GOROOT`'s, the
 * one on the PATH, then the places the provisioner looks, the first that answers in time.
 * @returns Returns its answer, or null when none answered.
 */
async function readGoEnv(): Promise<GoEnvAnswer | null> {
  const executable: string = process.platform === 'win32' ? 'go.exe' : 'go';
  const goRoot: string | null = folderOf(process.env['GOROOT']);
  const candidates: readonly string[] = [
    ...(goRoot === null ? [] : [path.join(goRoot, 'bin', executable)]),
    executable,
    ...(process.platform === 'win32'
      ? [path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Go', 'bin', executable)]
      : ['/usr/local/go/bin/go', '/opt/homebrew/bin/go', '/usr/local/bin/go']),
  ];
  for (const candidate of candidates) {
    try {
      const { stdout }: { stdout: string } = await execFileAsync(
        candidate,
        ['env', '-json', 'GOROOT', 'GOMODCACHE'],
        { timeout: GO_ENV_TIMEOUT_MS },
      );
      const answer: unknown = JSON.parse(stdout);
      if (typeof answer === 'object' && answer !== null) {
        return answer;
      }
    } catch {
      // Not this one: try the next.
    }
  }
  return null;
}

/**
 * Works out Go's folders (#1211): what `go env` says, and failing that the environment — `GOROOT`;
 * `GOMODCACHE`, else the first `GOPATH` entry's `pkg/mod`, else `~/go/pkg/mod`, as Go defaults it.
 * Only absolute paths are taken, an empty or relative setting counting as unset.
 * @param env The environment.
 * @param readEnv Asks a Go for its folders.
 * @param home The home folder.
 * @returns Returns the folders.
 */
export async function resolveGoFolders(
  env: Readonly<Record<string, string | undefined>>,
  readEnv: GoEnvReader,
  home: string = homedir(),
): Promise<GoFolders> {
  const answer: GoEnvAnswer | null = await readEnv();
  const roots: readonly string[] = [folderOf(answer?.GOROOT), folderOf(env['GOROOT'])].filter(
    (root: string | null): root is string => root !== null,
  );
  const goPath: string | null =
    (env['GOPATH'] ?? '')
      .split(path.delimiter)
      .map(folderOf)
      .find((folder: string | null): folder is string => folder !== null) ?? null;
  const modules: string | null =
    folderOf(answer?.GOMODCACHE) ??
    folderOf(env['GOMODCACHE']) ??
    folderOf(path.join(goPath ?? path.join(home, 'go'), 'pkg', 'mod'));
  return { roots: [...new Set<string>(roots)], modules };
}

/**
 * Gets Go's folders, found once.
 * @returns Returns the folders.
 */
function goFolders(): Promise<GoFolders> {
  cachedGoFolders ??= resolveGoFolders(process.env, readGoEnv);
  return cachedGoFolders;
}

/**
 * Decides whether a path is Go source that belongs to the toolchain or a dependency (#1211): a `.go`
 * file whose **real** path lies in a Go installation's standard library (`<GOROOT>/src/`) or in the
 * module cache (`<GOMODCACHE>/`, outside its `cache/` of downloads). Go to Definition lands there for
 * anything from the standard library or a module the workspace requires.
 *
 * As narrow as the Rust rule: only `.go` source, in only those folders, resolved first so a link
 * planted in one cannot name a file elsewhere.
 * @param filePath The path, untrusted.
 * @param folders Where Go keeps its files; overridable for tests.
 * @returns Returns the resolved real path when it is Go toolchain or module source, otherwise null.
 */
export async function goSourcePath(filePath: unknown, folders?: GoFolders): Promise<string | null> {
  if (
    typeof filePath !== 'string' ||
    !path.isAbsolute(filePath) ||
    path.extname(filePath) !== '.go'
  ) {
    return null;
  }
  let real: string;
  try {
    real = await fs.realpath(filePath);
  } catch {
    return null;
  }
  if (path.extname(real) !== '.go') {
    return null;
  }
  const where: GoFolders = folders ?? (await goFolders());
  const modules: readonly string[] | null =
    where.modules === null ? null : await partsBelow(where.modules, real);
  if (modules !== null && modules[0] !== 'cache') {
    return real;
  }
  for (const root of where.roots) {
    const parts: readonly string[] | null = await partsBelow(root, real);
    if (parts !== null && parts[0] === 'src') {
      return real;
    }
  }
  return null;
}

/**
 * Decides whether a path is source a language server navigates to outside every workspace, which the
 * editor may open only to read: a decompiled source (#1133), the Rust toolchain's (#1210), or Go's
 * standard library or module cache (#1211).
 * @param filePath The path, untrusted.
 * @returns Returns the resolved real path when it is, otherwise null.
 */
export async function readOnlySourcePath(filePath: unknown): Promise<string | null> {
  return (
    (await metadataAsSourcePath(filePath)) ??
    (await toolchainSourcePath(filePath)) ??
    (await goSourcePath(filePath))
  );
}
