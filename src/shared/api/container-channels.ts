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
   * Attempts to launch Docker Desktop through the operating system (invoke); resolves true when the
   * launch was issued. Reliable on macOS; best-effort on Windows and Linux.
   */
  LaunchDesktop = 'container:launch-desktop',

  /**
   * Pushes a normalised container engine event to the renderer as it happens (main→renderer).
   */
  Events = 'container:events',

  /**
   * Lists the container engines, which are present, and which is in effect (invoke).
   */
  ListEngines = 'container:list-engines',

  /**
   * Chooses which container engine to use, or clears the choice (invoke).
   */
  ChooseEngine = 'container:choose-engine',
}
