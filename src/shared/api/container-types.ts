/**
 * The container payload contract shared between the main-process backend and the renderer. These are
 * the small, normalised shapes the backend maps the raw engine API responses into — the renderer never
 * sees the engine's wire format.
 *
 * Nothing here is Docker's alone. The shapes follow the Docker Engine API because that is the protocol
 * the engines in the catalogue serve, but a container, an image, an event and a status are what any
 * engine reports, and the surface reading them never knows which one answered.
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

  /**
   * The ports the container publishes, or undefined from a plugin that does not report them (#974).
   */
  readonly ports?: readonly ContainerPort[];

  /**
   * When the container was created, in seconds since the epoch, or undefined when not reported.
   */
  readonly created?: number;

  /**
   * The names of the volumes the container mounts, or undefined when not reported.
   */
  readonly volumes?: readonly string[];
}

/**
 * One port a container exposes, and where on the host it is published (#974).
 */
export interface ContainerPort {
  /**
   * The port inside the container.
   */
  readonly privatePort: number;

  /**
   * The port on the host it is published on, or undefined when it is exposed but not published.
   */
  readonly publicPort?: number;

  /**
   * The protocol: `tcp`, `udp` or `sctp`.
   */
  readonly protocol: string;

  /**
   * The host address it is bound to, or undefined for every address.
   */
  readonly ip?: string;
}

/**
 * A running container's resource use, as sampled once (#974).
 */
export interface ContainerStats {
  /**
   * The container id.
   */
  readonly id: string;

  /**
   * The share of the host's CPU the container used, as a percentage of one core times the cores.
   */
  readonly cpuPercent: number;

  /**
   * The memory the container uses, in bytes.
   */
  readonly memoryBytes: number;

  /**
   * The most memory the container may use, in bytes.
   */
  readonly memoryLimitBytes: number;
}

/**
 * A volume the engine holds (#974).
 */
export interface VolumeSummary {
  /**
   * The volume's name.
   */
  readonly name: string;

  /**
   * The driver that stores it.
   */
  readonly driver: string;

  /**
   * When it was created, as an ISO-8601 string, or empty when not reported.
   */
  readonly createdAt: string;

  /**
   * Whether the engine made it for a container that did not name one.
   */
  readonly anonymous: boolean;
}

/**
 * What to run a new container with (#974).
 */
export interface RunContainerRequest {
  /**
   * The image to run, by reference (`postgres:16`).
   */
  readonly image: string;

  /**
   * The container's name, or undefined to let the engine choose one.
   */
  readonly name?: string;

  /**
   * The ports to publish.
   */
  readonly ports?: readonly {
    readonly host: number;
    readonly container: number;
    readonly protocol?: 'tcp' | 'udp';
  }[];

  /**
   * The environment variables to set.
   */
  readonly env?: Readonly<Record<string, string>>;

  /**
   * The volumes or host folders to mount: a source (a volume name or an absolute host path) at a
   * target path inside the container.
   */
  readonly volumes?: readonly {
    readonly source: string;
    readonly target: string;
    readonly readOnly?: boolean;
  }[];
}

/**
 * How far an image download has got (#974).
 */
export interface ImagePullProgress {
  /**
   * The image being pulled.
   */
  readonly reference: string;

  /**
   * What the engine says it is doing.
   */
  readonly status: string;

  /**
   * The bytes downloaded so far across the image's layers, when known.
   */
  readonly current?: number;

  /**
   * The bytes to download across the layers seen so far, when known.
   */
  readonly total?: number;

  /**
   * Whether the pull has finished, successfully or not.
   */
  readonly done: boolean;

  /**
   * Why it failed, when it did.
   */
  readonly error?: string;
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
 * A normalised container engine event, pushed to the renderer as it happens so the dashboard reflects
 * out-of-band changes (a `docker start` from the CLI) without polling.
 */
export interface ContainerEvent {
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
 * Whether the container engine is reachable, and its version when it is.
 */
export interface ContainerStatus {
  /**
   * Whether the engine answered.
   */
  readonly available: boolean;

  /**
   * The engine version, present only when {@link available} is true.
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
   *
   * Independent of {@link available}: the engine in effect is the one the surface is talking to, and an
   * engine whose socket is down is still that engine. This is what lets the surface say *which* engine
   * is not running rather than guessing at the default.
   */
  readonly inEffect: boolean;

  /**
   * Gets the engine's command-line tool on this machine, by absolute path, for the operations that are
   * a terminal session — a shell in a container — or null when it is not installed, in which case
   * those operations are not offered (#973).
   */
  readonly cli: string | null;

  /**
   * Gets the command the user runs to start the engine themselves on this platform, or null when there
   * is nothing useful to tell them.
   *
   * There is no counterpart that starts the engine *for* them. Studio used to launch Docker Desktop,
   * which was the one engine it could; now that engines arrive as plugins and Studio talks to whatever
   * socket is served, saying what to run is the whole of what it can honestly offer (#596).
   */
  readonly startCommand: string | null;
}
