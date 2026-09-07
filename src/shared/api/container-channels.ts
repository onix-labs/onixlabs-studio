/**
 * Names the container IPC channels. This is the Containers feature's slice of the IPC contract: the
 * renderer client and the main-process {@link import('../electron/contributions/containers/containers.contribution').ContainersContribution}
 * name their channels from here, over the generic {@link import('./bridge').Bridge} transport. The
 * backend is contributed through the main-process contribution registry (#389); it is not a core
 * manager.
 *
 * The channels are named for the capability, not for one engine: Docker and Podman are peer
 * implementations behind the same contract (#394), so nothing here says `docker`.
 */
export enum ContainerChannel {
  /**
   * Lists all containers, running and stopped (invoke).
   */
  ListContainers = 'container:list-containers',

  /**
   * Lists all images (invoke).
   */
  ListImages = 'container:list-images',

  /**
   * Starts a container by id (invoke); resolves true on success.
   */
  Start = 'container:start',

  /**
   * Stops a container by id (invoke); resolves true on success.
   */
  Stop = 'container:stop',

  /**
   * Removes a container by id (invoke); resolves true on success.
   */
  Remove = 'container:remove',

  /**
   * Reports whether the container engine is reachable, and its version when it is (invoke).
   */
  Status = 'container:status',

  /**
   * Pushes a normalised container engine event to the renderer as it happens (main→renderer). Only
   * flows while at least one {@link WatchStart} is held.
   */
  Events = 'container:events',

  /**
   * Registers the renderer as a consumer of {@link Events} (invoke). The engine's event stream — a
   * persistent socket connection with reconnection — is ref-counted on these, so it exists only
   * while something consumes it: with no daemon installed an unconditional stream would otherwise
   * retry its connection for the life of the app.
   */
  WatchStart = 'container:watch-start',

  /**
   * Withdraws one {@link WatchStart} (invoke); the stream closes when the last consumer leaves.
   */
  WatchStop = 'container:watch-stop',

  /**
   * Lists the container engines, which are present, and which is in effect (invoke).
   */
  ListEngines = 'container:list-engines',

  /**
   * Chooses which container engine to use, or clears the choice (invoke).
   */
  ChooseEngine = 'container:choose-engine',
}
