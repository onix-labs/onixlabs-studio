import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContainerEvent } from '@shared/api/container-types';
import { ContainerSocket } from '../permissions/brokers/container-socket';
import { DockerEngine, parseEvent } from './docker-engine';
import { DockerResponse, DockerStreamHandle, DockerTransport } from './docker-transport';

/**
 * A fake transport recording requests and exposing the opened streams, so the engine's mapping,
 * daemon-absent handling, and reconnect logic can be driven without a daemon.
 */
class FakeTransport implements DockerTransport {
  public readonly requests: { method: string; path: string }[] = [];
  public readonly streams: {
    onLine: (line: string) => void;
    onError: (error: Error) => void;
    closed: boolean;
  }[] = [];
  public responder: (method: string, path: string) => Promise<DockerResponse> =
    (): Promise<DockerResponse> => Promise.reject(new Error('ENOENT'));

  public request(method: string, path: string): Promise<DockerResponse> {
    this.requests.push({ method, path });
    return this.responder(method, path);
  }

  public openStream(
    _method: string,
    _path: string,
    onLine: (line: string) => void,
    onError: (error: Error) => void,
  ): DockerStreamHandle {
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
 * A socket handle whose path is irrelevant here because the transport is injected.
 */
const SOCKET: ContainerSocket = {
  path: '/unused.sock',
  connect: (): Promise<never> => Promise.reject(new Error('unused')),
};

/**
 * Builds an engine over a fresh fake transport.
 */
function engineWith(): { engine: DockerEngine; transport: FakeTransport } {
  const transport: FakeTransport = new FakeTransport();
  return { engine: new DockerEngine(SOCKET, transport), transport };
}

/**
 * A responder answering a single path with a 200 body and rejecting everything else.
 */
function respondJson(
  path: string,
  body: unknown,
): (method: string, path: string) => Promise<DockerResponse> {
  return (_method: string, requested: string): Promise<DockerResponse> =>
    requested === path
      ? Promise.resolve({ statusCode: 200, body: JSON.stringify(body) })
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
    transport.responder = (): Promise<DockerResponse> =>
      Promise.resolve({ statusCode: 500, body: 'nope' });
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
    transport.responder = (): Promise<DockerResponse> =>
      Promise.resolve({ statusCode: 204, body: '' });

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
    const handle: DockerStreamHandle = engine.watch((): void => undefined);

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
