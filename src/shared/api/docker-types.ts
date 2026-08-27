/**
 * The Docker payload contract shared between the main-process backend and the renderer. These are the
 * small, normalised shapes the backend maps the raw Docker Engine API responses into — the renderer
 * never sees the engine's wire format.
 */

/**
 * A container as the dashboard lists it.
 */
export interface ContainerSummary {
  /**
   * The full container id.
   */
  readonly id: string;

  /**
   * The container's names, with the engine's leading slash stripped.
   */
  readonly names: readonly string[];

  /**
   * The image the container was created from.
   */
  readonly image: string;

  /**
   * The container's state (for example `running`, `exited`).
   */
  readonly state: string;

  /**
   * The human-readable status line (for example `Up 3 minutes`).
   */
  readonly status: string;
}

/**
 * An image as the dashboard lists it.
 */
export interface ImageSummary {
  /**
   * The full image id.
   */
  readonly id: string;

  /**
   * The image's repository tags (for example `nginx:latest`); empty for a dangling image.
   */
  readonly tags: readonly string[];

  /**
   * The image's size in bytes.
   */
  readonly size: number;
}

/**
 * A normalised Docker engine event, pushed to the renderer as it happens so the dashboard reflects
 * out-of-band changes (a `docker start` from the CLI) without polling.
 */
export interface DockerEvent {
  /**
   * The object the event concerns (for example `container`, `image`).
   */
  readonly type: string;

  /**
   * What happened (for example `start`, `stop`, `die`, `destroy`).
   */
  readonly action: string;

  /**
   * The id of the object the event concerns, or an empty string when the engine omitted it.
   */
  readonly id: string;
}

/**
 * Whether the Docker daemon is reachable, and its version when it is.
 */
export interface DockerStatus {
  /**
   * Whether the daemon answered.
   */
  readonly available: boolean;

  /**
   * The daemon version, present only when {@link available} is true.
   */
  readonly version?: string;
}

/**
 * Describes a container engine to the renderer: what it is, whether it is present on this machine, and
 * whether it is the one in effect.
 *
 * The Containers surface is engine-agnostic — it always has been, only the implementation behind it was
 * named after one engine. This is what lets the surface say which engine it is talking to, and offer a
 * choice when more than one is there to choose between.
 */
export interface ContainerEngineInfo {
  /**
   * Gets the stable engine identifier.
   */
  readonly id: string;

  /**
   * Gets the display name.
   */
  readonly displayName: string;

  /**
   * Gets whether the engine is present on this machine.
   */
  readonly available: boolean;

  /**
   * Gets whether this is the engine currently in effect.
   */
  readonly inEffect: boolean;

  /**
   * Gets the command-line tool that drives this engine, used for the operations that are a terminal
   * session rather than an API call — following logs, opening a shell in a container.
   */
  readonly cli: string;
}
