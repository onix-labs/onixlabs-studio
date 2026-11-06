import type { PackageManagerCapability } from '@shared/api/package-manager-protocol';

/**
 * Describes how to spawn a package-manager plugin.
 */
export interface PackageManagerSpec {
  /**
   * Gets the program to run.
   */
  readonly command: string;

  /**
   * Gets the arguments passed to it.
   */
  readonly args: readonly string[];

  /**
   * Gets environment variables overlaid on the spawned process, or undefined for none.
   */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Describes whether a package-manager plugin can be started, and how.
 */
export type PackageManagerResolution =
  | { readonly available: true; readonly spec: PackageManagerSpec }
  | { readonly available: false; readonly reason: string };

/**
 * Describes a contributed package-manager plugin, as the host needs it: what the manifest declared, and
 * how to start the process.
 */
export interface PackageManagerDescriptor {
  /**
   * Gets the identifier the plugin is registered under.
   */
  readonly id: string;

  /**
   * Gets the display name.
   */
  readonly displayName: string;

  /**
   * Gets the ecosystem the plugin serves, such as `npm`.
   */
  readonly ecosystem: string;

  /**
   * Gets the order plugins applying to one folder are listed in, higher first.
   */
  readonly priority: number;

  /**
   * Gets the file names that mark a project this plugin serves; each may hold a `*` wildcard.
   */
  readonly markers: readonly string[];

  /**
   * Gets the optional capabilities the manifest declared.
   */
  readonly capabilities: readonly PackageManagerCapability[];

  /**
   * Resolves how to start the plugin. Never installs anything: an uninstalled plugin resolves to
   * unavailable, and the user installs it in the Plugin Manager.
   */
  readonly resolve: () => PackageManagerResolution;
}
