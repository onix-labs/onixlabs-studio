// Reads a folder's Gradle projects: every `build.gradle(.kts)`, grouped into builds by the nearest
// `settings.gradle(.kts)` above it, with the build's version catalog and lockfiles.
//
// ⚠️ See `gradle-scripts.ts`: a build script is a program, and only what it declares literally is read.

import * as path from 'node:path';
import { findFiles, isFile, isWithin, readText } from './files';
import {
  EMPTY_CATALOG,
  CatalogLibrary,
  parseVersionCatalog,
  resolveCatalogReference,
  VersionCatalog,
} from './gradle-catalog';
import {
  GradleDeclaration,
  GradleRepositoryDeclaration,
  GradleSettings,
  gradleScope,
  interpolateGradle,
  parseGradleDependencies,
  parseGradleLockfile,
  parseGradleRepositories,
  parseGradleSettings,
  parseProperties,
  parseScriptVariables,
} from './gradle-scripts';
import { DeclaredPackage, ProjectRead, RepositoryCandidate } from './model';
import { MAVEN_CENTRAL, normaliseRepositoryUrl } from './repositories';
import { isConcreteVersion } from './versions';

/**
 * The build script names, Kotlin and Groovy.
 */
export const BUILD_SCRIPTS: readonly string[] = ['build.gradle.kts', 'build.gradle'];

/**
 * The settings script names, Kotlin and Groovy.
 */
const SETTINGS_SCRIPTS: readonly string[] = ['settings.gradle.kts', 'settings.gradle'];

/**
 * One Gradle build: the folder its settings script is in, and what is shared by all its projects.
 */
interface GradleBuild {
  /**
   * Gets the build's root folder.
   */
  readonly root: string;

  /**
   * Gets what its settings script says, or none.
   */
  readonly settings: GradleSettings;

  /**
   * Gets its version catalog.
   */
  readonly catalog: VersionCatalog;

  /**
   * Gets its root `gradle.properties`.
   */
  readonly properties: ReadonlyMap<string, string>;

  /**
   * Gets the variables its root build script assigns, which subprojects can see.
   */
  readonly rootVariables: ReadonlyMap<string, string>;

  /**
   * Gets the repositories its settings and root build script declare.
   */
  readonly repositories: readonly GradleRepositoryDeclaration[];
}

/**
 * Where a Gradle project sits in its build.
 */
export interface GradleLocation {
  /**
   * Gets the build's root folder, where Gradle is run from.
   */
  readonly buildRoot: string;

  /**
   * Gets the project's path (`:app:core`), or `:` for the root project.
   */
  readonly projectPath: string;
}

/**
 * Reads every Gradle project under a folder.
 * @param root The absolute folder.
 * @returns Returns the projects, the shallowest first.
 */
export async function readGradleProjects(root: string): Promise<readonly ProjectRead[]> {
  const files: readonly string[] = await findFiles(root, (name: string): boolean =>
    BUILD_SCRIPTS.includes(name),
  );
  const builds: Map<string, GradleBuild> = new Map<string, GradleBuild>();
  const projects: ProjectRead[] = [];
  for (const file of files) {
    // A folder with both scripts is Gradle's error to report; the Kotlin one is read.
    const directory: string = path.dirname(file);
    if (
      path.basename(file) === 'build.gradle' &&
      files.includes(path.join(directory, 'build.gradle.kts'))
    ) {
      continue;
    }
    const buildRoot: string = await findBuildRoot(directory, root);
    let build: GradleBuild | undefined = builds.get(buildRoot);
    if (build === undefined) {
      build = await readBuild(buildRoot);
      builds.set(buildRoot, build);
    }
    const project: ProjectRead | null = await readProject(file, build);
    if (project !== null) {
      projects.push(project);
    }
  }
  return projects;
}

/**
 * Finds the root of the build a project belongs to: the nearest folder at or above it, within the
 * workspace, holding a settings script; the project's own folder when there is none.
 * @param directory The project's folder.
 * @param root The workspace folder.
 * @returns Returns the build's root.
 */
