import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContainerEvent } from './protocol';
import { createBody, demuxLogs, DockerEngine, parseEvent, splitReference, statsOf } from './engine';
import { ImagePullProgress } from './protocol';
import { SocketHttpResponse, StreamHandle, SocketTransport } from './transport';

/**
 * A fake transport recording requests and exposing the opened streams, so the engine's mapping,
 * daemon-absent handling, and reconnect logic can be driven without a daemon.
 */
class FakeTransport implements SocketTransport {
  public readonly requests: { method: string; path: string }[] = [];
  public readonly streams: {
    onLine: (line: string) => void;
    onError: (error: Error) => void;
    closed: boolean;
  }[] = [];
  public responder: (method: string, path: string) => Promise<SocketHttpResponse> =
    (): Promise<SocketHttpResponse> => Promise.reject(new Error('ENOENT'));

  public request(method: string, path: string): Promise<SocketHttpResponse> {
    this.requests.push({ method, path });
    return this.responder(method, path);
  }

  public openStream(
    _method: string,
    _path: string,
    onLine: (line: string) => void,
    onError: (error: Error) => void,
  ): StreamHandle {
    const record: {
      onLine: (line: string) => void;
      onError: (error: Error) => void;
      closed: boolean;
    } = {
      onLine,
      onError,
      closed: false,
    };
    this.streams.push(record);
    return {
      close: (): void => {
        record.closed = true;
      },
    };
  }
}

/**
 * Builds an engine over a fresh fake transport.
 */
function engineWith(): { engine: DockerEngine; transport: FakeTransport } {
  const transport: FakeTransport = new FakeTransport();
  return { engine: new DockerEngine('/unused.sock', transport), transport };
}

/**
 * A responder answering a single path with a 200 body and rejecting everything else.
 */
function respondJson(
  path: string,
  body: unknown,
): (method: string, path: string) => Promise<SocketHttpResponse> {
  return (_method: string, requested: string): Promise<SocketHttpResponse> =>
    requested === path
      ? Promise.resolve({
          statusCode: 200,
          body: JSON.stringify(body),
          bytes: Buffer.from(JSON.stringify(body)),
        })
      : Promise.reject(new Error('unexpected path'));
}

afterEach((): void => {
  vi.useRealTimers();
});

describe('DockerEngine', () => {
  it('listContainers_mapsTheRawEngineShapeAndStripsNameSlashes', async () => {
    const { engine, transport } = engineWith();
    transport.responder = respondJson('/containers/json?all=1', [
      { Id: 'abc', Names: ['/web'], Image: 'nginx', State: 'running', Status: 'Up 2m' },
    ]);

    expect(await engine.listContainers()).toEqual([
      {
        id: 'abc',
        names: ['web'],
        image: 'nginx',
        state: 'running',
        status: 'Up 2m',
        ports: [],
        volumes: [],
      },
    ]);
  });

  it('listImages_mapsTheRawEngineShape', async () => {
    const { engine, transport } = engineWith();
    transport.responder = respondJson('/images/json', [
      { Id: 'sha256:1', RepoTags: ['nginx:latest'], Size: 1234 },
    ]);

    expect(await engine.listImages()).toEqual([
      { id: 'sha256:1', tags: ['nginx:latest'], size: 1234 },
    ]);
  });

  it('listContainers_returnsEmptyWhenTheDaemonIsUnreachable', async () => {
    const { engine } = engineWith(); // responder rejects everything
    expect(await engine.listContainers()).toEqual([]);
  });

  it('listImages_returnsEmptyOnANon2xxStatus', async () => {
    const { engine, transport } = engineWith();
    transport.responder = (): Promise<SocketHttpResponse> =>
      Promise.resolve({ statusCode: 500, body: 'nope', bytes: Buffer.from('nope') });
    expect(await engine.listImages()).toEqual([]);
  });

  it('status_reportsAvailableWithVersionWhenTheDaemonAnswers', async () => {
    const { engine, transport } = engineWith();
    transport.responder = respondJson('/version', { Version: '27.0.0' });
    expect(await engine.status()).toEqual({ available: true, version: '27.0.0' });
  });

  it('status_reportsUnavailableWhenTheDaemonIsAbsent', async () => {
    const { engine } = engineWith();
    expect(await engine.status()).toEqual({ available: false });
  });

  it('start_stop_remove_issueTheRightRequestsAndReportSuccess', async () => {
    const { engine, transport } = engineWith();
    transport.responder = (): Promise<SocketHttpResponse> =>
      Promise.resolve({ statusCode: 204, body: '', bytes: Buffer.from('') });

    expect(await engine.start('abc')).toBe(true);
    expect(await engine.stop('abc')).toBe(true);
    expect(await engine.remove('abc')).toBe(true);
    expect(transport.requests).toEqual([
      { method: 'POST', path: '/containers/abc/start' },
      { method: 'POST', path: '/containers/abc/stop' },
      { method: 'DELETE', path: '/containers/abc' },
    ]);
  });

  it('start_reportsFailureWhenTheDaemonRejects', async () => {
    const { engine } = engineWith();
    expect(await engine.start('abc')).toBe(false);
  });

  it('watch_pushesNormalisedEventsAndIgnoresMalformedLines', () => {
    const { engine, transport } = engineWith();
    const events: ContainerEvent[] = [];
    engine.watch((event: ContainerEvent): void => {
      events.push(event);
    });

    expect(transport.streams).toHaveLength(1);
    transport.streams[0].onLine(
      JSON.stringify({ Type: 'container', Action: 'start', Actor: { ID: 'abc' } }),
    );
    transport.streams[0].onLine('not json');

    expect(events).toEqual([{ type: 'container', action: 'start', id: 'abc' }]);
  });

  it('watch_reconnectsAfterTheStreamDropsAndStopsOnceClosed', () => {
    vi.useFakeTimers();
    const { engine, transport } = engineWith();
    const handle: StreamHandle = engine.watch((): void => undefined);

    expect(transport.streams).toHaveLength(1);
    transport.streams[0].onError(new Error('dropped'));
    vi.advanceTimersByTime(1_000);
    expect(transport.streams).toHaveLength(2);

    handle.close();
    transport.streams[1].onError(new Error('dropped again'));
    vi.advanceTimersByTime(60_000);
    expect(transport.streams).toHaveLength(2);
  });
});

