// The live-server protocol, as this plugin speaks it (#1062).
//
// Declared here rather than imported from the application's `@shared/api`: the plugin is a separate
// program whose contract with Studio is the wire protocol, not shared TypeScript. The contract spec in
// `src/shared/electron/live-server/` is what proves the two agree across the real process boundary.

/**
 * The protocol version this plugin speaks.
 */
export const LIVE_SERVER_PROTOCOL: string = '1.1';

/**
 * Describes a folder being served, in answer to `serve`.
 */
export interface Serving {
  /**
   * Gets the identifier `stop` names.
   */
  readonly serverId: string;

  /**
   * Gets the port it listens on.
   */
  readonly port: number;
}
