import type {
  VersionControlCapability,
  VersionControlExecutableMode,
} from '@shared/api/version-control-protocol';

/**
 * Describes how to spawn a version-control plugin.
 */
export interface VersionControlSpec {
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
 * Describes whether a version-control plugin can be started, and how.
 */
export type VersionControlResolution =
  | { readonly available: true; readonly spec: VersionControlSpec }
  | { readonly available: false; readonly reason: string };

/**
 * Describes a contributed version-control plugin, as the host needs it: what the manifest declared,
 * and how to start the process.
 */
export interface VersionControlDescriptor {
  /**
   * Gets the identifier the plugin is registered under.
   */
  readonly id: string;

  /**
   * Gets the display name.
   */
  readonly displayName: string;

  /**
   * Gets the priority among plugins claiming the same marker, higher first.
   */
  readonly priority: number;

  /**
   * Gets the entry names that mark a repository this plugin serves.
   */
  readonly markers: readonly string[];

  /**
   * Gets the version-control system's own directories inside a repository.
   */
  readonly metadataDirectories: readonly string[];

  /**
   * Gets the optional capabilities the manifest declared.
   */
  readonly capabilities: readonly VersionControlCapability[];

  /**
   * Gets where the plugin's tool may come from, empty when there is no choice.
   */
  readonly executableModes: readonly VersionControlExecutableMode[];

  /**
   * Resolves how to start the plugin. Never installs anything: an uninstalled plugin resolves to
   * unavailable, and the user installs it in the Plugin Manager.
   */
  readonly resolve: () => VersionControlResolution;
}
