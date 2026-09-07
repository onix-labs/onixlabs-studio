import { afterEach, describe, expect, it } from 'vitest';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { ContainerChannel } from '@shared/api/container-channels';
import { ContainerSummary, ContainerStatus } from '@shared/api/container-types';
import { StatusBar } from '@shared/angular/services/status-bar/status-bar';
import { Icon } from '@shared/angular/icons/icon';
import { ContainersStatus } from './containers-status';

/**
 * A running and a stopped container, so the running count under test is unambiguous.
 */
const CONTAINERS: ContainerSummary[] = [
  { id: 'a', names: ['web'], image: 'nginx', state: 'running', status: 'Up' },
  { id: 'b', names: ['db'], image: 'postgres', state: 'exited', status: 'Exited' },
];

/**
 * Installs a stub bridge answering status and list-containers with fixed replies.
 * @param status The daemon status to report.
 */
function stubBridge(status: ContainerStatus): void {
  const bridge: Bridge = {
    invoke: <T>(channel: string): Promise<T> => {
      if ((channel as ContainerChannel) === ContainerChannel.Status) {
        return Promise.resolve(status as T);
      }
      if ((channel as ContainerChannel) === ContainerChannel.ListContainers) {
        return Promise.resolve(CONTAINERS as T);
      }
      return Promise.resolve([] as T);
    },
    send: (): void => undefined,
    on: (): (() => void) => (): void => undefined,
  };
  (window as unknown as { bridge: Bridge }).bridge = bridge;
}

/**
 * Lets the service's async refresh settle, then flushes the status effect.
 */
async function settle(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
  TestBed.inject(ApplicationRef).tick();
}

describe('ContainersStatus', () => {
  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  it('publishesTheRunningContainerCountWhenTheDaemonIsUp', async () => {
    stubBridge({ available: true });
    TestBed.inject(ContainersStatus);
    const statusBar: StatusBar = TestBed.inject(StatusBar);

    await settle();

    expect(statusBar.segments()).toEqual([
      {
        id: 'containers-running',
        text: '1 running',
        icon: Icon.CONTAINERS,
        title: 'Running containers',
      },
    ]);
  });

  it('clearsTheSegmentWhenTheDaemonIsAbsent', async () => {
    stubBridge({ available: false });
    TestBed.inject(ContainersStatus);
    const statusBar: StatusBar = TestBed.inject(StatusBar);

    await settle();

    expect(statusBar.segments()).toEqual([]);
  });
});
