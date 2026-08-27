import * as net from 'node:net';
import { logger } from '../../../logger';
import { containerEngineCatalogue } from '../../docker/container-engine';
import { selectedEngine } from '../../docker/engine-selection';
import { PermissionFactory } from '../permission-broker';
import { PermissionId } from '../permission';

/**
 * The handle the `container.socket` permission resolves to: the sole door to the local socket of the
 * container engine in effect. The containers backend (#391) speaks the Engine API over this and never
 * sees the raw path, so the path (and any future policy on it) stays owned here.
 */
export interface ContainerSocket {
  /**
   * Gets the resolved socket path (a Unix domain socket, or a Windows named pipe).
   */
  readonly path: string;

  /**
   * Opens a fresh connection to the container engine socket.
   * @returns Returns a promise for the connected socket.
   */
  connect(): Promise<net.Socket>;
}

/**
 * Resolves the socket path of the container engine in effect — the user's chosen engine when they have
 * one and it is present, otherwise the highest-priority engine that is. Docker and Podman both serve
 * the Docker Engine API, so the difference between them is entirely which socket this returns.
 * @returns Returns the socket path for the engine in effect.
 */
export function resolveContainerSocketPath(): string {
  return selectedEngine().socketPath() ?? containerEngineCatalogue()[0].socketPath() ?? '';
}

/**
 * Mints the {@link ContainerSocket} handle for the `container.socket` permission. The path is resolved
 * through an injected resolver (defaulting to the platform default), so the factory carries no
 * settings dependency and is unit-testable.
 */
export class ContainerSocketFactory implements PermissionFactory<ContainerSocket> {
  /**
   * Gets the permission this factory mints the handle for.
   */
  public readonly id: PermissionId = 'container.socket';

  /**
   * Initializes a new instance of the {@link ContainerSocketFactory} class.
   * @param resolvePath Resolves the socket path; defaults to {@link resolveContainerSocketPath}.
   */
  public constructor(private readonly resolvePath: () => string = resolveContainerSocketPath) {}

  /**
   * Creates a {@link ContainerSocket} bound to the resolved path.
   * @returns Returns the socket handle.
   */
  public create(): ContainerSocket {
    const path: string = this.resolvePath();
    logger.debug('ContainerSocket', `Minted container engine socket handle for ${path}`);
    return {
      path,
      connect: (): Promise<net.Socket> =>
        new Promise<net.Socket>(
          (resolve: (socket: net.Socket) => void, reject: (error: Error) => void): void => {
            const socket: net.Socket = net.connect(path);
            socket.once('connect', (): void => resolve(socket));
            socket.once('error', reject);
          },
        ),
    };
  }
}