export async function findBuildRoot(directory: string, root: string): Promise<string> {
  for (let current: string = directory; isWithin(current, root);) {
    for (const name of SETTINGS_SCRIPTS) {
      if (await isFile(path.join(current, name))) {
        return current;
      }
    }
    const parent: string = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return directory;
}

/**
 * Reads the first of several files in a folder that exists.
 * @param directory The folder.
 * @param names The file names, in order of preference.
 * @returns Returns its text, or an empty string when none exists.
 */
async function readFirst(directory: string, names: readonly string[]): Promise<string> {
  for (const name of names) {
    const text: string | null = await readText(path.join(directory, name));
    if (text !== null) {
      return text;
    }
  }
  return '';
}

/**
 * Reads what a build's projects share.
 * @param buildRoot The build's root folder.
 * @returns Returns the build.
 */
async function readBuild(buildRoot: string): Promise<GradleBuild> {
  const settingsScript: string = await readFirst(buildRoot, SETTINGS_SCRIPTS);
  const rootScript: string = await readFirst(buildRoot, BUILD_SCRIPTS);
  const catalogText: string | null = await readText(
    path.join(buildRoot, 'gradle', 'libs.versions.toml'),
  );
  return {
    root: buildRoot,
    settings: parseGradleSettings(settingsScript),
    catalog: catalogText === null ? EMPTY_CATALOG : parseVersionCatalog(catalogText),
    properties: parseProperties((await readText(path.join(buildRoot, 'gradle.properties'))) ?? ''),
    rootVariables: parseScriptVariables(rootScript),
    repositories: [
      ...parseGradleRepositories(settingsScript),
      ...parseGradleRepositories(rootScript),
    ],
  };
}

/**
 * Works out where a project sits in its build: the path its settings script gives its folder, or the
 * conventional path its folder implies.
 * @param directory The project's folder.
 * @param buildRoot The build's root folder.
 * @param settings What the build's settings script says.
 * @returns Returns the project's path.
 */
export function projectPathOf(
  directory: string,
  buildRoot: string,
  settings: GradleSettings,
): string {
  if (path.resolve(directory) === path.resolve(buildRoot)) {
    return ':';
  }
  for (const [projectPath, folder] of settings.projects) {
    if (path.resolve(buildRoot, folder) === path.resolve(directory)) {
      return projectPath;
    }
  }
  return `:${path.relative(buildRoot, directory).split(path.sep).join(':')}`;
}

/**
 * Finds where a project's build file sits in its build, for a command that runs Gradle on it.
 * @param file The project's build file.
 * @param root The workspace folder.
 * @returns Returns the location.
 */
export async function locateGradleProject(file: string, root: string): Promise<GradleLocation> {
  const directory: string = path.dirname(file);
  const buildRoot: string = await findBuildRoot(directory, root);
  const settings: GradleSettings = parseGradleSettings(
    await readFirst(buildRoot, SETTINGS_SCRIPTS),
  );
  return { buildRoot, projectPath: projectPathOf(directory, buildRoot, settings) };
}

/**
 * Reads one project.
 * @param file The project's build file.
 * @param build The build it belongs to.
 * @returns Returns the project, or null when the file cannot be read.
 */
async function readProject(file: string, build: GradleBuild): Promise<ProjectRead | null> {
  const script: string | null = await readText(file);
  if (script === null) {
    return null;
  }
  const directory: string = path.dirname(file);
  const isRoot: boolean = path.resolve(directory) === path.resolve(build.root);
  const projectProperties: ReadonlyMap<string, string> = isRoot
    ? new Map<string, string>()
    : parseProperties((await readText(path.join(directory, 'gradle.properties'))) ?? '');
  // The nearest definition wins: the script's own, then its folder's properties, then the root's.
  const variables: Map<string, string> = new Map<string, string>([
    ...build.properties,
    ...build.rootVariables,
    ...projectProperties,
    ...parseScriptVariables(script),
  ]);
  const lockText: string | null = await readText(path.join(directory, 'gradle.lockfile'));
  const locked: ReadonlyMap<string, string> =
    lockText === null ? new Map<string, string>() : parseGradleLockfile(lockText);
  const packages: DeclaredPackage[] = [];
  const seen: Set<string> = new Set<string>();
  const add: (row: DeclaredPackage) => void = (row: DeclaredPackage): void => {
    const key: string = `${row.name} ${row.scope}`;
    if (!seen.has(key)) {
      seen.add(key);
      packages.push(row);
    }
  };
  for (const declaration of parseGradleDependencies(script)) {
    for (const row of rowsFor(declaration, build.catalog, variables, locked)) {
      add(row);
    }
  }
  const projectPath: string = projectPathOf(directory, build.root, build.settings);
  return {
    name: isRoot ? (build.settings.rootName ?? path.basename(directory)) : projectPath,
    manifestPath: file,
    packages,
    repositories: repositoriesFor(
      isRoot ? build.repositories : [...build.repositories, ...parseGradleRepositories(script)],
      build.properties,
    ),
  };
}

/**
 * Builds the rows one declaration stands for: one for coordinates or a library, one per library for a
 * bundle, none for a catalog reference the catalog does not hold.
 * @param declaration The declaration.
 * @param catalog The build's catalog.
 * @param variables The variables a version can refer to.
 * @param locked The project's locked versions.
 * @returns Returns the rows.
 */
function rowsFor(
  declaration: GradleDeclaration,
  catalog: VersionCatalog,
  variables: ReadonlyMap<string, string>,
  locked: ReadonlyMap<string, string>,
): readonly DeclaredPackage[] {
  const entries: readonly { module: string; version: string | null }[] =
    declaration.kind === 'catalog'
      ? resolveCatalogReference(catalog, declaration.notation).map(
          (entry: { alias: string; library: CatalogLibrary }): CatalogLibrary => entry.library,
        )
      : [{ module: declaration.notation, version: declaration.version }];
  return entries.map((entry: { module: string; version: string | null }): DeclaredPackage => {
    const name: string = interpolateGradle(entry.module, variables);
    const version: string | null =
      entry.version === null ? null : interpolateGradle(entry.version, variables);
    // `1.0!!` is Kotlin DSL shorthand for a strict version: still that one version.
    const plain: string | null = version === null ? null : version.replace(/!!$/, '');
    return {
      name,
      requested: version ?? '',
      current: plain !== null && isConcreteVersion(plain) ? plain : null,
      installed: locked.get(name) ?? null,
      scope: gradleScope(declaration.configuration),
    };
  });
}

/**
 * Turns a project's repository declarations into candidates, Maven Central last when nothing declared
 * it. A repository's credential comes from the build's own `gradle.properties` (`<name>Username` and
 * `<name>Password`, Gradle's convention for `credentials(PasswordCredentials)`), bound to the URL the
 * same build gives that name.
 *
 * ⛔ The user's `~/.gradle/gradle.properties` is not read for credentials: it holds a password by
 * repository name only, with no host, so any build in any folder could name a repository after it and
 * point it anywhere. Those repositories take a token saved in Studio instead.
 * @param declarations The declarations, in order.
 * @param properties The build's `gradle.properties`.
 * @returns Returns the candidates, without repeats.
 */
function repositoriesFor(
  declarations: readonly GradleRepositoryDeclaration[],
  properties: ReadonlyMap<string, string>,
): readonly RepositoryCandidate[] {
  const candidates: RepositoryCandidate[] = [];
  for (const declaration of [
    ...declarations,
    { url: MAVEN_CENTRAL, name: null, credentials: false },
  ]) {
    const url: string | null = normaliseRepositoryUrl(declaration.url);
    if (
      url === null ||
      candidates.some((candidate: RepositoryCandidate): boolean => candidate.url === url)
    ) {
      continue;
    }
    const username: string | undefined =
      declaration.name === null ? undefined : properties.get(`${declaration.name}Username`);
    const password: string | undefined =
      declaration.name === null ? undefined : properties.get(`${declaration.name}Password`);
    candidates.push({
      name: declaration.name ?? new URL(url).host,
      url,
      credential:
        declaration.credentials &&
        password !== undefined &&
        password.length > 0 &&
        !password.includes('${')
          ? { username: username ?? '', password }
          : null,
    });
  }
  return candidates;
}
