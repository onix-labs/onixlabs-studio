import type { TestAdapterCapability } from '@shared/api/test-adapter-protocol';

/**
 * Describes how to spawn a test-adapter plugin.
 */
export interface TestAdapterSpec {
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
 * Describes whether a test-adapter plugin can be started, and how.
 */
export type TestAdapterResolution =
  | { readonly available: true; readonly spec: TestAdapterSpec }
  | { readonly available: false; readonly reason: string };

/**
 * Describes a contributed test-adapter plugin, as the host needs it: what the manifest declared, and how
 * to start the process.
 */
export interface TestAdapterDescriptor {
  /**
   * Gets the identifier the plugin is registered under.
   */
  readonly id: string;

  /**
   * Gets the display name.
   */
  readonly displayName: string;

  /**
   * Gets the frameworks the adapter serves, for display.
   */
  readonly frameworks: readonly string[];

  /**
   * Gets the order adapters applying to one folder are listed in, higher first.
   */
  readonly priority: number;

  /**
   * Gets the file names that mark a project this adapter may find tests in; each may hold a `*`.
   */
  readonly markers: readonly string[];

  /**
   * Gets the optional capabilities the manifest declared.
   */
  readonly capabilities: readonly TestAdapterCapability[];

  /**
   * Resolves how to start the plugin. Never installs anything: an uninstalled plugin resolves to
   * unavailable, and the user installs it in the Plugin Manager.
   */
  readonly resolve: () => TestAdapterResolution;
}
