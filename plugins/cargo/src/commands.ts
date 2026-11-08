// Builds the commands this plugin answers a write with. It never runs one: Studio does, in a visible
// terminal, so the user reads what is about to happen and sees it happen.

import * as path from 'node:path';
import { CargoDependencyTable } from './cargo-manifest';
import { PackageCommand } from './protocol';

/**
 * Matches a crate name, or the key a dependency is declared under. Checked before one reaches an
 * argument list: a name starting with `-` would be read by cargo as an option.
 */
const CRATE_NAME: RegExp = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;

/**
 * Matches a version requirement `cargo add` takes after `@`: no spaces or leading dash, so it stays one
 * harmless argument.
 */
const VERSION_REQUIREMENT: RegExp = /^[0-9^~=<>*][0-9A-Za-z.+*^~=<>,-]*$/;

/**
 * Where an existing dependency is declared, so a write changes that entry rather than adding a new one
 * to `[dependencies]`.
 */
export interface Placement {
  /**
   * Gets the table it is in.
   */
  readonly table: CargoDependencyTable;

  /**
   * Gets the `[target.<this>]` it is under, or null.
   */
  readonly target: string | null;

  /**
   * Gets the key it is declared under.
   */
  readonly key: string;

  /**
   * Gets the crate the key names, which differs from the key when the dependency is renamed.
   */
  readonly package: string;
}

/**
 * Checks a crate name.
 * @param name The name.
 * @returns Returns the name.
 * @throws When it could be read as something other than a crate.
 */
function checked(name: string): string {
  if (!CRATE_NAME.test(name)) {
    throw new Error(`'${name}' is not a crate name.`);
  }
  return name;
}

/**
 * Builds the arguments that point cargo at an existing entry's table, target and key.
 * @param placement The entry, or null for a new one in `[dependencies]`.
 * @returns Returns the arguments.
 * @throws When the target could be read as an option.
 */
function placementArgs(placement: Placement | null): readonly string[] {
  if (placement === null) {
    return [];
  }
  const args: string[] = [];
  if (placement.table === 'dev-dependencies') {
    args.push('--dev');
  } else if (placement.table === 'build-dependencies') {
    args.push('--build');
  }
  if (placement.target !== null) {
    if (placement.target.startsWith('-') || placement.target.trim().length === 0) {
      throw new Error(`'${placement.target}' is not a target.`);
    }
    args.push('--target', placement.target);
  }
  return args;
}

/**
 * Builds the command that adds a crate to a manifest, or moves an existing entry to another version:
 * `cargo add` does both, and keeps an entry's features and other keys as they are.
 * @param manifestPath The absolute `Cargo.toml` path.
 * @param name The crate's name.
 * @param version The version requirement, or null for the newest compatible version cargo picks.
 * @param title The terminal's title.
 * @param placement The existing entry, or null to add one to `[dependencies]`.
 * @returns Returns the command.
 */
export function addCommand(
  manifestPath: string,
  name: string,
  version: string | null,
  title: string,
  placement: Placement | null,
): PackageCommand {
  if (version !== null && !VERSION_REQUIREMENT.test(version)) {
    throw new Error(`'${version}' is not a version.`);
  }
  const crate: string = checked(placement?.package ?? name);
  const renamed: readonly string[] =
    placement !== null && placement.key !== placement.package
      ? ['--rename', checked(placement.key)]
      : [];
  return {
    executable: 'cargo',
    args: [
      'add',
      version === null ? crate : `${crate}@${version}`,
      '--manifest-path',
      manifestPath,
      ...placementArgs(placement),
      ...renamed,
    ],
    cwd: path.dirname(manifestPath),
    title,
  };
}

/**
 * Builds the command that removes a dependency from a manifest.
 * @param manifestPath The absolute `Cargo.toml` path.
 * @param placement The entry.
 * @returns Returns the command.
 */
export function removeCommand(manifestPath: string, placement: Placement): PackageCommand {
  return {
    executable: 'cargo',
    args: [
      'remove',
      checked(placement.key),
      '--manifest-path',
      manifestPath,
      ...placementArgs(placement),
    ],
    cwd: path.dirname(manifestPath),
    title: `Remove ${placement.key}`,
  };
}

/**
 * Builds the command that fetches everything a manifest's workspace depends on.
 * @param manifestPath The absolute `Cargo.toml` path.
 * @returns Returns the command.
 */
export function restoreCommand(manifestPath: string): PackageCommand {
  return {
    executable: 'cargo',
    args: ['fetch', '--manifest-path', manifestPath],
    cwd: path.dirname(manifestPath),
    title: 'Fetch crates',
  };
}
