// The package-manager protocol, as this plugin speaks it. Declared here rather than imported: the plugin
// is a separate program that shares no code with Studio, and `package-manager-plugin.contract.spec.ts`
// is what proves the two agree, across the real process boundary.

/**
 * Names one optional capability this plugin can advertise.
 */
export type PackageManagerCapability =
  | 'sources'
  | 'search'
  | 'searchRequiresQuery'
  | 'prerelease'
  | 'install'
  | 'update'
  | 'remove'
  | 'restore';

/**
 * The dependency scope a package is declared under.
 */
export type PackageDependencyScope = 'production' | 'development' | 'peer' | 'optional';

/**
 * A package's upgrade state.
 */
export type PackageUpdateStatus = 'current' | 'outdated' | 'unknown';

/**
 * A single package a project depends on.
 */
export interface InstalledPackage {
  /**
   * Gets the package name.
   */
  readonly name: string;

  /**
   * Gets the version range as declared in the manifest.
   */
  readonly requested: string;

  /**
   * Gets the resolved installed version, or null when it is declared but not installed.
   */
  readonly installed: string | null;

  /**
   * Gets the latest version the registry offers, or null when it could not be resolved.
   */
  readonly latest: string | null;

  /**
   * Gets the upgrade verdict.
   */
  readonly status: PackageUpdateStatus;

  /**
   * Gets the dependency scope.
   */
  readonly scope: PackageDependencyScope;
}

/**
 * The dependencies of one project.
 */
export interface PackageProject {
  /**
   * Gets the project's display name.
   */
  readonly name: string;

  /**
   * Gets the absolute path of its manifest.
   */
  readonly manifestPath: string;

  /**
   * Gets the packages it declares.
   */
  readonly packages: readonly InstalledPackage[];
}

/**
 * The projects a folder holds and the packages each declares.
 */
export interface PackageManagerModel {
  /**
   * Gets the ecosystem that produced the model.
   */
  readonly ecosystem: string;

  /**
   * Gets the absolute folder the model was built for.
   */
  readonly root: string;

  /**
   * Gets the projects.
   */
  readonly projects: readonly PackageProject[];
}

/**
 * A package source. ⛔ A name, and never a credential or a URL.
 */
export interface PackageSourceInfo {
  /**
   * Gets the source's display name.
   */
  readonly name: string;
}

/**
 * The paging and filter options for a search.
 */
export interface PackageSearchOptions {
  /**
   * Gets how many results to skip.
   */
  readonly skip: number;

  /**
   * Gets how many results to take.
   */
  readonly take: number;

  /**
   * Gets whether prerelease versions are included.
   */
  readonly prerelease: boolean;
}

/**
 * One result of a search.
 */
export interface PackageSearchItem {
  /**
   * Gets the package name.
   */
  readonly name: string;

  /**
   * Gets the latest version.
   */
  readonly version: string;

  /**
   * Gets the description, empty when none is published.
   */
  readonly description: string;

  /**
   * Gets the download count, or null when the source does not report one.
   */
  readonly downloads: number | null;

  /**
   * Gets whether the source marks the package as verified.
   */
  readonly verified: boolean;

  /**
   * Gets the name of the source the result came from.
   */
  readonly sourceName: string;
}

/**
 * A page of search results.
 */
export interface PackageSearchResult {
  /**
   * Gets the results on this page.
   */
  readonly items: readonly PackageSearchItem[];

  /**
   * Gets the total number of matches.
   */
  readonly total: number;

  /**
   * Gets whether more results are available beyond this page.
   */
  readonly hasMore: boolean;
}

/**
 * A command for Studio to run in a visible terminal. This plugin never runs one itself.
 */
export interface PackageCommand {
  /**
   * Gets the program to run.
   */
  readonly executable: string;

  /**
   * Gets the arguments, one per entry.
   */
  readonly args: readonly string[];

  /**
   * Gets the absolute folder to run it in.
   */
  readonly cwd: string;

  /**
   * Gets the title of the terminal it runs in.
   */
  readonly title: string;
}

/**
 * What the plugin says it is in answer to `initialize`.
 */
export interface PackageManagerDescription {
  /**
   * Gets the protocol version the plugin speaks.
   */
  readonly protocol: string;

  /**
   * Gets the capabilities the plugin confirms.
   */
  readonly capabilities: readonly PackageManagerCapability[];

  /**
   * Gets the version of the tool the plugin found, or null when it needs none to read.
   */
  readonly toolVersion: string | null;
}

/**
 * A minimal HTTP response, so the registry code is testable without a network.
 */
export interface HttpResponse {
  /**
   * Gets whether the status is in the success range.
   */
  readonly ok: boolean;

  /**
   * Gets the HTTP status code.
   */
  readonly status: number;

  /**
   * Reads the body as parsed JSON.
   * @returns Returns the parsed body.
   */
  json(): Promise<unknown>;

  /**
   * Reads the body as text. A sparse index file is one JSON document per line, which `json()` cannot
   * read.
   * @returns Returns the body.
   */
  text(): Promise<string>;
}

/**
 * A minimal fetch, injected so a spec can never reach a real registry.
 */
export type HttpFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<HttpResponse>;

/**
 * Asks Studio for a token the user saved for a registry, answering null when there is none.
 */
export type CredentialAsk = (registry: string) => Promise<string | null>;
