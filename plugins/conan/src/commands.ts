// Builds the commands this plugin answers a write with. It never runs one: Studio does, in a visible
// terminal, so the user reads what is about to happen and sees it happen.
//
// Conan has one command that fits: `conan install .` in a conanfile's folder resolves, fetches and
// (where a binary is missing and the profile allows) builds what it declares. Conan has no command that
// adds, removes or changes a requirement — that is an edit to the conanfile — so none is offered.

import * as path from 'node:path';
import { CONANFILE_PY, CONANFILE_TXT } from './conan';
import { PackageCommand } from './protocol';

/**
 * Builds the command that installs what a conanfile declares: `conan install .` in its folder.
 * @param project The conanfile's absolute path.
 * @returns Returns the command.
 * @throws When the project is not a conanfile.
 */
export function installCommand(project: string): PackageCommand {
  const name: string = path.basename(project);
  if (!path.isAbsolute(project) || (name !== CONANFILE_PY && name !== CONANFILE_TXT)) {
    throw new Error('Conan commands run against a conanfile.py or conanfile.txt.');
  }
  return {
    executable: 'conan',
    args: ['install', '.'],
    cwd: path.dirname(project),
    title: 'Install Conan dependencies',
  };
}