describe('parseEvent', () => {
  it('defaultsMissingFieldsAndReadsTheActorId', () => {
    expect(parseEvent(JSON.stringify({ Type: 'image' }))).toEqual({
      type: 'image',
      action: '',
      id: '',
    });
  });

  it('returnsNullForNonJson', () => {
    expect(parseEvent('<<not json>>')).toBeNull();
  });
});

describe('DockerEngine.logs', () => {
  /**
   * Builds one framed log chunk, as the engine sends a container without a terminal.
   * @param stream 1 for stdout, 2 for stderr.
   * @param text The payload.
   * @returns Returns the frame.
   */
  function frame(stream: number, text: string): Buffer {
    const payload: Buffer = Buffer.from(text);
    const header: Buffer = Buffer.alloc(8);
    header[0] = stream;
    header.writeUInt32BE(payload.length, 4);
    return Buffer.concat([header, payload]);
  }

  it('demuxLogs_readsFramedOutput_andPlainTerminalOutput', () => {
    expect(demuxLogs(Buffer.concat([frame(1, 'out one\n'), frame(2, 'err two\n')]))).toBe(
      'out one\nerr two\n',
    );
    expect(demuxLogs(Buffer.from('plain text\n'))).toBe('plain text\n');
  });

  it('logs_asksForTheTailWithTimestamps_andSplitsTheLines', async () => {
    const requests: string[] = [];
    const bytes: Buffer = Buffer.concat([frame(1, 'a\n'), frame(1, 'b\n')]);
    const engine: DockerEngine = new DockerEngine('/unused.sock', {
      request: (_method: string, path: string): Promise<SocketHttpResponse> => {
        requests.push(path);
        return Promise.resolve({ statusCode: 200, body: bytes.toString('utf8'), bytes });
      },
      openStream: (): StreamHandle => ({ close: (): void => undefined }),
    });

    expect(await engine.logs('abc', 2)).toEqual({ lines: ['a', 'b'], truncated: true });
    expect(requests).toEqual(['/containers/abc/logs?stdout=1&stderr=1&timestamps=1&tail=2']);
  });

  it('logs_answersNoLinesWhenTheContainerIsGone', async () => {
    const engine: DockerEngine = new DockerEngine('/unused.sock', {
      request: (): Promise<SocketHttpResponse> =>
        Promise.resolve({ statusCode: 404, body: '', bytes: Buffer.alloc(0) }),
      openStream: (): StreamHandle => ({ close: (): void => undefined }),
    });

    expect(await engine.logs('gone', 100)).toEqual({ lines: [], truncated: false });
  });
});

