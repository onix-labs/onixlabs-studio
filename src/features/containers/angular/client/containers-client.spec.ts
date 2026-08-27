import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { ContainerChannel } from '@shared/api/container-channels';
import { DockerEvent } from '@shared/api/docker-types';
import { ContainersClient } from './containers-client';

/**
 * A recorded bridge invocation.
 */
interface RecordedCall {
  readonly channel: string;
  readonly args: readonly unknown[];
}

describe('ContainersClient', () => {
  let calls: RecordedCall[];
  let listeners: Map<string, (...args: unknown[]) => void>;

  /**
   * Installs a stub bridge that records invocations, resolves with a fixed reply, and captures push
   * listeners so a test can emit events.
   * @param reply The value invoke resolves with.
   */
  function stubBridge(reply: unknown): void {
    calls = [];
    listeners = new Map<string, (...args: unknown[]) => void>();
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        calls.push({ channel, args });
        if (channel === (ContainerChannel.ListEngines as string)) {
          return Promise.resolve([
            {
              id: 'docker',
              displayName: 'Docker',
              available: false,
              inEffect: false,
              cli: 'docker',
            },
            { id: 'podman', displayName: 'Podman', available: true, inEffect: true, cli: 'podman' },
          ] as T);
        }
        return Promise.resolve(reply as T);
      },
      send: (): void => undefined,
      on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
        listeners.set(channel, listener);
        return (): void => {
          listeners.delete(channel);
        };
      },
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
  }

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  /**
   * Gets the recorded calls with the engine lookup removed. The client asks which container engines
   * are present as soon as it is created, which is startup rather than an operation under test.
   * @returns Returns the operation calls.
   */
  function operations(): RecordedCall[] {
    return calls.filter(
      (call: RecordedCall): boolean => call.channel !== (ContainerChannel.ListEngines as string),
    );
  }

  it('forwardsEachOperationToItsChannel', async () => {
    stubBridge(true);
    const client: ContainersClient = TestBed.inject(ContainersClient);

    await client.start('abc');
    await client.stop('def');
    await client.remove('ghi');

    expect(operations()).toEqual([
      { channel: ContainerChannel.Start, args: ['abc'] },
      { channel: ContainerChannel.Stop, args: ['def'] },
      { channel: ContainerChannel.Remove, args: ['ghi'] },
    ]);
  });

  it('routesEventPushesToTheListener', () => {
    stubBridge(undefined);
    const client: ContainersClient = TestBed.inject(ContainersClient);
    const received: DockerEvent[] = [];
    client.onEvents((event: DockerEvent): void => {
      received.push(event);
    });

    const event: DockerEvent = { type: 'container', action: 'start', id: 'abc' };
    listeners.get(ContainerChannel.Events)?.(event);

    expect(received).toEqual([event]);
  });

  it('forwardsLaunchDesktopToItsChannel', async () => {
    stubBridge(true);
    const client: ContainersClient = TestBed.inject(ContainersClient);

    expect(await client.launchDesktop()).toBe(true);
    expect(operations()).toEqual([{ channel: ContainerChannel.LaunchDesktop, args: [] }]);
  });

  it('degradesToSafeDefaultsWithoutABridge', async () => {
    delete (window as unknown as { bridge?: unknown }).bridge;
    const client: ContainersClient = TestBed.inject(ContainersClient);

    expect(await client.listContainers()).toEqual([]);
    expect(await client.listImages()).toEqual([]);
    expect(await client.status()).toEqual({ available: false });
    expect(await client.start('abc')).toBe(false);
    expect(await client.launchDesktop()).toBe(false);
    expect(client.onEvents((): void => undefined)).toBeTypeOf('function');
  });

  it('engineCli_reportsTheEngineInEffect', async () => {
    stubBridge(true);
    const client: ContainersClient = TestBed.inject(ContainersClient);
    await client.refreshEngines();

    expect(client.engineCli()).toBe('podman');
  });

  it('engineCli_beforeTheEnginesAreKnown_fallsBackToDocker', () => {
    delete (window as unknown as { bridge?: unknown }).bridge;
    const client: ContainersClient = TestBed.inject(ContainersClient);

    expect(client.engineCli()).toBe('docker');
  });
});
