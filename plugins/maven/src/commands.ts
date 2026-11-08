// Builds the commands this plugin answers a write with. It never runs one: Studio does, in a visible
// terminal, so the user reads what is about to happen and sees it happen.
//
// Neither Maven nor Gradle has a command that adds, moves or removes a dependency — both expect the
// build file to be edited — so the only write offered is resolving what a project declares.

import * as path from 'node:path';
import { PackageCommand } from './protocol';

/**
 * Matches a Gradle project path: `:` for the root, or `:`-separated names. Checked before it becomes a
 * task argument, so nothing in a settings script can turn it into an option.
 */
const PROJECT_PATH: RegExp = /^:(?:[A-Za-z0-9_][A-Za-z0-9._-]*(?::[A-Za-z0-9_][A-Za-z0-9._-]*)*)?$/;

/**
 * Builds the command that resolves a Maven project's dependencies:
 * `mvn -f pom.xml dependency:resolve`, through the project's Maven wrapper when it has one.
 * @param pom The absolute `pom.xml` path.
 * @param wrapper The absolute path of the Maven wrapper (`mvnw`) that applies, or null.
 * @returns Returns the command.
 */
export function mavenRestoreCommand(pom: string, wrapper: string | null): PackageCommand {
  return {
    executable: wrapper ?? 'mvn',
    args: ['-f', path.basename(pom), 'dependency:resolve'],
    cwd: path.dirname(pom),
    title: 'Resolve dependencies',
  };
}

/**
 * Builds the command that resolves a Gradle project's dependencies: its `dependencies` task, which
 * resolves every configuration (and prints the tree). Run from the build's root, through the build's
 * wrapper when it has one, since that is the Gradle version the build was written for.
 * @param buildRoot The absolute folder of the build.
 * @param projectPath The project's path in the build, `:` for the root project.
 * @param wrapper The absolute path of the build's wrapper (`gradlew`), or null.
 * @returns Returns the command.
 * @throws When the project path is not one.
 */
export function gradleRestoreCommand(
  buildRoot: string,
  projectPath: string,
  wrapper: string | null,
): PackageCommand {
  if (!PROJECT_PATH.test(projectPath)) {
    throw new Error(`'${projectPath}' is not a Gradle project path.`);
  }
  return {
    executable: wrapper ?? 'gradle',
    args: [projectPath === ':' ? ':dependencies' : `${projectPath}:dependencies`],
    cwd: buildRoot,
    title: 'Resolve dependencies',
  };
}
