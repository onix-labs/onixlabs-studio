import {
  ContainerEvent,
  ContainerLogs,
  ContainerPort,
  ContainerStats,
  ContainerStatus,
  ContainerSummary,
  ImagePullProgress,
  ImageSummary,
  RunContainerRequest,
  VolumeSummary,
} from './protocol';
import {
  SocketHttpResponse,
  SocketHttpTransport,
  SocketTransport,
  StreamHandle,
} from './transport';

/**
 * The raw container shape from `GET /containers/json`.
 */
interface RawContainer {
  readonly Id?: string;
  readonly Names?: readonly string[];
  readonly Image?: string;
  readonly State?: string;
  readonly Status?: string;
  readonly Created?: number;
  readonly Ports?: readonly {
    readonly PrivatePort?: number;
    readonly PublicPort?: number;
    readonly Type?: string;
    readonly IP?: string;
  }[];
  readonly Mounts?: readonly { readonly Type?: string; readonly Name?: string }[];
}

/**
 * The raw sample shape from `GET /containers/{id}/stats`, narrowed to what the summary reads.
 */
interface RawStats {
  readonly cpu_stats?: RawCpu;
  readonly precpu_stats?: RawCpu;
  readonly memory_stats?: {
    readonly usage?: number;
    readonly limit?: number;
    readonly stats?: { readonly cache?: number; readonly inactive_file?: number };
  };
}

/**
 * The raw CPU shape inside a stats sample.
 */
interface RawCpu {
  readonly cpu_usage?: { readonly total_usage?: number; readonly percpu_usage?: readonly number[] };
  readonly system_cpu_usage?: number;
  readonly online_cpus?: number;
}

/**
 * The raw volume shape from `GET /volumes`.
 */
interface RawVolume {
  readonly Name?: string;
  readonly Driver?: string;
  readonly CreatedAt?: string;
  readonly Labels?: Readonly<Record<string, string>> | null;
}

/**
 * One progress line from `POST /images/create`.
 */
interface RawPullLine {
  readonly id?: string;
  readonly status?: string;
  readonly error?: string;
  readonly progressDetail?: { readonly current?: number; readonly total?: number };
}

/**
 * How often, at most, a pull's progress is reported while it runs.
 */
const PULL_REPORT_MS: number = 250;

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
 * How many containers are sampled at once. Enough to keep a tick short, few enough that a tick is not
 * fifty connections to the engine.
 */
const STATS_CONCURRENCY: number = 8;

/**
 * The initial and maximum reconnect delays (ms) for the event watcher's capped exponential backoff.
 */
const INITIAL_BACKOFF_MS: number = 1_000;
const MAX_BACKOFF_MS: number = 30_000;

/**
 * A thin client for the Docker Engine API, speaking it over an injected {@link SocketTransport}
 * (HTTP-over-socket by default). Every operation is daemon-absent-safe: a connection failure resolves
 * to an empty result or an unavailable status rather than throwing to the renderer, and the event
 * watcher reconnects with capped backoff so the dashboard recovers when the engine starts.
 *
 * **The `Docker` in this class's name is the protocol, not the product.** "Docker Engine API" is what
 * the wire format is called — Podman describes its own implementation of it as Docker-compatible — and
 * this file implements that specification, so the name is what tells a reader which reference to go and
 * read. A neutral name would say strictly less. The test of it: this class serves every engine in the
 * catalogue, and none of them is Docker.
 *
 * That argument reaches exactly this far and no further. The transport underneath was called
 * `DockerTransport` on the same reasoning, and there it did not hold: it carries HTTP over a socket and
 * knows nothing of any API, so it had been named after its only caller rather than after what it does,
 * and was renamed (#598). The line is between the layer that *implements* the protocol, named for it,
 * and the layer that carries bytes, named for that.
 */
export class DockerEngine {
  /**
   * The transport the Engine API is spoken over.
   */
  private readonly transport: SocketTransport;

