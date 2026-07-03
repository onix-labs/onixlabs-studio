// Shared IPC channel names used between the Electron main process and the renderer.
// Keep this module platform-neutral (no Node or DOM dependencies) so both compilation
// targets can import it.

/**
 * Specifies the IPC channel names used for communication between the renderer and main processes.
 */
export enum IpcChannel {
  /**
   * Gets the agent's current authentication status.
   */
  AiAuthStatus = 'ai:auth-status',

  /**
   * Stores a user-supplied API key for the agent.
   */
  AiSetApiKey = 'ai:set-api-key',

  /**
   * Clears any stored agent API key.
   */
  AiClearApiKey = 'ai:clear-api-key',

  /**
   * Runs a minimal agent turn to verify authentication end-to-end.
   */
  AiVerify = 'ai:verify',

  /**
   * Lists the registered agent providers and their availability.
   */
  AiListProviders = 'ai:list-providers',

  /**
   * Starts an agent turn.
   */
  AiRun = 'ai:run',

  /**
   * Aborts a running agent turn.
   */
  AiAbort = 'ai:abort',

  /**
   * Carries a streamed event from a running agent turn to the renderer.
   */
  AiEvent = 'ai:event',

  /**
   * Carries an in-app capability request from the main process to the renderer.
   */
  AiBridgeRequest = 'ai:bridge-request',

  /**
   * Carries the renderer's reply to an in-app capability request.
   */
  AiBridgeReply = 'ai:bridge-reply',

  /**
   * Carries the renderer's answer to an agent permission request.
   */
  AiPermissionReply = 'ai:permission-reply',
}
