import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { metadataAsSourcePath } from './metadata-as-source';

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
   * Gets the module cache, where the dependencies Go downloaded are unpacked (`GOMODCACHE`).
   */
  readonly modules: string;
}

/**
 * Gets Go's folders as gopls sees them: it inherits Studio's environment, and runs the Go that Studio
 * finds — `GOROOT`'s, or one in the places the provisioner looks — whose installation is the folder
 * two above the real executable (Homebrew's `/usr/local/bin/go` is a link into its own `libexec`).
 * @returns Returns the folders.
 */
async function goFolders(): Promise<GoFolders> {
  const executable: string = process.platform === 'win32' ? 'go.exe' : 'go';
  const candidates: string[] = [
    ...(process.env['PATH'] ?? '')
      .split(path.delimiter)
      .filter((folder: string): boolean => folder !== '')
      .map((folder: string): string => path.join(folder, executable)),
    ...(process.platform === 'win32'
      ? [path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Go', 'bin', executable)]
      : ['/usr/local/go/bin/go', '/opt/homebrew/bin/go', '/usr/local/bin/go']),
  ];
  const found: readonly (string | null)[] = await Promise.all(
    candidates.map(async (candidate: string): Promise<string | null> => {
      try {
        return path.dirname(path.dirname(await fs.realpath(candidate)));
      } catch {
        return null;
      }
    }),
  );
  const goRoot: string | undefined = process.env['GOROOT'];
  const roots: string[] = [
    ...(goRoot !== undefined && goRoot !== '' ? [goRoot] : []),
    ...found.filter((root: string | null): root is string => root !== null),
  ];
  const goPath: string | undefined = process.env['GOPATH']
    ?.split(path.delimiter)
    .find((folder: string): boolean => folder !== '');
  return {
    roots: [...new Set<string>(roots)],
    modules:
      process.env['GOMODCACHE'] ?? path.join(goPath ?? path.join(homedir(), 'go'), 'pkg', 'mod'),
  };
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
  const modules: readonly string[] | null = await partsBelow(where.modules, real);
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
