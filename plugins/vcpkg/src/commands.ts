// Builds the commands this plugin answers a write with. It never runs one: Studio does, in a visible
// terminal, so the user reads what is about to happen and sees it happen.
//
// vcpkg has two commands that fit: `vcpkg add port` writes a dependency into `vcpkg.json`, and
// `vcpkg install` in a manifest's folder installs what it declares. It has no command that removes a
// dependency or moves one to another version — that is an edit to `vcpkg.json` (an override, or a new
// `builtin-baseline`) — so neither is offered.

import * as path from 'node:path';
import { PackageCommand } from './protocol';
import { MANIFEST } from './vcpkg';

/**
 * Matches a vcpkg port name: lower-case letters, digits and single dashes, as vcpkg requires. Checked
 * before a name reaches an argument list, so one starting with `-` cannot be read as an option and a
 * `name[feature]` cannot smuggle anything in.
 */
const PORT_NAME: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Matches a version as the panel may send one: no spaces or leading dash.
 */
const VERSION: RegExp = /^[A-Za-z0-9][A-Za-z0-9.#+_-]*$/;

/**
 * Checks that a project is a vcpkg manifest and answers its folder.
 * @param project The manifest's absolute path.
 * @returns Returns the folder.
 * @throws When the project is not a `vcpkg.json`.
 */
function manifestFolder(project: string): string {
  if (!path.isAbsolute(project) || path.basename(project) !== MANIFEST) {
    throw new Error('vcpkg commands run against a vcpkg.json.');
  }
  return path.dirname(project);
}

/**
 * Builds the command that adds a port to a manifest: `vcpkg add port <name>`. vcpkg adds it at the
 * version the manifest's baseline gives, and takes no version: one sent is checked and otherwise left
 * alone, because pinning is an override in `vcpkg.json`, which no command writes.
 * @param project The manifest's absolute path.
 * @param name The port name.
 * @param version The version asked for, or null.
 * @returns Returns the command.
 * @throws When the name is not a port name, or the version could be read as an option.
 */
export function addPortCommand(
  project: string,
  name: string,
  version: string | null,
): PackageCommand {
  if (!PORT_NAME.test(name)) {
    throw new Error(`'${name}' is not a vcpkg port name.`);
  }
  if (version !== null && !VERSION.test(version)) {
    throw new Error(`'${version}' is not a version.`);
  }
  return {
    executable: 'vcpkg',
    args: ['add', 'port', name],
    cwd: manifestFolder(project),
    title: `Add ${name}`,
  };
}

/**
 * Builds the command that installs what a manifest declares: `vcpkg install`, which in a folder holding
 * a `vcpkg.json` runs in manifest mode and installs into its `vcpkg_installed`.
 * @param project The manifest's absolute path.
 * @returns Returns the command.
 */
export function installCommand(project: string): PackageCommand {
  return {
    executable: 'vcpkg',
    args: ['install'],
    cwd: manifestFolder(project),
    title: 'Install vcpkg dependencies',
  };
}
