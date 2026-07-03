// Shared contract between the Electron (back-end) and Angular (front-end) processes.
// The preload script implements this API and exposes it on `window.studio`; the
// renderer consumes it. Keep this module platform-neutral (types only — no Node or
// DOM dependencies) so both compilation targets can import it.

import type { AiApi } from './ai-types';

/**
 * Defines the minimal, sandboxed API surface exposed to the renderer process via
 * the context bridge. This is the only channel through which the renderer reaches
 * privileged capability.
 */
export interface StudioApi {
  /**
   * Gets the AI-agent authentication and verification operations for the application.
   */
  readonly ai: AiApi;
}
