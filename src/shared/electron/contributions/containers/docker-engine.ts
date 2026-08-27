import {
  ContainerSummary,
  DockerEvent,
  DockerStatus,
  ImageSummary,
} from '@shared/api/docker-types';
import { ContainerSocket } from '../permissions/brokers/container-socket';
import { ContainerEngine } from './container-engine';
import { DockerStreamHandle, DockerTransport, HttpDockerTransport } from './docker-transport';

/**
 * The raw container shape from `GET /containers/json`.
 */
interface RawContainer {
  readonly Id?: string;
  readonly Names?: readonly string[];
  readonly Image?: string;
  readonly State?: string;
  readonly Status?: string;
}

/**
 * The raw image shape from `GET /images/json`.
 */
interface RawImage {
  readonly Id?: string;
  readonly RepoTags?: readonly string[];
  readonly Size?: number;
}

/**
 * The raw event shape from `GET /events`.
 */
interface RawEvent {
  readonly Type?: string;
  readonly Action?: string;
  readonly Actor?: { readonly ID?: string };
}

/**
 * The initial and maximum reconnect delays (ms) for the event watcher's capped exponential backoff.
 */
const INITIAL_BACKOFF_MS: number = 1_000;
const MAX_BACKOFF_MS: number = 30_000;

/**
 * A thin client for the Docker Engine API, speaking it over an injected {@link DockerTransport}
 * (HTTP-over-socket by default). Every operation is daemon-absent-safe: a connection failure resolves
 * to an empty result or an unavailable status rather than throwing to the renderer, and the event
 * watcher reconnects with capped backoff so the dashboard recovers when Docker starts.
 */
export class DockerEngine implements ContainerEngine {
  /**
   * The transport the Engine API is spoken over.
   */
  private readonly transport: DockerTransport;

  /**
   * Initializes a new instance of the {@link DockerEngine} class.
   * @param socket The granted Docker socket handle (its path drives the default transport).
   * @param transport The transport to use; defaults to HTTP over the socket path.
   */
  public constructor(socket: ContainerSocket, transport?: DockerTransport) {
    this.transport = transport ?? new HttpDockerTransport(socket.path);
  }

  /**
   * Lists all containers, running and stopped. Returns an empty list when the daemon is unreachable.
   * @returns Returns the container summaries.
   */
  public async listContainers(): Promise<ContainerSummary[]> {
    const raw: RawContainer[] | null = await this.getJson<RawContainer[]>('/containers/json?all=1');
    return (raw ?? []).map(
      (container: RawContainer): ContainerSummary => ({
        id: container.Id ?? '',
        names: (container.Names ?? []).map((name: string): string => name.replace(/^\//, '')),
        image: container.Image ?? '',
        state: container.State ?? '',
        status: container.Status ?? '',
      }),
    );
  }

  /**
   * Lists all images. Returns an empty list when the daemon is unreachable.
   * @returns Returns the image summaries.
   */
  public async listImages(): Promise<ImageSummary[]> {
    const raw: RawImage[] | null = await this.getJson<RawImage[]>('/images/json');
    return (raw ?? []).map(
      (image: RawImage): ImageSummary => ({
        id: image.Id ?? '',
        tags: image.RepoTags ?? [],
        size: image.Size ?? 0,
      }),
    );
  }

  /**
   * Starts a container.
   * @param id The container id.
   * @returns Returns true when the daemon accepted the request.
   */
  public start(id: string): Promise<boolean> {
    return this.act('POST', `/containers/${encodeURIComponent(id)}/start`);
  }

  /**
   * Stops a container.
   * @param id The container id.
   * @returns Returns true when the daemon accepted the request.
   */
  public stop(id: string): Promise<boolean> {
    return this.act('POST', `/containers/${encodeURIComponent(id)}/stop`);
  }

  /**
   * Removes a container.
   * @param id The container id.
   * @returns Returns true when the daemon accepted the request.
   */
  public remove(id: string): Promise<boolean> {
    return this.act('DELETE', `/containers/${encodeURIComponent(id)}`);
  }

  /**
   * Reports whether the daemon is reachable, and its version when it is.
   * @returns Returns the daemon status.
   */
  public async status(): Promise<DockerStatus> {
    const raw: { Version?: string } | null = await this.getJson<{ Version?: string }>('/version');
    return raw === null ? { available: false } : { available: true, version: raw.Version };
  }

  /**
   * Watches the daemon's event stream, delivering each normalised event to `onEvent`. Reconnects with
   * capped backoff when the stream drops (so the dashboard recovers when Docker restarts) until the
   * returned handle is closed.
   * @param onEvent Receives each normalised event.
   * @returns Returns a handle that stops watching.
   */
  public watch(onEvent: (event: DockerEvent) => void): DockerStreamHandle {
    let closed: boolean = false;
    let stream: DockerStreamHandle | null = null;
    let backoff: number = INITIAL_BACKOFF_MS;

    const connect: () => void = (): void => {
      if (closed) {
        return;
      }
      stream = this.transport.openStream(
        'GET',
        '/events',
        (line: string): void => {
          const event: DockerEvent | null = parseEvent(line);
          if (event !== null) {
            onEvent(event);
          }
          backoff = INITIAL_BACKOFF_MS; // a live stream resets the backoff
        },
        (): void => {
          stream = null;
          scheduleReconnect();
        },
      );
    };

    const scheduleReconnect: () => void = (): void => {
      if (closed) {
        return;
      }
      const delay: number = backoff;
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      setTimeout(connect, delay);
    };

    connect();
    return {
      close: (): void => {
        closed = true;
        stream?.close();
      },
    };
  }

  /**
   * Performs a mutating request, reporting whether the daemon accepted it. Never throws: a connection
   * failure resolves false.
   * @param method The HTTP method.
   * @param path The request path.
   * @returns Returns true on a 2xx response.
   */
  private async act(method: string, path: string): Promise<boolean> {
    try {
      const response: { statusCode: number } = await this.transport.request(method, path);
      return response.statusCode >= 200 && response.statusCode < 300;
    } catch {
      return false;
    }
  }

  /**
   * Performs a GET and parses its JSON body, or resolves null when the daemon is unreachable, answers
   * with a non-2xx status, or returns a malformed body — so callers can fall back rather than throw.
   * @param path The request path.
   * @returns Returns the parsed body, or null.
   */
  private async getJson<T>(path: string): Promise<T | null> {
    try {
      const response: { statusCode: number; body: string } = await this.transport.request(
        'GET',
        path,
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return null;
      }
      return JSON.parse(response.body) as T;
    } catch {
      return null;
    }
  }
}

/**
 * Normalises one raw Docker event line into a {@link DockerEvent}, or null when the line is not valid
 * JSON. Exported for unit testing.
 * @param line One newline-delimited body line from `GET /events`.
 * @returns Returns the normalised event, or null.
 */
export function parseEvent(line: string): DockerEvent | null {
  let raw: RawEvent;
  try {
    raw = JSON.parse(line) as RawEvent;
  } catch {
    return null;
  }
  return {
    type: raw.Type ?? '',
    action: raw.Action ?? '',
    id: raw.Actor?.ID ?? '',
  };
}
