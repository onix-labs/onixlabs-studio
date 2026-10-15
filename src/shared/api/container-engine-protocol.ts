import type {
  ContainerEvent,
  ContainerStats,
  ContainerStatus,
  ContainerSummary,
  ImagePullProgress,
  ImageSummary,
  RunContainerRequest,
  VolumeSummary,
} from './container-types';

// The container-engine protocol (#973): what Studio says to a container-engine plugin, and what it
// answers. Keep this module platform-neutral (types, constants and pure functions only) so both
// compilation targets can import it; a plugin keeps its own copy, as the version-control and hosting
// plugins do.
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
