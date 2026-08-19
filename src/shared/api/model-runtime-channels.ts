/**
 * Names the local model-runtime IPC channels. This is the AI Model Manager's slice of the IPC
 * contract: the renderer client and the main-process
 * {@link import('../electron/contributions/model-runtime/model-runtime.contribution').ModelRuntimeContribution}
 * name their channels from here, over the generic {@link import('./bridge').Bridge} transport. The
 * backend is contributed through the main-process contribution registry (#389); it is not a core
 * manager.
 *
 * The channels are named for the *runtime* rather than for Ollama, because the backend is a
 * runtime-agnostic slot with Ollama as its first implementation (#409).
 */
export enum ModelRuntimeChannel {
  /**
   * Lists the models installed locally (invoke).
   */
  List = 'model-runtime:list',

  /**
   * Lists the models currently loaded into memory (invoke).
   */
  Running = 'model-runtime:running',

  /**
   * Reads one model's detailed metadata by name (invoke); resolves null when it is not installed.
   */
  Show = 'model-runtime:show',

  /**
   * Removes an installed model by name (invoke); resolves true on success.
   */
  Remove = 'model-runtime:remove',

  /**
   * Reports whether the runtime's server is reachable, and its version when it is (invoke).
   */
  Status = 'model-runtime:status',

  /**
   * Asks the backend to begin polling the runtime's status (send). Ref-counted, so several open views
   * share one poll; balanced by {@link StopWatch}.
   */
  StartWatch = 'model-runtime:start-watch',

  /**
   * Asks the backend to stop polling the runtime's status (send). Balances {@link StartWatch}.
   */
  StopWatch = 'model-runtime:stop-watch',

  /**
   * Pushes the runtime's status to the renderer when it changes (main→renderer), so the view reflects
   * a server started or stopped outside Studio without polling in the renderer.
   */
  StatusChanged = 'model-runtime:status-changed',
}
