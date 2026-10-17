import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONTROL_CONTAINER,
  LIST_CONTAINER_IMAGES,
  LIST_CONTAINERS,
  PULL_IMAGE,
  READ_CONTAINER_LOGS,
  REMOVE_CONTAINER,
  REMOVE_IMAGE,
  REMOVE_VOLUME,
  RUN_CONTAINER,
  type AiBridgeScope,
} from '@shared/api/ai-types';
import type { ContainerLogs } from '@shared/api/container-engine-protocol';
import type {
  ContainerStats,
  ContainerSummary,
  ImageSummary,
  RunContainerRequest,
  VolumeSummary,
} from '@shared/api/container-types';
import { AiCapability, AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { Log } from '@shared/angular/services/log/log';
import { ContainersClient } from '../client/containers-client';
import { ContainersAgentCapabilities } from './containers-agent-capabilities';

const CONTAINERS: AiBridgeScope = {
  owningTabId: 'tab',
  surface: 'containers',
  workspaceRoot: null,
};
const PLUGINS: AiBridgeScope = { owningTabId: 'tab', surface: 'plugins', workspaceRoot: null };

/**
 * A running database and a stopped API, as the engine lists them.
 */
const DB: ContainerSummary = {
  id: 'db0123456789abcdef',
  names: ['db'],
  image: 'postgres:16',
  state: 'running',
  status: 'Up 2 minutes',
  ports: [{ privatePort: 5432, publicPort: 5432, protocol: 'tcp' }],
  volumes: ['pgdata'],
};
const API: ContainerSummary = {
  id: 'api0123456789abcdef',
  names: ['api'],
  image: 'acme/api:1',
  state: 'exited',
  status: 'Exited (1) 3 minutes ago',
};

describe('ContainersAgentCapabilities', () => {
  let capabilities: Map<string, AiCapability>;
  let calls: string[];
  let available: boolean;
  let ran: RunContainerRequest[];
  let agent: ContainersAgentCapabilities;

  beforeEach(() => {
    capabilities = new Map<string, AiCapability>();
    calls = [];
    available = true;
    ran = [];
    const act: (name: string) => (id: string) => Promise<boolean> =
      (name: string) =>
      (id: string): Promise<boolean> => {
        calls.push(`${name} ${id}`);
        return Promise.resolve(true);
      };
    TestBed.configureTestingModule({
      providers: [
        ContainersAgentCapabilities,
        {
          provide: AiRuntime,
          useValue: {
            registerCapability: (name: string, handler: AiCapability): (() => void) => {
              capabilities.set(name, handler);
              return (): void => void capabilities.delete(name);
            },
          },
        },
        {
          provide: ContainersClient,
          useValue: {
            ready: (): Promise<void> => Promise.resolve(),
            status: (): Promise<{ available: boolean }> => Promise.resolve({ available }),
            engineInEffect: signal({ displayName: 'Docker' }),
            listContainers: (): Promise<ContainerSummary[]> => Promise.resolve([DB, API]),
            listImages: (): Promise<ImageSummary[]> =>
              Promise.resolve([
                { id: 'sha256:aaaa1111', tags: ['postgres:16'], size: 400 * 1024 * 1024 },
                { id: 'sha256:bbbb2222', tags: ['redis:7'], size: 100 * 1024 * 1024 },
              ]),
            listVolumes: (): Promise<VolumeSummary[]> =>
              Promise.resolve([
                { name: 'pgdata', driver: 'local', createdAt: '', anonymous: false },
                { name: 'old', driver: 'local', createdAt: '', anonymous: false },
              ]),
            stats: (ids: readonly string[]): Promise<ContainerStats[]> =>
              Promise.resolve(
                ids.map((id: string): ContainerStats => ({
                  id,
                  cpuPercent: 12.345,
                  memoryBytes: 64 * 1024 * 1024,
                  memoryLimitBytes: 0,
                })),
              ),
            logs: (id: string, tail: number): Promise<ContainerLogs> =>
              Promise.resolve({ lines: [`${id} ${tail}`, 'FATAL: bad config'], truncated: true }),
            start: act('start'),
            stop: act('stop'),
            restart: act('restart'),
            pause: act('pause'),
            unpause: act('unpause'),
            remove: act('remove'),
            removeImage: act('removeImage'),
            removeVolume: act('removeVolume'),
            pullImage: (reference: string): Promise<{ ok: boolean }> => {
              calls.push(`pull ${reference}`);
              return Promise.resolve({ ok: true });
            },
            run: (request: RunContainerRequest): Promise<{ id: string }> => {
              ran.push(request);
              return Promise.resolve({ id: 'new0123456789' });
            },
          },
        },
        { provide: Log, useValue: { info: (): void => undefined } },
      ],
    });
    agent = TestBed.inject(ContainersAgentCapabilities);
  });

  /**
   * Calls a registered capability.
   * @param name The capability.
   * @param input What the model sent.
   * @param scope The run's scope.
   * @returns Returns the answer.
   */
  function call(name: string, input: unknown, scope: AiBridgeScope = CONTAINERS): Promise<unknown> {
    return Promise.resolve(capabilities.get(name)!(input, scope));
  }

  it('answersOnlyTheContainersViewsOwnAgent', async () => {
    expect(await call(REMOVE_CONTAINER, { id: 'db' }, PLUGINS)).toEqual({ available: false });
    expect(calls).toEqual([]);
  });

  it('listsContainers_withPortsVolumes_andCpuAndMemoryWhileTheyRun', async () => {
    expect(await call(LIST_CONTAINERS, {})).toEqual({
      available: true,
      result: [
        {
          id: 'db0123456789',
          name: 'db',
          image: 'postgres:16',
          state: 'running',
          status: 'Up 2 minutes',
          ports: ['5432->5432/tcp'],
          volumes: ['pgdata'],
          cpuPercent: 12.3,
          memoryMb: 64,
        },
        {
          id: 'api012345678',
          name: 'api',
          image: 'acme/api:1',
          state: 'exited',
          status: 'Exited (1) 3 minutes ago',
          ports: [],
          volumes: [],
        },
      ],
    });
    expect(await call(LIST_CONTAINER_IMAGES, {})).toMatchObject({
      result: [{ tags: ['postgres:16'], sizeMb: 400, usedBy: ['db'] }, { usedBy: [] }],
    });
  });

  it('readsLogs_byNameOrIdPrefix_andSaysWhenThereIsNoSuchContainer', async () => {
    expect(await call(READ_CONTAINER_LOGS, { id: 'api', tail: 50 })).toEqual({
      available: true,
      lines: ['api0123456789abcdef 50', 'FATAL: bad config'],
      truncated: true,
    });
    expect(await call(READ_CONTAINER_LOGS, { id: 'db01' })).toMatchObject({
      lines: ['db0123456789abcdef 200', 'FATAL: bad config'],
    });
    expect(await call(READ_CONTAINER_LOGS, { id: 'nope' })).toEqual({
      available: true,
      error: 'There is no container "nope". List the containers to see their names.',
    });
  });

  it('controlsAContainer_andTheViewReloads', async () => {
    expect(await call(CONTROL_CONTAINER, { id: 'db', action: 'resume' })).toMatchObject({
      name: 'db',
    });
    expect(await call(CONTROL_CONTAINER, { id: 'db', action: 'explode' })).toMatchObject({
      error: '"explode" is not something a container can do.',
    });
    expect(calls).toEqual(['unpause db0123456789abcdef']);
    expect(agent.changes()).toBe(1);
  });

  it('removesARunningContainer_byStoppingItFirst', async () => {
    expect(await call(REMOVE_CONTAINER, { id: 'db' })).toEqual({ available: true, removed: true });
    expect(calls).toEqual(['stop db0123456789abcdef', 'remove db0123456789abcdef']);
  });

  it('refusesToRemoveAnImageOrVolumeStillInUse', async () => {
    expect(await call(REMOVE_IMAGE, { id: 'postgres:16' })).toEqual({
      available: true,
      error: 'postgres:16 is used by db; remove those containers first.',
    });
    expect(await call(REMOVE_VOLUME, { name: 'pgdata' })).toEqual({
      available: true,
      error: 'pgdata is mounted by db; remove those containers first.',
    });
    expect(await call(REMOVE_IMAGE, { id: 'redis:7' })).toEqual({ available: true, removed: true });
    expect(await call(REMOVE_VOLUME, { name: 'old' })).toEqual({ available: true, removed: true });
    expect(calls).toEqual(['removeImage sha256:bbbb2222', 'removeVolume old']);
  });

  it('pullsThenRuns_keepingOnlyTheWellFormedParts', async () => {
    expect(await call(PULL_IMAGE, { reference: 'postgres:16' })).toEqual({
      available: true,
      pulled: true,
    });
    expect(
      await call(RUN_CONTAINER, {
        image: 'postgres:16',
        name: 'db2',
        ports: [{ host: 5433, container: 5432 }, { host: 'x' }],
        env: { POSTGRES_PASSWORD: 'secret' },
      }),
    ).toEqual({ available: true, id: 'new0123456789' });
    expect(ran).toEqual([
      {
        image: 'postgres:16',
        name: 'db2',
        ports: [{ host: 5433, container: 5432, protocol: 'tcp' }],
        env: { POSTGRES_PASSWORD: 'secret' },
        volumes: [],
      },
    ]);
    expect(await call(RUN_CONTAINER, { image: '' })).toEqual({
      available: true,
      error: 'That is not a container to run: name an image at least.',
    });
  });

  it('saysWhenTheEngineIsNotRunning', async () => {
    available = false;
    expect(await call(LIST_CONTAINERS, {})).toEqual({
      available: true,
      error: 'Docker is not running. Start it, then ask again.',
    });
  });
});
