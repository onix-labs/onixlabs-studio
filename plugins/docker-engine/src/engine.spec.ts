import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContainerEvent } from './protocol';
import { demuxLogs, DockerEngine, parseEvent } from './engine';
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
      { id: 'abc', names: ['web'], image: 'nginx', state: 'running', status: 'Up 2m' },
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
