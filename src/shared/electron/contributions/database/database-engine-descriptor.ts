import type { NodeRuntimeSpec } from '../plugins/plugin-loader';

/**
 * Whether an engine's plugin can be started, and how.
 */
export type DatabaseEngineResolution =
  | { readonly available: true; readonly spec: NodeRuntimeSpec }
  | { readonly available: false; readonly reason: string };

/**
 * A database engine an installed plugin contributes (#1095), as the Database Explorer's host needs it:
 * which engine it is and how to start its process. What the engine can do — its language, its
 * capabilities, the fields a connection needs — the process says for itself when it starts.
 */
export interface DatabaseEngineDescriptor {
  /**
   * Gets the identifier the engine is registered under, which saved connections name.
   */
  readonly id: string;

  /**
   * Gets the display name.
   */
  readonly displayName: string;

  /**
   * Gets the priority the engines are offered in, higher first.
   */
  readonly priority: number;

  /**
   * Works out how to start the plugin now: resolved when asked rather than when the descriptor is
   * built, so an engine installed or updated while Studio runs is started from what is on disk.
   * @returns Returns how to start it, or why it cannot be.
   */
  resolve(): DatabaseEngineResolution;
}
