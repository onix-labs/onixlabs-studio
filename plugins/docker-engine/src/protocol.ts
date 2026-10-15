// The container-engine protocol (#973), as this plugin speaks it.
//
// ⛔ A deliberate COPY of Studio's `src/shared/api/container-engine-protocol.ts` (with the payload
// shapes from `container-types.ts` below), not an import: the plugin is a separate program and shares
// no code with the app, so the wire is the only contract. Keep the two in step when the protocol
// changes.
//
// Framing is newline-delimited JSON over the plugin's standard streams. Each request line carries an
// `id`, and each answer carries the same `id`; answers may arrive in any order. Besides answers, the
// plugin writes **event** lines — `{ "type": "event", "event": … }` — for the engine's event stream
// while Studio is watching it.
//
// `1.1` (#974) adds stats, volumes, pause and resume, restart, removing and pulling images, and running
// a new container, each behind a capability of its own, and `{ "type": "pull", "progress": … }` lines
// while an image downloads. Adds only: a 1.0 plugin is simply never asked for them.
//
// The plugin speaks to the engine itself; Studio speaks to the plugin. The one thing Studio hands over
// is the engine's socket, resolved through the `container.socket` permission and passed at
// `initialize`, so a plugin never decides for itself where it may connect.

/**
 * The protocol version this build speaks. A plugin answering with a different major version is
 * refused; a newer minor is accepted, and its additions go unused.
 */
export const CONTAINER_ENGINE_PROTOCOL_VERSION: string = '1.1';

/**
 * Every capability an engine plugin can declare. A closed list: Studio asks for an operation only when
 * the plugin said at `initialize` that it can perform it.
 */
export const CONTAINER_ENGINE_CAPABILITIES: readonly [
  'containers',
  'images',
  'lifecycle',
  'logs',
  'events',
  'stats',
  'volumes',
  'pause',
  'restart',
  'imageRemove',
  'imagePull',
  'run',
] = [
  'containers',
  'images',
  'lifecycle',
  'logs',
  'events',
  'stats',
  'volumes',
  'pause',
  'restart',
  'imageRemove',
  'imagePull',
  'run',
];

/**
 * Identifies one capability.
 */
export type ContainerEngineCapability = (typeof CONTAINER_ENGINE_CAPABILITIES)[number];

/**
 * Determines whether a value names a capability.
 * @param value The value.
 * @returns Returns true when it does.
 */
export function isContainerEngineCapability(value: unknown): value is ContainerEngineCapability {
  return (
    typeof value === 'string' &&
    (CONTAINER_ENGINE_CAPABILITIES as readonly string[]).includes(value)
  );
}

/**
 * What a plugin says about itself at `initialize`.
 */
export interface ContainerEngineDescription {
  /**
   * Gets the protocol version the plugin speaks.
   */
  readonly protocol: string;

  /**
   * Gets what the plugin can do.
   */
  readonly capabilities: readonly ContainerEngineCapability[];
}

/**
 * A container's recent log output.
 */
export interface ContainerLogs {
  /**
   * Gets the lines, oldest first, each carrying its timestamp when the engine reports one.
   */
  readonly lines: readonly string[];

  /**
   * Gets whether older lines were left out to keep within the tail asked for.
   */
  readonly truncated: boolean;
}

/**
 * Every operation, with what it takes and what it answers.
 */
export interface ContainerEngineOperations {
  /**
   * Starts the session: the protocol Studio speaks and the socket the engine serves.
   */
  readonly initialize: {
    readonly params: { readonly protocol: string; readonly socketPath: string };
    readonly result: ContainerEngineDescription;
  };

  /**
   * Reports whether the engine is reachable, and what it is.
   */
  readonly status: { readonly params: Record<string, never>; readonly result: ContainerStatus };

  /**
   * Lists the containers, running and stopped.
   */
  readonly listContainers: {
    readonly params: Record<string, never>;
    readonly result: readonly ContainerSummary[];
  };

  /**
   * Lists the images held locally.
   */
  readonly listImages: {
    readonly params: Record<string, never>;
    readonly result: readonly ImageSummary[];
  };

  /**
   * Starts a container.
   */
  readonly start: { readonly params: { readonly id: string }; readonly result: boolean };

  /**
   * Stops a container.
   */
  readonly stop: { readonly params: { readonly id: string }; readonly result: boolean };

  /**
   * Removes a container.
   */
  readonly remove: { readonly params: { readonly id: string }; readonly result: boolean };

