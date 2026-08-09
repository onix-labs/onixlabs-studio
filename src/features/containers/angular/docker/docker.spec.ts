import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { DockerChannel } from '@shared/api/docker-channels';
import { DockerEvent } from '@shared/api/docker-types';
import { Docker } from './docker';

/**
 * A recorded bridge invocation.
 */
interface RecordedCall {
  readonly channel: string;
  readonly args: readonly unknown[];
}

describe('Docker', () => {
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

  it('forwardsEachOperationToItsChannel', async () => {
    stubBridge(true);
    const docker: Docker = TestBed.inject(Docker);

    await docker.start('abc');
    await docker.stop('def');
    await docker.remove('ghi');

    expect(calls).toEqual([
      { channel: DockerChannel.Start, args: ['abc'] },
      { channel: DockerChannel.Stop, args: ['def'] },
      { channel: DockerChannel.Remove, args: ['ghi'] },
    ]);
  });

  it('routesEventPushesToTheListener', () => {
    stubBridge(undefined);
    const docker: Docker = TestBed.inject(Docker);
    const received: DockerEvent[] = [];
    docker.onEvents((event: DockerEvent): void => {
      received.push(event);
    });

    const event: DockerEvent = { type: 'container', action: 'start', id: 'abc' };
    listeners.get(DockerChannel.Events)?.(event);

    expect(received).toEqual([event]);
  });

  it('forwardsLaunchDesktopToItsChannel', async () => {
    stubBridge(true);
    const docker: Docker = TestBed.inject(Docker);

    expect(await docker.launchDesktop()).toBe(true);
    expect(calls).toEqual([{ channel: DockerChannel.LaunchDesktop, args: [] }]);
  });

  it('degradesToSafeDefaultsWithoutABridge', async () => {
    delete (window as unknown as { bridge?: unknown }).bridge;
    const docker: Docker = TestBed.inject(Docker);

    expect(await docker.listContainers()).toEqual([]);
    expect(await docker.listImages()).toEqual([]);
    expect(await docker.status()).toEqual({ available: false });
    expect(await docker.start('abc')).toBe(false);
    expect(await docker.launchDesktop()).toBe(false);
    expect(docker.onEvents((): void => undefined)).toBeTypeOf('function');
  });
});
