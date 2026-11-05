import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { ContainerChannel } from '@shared/api/container-channels';
import type { ContainerEngineInfo, ContainerEvent } from '@shared/api/container-types';
import { ContributionContext, InvokeHandler } from '../main-contribution';
import type { PermissionId } from '../permissions/permission';
import type { ContainerEngineDescriptor, StreamHandle } from './container-engine';
import {
  ContainerEngineConnection,
  ContainersContribution,
  ContainersHost,
} from './containers.contribution';

// Loaded with the module's graph only; the machine is behind the host below, so nothing here reads the
// user's home, settings or plugins, or starts an engine's process.
vi.mock('electron', () => ({
  app: {
    getPath: (): string => {
      throw new Error('A spec must not reach userData.');
    },
  },
}));

/**
 * Records what was asked of a client, and answers nothing of substance.
 */
class FakeClient {
  public readonly calls: unknown[][] = [];
  public readonly streams: FakeStream[] = [];
  public disposed: number = 0;

  public constructor(public readonly socketPath: string) {}

  public get openStreams(): number {
    return this.streams.filter((stream: FakeStream): boolean => !stream.closed).length;
  }

  public watch(onEvent: (event: ContainerEvent) => void): StreamHandle {
    const stream: FakeStream = new FakeStream(onEvent);
    this.streams.push(stream);
    return stream;
  }

  public dispose(): void {
    this.disposed += 1;
  }

  public record<T>(answer: T, ...call: unknown[]): Promise<T> {
    this.calls.push(call);
    return Promise.resolve(answer);
  }
}

/**
 * One open event stream.
 */
class FakeStream implements StreamHandle {
  public closed: boolean = false;

  public constructor(public readonly onEvent: (event: ContainerEvent) => void) {}

  public close(): void {
    this.closed = true;
  }
}

/**
 * Wraps a {@link FakeClient} in the whole connection surface.
 * @param client The client.
 * @returns Returns the connection.
 */
function connection(client: FakeClient): ContainerEngineConnection {
  return {
    listContainers: () => client.record([], 'listContainers'),
    listImages: () => client.record([], 'listImages'),
    start: (id: string) => client.record(true, 'start', id),
    stop: (id: string) => client.record(true, 'stop', id),
    remove: (id: string, volumes?: boolean) => client.record(true, 'remove', id, volumes),
    logs: (id: string, tail: number) =>
      client.record({ lines: [], truncated: false }, 'logs', id, tail),
    status: () => client.record({ available: true } as never, 'status'),
    stats: (ids: readonly string[]) => client.record([], 'stats', ids),
    listVolumes: () => client.record([], 'listVolumes'),
    removeVolume: (name: string) => client.record(true, 'removeVolume', name),
    pause: (id: string) => client.record(true, 'pause', id),
    unpause: (id: string) => client.record(true, 'unpause', id),
    restart: (id: string) => client.record(true, 'restart', id),
    removeImage: (id: string, force: boolean) => client.record(true, 'removeImage', id, force),
    pullImage: (reference: string, onProgress: (progress: never) => void): Promise<never> => {
      onProgress({ status: 'pulling' } as never);
      return client.record({ ok: true } as never, 'pullImage', reference);
    },
    run: (request: unknown) => client.record({ id: 'c1' } as never, 'run', request),
    watch: (onEvent: (event: ContainerEvent) => void) => client.watch(onEvent),
    dispose: () => client.dispose(),
  };
}

/**
 * Builds an engine descriptor.
 * @param id The engine's id.
 * @param entry The plugin's entry point, which an update moves.
 * @returns Returns the descriptor.
 */
function engineNamed(id: string, entry: string = `/plugins/${id}.js`): ContainerEngineDescriptor {
  return {
    id,
    displayName: id,
    priority: 1,
    cli: null,
    discovery: {} as never,
    spawn: { command: '/never/run', args: [entry], env: {} },
    startCommand: (): null => null,
  };
}

/**
 * A machine whose engines the spec sets.
 */
class FakeHost implements ContainersHost {
  public engine: ContainerEngineDescriptor | null = null;
  public socket: string | null = '/sockets/engine.sock';
  public refreshes: number = 0;
  public readonly clients: FakeClient[] = [];
  public readonly choices: (string | null)[] = [];
  public readonly descriptions: readonly ContainerEngineInfo[] = [];