describe('DockerEngine P2 (#974)', () => {
  /**
   * Builds an engine over a transport that answers each path from a table.
   * @param answers The status and body per request path.
   * @param lines The lines a streamed request sends, if any.
   * @returns Returns the engine and the requests it made.
   */
  /**
   * An engine over a scripted transport, and the requests it was sent.
   */
  interface Answering {
    engine: DockerEngine;
    requests: { method: string; path: string; body?: unknown }[];
  }

  function engineAnswering(
    answers: Record<string, { status: number; body: unknown }>,
    lines: readonly string[] = [],
  ): Answering {
    const requests: { method: string; path: string; body?: unknown }[] = [];
    const engine: DockerEngine = new DockerEngine('/unused.sock', {
      request: (method: string, path: string, body?: unknown): Promise<SocketHttpResponse> => {
        requests.push({ method, path, ...(body === undefined ? {} : { body }) });
        const answer: { status: number; body: unknown } = answers[path] ?? {
          status: 404,
          body: {},
        };
        const text: string = JSON.stringify(answer.body);
        return Promise.resolve({ statusCode: answer.status, body: text, bytes: Buffer.from(text) });
      },
      requestLines: (
        method: string,
        path: string,
        onLine: (line: string) => void,
      ): Promise<number> => {
        requests.push({ method, path });
        for (const line of lines) {
          onLine(line);
        }
        return Promise.resolve(200);
      },
      openStream: (): StreamHandle => ({ close: (): void => undefined }),
    });
    return { engine, requests };
  }

  it('listContainers_reportsPortsCreatedAndNamedVolumes', async () => {
    const { engine } = engineAnswering({
      '/containers/json?all=1': {
        status: 200,
        body: [
          {
            Id: 'c1',
            Names: ['/db'],
            Created: 100,
            Ports: [
              { PrivatePort: 5432, PublicPort: 5432, Type: 'tcp', IP: '0.0.0.0' },
              { PrivatePort: 9000, Type: 'tcp' },
            ],
            Mounts: [
              { Type: 'volume', Name: 'pgdata' },
              { Type: 'bind', Name: undefined },
            ],
          },
        ],
      },
    });

    const [container] = await engine.listContainers();

    expect(container.ports).toEqual([
      { privatePort: 5432, publicPort: 5432, protocol: 'tcp', ip: '0.0.0.0' },
      { privatePort: 9000, protocol: 'tcp' },
    ]);
    expect(container.created).toBe(100);
    expect(container.volumes).toEqual(['pgdata']);
  });

  it('statsOf_measuresCpuAsDockerStatsDoes_andLeavesOutReclaimableCache', () => {
    expect(
      statsOf('c1', {
        cpu_stats: { cpu_usage: { total_usage: 300 }, system_cpu_usage: 2_000, online_cpus: 4 },
        precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1_000 },
        memory_stats: { usage: 1_000, limit: 8_000, stats: { inactive_file: 200 } },
      }),
    ).toEqual({ id: 'c1', cpuPercent: 80, memoryBytes: 800, memoryLimitBytes: 8_000 });
    expect(statsOf('c2', {}).cpuPercent).toBe(0);
  });

  it('splitReference_separatesTheTag_butNotARegistryPort', () => {
    expect(splitReference('postgres:16')).toEqual({ name: 'postgres', tag: '16' });
    expect(splitReference('nginx')).toEqual({ name: 'nginx', tag: 'latest' });
    expect(splitReference('localhost:5000/app')).toEqual({
      name: 'localhost:5000/app',
      tag: 'latest',
    });
    expect(splitReference('ghcr.io/o/n@sha256:abc')).toEqual({
      name: 'ghcr.io/o/n@sha256:abc',
      tag: '',
    });
  });

  it('createBody_publishesPortsSetsEnvironmentAndMounts', () => {
    expect(
      createBody({
        image: 'postgres:16',
        ports: [{ host: 5433, container: 5432 }],
        env: { A: 'b' },
        volumes: [{ source: 'pgdata', target: '/data', readOnly: true }],
      }),
    ).toEqual({
      Image: 'postgres:16',
      Env: ['A=b'],
      ExposedPorts: { '5432/tcp': {} },
      HostConfig: {
        PortBindings: { '5432/tcp': [{ HostPort: '5433' }] },
        Binds: ['pgdata:/data:ro'],
      },
    });
  });

  it('run_createsThenStarts_andSaysWhenTheImageIsMissing', async () => {
    const created: Answering = engineAnswering({
      '/containers/create?name=db': { status: 201, body: { Id: 'new' } },
      '/containers/new/start': { status: 204, body: {} },
    });
    expect(await created.engine.run({ image: 'postgres:16', name: 'db' })).toEqual({ id: 'new' });
    expect(created.requests.map((request) => request.path)).toEqual([
      '/containers/create?name=db',
      '/containers/new/start',
    ]);

    const missing: Answering = engineAnswering({ '/containers/create': { status: 404, body: {} } });
    expect(await missing.engine.run({ image: 'nope:1' })).toEqual({
      error: 'There is no image "nope:1" on this machine. Pull it first.',
    });
  });

  it('pullImage_reportsProgressAcrossLayers_andTheEnginesError', async () => {
    const progress: ImagePullProgress[] = [];
    const ok: Answering = engineAnswering({}, [
      JSON.stringify({
        id: 'l1',
        status: 'Downloading',
        progressDetail: { current: 5, total: 10 },
      }),
      JSON.stringify({ status: 'Done' }),
    ]);

    expect(await ok.engine.pullImage('postgres:16', (update) => progress.push(update))).toEqual({
      ok: true,
    });
    expect(ok.requests[0].path).toBe('/images/create?fromImage=postgres&tag=16');
    expect(progress.at(-1)).toMatchObject({
      reference: 'postgres:16',
      done: true,
      current: 5,
      total: 10,
    });

    const failed: Answering = engineAnswering({}, [JSON.stringify({ error: 'manifest unknown' })]);
    expect(await failed.engine.pullImage('nope:1', (): void => undefined)).toEqual({
      ok: false,
      error: 'manifest unknown',
    });
  });
});
