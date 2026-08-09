import * as net from 'node:net';
import { PermissionFactory } from '../permission-broker';
import { PermissionId } from '../permission';

/**
 * The handle the `docker.socket` permission resolves to: the sole door to the Docker Engine's local
 * socket. P3's Docker backend (#391) speaks the Engine API over this and never sees the raw path,
 * so the path (and any future policy on it) stays owned here.
 */
export interface DockerSocket {
  /**
   * Gets the resolved socket path (a Unix domain socket, or a Windows named pipe).
   */
  readonly path: string;

  /**
   * Opens a fresh connection to the Docker Engine socket.
   * @returns Returns a promise for the connected socket.
   */
  connect(): Promise<net.Socket>;
}

/**
 * Resolves the platform-default Docker Engine socket path: the Windows named pipe, or the Unix domain
 * socket everywhere else. A settings-driven override can replace this resolver later without touching
 * the factory or the broker.
 * @returns Returns the default socket path for the current platform.
 */
export function resolveDockerSocketPath(): string {
  return process.platform === 'win32' ? '\\\\.\\pipe\\docker_engine' : '/var/run/docker.sock';
}

/**
 * Mints the {@link DockerSocket} handle for the `docker.socket` permission. The path is resolved
 * through an injected resolver (defaulting to the platform default), so the factory carries no
 * settings dependency and is unit-testable.
 */
export class DockerSocketFactory implements PermissionFactory<DockerSocket> {
  /**
   * Gets the permission this factory mints the handle for.
   */
  public readonly id: PermissionId = 'docker.socket';

  /**
   * Initializes a new instance of the {@link DockerSocketFactory} class.
   * @param resolvePath Resolves the socket path; defaults to {@link resolveDockerSocketPath}.
   */
  public constructor(private readonly resolvePath: () => string = resolveDockerSocketPath) {}

  /**
   * Creates a {@link DockerSocket} bound to the resolved path.
   * @returns Returns the socket handle.
   */
  public create(): DockerSocket {
    const path: string = this.resolvePath();
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
