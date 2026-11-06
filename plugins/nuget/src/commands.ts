// Builds the commands this plugin answers a write with. It never runs one: Studio does, in a visible
// terminal, so the user reads what is about to happen and sees it happen.

import * as path from 'node:path';
import { PackageCommand } from './protocol';

/**
 * Matches a NuGet package id. Checked before an id reaches an argument list: one starting with `-`
 * would be read as an option by `dotnet`.
 */
const PACKAGE_ID: RegExp = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/**
 * Matches a version or a version range: no spaces or leading dash, so it stays one harmless argument.
 */
const PACKAGE_VERSION: RegExp = /^[A-Za-z0-9[(][A-Za-z0-9.+*,[\]()-]*$/;

/**
 * Checks a package id.
 * @param id The id.
 * @returns Returns the id.
 * @throws When it could be read as something other than a package.
 */
function checked(id: string): string {
  if (!PACKAGE_ID.test(id)) {
    throw new Error(`'${id}' is not a package id.`);
  }
  return id;
}

/**
 * Builds the command that adds a package to a project, or moves it to another version: `dotnet add
 * package` does both, and writes to `Directory.Packages.props` itself in a centrally managed solution.
 * @param project The absolute project-file path.
 * @param id The package id.
 * @param version The version, or null for the latest.
 * @param title The terminal's title.
 * @returns Returns the command.
 */
export function addCommand(
  project: string,
  id: string,
  version: string | null,
  title: string,
): PackageCommand {
  if (version !== null && !PACKAGE_VERSION.test(version)) {
    throw new Error(`'${version}' is not a version.`);
  }
  return {
    executable: 'dotnet',
    args: [
      'add',
      path.basename(project),
      'package',
      checked(id),
      ...(version === null ? [] : ['--version', version]),
    ],
    cwd: path.dirname(project),
    title,
  };
}

/**
 * Builds the command that removes a package from a project.
 * @param project The absolute project-file path.
 * @param id The package id.
 * @returns Returns the command.
 */
export function removeCommand(project: string, id: string): PackageCommand {
  return {
    executable: 'dotnet',
    args: ['remove', path.basename(project), 'package', checked(id)],
    cwd: path.dirname(project),
    title: `Remove ${id}`,
  };
}

/**
 * Builds the command that restores what a project declares.
 * @param project The absolute project-file path.
 * @returns Returns the command.
 */
export function restoreCommand(project: string): PackageCommand {
  return {
    executable: 'dotnet',
    args: ['restore', path.basename(project)],
    cwd: path.dirname(project),
    title: 'Restore packages',
  };
}
