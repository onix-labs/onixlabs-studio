// Builds the commands this plugin answers a write with. It never runs one: Studio does, in a visible
// terminal, so the user reads what is about to happen and sees it happen.
//
// Every write is the go command in the module's own directory, which is what makes it act on that
// module, inside a go.work workspace as much as outside one:
// - install and update: `go get <module>@<version>`, or `@latest`;
// - remove: `go get <module>@none`, which drops the requirement and downgrades whatever needed it;
// - restore: `go mod download`, which fetches everything the module requires into the module cache.

import * as path from 'node:path';
import { isModulePath } from './go-proxy';
import { PackageCommand } from './protocol';

/**
 * The file a Go module is described by: a write names one as its project.
 */
const GO_MOD: string = 'go.mod';

/**
 * Matches a version or a version query `go get` takes after `@`: a semantic version, a pseudo-version
 * or a query word such as `latest`. No spaces, no slashes, no leading dash, so it stays part of one
 * harmless argument.
 */
const VERSION: RegExp = /^[A-Za-z0-9][A-Za-z0-9.+_-]*$/;

/**
 * Checks the project a write names and finds the directory the go command runs in.
 * @param project The absolute path of the module's go.mod.
 * @returns Returns the module's directory.
 * @throws When the project is not a go.mod.
 */
function moduleDirectory(project: string): string {
  if (path.basename(project) !== GO_MOD) {
    throw new Error(
      'Packages can only be changed in a Go module, which is a folder with a go.mod.',
    );
  }
  return path.dirname(project);
}

/**
 * Checks a module path.
 * @param modulePath The module path.
 * @returns Returns the path.
 * @throws When it could be read as something other than a module.
 */
function checked(modulePath: string): string {
  if (!isModulePath(modulePath)) {
    throw new Error(`'${modulePath}' is not a Go module path.`);
  }
  return modulePath;
}

/**
 * Builds the command that adds a module to a Go module, or moves it to another version: `go get` does
 * both.
 * @param project The absolute path of the module's go.mod.
 * @param modulePath The module to add or move.
 * @param version The version, or null for the latest.
 * @param title The terminal's title.
 * @returns Returns the command.
 * @throws When the project is not a go.mod, or the module or version could be read as anything else.
 */
export function addCommand(
  project: string,
  modulePath: string,
  version: string | null,
  title: string,
): PackageCommand {
  // `none` is a version query too, and means remove: an install or update must not be one.
  if (version !== null && (!VERSION.test(version) || version === 'none')) {
    throw new Error(`'${version}' is not a version.`);
  }
  return {
    executable: 'go',
    args: ['get', `${checked(modulePath)}@${version ?? 'latest'}`],
    cwd: moduleDirectory(project),
    title,
  };
}

/**
 * Builds the command that removes a module from a Go module.
 * @param project The absolute path of the module's go.mod.
 * @param modulePath The module to remove.
 * @returns Returns the command.
 * @throws When the project is not a go.mod, or the module could be read as anything else.
 */
export function removeCommand(project: string, modulePath: string): PackageCommand {
  return {
    executable: 'go',
    args: ['get', `${checked(modulePath)}@none`],
    cwd: moduleDirectory(project),
    title: `Remove ${modulePath}`,
  };
}

/**
 * Builds the command that downloads everything a Go module requires.
 * @param project The absolute path of the module's go.mod.
 * @returns Returns the command.
 * @throws When the project is not a go.mod.
 */
export function restoreCommand(project: string): PackageCommand {
  return {
    executable: 'go',
    args: ['mod', 'download'],
    cwd: moduleDirectory(project),
    title: 'Download modules',
  };
}
