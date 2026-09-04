import { afterEach, describe, expect, it } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { ContainerChannel } from '@shared/api/container-channels';
import {
  ContainerEngineInfo,
  ContainerStatus,
  ContainerSummary,
} from '@shared/api/container-types';
import { ContainerTerminals } from '../container-terminals/container-terminals';
import { ContainersView } from './containers-view';

/**
 * A recorded bridge invocation.
 */
interface RecordedCall {
  readonly channel: string;
  readonly args: readonly unknown[];
}

/**
 * One running container the daemon reports.
 */
const CONTAINER: ContainerSummary = {
  id: 'abc123',
  names: ['web'],
  image: 'nginx:latest',
  state: 'running',
  status: 'Up 3 minutes',
};

/**
 * The Docker engine in effect: the engine the application can launch itself.
 */
const DOCKER: ContainerEngineInfo = {
  id: 'docker',
  displayName: 'Docker',
  available: true,
  inEffect: true,
  cli: 'docker',
  canLaunch: true,
  startCommand: null,
};

/**
 * The Podman engine in effect: the engine the application cannot launch, which offers the command that
 * starts it instead.
 */
const PODMAN: ContainerEngineInfo = {
  id: 'podman',
  displayName: 'Podman',
  available: false,
  inEffect: true,
  cli: 'podman',
  canLaunch: false,
  startCommand: 'podman machine start',
};

describe('ContainersView', () => {
  let calls: RecordedCall[];

  /**
   * Installs a recording stub bridge answering status/list channels with fixed replies.
   * @param status The daemon status to report.
   * @param engine The engine in effect, defaulting to Docker; null reports no engines at all, which is
   * what the renderer sees before the main process answers.
   */
  function stubBridge(status: ContainerStatus, engine: ContainerEngineInfo | null = DOCKER): void {
    calls = [];
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        calls.push({ channel, args });
        if ((channel as ContainerChannel) === ContainerChannel.ListEngines) {
          return Promise.resolve((engine === null ? [] : [engine]) as T);
        }
        if ((channel as ContainerChannel) === ContainerChannel.Status) {
          return Promise.resolve(status as T);
        }
        if ((channel as ContainerChannel) === ContainerChannel.ListContainers) {
          return Promise.resolve([CONTAINER] as T);
        }
        if ((channel as ContainerChannel) === ContainerChannel.ListImages) {
          return Promise.resolve([] as T);
        }
        return Promise.resolve(true as T);
      },
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
  }

  /**
   * Creates the view with its required inputs set and its first load settled.
   * @returns Returns the component fixture.
   */
  async function createView(): Promise<ComponentFixture<ContainersView>> {
    const fixture: ComponentFixture<ContainersView> = TestBed.createComponent(ContainersView);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.componentRef.setInput('isActive', true);
    fixture.detectChanges();
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  it('showsTheDaemonAbsentEmptyStateWithAStartDockerAction', async () => {
    stubBridge({ available: false });
    const fixture: ComponentFixture<ContainersView> = await createView();
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain("Docker isn't running");
    expect(text).toContain('Start Docker');
  });

  it('namesTheEngineInEffectRatherThanDockerWhenItIsNotRunning', async () => {
    stubBridge({ available: false }, PODMAN);
    const fixture: ComponentFixture<ContainersView> = await createView();
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain("Podman isn't running");
    expect(text).toContain('Start Podman to manage containers and images.');
    expect(text).not.toContain('Docker');
  });

  it('offersTheStartCommandInsteadOfALaunchButtonForAnEngineItCannotStart', async () => {
    stubBridge({ available: false }, PODMAN);
    const fixture: ComponentFixture<ContainersView> = await createView();
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    const actions: string = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.containers__empty-actions button'),
    )
      .map((button: Element): string => button.textContent?.trim() ?? '')
      .join(' ');

    expect(text).toContain('podman machine start');
    expect(actions).toContain('Refresh');
    expect(actions).not.toContain('Start');
  });

  it('namesNoEngineBeforeTheEnginesAreKnown', async () => {
    stubBridge({ available: false }, null);
    const fixture: ComponentFixture<ContainersView> = await createView();
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain("The container engine isn't running");
    expect(text).not.toContain('Docker');
  });

  it('listsContainersWhenTheDaemonIsUp', async () => {
    stubBridge({ available: true });
    const fixture: ComponentFixture<ContainersView> = await createView();
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('web');
    expect(text).toContain('nginx:latest');
  });

  it('startInvokesTheStartChannelForTheContainer', async () => {
    stubBridge({ available: true });
    const fixture: ComponentFixture<ContainersView> = await createView();

    (fixture.componentInstance as unknown as { start(id: string): void }).start('abc123');
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });

    expect(
      calls.some(
        (call: RecordedCall): boolean =>
          (call.channel as ContainerChannel) === ContainerChannel.Start,
      ),
    ).toBe(true);
  });

  it('viewLogs_opensADockerLogsTerminalSession', async () => {
    stubBridge({ available: true });
    const fixture: ComponentFixture<ContainersView> = await createView();
    const terminals: ContainerTerminals = fixture.debugElement.injector.get(ContainerTerminals);

    (
      fixture.componentInstance as unknown as { viewLogs(container: ContainerSummary): void }
    ).viewLogs(CONTAINER);

    expect(terminals.sessions()).toHaveLength(1);
    expect(terminals.sessions()[0].name).toContain('Logs');
  });

  it('openShell_opensADockerExecTerminalSession', async () => {
    stubBridge({ available: true });
    const fixture: ComponentFixture<ContainersView> = await createView();
    const terminals: ContainerTerminals = fixture.debugElement.injector.get(ContainerTerminals);

    (
      fixture.componentInstance as unknown as { openShell(container: ContainerSummary): void }
    ).openShell(CONTAINER);

    expect(terminals.sessions()).toHaveLength(1);
    expect(terminals.sessions()[0].name).toContain('shell');
  });
});