  /**
   * Reads a container's most recent log lines.
   */
  readonly logs: {
    readonly params: { readonly id: string; readonly tail: number };
    readonly result: ContainerLogs;
  };

  /**
   * Samples the resource use of the running containers named (1.1).
   */
  readonly stats: {
    readonly params: { readonly ids: readonly string[] };
    readonly result: readonly ContainerStats[];
  };

  /**
   * Lists the volumes (1.1).
   */
  readonly listVolumes: {
    readonly params: Record<string, never>;
    readonly result: readonly VolumeSummary[];
  };

  /**
   * Removes a volume no container uses (1.1).
   */
  readonly removeVolume: { readonly params: { readonly name: string }; readonly result: boolean };

  /**
   * Pauses a running container (1.1).
   */
  readonly pause: { readonly params: { readonly id: string }; readonly result: boolean };

  /**
   * Resumes a paused container (1.1).
   */
  readonly unpause: { readonly params: { readonly id: string }; readonly result: boolean };

  /**
   * Restarts a container (1.1).
   */
  readonly restart: { readonly params: { readonly id: string }; readonly result: boolean };

  /**
   * Removes an image (1.1).
   */
  readonly removeImage: {
    readonly params: { readonly id: string; readonly force: boolean };
    readonly result: boolean;
  };

  /**
   * Downloads an image, sending `pull` lines as it goes and answering once it has finished (1.1).
   */
  readonly pullImage: {
    readonly params: { readonly reference: string };
    readonly result: { readonly ok: boolean; readonly error?: string };
  };

  /**
   * Creates a container from an image and starts it (1.1).
   */
  readonly run: {
    readonly params: { readonly request: RunContainerRequest };
    readonly result: { readonly id?: string; readonly error?: string };
  };

  /**
   * Starts sending the engine's events as event lines.
   */
  readonly watchStart: { readonly params: Record<string, never>; readonly result: boolean };

  /**
   * Stops sending events.
   */
  readonly watchStop: { readonly params: Record<string, never>; readonly result: boolean };
}

/**
 * Identifies one operation.
 */
export type ContainerEngineOp = keyof ContainerEngineOperations;

/**
 * What an operation takes.
 */
export type ContainerEngineParams<Op extends ContainerEngineOp> =
  ContainerEngineOperations[Op]['params'];

/**
 * What an operation answers.
 */
export type ContainerEngineResult<Op extends ContainerEngineOp> =
  ContainerEngineOperations[Op]['result'];

/**
 * The capability each operation needs; `null` for the ones every plugin answers.
 */
export const CONTAINER_ENGINE_OP_CAPABILITY: Readonly<
  Record<ContainerEngineOp, ContainerEngineCapability | null>
> = {
  initialize: null,
  status: null,
  listContainers: 'containers',
  listImages: 'images',
  start: 'lifecycle',
  stop: 'lifecycle',
  remove: 'lifecycle',
  logs: 'logs',
  watchStart: 'events',
  watchStop: 'events',
  stats: 'stats',
  listVolumes: 'volumes',
  removeVolume: 'volumes',
  pause: 'pause',
  unpause: 'pause',
  restart: 'restart',
  removeImage: 'imageRemove',
  pullImage: 'imagePull',
  run: 'run',
};

/**
 * One request line.
 */
export interface ContainerEngineRequest<Op extends ContainerEngineOp = ContainerEngineOp> {
  readonly id: number;
  readonly op: Op;
  readonly params: ContainerEngineParams<Op>;
}

/**
 * One answer line.
 */
export type ContainerEngineResponse<Op extends ContainerEngineOp = ContainerEngineOp> =
  | { readonly id: number; readonly ok: true; readonly result: ContainerEngineResult<Op> }
  | { readonly id: number; readonly ok: false; readonly error: string };

/**
 * One event line: something happened in the engine while Studio was watching.
 */
export interface ContainerEngineEventLine {
  readonly type: 'event';
  readonly event: ContainerEvent;
}

/**
 * One pull line: how far an image download has got (1.1).
 */
export interface ContainerEnginePullLine {
  readonly type: 'pull';
  readonly progress: ImagePullProgress;
}

/**
 * Determines whether a plugin's protocol version is one this build can speak: the same major version.
 * @param version The plugin's version.
 * @returns Returns true when it is compatible.
 */
export function isCompatibleContainerEngineProtocol(version: string): boolean {
  const major: string | undefined = version.split('.')[0];
  return major !== undefined && major === CONTAINER_ENGINE_PROTOCOL_VERSION.split('.')[0];
}

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
