// What the Maven and Gradle readers hand the plugin: each project's declared packages and the
// repositories its build resolves from, before any latest version is known.

import { PackageDependencyScope } from './protocol';

/**
 * A package a project declares.
 */
export interface DeclaredPackage {
  /**
   * Gets the package's name, `group:artifact`.
   */
  readonly name: string;

  /**
   * Gets the version as the panel shows it: resolved through properties, the dependency management or
   * the catalog where it could be, the reference as written where it could not, or what manages it.
   */
  readonly requested: string;

  /**
   * Gets the one concrete version the project is on, which the latest is compared with, or null when
   * that is not known (a range, a dynamic version, a version a remote BOM manages).
   */
  readonly current: string | null;

  /**
   * Gets the version a lockfile resolved, or null when there is no lockfile saying so.
   */
  readonly installed: string | null;

  /**
   * Gets the scope.
   */
  readonly scope: PackageDependencyScope;
}

/**
 * A repository a project's build resolves from, with the credential its configuration binds to it.
 */
export interface RepositoryCandidate {
  /**
   * Gets the name it is known by: a Maven repository id, a Gradle repository name, or its host.
   */
  readonly name: string;

  /**
   * Gets its normalised URL.
   */
  readonly url: string;

  /**
   * Gets the credential the tool's configuration binds to it, or null.
   */
  readonly credential: { readonly username: string; readonly password: string } | null;
}

/**
 * A project as read from its build file.
 */
export interface ProjectRead {
  /**
   * Gets the name the panel shows it by.
   */
  readonly name: string;

  /**
   * Gets the absolute path of its build file.
   */
  readonly manifestPath: string;

  /**
   * Gets what it declares.
   */
  readonly packages: readonly DeclaredPackage[];

  /**
   * Gets the repositories its build resolves from, in the order they are tried.
   */
  readonly repositories: readonly RepositoryCandidate[];
}
