/**
 * Names the Docker IPC channels. This is the Docker feature's slice of the IPC contract: the renderer
 * client and the main-process {@link import('../electron/contributions/docker/docker.contribution').DockerContribution}
 * name their channels from here, over the generic {@link import('./bridge').Bridge} transport. The
 * backend is contributed through the main-process contribution registry (#389); it is not a core
 * manager.
 */
export enum DockerChannel {
  /**
   * Lists all containers, running and stopped (invoke).
   */
  ListContainers = 'docker:list-containers',

  /**
   * Lists all images (invoke).
   */
  ListImages = 'docker:list-images',

  /**
   * Starts a container by id (invoke); resolves true on success.
   */
  Start = 'docker:start',

  /**
   * Stops a container by id (invoke); resolves true on success.
   */
  Stop = 'docker:stop',

  /**
   * Removes a container by id (invoke); resolves true on success.
   */
  Remove = 'docker:remove',

  /**
   * Reports whether the Docker daemon is reachable, and its version when it is (invoke).
   */
  Status = 'docker:status',

  /**
   * Pushes a normalised Docker engine event to the renderer as it happens (main→renderer).
   */
  Events = 'docker:events',
}
