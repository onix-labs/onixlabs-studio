import * as path from 'node:path';
import {
  ContainerEvent,
  ContainerStatus,
  ContainerSummary,
  ImageSummary,
} from '@shared/api/container-types';
import { SlotEntry } from '@shared/api/slot';
import { contributedEngines } from './container-engine-registry';
import { DockerStreamHandle } from './docker-transport';
import {
  DiscoveryEnvironment,
  EndpointDiscovery,
  processDiscoveryEnvironment,
  reportEndpoint,
  resolveEndpoint,
  ResolvedEndpoint,
} from './socket-discovery';

/**
 * The container engine slot's contract: everything the Containers surface asks of whatever is behind
 * it. Docker was the first implementation and the shape is its API's, but nothing here is Docker's
 * alone — listing, starting, stopping, removing, reporting status and watching events are what any
 * container engine does.
 *
 * The renderer-facing contract was already generic; only the implementation was named after one
 * engine. This is the seam that makes that honest.
 */
export interface ContainerEngine {
  /**
   * Lists the containers the engine knows about.
   * @returns Returns the container summaries.
   */
  listContainers(): Promise<ContainerSummary[]>;

  /**
   * Lists the images available locally.
   * @returns Returns the image summaries.
   */
  listImages(): Promise<ImageSummary[]>;

  /**
   * Starts a container.
   * @param id The container identifier.
   * @returns Returns true when the engine accepted the request.
   */
  start(id: string): Promise<boolean>;

  /**
   * Stops a container.
   * @param id The container identifier.
   * @returns Returns true when the engine accepted the request.
   */
  stop(id: string): Promise<boolean>;

  /**
   * Removes a container.
   * @param id The container identifier.
   * @returns Returns true when the engine accepted the request.
   */
  remove(id: string): Promise<boolean>;

  /**
   * Reports whether the engine is reachable, and what it is.
   * @returns Returns the status.
   */
  status(): Promise<ContainerStatus>;

  /**
   * Watches the engine's event stream.
   * @param onEvent Invoked for each event.
   * @returns Returns the stream handle, closed to stop watching.
   */
  watch(onEvent: (event: ContainerEvent) => void): DockerStreamHandle;
}

/**
 * Describes one container engine the application can talk to — the unit the container-engine slot is
 * filled with.
 *
 * Note what this slot is *not* keyed by. A language server is chosen per language; an engine is chosen
 * once, because there is nothing to vary it by. That is why it extends the plain {@link SlotEntry}
 * rather than the language-keyed one, and it is the reason the two were separated: keying is a
 * specialisation of a slot, not part of what a slot is.
 */
export interface ContainerEngineDescriptor extends SlotEntry {
  /**
   * Gets how this engine's socket is found: the environment variable that names it, whether the
   * `docker` context store does, and the platform defaults to fall back on (#593).
   */
  readonly discovery: EndpointDiscovery;

  /**
   * Gets the command-line tool that drives the engine directly, used for the operations that are a
   * terminal session rather than an API call — following logs, opening a shell in a container.
   */
  readonly cli: string;

  /**
   * Gets the command the user runs to start the engine themselves on a platform, or null when there is
   * nothing useful to tell them (because the application can do it, or because the answer depends on an
   * installation the application cannot see).
   * @param platform The platform to resolve for.
   * @returns Returns the command, or null.
   */
  startCommand(platform: NodeJS.Platform): string | null;
}

/**
 * Gets the runtime directory a rootless engine keeps its socket under, or null when unset.
 * @returns Returns the runtime directory, or null.
 */
function runtimeDirectory(): string | null {
  const runtime: string | undefined = process.env['XDG_RUNTIME_DIR'];
  return runtime !== undefined && runtime.length > 0 ? runtime : null;
}

/**
 * The Podman engine descriptor. Podman serves the Docker Engine API, so the same client speaks to it
 * unchanged — the whole difference is which socket to open and which CLI to drive, which is precisely
 * what a slot descriptor should carry.
 *
 * Rootless Podman puts its socket under the runtime directory; rootful puts it in `/run`. Both are
 * offered, nearest first.
 */
