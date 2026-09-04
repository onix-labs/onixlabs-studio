import { existsSync } from 'node:fs';
import * as path from 'node:path';
import {
  ContainerEvent,
  ContainerStatus,
  ContainerSummary,
  ImageSummary,
} from '@shared/api/container-types';
import { SlotEntry } from '@shared/api/slot';
import { dockerDesktopLaunchCommand } from './docker-desktop';
import { DockerStreamHandle } from './docker-transport';

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
   * Gets the socket path the engine's API is served on for this platform, or null when the engine does
   * not run here.
   */
  socketPath(): string | null;

  /**
   * Gets the command-line tool that drives the engine directly, used for the operations that are a
   * terminal session rather than an API call — following logs, opening a shell in a container.
   */
  readonly cli: string;

  /**
   * Gets whether the application can start this engine itself on a platform. An engine that ships a
   * launchable desktop application can be started for the user; one that is a daemon the user brings up
   * themselves cannot, and pretending otherwise is what {@link startCommand} exists to avoid.
   * @param platform The platform to resolve for.
   * @returns Returns true when the engine can be launched from the surface.
   */
  canLaunch(platform: NodeJS.Platform): boolean;

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
 * The Docker engine descriptor. The default, because it is what most machines with containers have.
 */
const DOCKER: ContainerEngineDescriptor = {
  id: 'docker',
  displayName: 'Docker',
  priority: 100,
  cli: 'docker',
  socketPath: (): string =>
    process.platform === 'win32' ? '\\\\.\\pipe\\docker_engine' : '/var/run/docker.sock',
  // Docker Desktop is an application the operating system can be asked to open, on every platform the
  // launcher knows how to do it for.
  canLaunch: (platform: NodeJS.Platform): boolean =>
    dockerDesktopLaunchCommand(platform, process.env) !== null,
  startCommand: (): string | null => null,
};

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
  socketPath: (): string | null => {
    if (process.platform === 'win32') {
      return '\\\\.\\pipe\\podman-machine-default';
    }
    const runtime: string | null = runtimeDirectory();
    const rootless: string | null =
      runtime === null ? null : path.join(runtime, 'podman', 'podman.sock');
    if (rootless !== null && existsSync(rootless)) {
      return rootless;
    }
    return '/run/podman/podman.sock';
  },
  // There is no Podman application to open: macOS and Windows run it in a virtual machine the user
  // starts, and Linux serves it from a socket-activated user unit. All the surface can honestly do is
  // say which command brings it up.
  canLaunch: (): boolean => false,
  startCommand: (platform: NodeJS.Platform): string | null =>
    platform === 'linux' ? 'systemctl --user start podman.socket' : 'podman machine start',
};

/**
 * The container engines the application knows how to talk to.
 *
 * A closed list, like the debug adapters: a new engine is a change to what the application supports,
 * and the runtime-contributed case is the plugin loader's concern (#295).
 * @returns Returns the descriptors, in registration order.
 */
export function containerEngineCatalogue(): readonly ContainerEngineDescriptor[] {
  return [DOCKER, PODMAN];
}

/**
 * Gets whether an engine is present on this machine, by looking for its socket. This is the engine
 * slot's equivalent of a plugin being installed: an engine whose socket is absent is not something the
 * user can choose, and offering it would be offering a connection that cannot be made.
 *
 * Windows named pipes do not appear on the file system the way sockets do, so there they are always
 * treated as candidates and the connection attempt is what reports the truth.
 * @param descriptor The engine to test.
 * @returns Returns true when the engine looks reachable.
 */
export function isEngineAvailable(descriptor: ContainerEngineDescriptor): boolean {
  const socket: string | null = descriptor.socketPath();
  if (socket === null) {
    return false;
  }
  return process.platform === 'win32' ? true : existsSync(socket);
}
