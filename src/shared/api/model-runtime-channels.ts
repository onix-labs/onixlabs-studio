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

  /**
   * Reports where the runtime's binary is and how it got there (invoke).
   */
  Installation = 'model-runtime:installation',

  /**
   * Downloads and installs the managed runtime binary (invoke); resolves the resulting installation.
   * Only meaningful when no system install was detected.
   */
  Install = 'model-runtime:install',

  /**
   * Pushes managed-install progress to the renderer (main→renderer).
   */
  InstallProgress = 'model-runtime:install-progress',

  /**
   * Starts the runtime's server (invoke); resolves true once it answers.
   */
  Start = 'model-runtime:start',

  /**
   * Stops the runtime's server (invoke); resolves true when it was stopped. Only a server Studio
   * started can be stopped — one the user is running themselves is left alone.
   */
  Stop = 'model-runtime:stop',

  /**
   * Reports how much disk the runtime's model store is using (invoke).
   */
  DiskUsage = 'model-runtime:disk-usage',

  /**
   * Pulls a model by reference (invoke); resolves true when the model finished downloading. The
   * invoke stays outstanding for the whole pull, which can be many minutes — progress arrives
   * separately on {@link PullProgress}.
   */
  Pull = 'model-runtime:pull',

  /**
   * Pushes a pull's progress to the renderer (main→renderer).
   */
  PullProgress = 'model-runtime:pull-progress',

  /**
   * Cancels an in-flight pull by model reference (invoke); resolves true when there was one to cancel.
   */
  CancelPull = 'model-runtime:cancel-pull',

  /**
   * Searches the catalogue of models available to install (invoke).
   */
  SearchCatalog = 'model-runtime:search-catalog',
}
