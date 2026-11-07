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
 * Decides whether a path is source a language server navigates to outside every workspace, which the
 * editor may open only to read: a decompiled source (#1133), or the Rust toolchain's (#1210).
 * @param filePath The path, untrusted.
 * @returns Returns the resolved real path when it is, otherwise null.
 */
export async function readOnlySourcePath(filePath: unknown): Promise<string | null> {
  return (await metadataAsSourcePath(filePath)) ?? (await toolchainSourcePath(filePath));
}
