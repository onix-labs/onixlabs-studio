/**
 * Describes how to spawn a live-server plugin.
 */
export interface LiveServerSpec {
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
 * Describes whether a live-server plugin can be started, and how.
 */
export type LiveServerResolution =
  | { readonly available: true; readonly spec: LiveServerSpec }
  | { readonly available: false; readonly reason: string };

/**
 * Describes a contributed live-server plugin, as the host needs it: what the manifest declared, and how
 * to start the process.
 */
export interface LiveServerDescriptor {
  /**
   * Gets the identifier the plugin is registered under.
   */
  readonly id: string;

  /**
   * Gets the display name.
   */
  readonly displayName: string;

  /**
   * Gets the priority used to pick between installed live servers, higher first.
   */
  readonly priority: number;

  /**
   * Resolves how to start the plugin. Never installs anything: an uninstalled plugin resolves to
   * unavailable, and the user installs it in the Plugin Manager.
   */
  readonly resolve: () => LiveServerResolution;
}
