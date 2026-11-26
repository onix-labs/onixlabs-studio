import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NotificationRequest,
  Notifications,
} from '@shared/angular/services/notifications/notifications';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { ContainerEngineInfo, ContainerEvent } from '@shared/api/container-types';
import { ContainersClient, PullListener } from '../client/containers-client';
import { ContainerTerminals } from '../container-terminals/container-terminals';
import { ContainerNotifier } from './container-notifier';

/**
 * A stand-in for the containers client: it hands the notifier's listeners to the test.
 */
class FakeClient {
  public readonly containerEngines: WritableSignal<readonly ContainerEngineInfo[]> = signal<
    readonly ContainerEngineInfo[]
  >([]);

  public available: boolean = true;
  public eventListener: ((event: ContainerEvent) => void) | null = null;
  public pullListener: PullListener | null = null;
  public readonly ownActions: Set<string> = new Set<string>();
  public readonly watches: string[] = [];
  public readonly restarted: string[] = [];

  public status(): Promise<{ available: boolean }> {
    return Promise.resolve({ available: this.available });
  }

  public onEvents(listener: (event: ContainerEvent) => void): () => void {
    this.eventListener = listener;
    return (): void => undefined;
  }

  public onPullFinished(listener: PullListener): () => void {
    this.pullListener = listener;
    return (): void => undefined;
  }

  public watchStart(): Promise<boolean> {
    this.watches.push('start');
    return Promise.resolve(true);
  }

  public watchStop(): Promise<boolean> {
    this.watches.push('stop');
    return Promise.resolve(true);
  }

  public actedOnRecently(id: string): boolean {
    return this.ownActions.has(id);
  }

  public restart(id: string): Promise<boolean> {
    this.restarted.push(id);
    return Promise.resolve(true);
  }
}

describe('ContainerNotifier (#1488)', () => {
  let client: FakeClient;
  let raised: NotificationRequest[];
  let logs: { name: string; id: string }[];

  /**
   * Starts the notifier with an engine plugin installed, and lets its first check settle.
   * @returns Returns a promise that resolves once it is listening.
   */
  async function listening(): Promise<void> {
    TestBed.inject(ContainerNotifier);
    client.containerEngines.set([{ id: 'docker' } as ContainerEngineInfo]);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
  }

  /**
   * Delivers a container event from the engine.
   * @param action What happened.
   * @param details The event's details.
   */
  function event(action: string, details: Partial<ContainerEvent> = {}): void {
    client.eventListener?.({ type: 'container', action, id: 'abc123def4567', ...details });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    client = new FakeClient();
    raised = [];
    logs = [];
    TestBed.configureTestingModule({
      providers: [
        { provide: ContainersClient, useValue: client },
        {
          provide: Notifications,
          useValue: { notify: (request: NotificationRequest): number => raised.push(request) },
        },
        { provide: Tabs, useValue: { open: (): void => undefined } },
        {
          provide: ContainerTerminals,
          useValue: { openLogs: (name: string, id: string): number => logs.push({ name, id }) },
        },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('listensOnlyOnceAnEnginePluginIsInstalled', async () => {
    TestBed.inject(ContainerNotifier);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.eventListener).toBeNull();

    await listening();

    expect(client.eventListener).not.toBeNull();
    expect(client.watches).toEqual(['start']);
  });

  it('aContainerThatFails_popsUpByName_withShowLogsAndRestart', async () => {
    await listening();

    event('die', { name: 'postgres', image: 'postgres:17', project: 'shop', exitCode: 3 });

    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      title: 'postgres exited (code 3)',
      detail: 'shop · postgres:17',
      type: 'containers.exited',
      key: 'container:abc123def4567',
    });
    raised[0].actions?.find((action) => action.label === 'Show Logs')?.run();
    raised[0].actions?.find((action) => action.label === 'Restart')?.run();
    expect(logs).toEqual([{ name: 'Logs: postgres', id: 'abc123def4567' }]);
    expect(client.restarted).toEqual(['abc123def4567']);
  });

  it('aContainerFromAnOlderPlugin_isNamedByItsShortId', async () => {
    await listening();

    event('die');

    expect(raised[0].title).toBe('abc123def456 exited');
  });

  it('aCleanExit_isRecordedAsFinished', async () => {
    await listening();

    event('die', { name: 'migrate', exitCode: 0 });

    expect(raised[0]).toMatchObject({ title: 'migrate finished', type: 'containers.finished' });
  });

  it('whatStudioJustDid_isNotReportedBack', async () => {
    await listening();
    client.ownActions.add('abc123def4567');

    event('die', { name: 'postgres', exitCode: 137 });

    expect(raised).toEqual([]);
  });

  it('outOfMemory_andUnhealthy_popUp', async () => {
    await listening();

    event('oom', { name: 'api' });
    event('health_status: unhealthy', { name: 'api' });
    event('health_status: healthy', { name: 'api' });

    expect(raised.map((request) => request.type)).toEqual([
      'containers.oom',
      'containers.unhealthy',
    ]);
  });

  it('aContainerThatKeepsStopping_isOneRestartingNotice', async () => {
    await listening();

    for (let stop: number = 0; stop < 5; stop += 1) {
      event('die', { name: 'worker', exitCode: 1 });
      await vi.advanceTimersByTimeAsync(10_000);
    }

    expect(raised.map((request) => request.type)).toEqual([
      'containers.exited',
      'containers.exited',
      'containers.restarting',
    ]);
    expect(raised[2].title).toBe('worker keeps restarting');
  });

  it('aDownload_saysHowItEnded', async () => {
    await listening();

    client.pullListener?.('nginx:latest', { ok: true });
    client.pullListener?.('missing:tag', { ok: false, error: 'not found' });

    expect(raised).toEqual([
      expect.objectContaining({
        title: 'Downloaded nginx:latest',
        type: 'containers.pullFinished',
      }),
      expect.objectContaining({
        title: "Couldn't download missing:tag",
        detail: 'not found',
        type: 'containers.pullFailed',
      }),
    ]);
  });

  it('theEngineStoppingAndComingBack_isRecorded_butNotItsStateAtStartUp', async () => {
    await listening();
    expect(raised).toEqual([]);

    client.available = false;
    await vi.advanceTimersByTimeAsync(60_000);
    client.available = true;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(raised.map((request) => request.title)).toEqual([
      'The container engine stopped',
      'The container engine is running again',
    ]);
    expect(client.watches).toEqual(['start', 'stop', 'start']);
  });

  it('eventsAboutOtherThings_sayNothing', async () => {
    await listening();

    client.eventListener?.({ type: 'image', action: 'pull', id: 'sha256:1' });
    event('start', { name: 'web' });

    expect(raised).toEqual([]);
  });
});