  public get client(): FakeClient {
    return this.clients[this.clients.length - 1];
  }

  public refreshEngines(): void {
    this.refreshes += 1;
  }

  public selectedEngine(): ContainerEngineDescriptor | null {
    return this.engine;
  }

  public socketPath(): string | null {
    return this.socket;
  }

  public createClient(
    _descriptor: ContainerEngineDescriptor,
    _spawn: unknown,
    socketPath: string,
  ): ContainerEngineConnection {
    const client: FakeClient = new FakeClient(socketPath);
    this.clients.push(client);
    return connection(client);
  }

  public chooseEngine(id: string | null): void {
    this.choices.push(id);
  }

  public describeEngines(): readonly ContainerEngineInfo[] {
    return this.descriptions;
  }
}

describe('ContainersContribution', () => {
  const event: IpcMainInvokeEvent = {} as IpcMainInvokeEvent;
  let host: FakeHost;
  let contribution: ContainersContribution;
  let handlers: Map<string, InvokeHandler>;
  let pushed: unknown[][];
  let grants: PermissionId[];
  let refusal: Error | null;

  /**
   * Builds the context the contribution activates against.
   * @returns Returns the context.
   */
  function context(): ContributionContext {
    return {
      handle: (channel: string, handler: InvokeHandler): void =>
        void handlers.set(channel, handler),
      on: (): void => undefined,
      send: (channel: string, ...payload: unknown[]): void =>
        void pushed.push([channel, ...payload]),
      permission: <T>(request: PermissionId): T => {
        if (refusal !== null) {
          throw refusal;
        }
        grants.push(request);
        return { path: `/granted/${grants.length}.sock` } as T;
      },
      mainWindow: () => null,
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    };
  }

  /**
   * Calls a channel as the renderer would.
   * @param channel The channel.
   * @param args The arguments.
   * @returns Returns the handler's answer.
   */
  function call(channel: ContainerChannel, ...args: unknown[]): unknown {
    const handler: InvokeHandler | undefined = handlers.get(channel);
    if (handler === undefined) {
      throw new Error(`Nothing handles ${channel}.`);
    }
    return handler(event, ...args);
  }

  beforeEach(() => {
    host = new FakeHost();
    contribution = new ContainersContribution(host);
    handlers = new Map<string, InvokeHandler>();
    pushed = [];
    grants = [];
    refusal = null;
  });

  describe('with no engine installed', () => {
    beforeEach(() => contribution.activate(context()));

    it('degradesEveryOperationToAnEmptyAnswer', async () => {
      expect(await call(ContainerChannel.ListContainers)).toEqual([]);
      expect(await call(ContainerChannel.ListImages)).toEqual([]);
      expect(await call(ContainerChannel.ListVolumes)).toEqual([]);
      expect(await call(ContainerChannel.Stats, ['c1'])).toEqual([]);
      expect(await call(ContainerChannel.Start, 'c1')).toBe(false);
      expect(await call(ContainerChannel.Stop, 'c1')).toBe(false);
      expect(await call(ContainerChannel.Remove, 'c1')).toBe(false);
      expect(await call(ContainerChannel.RemoveVolume, 'v1')).toBe(false);
      expect(await call(ContainerChannel.Pause, 'c1')).toBe(false);
      expect(await call(ContainerChannel.Unpause, 'c1')).toBe(false);
      expect(await call(ContainerChannel.Restart, 'c1')).toBe(false);
      expect(await call(ContainerChannel.RemoveImage, 'i1')).toBe(false);
      expect(await call(ContainerChannel.Logs, 'c1')).toEqual({ lines: [], truncated: false });
      expect(await call(ContainerChannel.Status)).toEqual({ available: false });
    });

    it('saysNoEngineIsInstalled_whereAnOperationWasPromisedAResult', async () => {
      const error: string = 'No container engine is installed.';

      expect(await call(ContainerChannel.PullImage, 'alpine')).toEqual({ ok: false, error });
      expect(await call(ContainerChannel.Run, { image: 'alpine' })).toEqual({ error });
    });

    it('resolvesNoPermission_withNothingToGrantItFor', () => {
      expect(grants).toEqual([]);
    });
  });

  it('treatsAnEngineFromAnOlderStudio_asNoEngine', async () => {
    host.engine = { ...engineNamed('old'), spawn: null };
    contribution.activate(context());

    expect(await call(ContainerChannel.Status)).toEqual({ available: false });
    expect(host.clients).toEqual([]);
  });

  it('activation_propagatesARefusedPermission', () => {
    // The registry isolates this; swallowing it here would leave the feature half active.
    host.engine = engineNamed('docker');
    refusal = new Error('denied');

    expect(() => contribution.activate(context())).toThrow('denied');
  });

  describe('with an engine', () => {
    beforeEach(() => {
      host.engine = engineNamed('docker');
      contribution.activate(context());
    });

    it('handsThePluginTheSocketThePermissionResolved_notOneItFoundItself', () => {
      expect(host.client.socketPath).toBe('/granted/1.sock');
    });

    it('resolvesThePermissionOnce_notOnEveryRequest', async () => {
      await call(ContainerChannel.ListContainers);
      await call(ContainerChannel.ListImages);

      expect(grants).toEqual(['container.socket']);
      expect(host.clients).toHaveLength(1);
    });

    it('stringifiesARendererId_andKeepsOnlyARealBooleanFlag', async () => {
      await call(ContainerChannel.Remove, 7, 'yes');
      await call(ContainerChannel.Remove, 'c1', true);
      await call(ContainerChannel.RemoveImage, 'i1', 1);

      expect(host.client.calls).toEqual([
        ['remove', '7', false],
        ['remove', 'c1', true],
        ['removeImage', 'i1', false],
      ]);
    });

    it('fallsBackToTheDefaultTail_whenTheRendererSendsNoNumber', async () => {
      await call(ContainerChannel.Logs, 'c1', '9');
      await call(ContainerChannel.Logs, 'c1', 25);

      expect(host.client.calls).toEqual([
        ['logs', 'c1', 500],
        ['logs', 'c1', 25],
      ]);
    });

    it('keepsOnlyStringIds_forStats', async () => {
      await call(ContainerChannel.Stats, ['c1', 2, null, 'c3']);
      await call(ContainerChannel.Stats, 'not a list');

      expect(host.client.calls).toEqual([
        ['stats', ['c1', 'c3']],
        ['stats', []],
      ]);
    });

    it('pushesPullProgressToTheRenderer', async () => {
      await call(ContainerChannel.PullImage, 'alpine');

      expect(pushed).toEqual([[ContainerChannel.PullProgress, { status: 'pulling' }]]);
    });

    it('refusesARunWithNoImage_beforeTheEngineHearsOfIt', async () => {
      for (const request of [null, 'alpine', {}, { image: '' }, { image: '   ' }, { image: 7 }]) {
        expect(await call(ContainerChannel.Run, request)).toEqual({
          error: 'Say which image to run.',
        });
      }

      expect(host.client.calls).toEqual([]);
    });

    it('recomputesTheEngines_whenAskedWhatTheChoicesAre', () => {
      const before: number = host.refreshes;

      expect(call(ContainerChannel.ListEngines)).toBe(host.descriptions);
      expect(host.refreshes).toBe(before + 1);
    });

    it('treatsAnEmptyOrWrongChoice_asAutomatic', () => {
      call(ContainerChannel.ChooseEngine, 'podman');
      call(ContainerChannel.ChooseEngine, '');
      call(ContainerChannel.ChooseEngine, 7);

      expect(host.choices).toEqual(['podman', null, null]);
    });

    it('changingEngine_retiresTheOldClientAndAsksForThePermissionAgain', async () => {
      const old: FakeClient = host.client;

      host.engine = engineNamed('podman');
      await call(ContainerChannel.Status);

      expect(old.disposed).toBe(1);
      expect(host.clients).toHaveLength(2);
      expect(grants).toHaveLength(2);
    });

    it('anEngineStartingElsewhere_rebuildsTheClient', async () => {
      host.socket = '/sockets/moved.sock';
      await call(ContainerChannel.Status);

      expect(host.clients).toHaveLength(2);
    });

    it('anUpdatedPlugin_rebuildsTheClient', async () => {
      host.engine = engineNamed('docker', '/plugins/docker-2.js');
      await call(ContainerChannel.Status);

      expect(host.clients).toHaveLength(2);
    });
  });

  describe('the event stream', () => {
    it('isNotOpenedUntilAConsumerAsks', () => {
      host.engine = engineNamed('docker');
      contribution.activate(context());

      expect(host.client.streams).toEqual([]);
    });

    it('pushesEventsToTheRenderer', () => {
      host.engine = engineNamed('docker');
      contribution.activate(context());
      const engineEvent: ContainerEvent = { type: 'start' } as never;

      call(ContainerChannel.WatchStart);
      host.client.streams[0].onEvent(engineEvent);

      expect(pushed).toEqual([[ContainerChannel.Events, engineEvent]]);
    });

    it('isSharedByConsumers_andClosesWithTheLast', () => {
      host.engine = engineNamed('docker');
      contribution.activate(context());

      call(ContainerChannel.WatchStart);
      call(ContainerChannel.WatchStart);
      expect(host.client.streams).toHaveLength(1);

      call(ContainerChannel.WatchStop);
      expect(host.client.openStreams).toBe(1);

      call(ContainerChannel.WatchStop);
      expect(host.client.openStreams).toBe(0);
    });

    it('anExtraStop_doesNotLeaveTheCountBelowZero', () => {
      host.engine = engineNamed('docker');
      contribution.activate(context());

      call(ContainerChannel.WatchStop);
      call(ContainerChannel.WatchStart);
      expect(host.client.openStreams).toBe(1);

      call(ContainerChannel.WatchStop);
      expect(host.client.openStreams).toBe(0);
    });

    it('opensWhenAnEngineInstalls_forAWatchStartedWithoutOne', async () => {
      contribution.activate(context());
      call(ContainerChannel.WatchStart);

      host.engine = engineNamed('docker');
      await call(ContainerChannel.Status);

      expect(host.client.openStreams).toBe(1);
    });

    it('opensForASecondConsumer_whenTheFirstFoundNoEngine', () => {
      contribution.activate(context());
      call(ContainerChannel.WatchStart);
      // The engine arrives and the next thing to ask is a second consumer, not an operation.
      host.engine = engineNamed('docker');

      call(ContainerChannel.WatchStart);

      expect(host.client.openStreams).toBe(1);
    });

    it('opensOnlyOneStream_whenTheConsumerItselfIsWhatAdoptsTheEngine', () => {
      // 🔥 Adopting opens the stream, and the consumer's own open comes back round: both would run
      // here, and the handle the second overwrote could then never be closed.
      contribution.activate(context());
      host.engine = engineNamed('docker');

      call(ContainerChannel.WatchStart);

      expect(host.client.streams).toHaveLength(1);
    });

    it('doesNotOpen_forAnEngineThatInstallsAfterEveryConsumerLeft', async () => {
      contribution.activate(context());
      call(ContainerChannel.WatchStart);
      call(ContainerChannel.WatchStop);

      host.engine = engineNamed('docker');
      await call(ContainerChannel.Status);

      expect(host.client.streams).toEqual([]);
    });

    it('followsAChangedEngine', async () => {
      host.engine = engineNamed('docker');
      contribution.activate(context());
      call(ContainerChannel.WatchStart);
      const old: FakeClient = host.client;

      host.engine = engineNamed('podman');
      await call(ContainerChannel.Status);

      expect(old.openStreams).toBe(0);
      expect(host.client).not.toBe(old);
      expect(host.client.openStreams).toBe(1);
    });

    it('closesWhenTheLastEngineIsUninstalled_andReturnsWithTheNext', async () => {
      host.engine = engineNamed('docker');
      contribution.activate(context());
      call(ContainerChannel.WatchStart);
      const old: FakeClient = host.client;

      host.engine = null;
      await call(ContainerChannel.Status);

      expect(old.openStreams).toBe(0);
      expect(old.disposed).toBe(1);

      host.engine = engineNamed('podman');
      await call(ContainerChannel.Status);

      expect(host.client).not.toBe(old);
      expect(host.client.openStreams).toBe(1);
    });
  });

  describe('dispose', () => {
    it('closesTheStreamAndTheClient', () => {
      host.engine = engineNamed('docker');
      contribution.activate(context());
      call(ContainerChannel.WatchStart);

      contribution.dispose();

      expect(host.client.openStreams).toBe(0);
      expect(host.client.disposed).toBe(1);
    });

    it('isSafe_beforeActivation', () => {
      expect(() => contribution.dispose()).not.toThrow();
    });
  });
});