const PODMAN: ContainerEngineDescriptor = {
  id: 'podman',
  displayName: 'Podman',
  priority: 50,
  cli: 'podman',
  // Podman keeps its own configuration rather than appearing in the docker context store, so it is
  // found by its own variable and its own candidates: rootless under the runtime directory first,
  // then rootful in `/run`.
  discovery: {
    hostVariable: 'CONTAINER_HOST',
    dockerContext: false,
    defaults: (platform: NodeJS.Platform): readonly string[] => {
      if (platform === 'win32') {
        return ['\\\\.\\pipe\\podman-machine-default'];
      }
      const runtime: string | null = runtimeDirectory();
      const rootless: string | null =
        runtime === null ? null : path.join(runtime, 'podman', 'podman.sock');
      return rootless === null
        ? ['/run/podman/podman.sock']
        : [rootless, '/run/podman/podman.sock'];
    },
  },
  // No Podman application to open: macOS and Windows run it in a virtual machine the user starts, and
  // Linux serves it from a socket-activated user unit. Saying which command brings it up is the whole
  // of what the surface can honestly offer.
  startCommand: (platform: NodeJS.Platform): string | null =>
    platform === 'linux' ? 'systemctl --user start podman.socket' : 'podman machine start',
};

/**
 * The container engines the application can talk to: the built-in ones, then whatever installed
 * plugins contribute (#594).
 *
 * No longer a closed list. It was one when the comment here said so, and the analogy it drew — "like
 * the debug adapters" — is exactly what expired: debug adapters became a contribution point, and an
 * engine is the same kind of thing, an implementation filling a slot the application defines.
 *
 * Built-ins come first so that registration order, which breaks ties between equal priorities, cannot
 * be changed by installing a plugin.
 * @returns Returns the descriptors, in registration order.
 */
export function containerEngineCatalogue(): readonly ContainerEngineDescriptor[] {
  return [PODMAN, ...contributedEngines.all()];
}

/**
 * Resolves where an engine's socket is, following the discovery order in {@link resolveEndpoint}, and
 * reports it to the log when the answer changes.
 * @param descriptor The engine to locate.
 * @param environment The discovery environment; defaults to the running process.
 * @returns Returns the resolved endpoint, or null when the engine does not run on this platform.
 */
export function engineEndpoint(
  descriptor: ContainerEngineDescriptor,
  environment: DiscoveryEnvironment = processDiscoveryEnvironment(),
): ResolvedEndpoint | null {
  const endpoint: ResolvedEndpoint | null = resolveEndpoint(descriptor.discovery, environment);
  reportEndpoint(descriptor.id, endpoint);
  return endpoint;
}

/**
 * Gets the socket path an engine's API is served on, or null when the engine does not run here. The
 * path is returned whether or not anything is listening on it: the caller that opens the socket needs
 * somewhere to try, and the caller that reports a failure needs something to name.
 * @param descriptor The engine to locate.
 * @param environment The discovery environment; defaults to the running process.
 * @returns Returns the socket path, or null.
 */
export function engineSocketPath(
  descriptor: ContainerEngineDescriptor,
  environment: DiscoveryEnvironment = processDiscoveryEnvironment(),
): string | null {
  return engineEndpoint(descriptor, environment)?.path ?? null;
}

/**
 * Gets whether an engine is present on this machine, by looking for the socket discovery resolves to.
 * This is the engine slot's equivalent of a plugin being installed: an engine whose socket is absent is
 * not something the user can choose, and offering it would be offering a connection that cannot be
 * made.
 *
 * Windows named pipes do not appear on the file system the way sockets do, so there they are always
 * treated as candidates and the connection attempt is what reports the truth.
 * @param descriptor The engine to test.
 * @param environment The discovery environment; defaults to the running process.
 * @returns Returns true when the engine looks reachable.
 */
export function isEngineAvailable(
  descriptor: ContainerEngineDescriptor,
  environment: DiscoveryEnvironment = processDiscoveryEnvironment(),
): boolean {
  return engineEndpoint(descriptor, environment)?.exists === true;
}
