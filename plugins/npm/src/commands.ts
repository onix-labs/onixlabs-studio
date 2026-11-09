// Builds the commands this plugin answers a write with. It never runs one: Studio does, in a visible
// terminal, so the user reads what is about to happen and sees it happen.

import * as path from 'node:path';
import { PackageCommand } from './protocol';

/**
 * Names the Node package tools, each of which keeps its own lockfile.
 */
export type NodeTool = 'npm' | 'pnpm' | 'yarn';

/**
 * Matches a package name as a registry accepts one. Checked before a name reaches an argument list:
 * one starting with `-` would be read as an option by the tool it is handed to.
 */
const PACKAGE_NAME: RegExp = /^(@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*$/i;

/**
 * Matches a version or range or tag: no spaces or leading dash, so it stays one harmless argument.
 */
const PACKAGE_VERSION: RegExp = /^[A-Za-z0-9^~*][A-Za-z0-9.+^~*-]*$/;

/**
 * Picks the tool a project uses, by the lockfile it keeps.
 * @param files The file names beside the project, or at the root of its workspace.
 * @returns Returns the tool.
 */
export function toolFor(files: readonly string[]): NodeTool {
  if (files.includes('pnpm-lock.yaml')) {
    return 'pnpm';
  }
  return files.includes('yarn.lock') ? 'yarn' : 'npm';
}

/**
 * Builds a package specifier from a name and version.
 * @param name The package name.
 * @param version The version, or null for the latest.
 * @returns Returns the specifier.
 * @throws When either could be read as something other than a package.
 */
function specifier(name: string, version: string | null): string {
  if (!PACKAGE_NAME.test(name)) {
    throw new Error(`'${name}' is not a package name.`);
  }
  if (version === null) {
    return name;
  }
  if (!PACKAGE_VERSION.test(version)) {
    throw new Error(`'${version}' is not a version.`);
  }
  return `${name}@${version}`;
}

/**
 * Builds the command that adds a package, or moves one already declared to another version: every tool
 * keeps a declared package in the section it is already in.
 * @param tool The tool.
 * @param project The absolute manifest path.
 * @param name The package name.
 * @param version The version, or null for the latest.
 * @param title The terminal's title.
 * @returns Returns the command.
 */
export function addCommand(
  tool: NodeTool,
  project: string,
  name: string,
  version: string | null,
  title: string,
): PackageCommand {
  const target: string = specifier(name, version);
  return {
    executable: tool,
    args: tool === 'npm' ? ['install', target] : ['add', target],
    cwd: path.dirname(project),
    title,
  };
}

/**
 * Builds the command that removes a package.
 * @param tool The tool.
 * @param project The absolute manifest path.
 * @param name The package name.
 * @returns Returns the command.
 */
export function removeCommand(tool: NodeTool, project: string, name: string): PackageCommand {
  return {
    executable: tool,
    args: [tool === 'npm' ? 'uninstall' : 'remove', specifier(name, null)],
    cwd: path.dirname(project),
    title: `Remove ${name}`,
  };
}

/**
 * Builds the command that restores what a project declares.
 * @param tool The tool.
 * @param project The absolute manifest path.
 * @returns Returns the command.
 */
export function restoreCommand(tool: NodeTool, project: string): PackageCommand {
  return {
    executable: tool,
    args: ['install'],
    cwd: path.dirname(project),
    title: 'Restore packages',
  };
}
