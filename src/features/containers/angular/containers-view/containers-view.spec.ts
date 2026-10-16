import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { Bridge } from '@shared/api/bridge';
import { ContainerChannel } from '@shared/api/container-channels';
import { FileChannel } from '@shared/api/file-channels';
import {
  ContainerEngineInfo,
  ContainerStatus,
  ContainerSummary,
  ImageSummary,
} from '@shared/api/container-types';
import { PluginSummary } from '@shared/api/plugin-channels';
import { ContainerEnginePrompt } from '@shared/angular/services/plugins/container-engine-prompt';
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
  startCommand: 'podman machine start',
};

/**
 * An engine plugin the empty state can offer to install.
 */
const ENGINE_PLUGIN: PluginSummary = {
  id: 'docker-engine',
  name: 'Docker',
  description: '',
  state: 'available',
  contributions: [{ slot: 'container-engine', id: 'docker', displayName: 'Docker', priority: 100 }],
  version: '1.0.0',
  detail: null,
  origin: null,
  installedVersion: null,
};

describe('ContainersView', () => {
  let calls: RecordedCall[];
  let offers: number;
  let installs: number;

  /**
   * Installs a recording stub bridge answering status/list channels with fixed replies.
   * @param status The daemon status to report.
   * @param engine The engine in effect, defaulting to Docker; null reports no engines at all, which is
   * what the renderer sees before the main process answers.
   */
  /**
   * Holds the containers and images the stub engine lists.
   */
  let listed: readonly ContainerSummary[] = [CONTAINER];

  /**
   * Holds what the user answers when asked to confirm a removal.
   */
  let confirms: boolean = true;
  let imaged: readonly ImageSummary[] = [];

  function stubBridge(status: ContainerStatus, engine: ContainerEngineInfo | null = DOCKER): void {
    calls = [];
    confirms = true;
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
          return Promise.resolve(listed as T);
        }
        if ((channel as ContainerChannel) === ContainerChannel.ListImages) {
          return Promise.resolve(imaged as T);
        }
        if (
          (channel as ContainerChannel) === ContainerChannel.ListVolumes ||
          (channel as ContainerChannel) === ContainerChannel.Stats
        ) {
          return Promise.resolve([] as T);
        }
        if ((channel as FileChannel) === FileChannel.ConfirmDestructive) {
          return Promise.resolve(confirms as T);
        }
        // The engine's actions succeed; anything else — the docked agent's providers and
        // conversations (#969) — has nothing to say.
        return Promise.resolve((channel.startsWith('container:') ? true : undefined) as T);
      },
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
  }

  /**
   * Installs a fake engine-install offer, so the view's empty state is tested without reaching the
   * real plugin catalogue.
   * @param candidates The engine plugins available to install.
   */
  function stubPrompt(candidates: readonly PluginSummary[] = []): void {
    offers = 0;
    installs = 0;
    // Reset first, so a test that wants candidates can re-stub over the default one every test gets.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ContainerEnginePrompt,
          useValue: {
            candidates: signal(candidates),
            isInstalled: signal(false),
            offer: (): void => {
              offers += 1;
            },
            installFirstCandidate: (): Promise<void> => {
              installs += 1;
              return Promise.resolve();
            },
          },
        },
      ],
    });
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

  beforeEach(() => {
    // Every test gets the fake offer, not just the ones about it: the real one reaches the plugin
    // catalogue through the bridge, which these tests stub for containers rather than for plugins.
    stubPrompt();
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  it('showsTheEngineAbsentEmptyStateWithoutOfferingToStartIt', async () => {
    // Studio talks to an engine; it does not run one. The launch button went with Docker Desktop when
    // the engines became plugins (#596) — asserted over the buttons, because the copy still says
    // "Start Docker to manage containers and images", which is advice rather than an offer.
    stubBridge({ available: false });
    const fixture: ComponentFixture<ContainersView> = await createView();
    const actions: readonly string[] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '.containers__empty app-button-row button',
      ),
    ).map((button: Element): string => button.textContent?.trim() ?? '');

    expect((fixture.nativeElement as HTMLElement).textContent).toContain("Docker isn't running");
    expect(actions).toEqual(['Refresh']);
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
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '.containers__empty app-button-row button',
      ),
    )
      .map((button: Element): string => button.textContent?.trim() ?? '')
      .join(' ');

    expect(text).toContain('podman machine start');
    expect(actions).toContain('Refresh');
    expect(actions).not.toContain('Start');
  });

  it('withNoEngineInstalled_saysSoRatherThanThatOneIsNotRunning', async () => {
    // The two states look identical from the outside and need opposite things said: one is fixed by
    // starting something, the other by installing something.
    stubBridge({ available: false }, null);
    stubPrompt([ENGINE_PLUGIN]);
    const fixture: ComponentFixture<ContainersView> = await createView();
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('No container engine is installed');
    expect(text).not.toContain("isn't running");
    expect(text).toContain('Install Docker');
  });

  it('withNoEngineInstalled_raisesTheInstallOfferOnce', async () => {
    stubBridge({ available: false }, null);
    stubPrompt([ENGINE_PLUGIN]);
    const fixture: ComponentFixture<ContainersView> = await createView();

    (fixture.componentInstance as unknown as { refresh(): void }).refresh();
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });

    // The prompt itself is what enforces once-per-session; the view simply asks each time it finds
    // nothing, which is why asking twice must be harmless.
    expect(offers).toBeGreaterThanOrEqual(1);
  });

  it('withNoEngineInstalledAndNothingToInstall_saysThatToo', async () => {
    stubBridge({ available: false }, null);
    stubPrompt([]);
    const fixture: ComponentFixture<ContainersView> = await createView();
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('No container engine is installed');
    expect(text).toContain('No container engine plugin is available to install.');
  });

  it('installEngine_installsTheOfferedEngine', async () => {
    stubBridge({ available: false }, null);
    stubPrompt([ENGINE_PLUGIN]);
    const fixture: ComponentFixture<ContainersView> = await createView();

    await (
      fixture.componentInstance as unknown as { installEngine(): Promise<void> }
    ).installEngine();

    expect(installs).toBe(1);
  });

  it('withAnEngineInstalledButNotRunning_neverOffersAnInstall', async () => {
    // Installing a second engine is not the answer to the first one being stopped.
    stubBridge({ available: false }, PODMAN);
    stubPrompt([ENGINE_PLUGIN]);
    const fixture: ComponentFixture<ContainersView> = await createView();
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain("Podman isn't running");
    expect(offers).toBe(0);
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

  it('remove_asksFirst_andRemovesNothingWhenTheUserSaysNo', async () => {
    // #969: a removed container cannot be got back.
    stubBridge({ available: true });
    const fixture: ComponentFixture<ContainersView> = await createView();
    const view: { remove(id: string): Promise<void> } = fixture.componentInstance as unknown as {
      remove(id: string): Promise<void>;
    };
    const removals: () => number = (): number =>
      calls.filter(
        (call: RecordedCall): boolean =>
          (call.channel as ContainerChannel) === ContainerChannel.Remove,
      ).length;

    confirms = false;
    await view.remove('abc123');
    expect(
      calls.some(
        (call: RecordedCall): boolean =>
          (call.channel as FileChannel) === FileChannel.ConfirmDestructive,
      ),
    ).toBe(true);
    expect(removals()).toBe(0);

    confirms = true;
    await view.remove('abc123');
    expect(removals()).toBe(1);
  });

  it('bulk_actsOnEveryTickedContainer_andTheRowMenuOffersPauseAndRestart', async () => {
    // #974.
    stubBridge({ available: true });
    const fixture: ComponentFixture<ContainersView> = await createView();
    const view: {
      setChecked(id: string, on: boolean): void;
      bulk(action: 'restart'): Promise<void>;
      menuTarget: WritableSignal<ContainerSummary | null>;
      rowMenuItems(): readonly MenuItem[];
    } = fixture.componentInstance as unknown as {
      setChecked(id: string, on: boolean): void;
      bulk(action: 'restart'): Promise<void>;
      menuTarget: WritableSignal<ContainerSummary | null>;
      rowMenuItems(): readonly MenuItem[];
    };

    view.setChecked('abc123', true);
    view.setChecked('other', true);
    await view.bulk('restart');

    expect(
      calls
        .filter(
          (call: RecordedCall): boolean =>
            (call.channel as ContainerChannel) === ContainerChannel.Restart,
        )
        .map((call: RecordedCall): unknown => call.args[0]),
    ).toEqual(['abc123', 'other']);

    view.menuTarget.set(CONTAINER);
    expect(view.rowMenuItems().map((item: MenuItem): string => item.id)).toEqual(
      expect.arrayContaining(['restart', 'pause']),
    );
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

  describe('the side panel and table (#952)', () => {
    const STOPPED: ContainerSummary = {
      id: 'def456',
      names: ['db'],
      image: 'postgres:16',
      state: 'exited',
      status: 'Exited (0) 2 hours ago',
    };
    const NGINX: ImageSummary = { id: 'sha256:aaa', tags: ['nginx:latest'], size: 1024 };
    const POSTGRES: ImageSummary = { id: 'sha256:bbb', tags: ['postgres:16'], size: 2048 };

    beforeEach(() => {
      listed = [CONTAINER, STOPPED];
      imaged = [NGINX, POSTGRES];
    });

    afterEach(() => {
      listed = [CONTAINER];
      imaged = [];
    });

    /**
     * Reads the side panel's entries.
     * @param fixture The view.
     * @returns Returns them as "Label count".
     */
    function kinds(fixture: ComponentFixture<ContainersView>): string[] {
      return [
        ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
          '.category-list__item',
        ),
      ].map(
        (entry: HTMLElement): string =>
          `${entry.querySelector('.category-list__label')?.textContent?.trim()} ${entry
            .querySelector('.category-list__count')
            ?.textContent?.trim()}`,
      );
    }

    /**
     * Reads the shown table's first text column.
     * @param fixture The view.
     * @returns Returns the names (containers) or tags (images), in row order.
     */
    function names(fixture: ComponentFixture<ContainersView>): string[] {
      return [
        ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
          'tr.table-row .containers__name',
        ),
      ].map((cell: HTMLElement): string => cell.textContent?.trim() ?? '');
    }

    it('listsContainersAndImages_withCounts_andShowsOneTableAtATime', async () => {
      stubBridge({ available: true });
      const fixture: ComponentFixture<ContainersView> = await createView();
      const host: HTMLElement = fixture.nativeElement as HTMLElement;

      expect(kinds(fixture)).toEqual(['Containers 2', 'Images 2', 'Volumes 0']);
      expect(host.querySelectorAll('app-table')).toHaveLength(1);
      expect(names(fixture)).toEqual(['web', 'db']);

      host.querySelectorAll<HTMLButtonElement>('.category-list__item')[1].click();
      fixture.detectChanges();

      expect(host.querySelectorAll('app-table')).toHaveLength(1);
      expect(names(fixture)).toEqual(['nginx:latest', 'postgres:16']);
    });

    it('onlyShowRunning_hidesStoppedContainers', async () => {
      stubBridge({ available: true });
      const fixture: ComponentFixture<ContainersView> = await createView();

      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLInputElement>('.containers__running-only input')
        ?.click();
      fixture.detectChanges();

      expect(names(fixture)).toEqual(['web']);
    });

    it('search_narrowsByNameOrImage', async () => {
      stubBridge({ available: true });
      const fixture: ComponentFixture<ContainersView> = await createView();
      const input: HTMLInputElement = (fixture.nativeElement as HTMLElement).querySelector(
        '.category-list__search input',
      )!;

      input.value = 'postgres';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(names(fixture)).toEqual(['db']);
    });

    it('imageLink_showsThatImageSelectedInTheImagesList', async () => {
      stubBridge({ available: true });
      const fixture: ComponentFixture<ContainersView> = await createView();
      const host: HTMLElement = fixture.nativeElement as HTMLElement;

      host.querySelector<HTMLButtonElement>('.containers__image-link')?.click();
      fixture.detectChanges();

      expect(names(fixture)).toEqual(['nginx:latest', 'postgres:16']);
      expect(
        host.querySelector('tr.table-row--selected .containers__name')?.textContent?.trim(),
      ).toBe('nginx:latest');
    });

    it('rowMenu_opensLogsForTheRowThatOpenedIt_andOffersAShellOnlyWhileItRuns', async () => {
      stubBridge({ available: true });
      const fixture: ComponentFixture<ContainersView> = await createView();
      const view: {
        menuTarget: WritableSignal<ContainerSummary | null>;
        rowMenuItems(): readonly MenuItem[];
        onRowMenu(id: string): void;
      } = fixture.componentInstance as unknown as {
        menuTarget: WritableSignal<ContainerSummary | null>;
        rowMenuItems(): readonly MenuItem[];
        onRowMenu(id: string): void;
      };
      const terminals: ContainerTerminals = fixture.debugElement.injector.get(ContainerTerminals);

      view.menuTarget.set(STOPPED);
      expect(view.rowMenuItems().find((item: MenuItem) => item.id === 'shell')?.disabled).toBe(
        true,
      );
      view.onRowMenu('logs');

      expect(terminals.sessions()).toHaveLength(1);
      expect(terminals.sessions()[0].name).toContain('db');
    });

    it('terminals_closingThePanelHidesIt_andTheNextSessionShowsItAgain', async () => {
      // Driven through the view rather than the rendered panel: a rendered session mounts a real
      // terminal, which needs browser APIs the test environment does not have.
      stubBridge({ available: true });
      const fixture: ComponentFixture<ContainersView> = await createView();
      const view: {
        terminalsHidden: WritableSignal<boolean>;
        hideTerminals(): void;
        viewLogs(container: ContainerSummary): void;
      } = fixture.componentInstance as unknown as {
        terminalsHidden: WritableSignal<boolean>;
        hideTerminals(): void;
        viewLogs(container: ContainerSummary): void;
      };

      view.viewLogs(CONTAINER);
      view.hideTerminals();
      expect(view.terminalsHidden()).toBe(true);

      view.viewLogs(STOPPED);
      expect(view.terminalsHidden()).toBe(false);
    });
  });
});