  /**
   * Initializes a new instance of the {@link DockerEngine} class.
   * @param socketPath The engine's socket, as Studio resolved it through the `container.socket`
   * permission and passed at `initialize`.
   * @param transport The transport to use; defaults to HTTP over the socket path.
   */
  public constructor(socketPath: string, transport?: SocketTransport) {
    this.transport = transport ?? new SocketHttpTransport(socketPath);
  }

  /**
   * Lists all containers, running and stopped. Returns an empty list when the daemon is unreachable.
   * @returns Returns the container summaries.
   */
  public async listContainers(): Promise<ContainerSummary[]> {
    const raw: RawContainer[] | null = await this.getJson<RawContainer[]>('/containers/json?all=1');
    return (raw ?? []).map((container: RawContainer): ContainerSummary => ({
      id: container.Id ?? '',
      names: (container.Names ?? []).map((name: string): string => name.replace(/^\//, '')),
      image: container.Image ?? '',
      state: container.State ?? '',
      status: container.Status ?? '',
      ports: (container.Ports ?? [])
        .filter((port): boolean => typeof port.PrivatePort === 'number')
        .map((port): ContainerPort => ({
          privatePort: port.PrivatePort!,
          ...(typeof port.PublicPort === 'number' ? { publicPort: port.PublicPort } : {}),
          protocol: port.Type ?? 'tcp',
          ...(port.IP === undefined || port.IP.length === 0 ? {} : { ip: port.IP }),
        })),
      ...(typeof container.Created === 'number' ? { created: container.Created } : {}),
      volumes: (container.Mounts ?? [])
        .filter((mount): boolean => mount.Type === 'volume' && typeof mount.Name === 'string')
        .map((mount): string => mount.Name!),
    }));
  }

  /**
   * Holds the CPU counters of the last sample taken of each container, so the next sample's share is
   * measured against it.
   */
  private readonly lastCpu: Map<string, RawCpu> = new Map<string, RawCpu>();

  /**
   * Samples the resource use of the containers named. A container that has stopped, or cannot be
   * read, is left out rather than reported as idle.
   *
   * One snapshot each (`one-shot=true`): without it the engine takes two samples a second apart to fill
   * in the CPU delta itself, which held one connection per container open for that second — fifty
   * containers, fifty connections, every tick (audit P1). The delta is measured here instead, against
   * the counters of the previous sample, so the first sample of a container reports no CPU and every
   * later one reports its use since the last. At most {@link STATS_CONCURRENCY} requests run at once.
   * @param ids The container ids.
   * @returns Returns a sample per container that answered.
   */
  public async stats(ids: readonly string[]): Promise<ContainerStats[]> {
    const samples: ContainerStats[] = [];
    const queue: string[] = [...ids];
    const worker: () => Promise<void> = async (): Promise<void> => {
      for (let id: string | undefined = queue.shift(); id !== undefined; id = queue.shift()) {
        const raw: RawStats | null = await this.getJson<RawStats>(
          `/containers/${encodeURIComponent(id)}/stats?stream=false&one-shot=true`,
        );
        if (raw === null) {
          this.lastCpu.delete(id);
          continue;
        }
        samples.push(statsOf(id, raw, this.lastCpu.get(id)));
        if (raw.cpu_stats !== undefined) {
          this.lastCpu.set(id, raw.cpu_stats);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(STATS_CONCURRENCY, ids.length) }, worker));
    // Forget containers that are no longer asked about, so the map does not grow with every
    // container that ever ran.
    for (const id of [...this.lastCpu.keys()]) {
      if (!ids.includes(id)) {
        this.lastCpu.delete(id);
      }
    }
    return samples;
  }

  /**
   * Lists the volumes. Returns an empty list when the daemon is unreachable.
   * @returns Returns the volume summaries.
   */
  public async listVolumes(): Promise<VolumeSummary[]> {
    const raw: { Volumes?: RawVolume[] | null } | null = await this.getJson<{
      Volumes?: RawVolume[] | null;
    }>('/volumes');
    return (raw?.Volumes ?? []).map((volume: RawVolume): VolumeSummary => ({
      name: volume.Name ?? '',
      driver: volume.Driver ?? '',
      createdAt: volume.CreatedAt ?? '',
      anonymous: volume.Labels?.['com.docker.volume.anonymous'] !== undefined,
    }));
  }

  /**
   * Removes a volume. The engine refuses one a container still uses.
   * @param name The volume's name.
   * @returns Returns true when it was removed.
   */
  public removeVolume(name: string): Promise<boolean> {
    return this.act('DELETE', `/volumes/${encodeURIComponent(name)}`);
  }

  /**
   * Pauses a running container.
   * @param id The container id.
   * @returns Returns true when the daemon accepted the request.
   */
  public pause(id: string): Promise<boolean> {
    return this.act('POST', `/containers/${encodeURIComponent(id)}/pause`);
  }

  /**
   * Resumes a paused container.
   * @param id The container id.
   * @returns Returns true when the daemon accepted the request.
   */
  public unpause(id: string): Promise<boolean> {
    return this.act('POST', `/containers/${encodeURIComponent(id)}/unpause`);
  }

  /**
   * Restarts a container.
   * @param id The container id.
   * @returns Returns true when the daemon accepted the request.
   */
  public restart(id: string): Promise<boolean> {
    return this.act('POST', `/containers/${encodeURIComponent(id)}/restart`);
  }

  /**
   * Removes an image. Without `force` the engine refuses one a container still uses.
   * @param id The image id or reference.
   * @param force Whether to remove it even so.
   * @returns Returns true when it was removed.
   */
  public removeImage(id: string, force: boolean): Promise<boolean> {
    return this.act('DELETE', `/images/${encodeURIComponent(id)}?force=${force ? 1 : 0}`);
  }

  /**
   * Downloads an image, reporting how far it has got as it goes and once more when it has finished.
   * @param reference The image reference, such as `postgres:16`; `latest` when no tag is given.
   * @param onProgress Receives the progress.
   * @returns Returns whether it succeeded, and why not.
   */
  public async pullImage(
    reference: string,
    onProgress: (progress: ImagePullProgress) => void,
  ): Promise<{ ok: boolean; error?: string }> {
    const { name, tag } = splitReference(reference);
    const layers: Map<string, { current: number; total: number }> = new Map<
      string,
      { current: number; total: number }
    >();
    let status: string = 'Starting';
    let error: string | undefined;
    let lastReport: number = 0;
    const report: (done: boolean) => void = (done: boolean): void => {
      let current: number = 0;
      let total: number = 0;
      for (const layer of layers.values()) {
        current += layer.current;
        total += layer.total;
      }
      onProgress({
        reference,
        status,
        ...(total > 0 ? { current, total } : {}),
        done,
        ...(error === undefined ? {} : { error }),
      });
    };
    if (this.transport.requestLines === undefined) {
      return { ok: false, error: 'This transport cannot stream a download.' };
    }
    try {
      const statusCode: number = await this.transport.requestLines(
        'POST',
        `/images/create?fromImage=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`,
        (line: string): void => {
          let raw: RawPullLine;
          try {
            raw = JSON.parse(line) as RawPullLine;
          } catch {
            return;
          }
          if (raw.error !== undefined) {
            error = raw.error;
            return;
          }
          status = raw.status ?? status;
          if (raw.id !== undefined && raw.progressDetail?.total !== undefined) {
            layers.set(raw.id, {
              current: raw.progressDetail.current ?? 0,
              total: raw.progressDetail.total,
            });
          }
          const now: number = Date.now();
          if (now - lastReport >= PULL_REPORT_MS) {
            lastReport = now;
            report(false);
          }
        },
      );
      if (error === undefined && (statusCode < 200 || statusCode >= 300)) {
        error = `The engine refused the download (${statusCode}).`;
      }
    } catch (failure: unknown) {
      error = failure instanceof Error ? failure.message : 'The engine could not be reached.';
    }
    status = error === undefined ? 'Downloaded' : 'Failed';
    report(true);
    return error === undefined ? { ok: true } : { ok: false, error };
  }

  /**
   * Creates a container from an image and starts it.
   * @param request What to run.
   * @returns Returns the new container's id, or why it could not be run.
   */
  public async run(request: RunContainerRequest): Promise<{ id?: string; error?: string }> {
    const query: string =
      request.name === undefined || request.name.length === 0
        ? ''
        : `?name=${encodeURIComponent(request.name)}`;
    let created: { statusCode: number; body: string };
    try {
      created = await this.transport.request(
        'POST',
        `/containers/create${query}`,
        createBody(request),
      );
    } catch {
      return { error: 'The engine could not be reached.' };
    }
    if (created.statusCode === 404) {
      return { error: `There is no image "${request.image}" on this machine. Pull it first.` };
    }
    if (created.statusCode < 200 || created.statusCode >= 300) {
      return {
        error: engineMessage(created.body) ?? `The engine refused (${created.statusCode}).`,
      };
    }
    const id: string = (JSON.parse(created.body) as { Id?: string }).Id ?? '';
    if (!(await this.start(id))) {
      return { id, error: 'The container was created but did not start.' };
    }
    return { id };
  }

  /**
   * Lists all images. Returns an empty list when the daemon is unreachable.
   * @returns Returns the image summaries.
   */
  public async listImages(): Promise<ImageSummary[]> {
    const raw: RawImage[] | null = await this.getJson<RawImage[]>('/images/json');
    return (raw ?? []).map((image: RawImage): ImageSummary => ({
      id: image.Id ?? '',
      tags: image.RepoTags ?? [],
      size: image.Size ?? 0,
    }));
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
   * Reads a container's most recent log lines, stdout and stderr together, each with its timestamp.
   * Resolves no lines when the daemon is unreachable or the container is gone.
   * @param id The container id.
   * @param tail How many lines, at most.
   * @returns Returns the lines, oldest first.
   */
  public async logs(id: string, tail: number): Promise<ContainerLogs> {
    const lines: number = Math.max(1, Math.min(5_000, Math.floor(tail)));
    try {
      const response: SocketHttpResponse = await this.transport.request(
        'GET',
        `/containers/${encodeURIComponent(id)}/logs?stdout=1&stderr=1&timestamps=1&tail=${lines}`,
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return { lines: [], truncated: false };
      }
      const text: string[] = demuxLogs(response.bytes)
        .split('\n')
        .filter((line: string): boolean => line.length > 0);
      return { lines: text, truncated: text.length >= lines };
    } catch {
      return { lines: [], truncated: false };
    }
  }

  /**
   * Reports whether the daemon is reachable, and its version when it is.
   * @returns Returns the daemon status.
   */
  public async status(): Promise<ContainerStatus> {
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
  public watch(onEvent: (event: ContainerEvent) => void): StreamHandle {
    let closed: boolean = false;
    let stream: StreamHandle | null = null;
    let backoff: number = INITIAL_BACKOFF_MS;

    const connect: () => void = (): void => {
      if (closed) {
        return;
      }
      stream = this.transport.openStream(
        'GET',
        '/events',
        (line: string): void => {
          const event: ContainerEvent | null = parseEvent(line);
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
 * Normalises one raw Docker event line into a {@link ContainerEvent}, or null when the line is not valid
 * JSON. Exported for unit testing.
 * @param line One newline-delimited body line from `GET /events`.
 * @returns Returns the normalised event, or null.
 */
export function parseEvent(line: string): ContainerEvent | null {
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

/**
 * Reads a container's log body as text. A container without a terminal sends its output framed: each
 * frame an eight-byte header — which stream, three zero bytes, then the payload's length — and the
 * payload. One with a terminal sends plain text. The two are told apart by whether the body opens with
 * a header. Exported for unit testing.
 * @param bytes The body as it arrived.
 * @returns Returns the text.
 */
export function demuxLogs(bytes: Buffer): string {
  const framed: boolean =
    bytes.length >= 8 && bytes[0] <= 2 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0;
  if (!framed) {
    return bytes.toString('utf8');
  }
  const parts: Buffer[] = [];
  let offset: number = 0;
  while (offset + 8 <= bytes.length) {
    const size: number = bytes.readUInt32BE(offset + 4);
    parts.push(bytes.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size;
  }
  return Buffer.concat(parts).toString('utf8');
}

/**
 * Summarises one stats sample the way `docker stats` does: the CPU used since the previous sample, as
 * a share of the whole machine scaled by its cores; and the memory in use, without the page cache the
 * kernel can reclaim. The previous sample is the one this plugin took last, when it has one, else the
 * one the engine reports beside the current (which a one-shot sample leaves empty).
 * @param id The container id.
 * @param raw The sample.
 * @param lastCpu The CPU counters of the previous sample this plugin took, if any.
 * @returns Returns the summary.
 */
export function statsOf(id: string, raw: RawStats, lastCpu?: RawCpu): ContainerStats {
  const cpu: RawCpu = raw.cpu_stats ?? {};
  // No previous sample at all — the first one-shot read of a container — measures nothing: reporting
  // the counters since zero would show a lifetime average as if it were current use.
  const previous: RawCpu | undefined = lastCpu ?? raw.precpu_stats;
  const measurable: boolean = previous?.system_cpu_usage !== undefined;
  const cpuDelta: number =
    (cpu.cpu_usage?.total_usage ?? 0) - (previous?.cpu_usage?.total_usage ?? 0);
  const systemDelta: number = (cpu.system_cpu_usage ?? 0) - (previous?.system_cpu_usage ?? 0);
  const cores: number = cpu.online_cpus ?? cpu.cpu_usage?.percpu_usage?.length ?? 1;
  const memory: NonNullable<RawStats['memory_stats']> = raw.memory_stats ?? {};
  const cache: number = memory.stats?.inactive_file ?? memory.stats?.cache ?? 0;
  return {
    id,
    cpuPercent:
      measurable && cpuDelta > 0 && systemDelta > 0
        ? Math.round((cpuDelta / systemDelta) * cores * 1000) / 10
        : 0,
    memoryBytes: Math.max(0, (memory.usage ?? 0) - cache),
    memoryLimitBytes: memory.limit ?? 0,
  };
}

/**
 * Splits an image reference into the name and tag the engine's create call takes. A digest stays on
 * the name; a reference with no tag gets `latest`. A colon in a registry's host:port is not a tag.
 * @param reference The reference.
 * @returns Returns the name and the tag.
 */
export function splitReference(reference: string): { name: string; tag: string } {
  const trimmed: string = reference.trim();
  if (trimmed.includes('@')) {
    return { name: trimmed, tag: '' };
  }
  const colon: number = trimmed.lastIndexOf(':');
  return colon > trimmed.lastIndexOf('/')
    ? { name: trimmed.slice(0, colon), tag: trimmed.slice(colon + 1) }
    : { name: trimmed, tag: 'latest' };
}

/**
 * Builds the engine's container-create body for a request.
 * @param request What to run.
 * @returns Returns the body.
 */
export function createBody(request: RunContainerRequest): Record<string, unknown> {
  const exposed: Record<string, Record<string, never>> = {};
  const bindings: Record<string, { HostPort: string }[]> = {};
  for (const port of request.ports ?? []) {
    const key: string = `${port.container}/${port.protocol ?? 'tcp'}`;
    exposed[key] = {};
    (bindings[key] ??= []).push({ HostPort: String(port.host) });
  }
  return {
    Image: request.image,
    Env: Object.entries(request.env ?? {}).map(
      ([key, value]: [string, string]): string => `${key}=${value}`,
    ),
    ExposedPorts: exposed,
    HostConfig: {
      PortBindings: bindings,
      Binds: (request.volumes ?? []).map(
        (volume): string =>
          `${volume.source}:${volume.target}${volume.readOnly === true ? ':ro' : ''}`,
      ),
    },
  };
}

/**
 * Reads the engine's own message out of an error body.
 * @param body The body.
 * @returns Returns the message, or undefined.
 */
function engineMessage(body: string): string | undefined {
  try {
    const message: unknown = (JSON.parse(body) as { message?: unknown }).message;
    return typeof message === 'string' ? message : undefined;
  } catch {
    return undefined;
  }
}
