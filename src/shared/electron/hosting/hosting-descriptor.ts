import type { HostingAuthMode, HostingCapability } from '@shared/api/hosting-protocol';
import type { HostingEndpoint } from './hosting-endpoint';

/**
 * Describes how to spawn a hosting plugin.
 */
export interface HostingSpec {
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
 * Describes whether a hosting plugin can be started, and how.
 */
export type HostingResolution =
  | { readonly available: true; readonly spec: HostingSpec }
  | {
      readonly available: true;
      /**
       * Creates an endpoint running inside the main process rather than a process to spawn — for a
       * host core still serves itself while it moves into a plugin, as core's git did (#816).
       */
      readonly create: () => HostingEndpoint;
    }
  | { readonly available: false; readonly reason: string };

/**
 * Describes a contributed hosting plugin, as the host needs it: what the manifest declared, and how to
 * start the process.
 */
export interface HostingDescriptor {
  /**
   * Gets the identifier the plugin is registered under.
   */
  readonly id: string;

  /**
   * Gets the display name.
   */
  readonly displayName: string;

  /**
   * Gets the priority among plugins serving the same host, higher first.
   */
  readonly priority: number;

  /**
   * Gets the host names the plugin serves, lowercased.
   */
  readonly hosts: readonly string[];

  /**
   * Gets the optional capabilities the manifest declared.
   */
  readonly capabilities: readonly HostingCapability[];

  /**
   * Gets the ways the plugin can sign in, empty when there is no choice.
   */
  readonly authModes: readonly HostingAuthMode[];

  /**
   * Resolves how to start the plugin. Never installs anything: an uninstalled plugin resolves to
   * unavailable, and the user installs it in the Plugin Manager.
   */
  readonly resolve: () => HostingResolution;
}
