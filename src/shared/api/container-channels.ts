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
   * Reads a container's most recent log lines by id and how many (invoke), answered with
   * `ContainerLogs` (#973). Logs come through the engine's own plugin, not a terminal.
   */
  Logs = 'container:logs',

  /**
   * Samples the resource use of running containers by id (invoke), answered with `ContainerStats[]`
   * (#974).
   */
  Stats = 'container:stats',

  /**
   * Lists the volumes (invoke), answered with `VolumeSummary[]` (#974).
   */
  ListVolumes = 'container:list-volumes',

  /**
   * Removes a volume by name (invoke); resolves true on success (#974).
   */
  RemoveVolume = 'container:remove-volume',

  /**
   * Pauses a container by id (invoke); resolves true on success (#974).
   */
  Pause = 'container:pause',

  /**
   * Resumes a paused container by id (invoke); resolves true on success (#974).
   */
  Unpause = 'container:unpause',

  /**
   * Restarts a container by id (invoke); resolves true on success (#974).
   */
  Restart = 'container:restart',

  /**
   * Removes an image by id and whether to force it (invoke); resolves true on success (#974).
   */
  RemoveImage = 'container:remove-image',

  /**
   * Downloads an image by reference (invoke), answered once it has finished with
   * `{ ok, error? }`; its progress arrives on {@link PullProgress} meanwhile (#974).
   */
  PullImage = 'container:pull-image',

  /**
   * Pushes how far an image download has got to the renderer (main→renderer, #974).
   */
  PullProgress = 'container:pull-progress',

  /**
   * Creates a container from an image and starts it (invoke), answered with `{ id?, error? }` (#974).
   */
  Run = 'container:run',

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
