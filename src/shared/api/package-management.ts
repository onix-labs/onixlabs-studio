/**
 * The package-management model for a workspace root, produced by a package manager (for example the
 * npm package manager reading package.json and its lockfile). It is deliberately distinct from the
 * project-system model: where {@link import('./project-system').ProjectModel} describes a solution's
 * project structure, this describes the third-party dependencies each project declares and their
 * upgrade state. Shared so the renderer's Package Management panel can render the same model the main
 * process builds.
 */

/**
 * The package ecosystem a model belongs to. The type is a string union so further ecosystems (Cargo,
 * Gradle/Maven) slot in without a structural change.
 */
export type PackageEcosystem = 'npm' | 'nuget';

/**
 * The dependency scope a package is declared under. Ecosystems that lack a given scope simply never
 * emit it; the panel groups and filters by whatever scopes are present.
 */
export type PackageDependencyScope = 'production' | 'development' | 'peer' | 'optional';

/**
 * A package's upgrade state, resolved by comparing its installed version against the latest the
 * registry offers. `unknown` covers a package whose latest version could not be resolved (offline, a
 * private feed, or an unrecognised name) — the panel shows it without an upgrade verdict rather than
 * implying it is current.
 */
export type PackageUpdateStatus = 'current' | 'outdated' | 'unknown';

/**
 * A single third-party package a project depends on, with its declared range, resolved installed
 * version, the latest version the registry offers, and the upgrade verdict derived from the two.
 */
export interface InstalledPackage {
  /**
   * Gets the package name (for example `@angular/core`).
   */
  readonly name: string;

  /**
   * Gets the version range as declared in the manifest (for example `^17.0.0`).
   */
  readonly requested: string;

  /**
   * Gets the resolved installed version from the lockfile, or null when the package is declared but
   * not installed (no lockfile, or absent from it).
   */
  readonly installed: string | null;

  /**
   * Gets the latest version the registry offers, or null when it could not be resolved.
   */
  readonly latest: string | null;

  /**
   * Gets the upgrade verdict derived from the installed and latest versions.
   */
  readonly status: PackageUpdateStatus;

  /**
   * Gets the dependency scope the package is declared under.
   */
  readonly scope: PackageDependencyScope;
}

/**
 * The dependencies of a single project (the unit that owns a manifest — an npm package, a .csproj, a
 * Cargo crate). Anchoring packages to a project keeps the per-project reality of solution-based
 * ecosystems on the same spine as single-manifest ones.
 */
export interface PackageProject {
  /**
   * Gets the project's display name (its manifest `name`, falling back to its directory).
   */
  readonly name: string;

  /**
   * Gets the absolute path of the manifest file the packages were read from.
   */
  readonly manifestPath: string;

  /**
   * Gets the packages the project declares, across every scope.
   */
  readonly packages: readonly InstalledPackage[];
}

/**
 * A package-management model for a workspace root: the projects it holds and the packages each
 * declares.
 */
export interface PackageManagerModel {
  /**
   * Gets the ecosystem that produced the model.
   */
  readonly ecosystem: PackageEcosystem;

  /**
   * Gets the absolute workspace root the model was built for.
   */
  readonly root: string;

  /**
   * Gets every project in the model, in the order they should be shown.
   */
  readonly projects: readonly PackageProject[];
}
