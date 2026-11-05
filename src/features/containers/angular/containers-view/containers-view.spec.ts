import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Signal, signal, WritableSignal } from '@angular/core';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { TableRow } from '@shared/angular/components/table/table';
import { Bridge } from '@shared/api/bridge';
import { ContainerChannel } from '@shared/api/container-channels';
import { FileChannel } from '@shared/api/file-channels';
import {
  ContainerEngineInfo,
  ContainerStats,
  ContainerStatus,
  ContainerSummary,
  ImageSummary,
  VolumeSummary,
} from '@shared/api/container-types';
import { PluginSummary } from '@shared/api/plugin-channels';
import { DocumentVisibility } from '@shared/angular/services/document-visibility/document-visibility';
import { ContainerEnginePrompt } from '@shared/angular/services/plugins/container-engine-prompt';
import { Settings } from '@shared/angular/services/settings/settings';
import { ContainersCommands } from '../containers-commands/containers-commands';
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
  let onScreen: WritableSignal<boolean>;
  let pushes: Map<string, (...args: unknown[]) => void>;

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
  let volumed: readonly VolumeSummary[] = [];
  let sampled: readonly ContainerStats[] = [];

  /**
   * Holds the channels the engine answers no on.
   */
  let refused: ReadonlySet<ContainerChannel> = new Set<ContainerChannel>();

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
        if ((channel as ContainerChannel) === ContainerChannel.ListVolumes) {
          return Promise.resolve(volumed as T);
        }
        if ((channel as ContainerChannel) === ContainerChannel.Stats) {
          return Promise.resolve(sampled as T);
        }
        if (refused.has(channel as ContainerChannel)) {
          return Promise.resolve(false as T);
        }
        if ((channel as FileChannel) === FileChannel.ConfirmDestructive) {
          return Promise.resolve(confirms as T);
        }
        // The engine's actions succeed; anything else — the docked agent's providers and
        // conversations (#969) — has nothing to say.
        return Promise.resolve((channel.startsWith('container:') ? true : undefined) as T);
      },
      send: (): void => undefined,
      on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
        pushes.set(channel, listener);
        return (): void => undefined;
      },
    };
    pushes = new Map<string, (...args: unknown[]) => void>();
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
    onScreen = signal<boolean>(true);
    // Reset first, so a test that wants candidates can re-stub over the default one every test gets.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: DocumentVisibility, useValue: { visible: onScreen } },
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
    localStorage.removeItem('settings');
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

  it('whenTheWindowLeavesTheScreen_statsAndEventReloadsPause_andReturningCatchesUpOnce', async () => {
    // Audit P4: the tab stays active behind another app or on another desktop; its feeds should not.
    stubBridge({ available: true });
    const fixture: ComponentFixture<ContainersView> = await createView();
    const count: (channel: ContainerChannel) => number = (channel: ContainerChannel): number =>
      calls.filter((call: RecordedCall): boolean => (call.channel as ContainerChannel) === channel)
        .length;
    const stats: number = count(ContainerChannel.Stats);
    const lists: number = count(ContainerChannel.ListContainers);
    expect(stats).toBeGreaterThan(0);

    onScreen.set(false);
    fixture.detectChanges();
    pushes.get(ContainerChannel.Events)?.({ type: 'start' });
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 400);
    });
    expect(count(ContainerChannel.Stats)).toBe(stats);
    expect(count(ContainerChannel.ListContainers)).toBe(lists);

    onScreen.set(true);
    fixture.detectChanges();
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
    expect(count(ContainerChannel.ListContainers)).toBe(lists + 1);
    expect(count(ContainerChannel.Stats)).toBeGreaterThan(stats);
  });

  it('listsContainersWhenTheDaemonIsUp', async () => {
    stubBridge({ available: true });
    const fixture: ComponentFixture<ContainersView> = await createView();
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('web');
    expect(text).toContain('nginx:latest');
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

  it('bulk_actsOnEveryTickedContainer_andTheRowMenuOffersPauseButNotRestart', async () => {
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
      expect.arrayContaining(['pause']),
    );
    expect(view.rowMenuItems().map((item: MenuItem): string => item.id)).not.toContain('restart');
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

      const ribbon: ContainersCommands = TestBed.inject(ContainersCommands);
      ribbon.setShown('paused', false);
      ribbon.setShown('stopped', false);
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

  describe('acting on what is listed', () => {
    const PAUSED: ContainerSummary = { ...CONTAINER, id: 'paused1', state: 'paused' };
    const USED: VolumeSummary = {
      name: 'data',
      driver: 'local',
      anonymous: false,
    } as VolumeSummary;
    const LOOSE: VolumeSummary = {
      name: '0123456789abcdef0123',
      driver: 'local',
      anonymous: true,
    } as VolumeSummary;
    const NGINX: ImageSummary = { id: 'sha256:aaa', tags: ['nginx:latest'], size: 1024 };

    /**
     * What these tests reach of the view: what its template binds.
     */
    interface View {
      readonly selectedId: WritableSignal<string | null>;
      readonly menuTarget: WritableSignal<ContainerSummary | null>;
      readonly notice: Signal<string | null>;
      readonly query: WritableSignal<string>;
      readonly kind: WritableSignal<string>;
      readonly runImage: Signal<string | null>;
      readonly pullOpen: WritableSignal<boolean>;
      readonly volumeRows: Signal<readonly TableRow[]>;
      readonly engineStartCommand: Signal<string | null>;
      setChecked(id: string, on: boolean): void;
      clearChecked(): void;
      checked(): ReadonlySet<string>;
      bulk(action: 'start' | 'stop' | 'restart' | 'remove'): Promise<void>;
      onRowMenu(id: string): void;
      removeImage(entry: { image: ImageSummary; usedBy: number }): Promise<void>;
      removeVolume(entry: { volume: VolumeSummary; usedBy: number }): Promise<void>;
      openRun(image?: string): void;
      onRunClosed(id: string | null): void;
      onPullClosed(pulled: boolean): void;
      formatPorts(container: ContainerSummary): string;
      formatCpu(id: string): string;
      formatMemory(id: string): string;
      displayVolume(volume: VolumeSummary): string;
    }

    /**
     * Reaches the view's template-facing members.
     * @param fixture The view.
     * @returns Returns them.
     */
    function drive(fixture: ComponentFixture<ContainersView>): View {
      return fixture.componentInstance as unknown as View;
    }

    /**
     * Reads which containers a channel was called with.
     * @param channel The channel.
     * @returns Returns the first argument of each call.
     */
    function calledWith(channel: ContainerChannel): unknown[] {
      return calls
        .filter((call: RecordedCall): boolean => (call.channel as ContainerChannel) === channel)
        .map((call: RecordedCall): unknown => call.args[0]);
    }

    /**
     * Lets the actions and reloads started by a synchronous call finish.
     */
    async function settled(): Promise<void> {
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 0);
      });
    }

    beforeEach(() => {
      stubBridge({ available: true });
    });

    afterEach(() => {
      listed = [CONTAINER];
      imaged = [];
      volumed = [];
      sampled = [];
      refused = new Set<ContainerChannel>();
    });

    describe('from the ribbon', () => {
      it('actsOnTheSelectedContainer', async () => {
        const fixture: ComponentFixture<ContainersView> = await createView();
        const ribbon: ContainersCommands = TestBed.inject(ContainersCommands);
        drive(fixture).selectedId.set('abc123');

        ribbon.stop();
        await settled();
        ribbon.restart();
        await settled();

        expect(ribbon.hasSelection()).toBe(true);
        expect(ribbon.selectionRunning()).toBe(true);
        expect(calledWith(ContainerChannel.Stop)).toEqual(['abc123']);
        expect(calledWith(ContainerChannel.Restart)).toEqual(['abc123']);
      });

      it('doesNothing_withNoSelection', async () => {
        const fixture: ComponentFixture<ContainersView> = await createView();
        const ribbon: ContainersCommands = TestBed.inject(ContainersCommands);
        calls = [];

        ribbon.start();
        ribbon.stop();
        ribbon.remove();
        ribbon.restart();
        ribbon.pause();
        ribbon.resume();
        ribbon.viewLogs();
        ribbon.shell();
        await settled();

        expect(ribbon.hasSelection()).toBe(false);
        expect(calls).toEqual([]);
        expect(fixture.debugElement.injector.get(ContainerTerminals).sessions()).toEqual([]);
      });

      it('resumesAPausedContainer_andPausesARunningOne', async () => {
        listed = [CONTAINER, PAUSED];
        const fixture: ComponentFixture<ContainersView> = await createView();
        const ribbon: ContainersCommands = TestBed.inject(ContainersCommands);

        drive(fixture).selectedId.set('paused1');
        expect(ribbon.canResume()).toBe(true);
        expect(ribbon.canPause()).toBe(false);
        ribbon.resume();
        await settled();
        drive(fixture).selectedId.set('abc123');
        expect(ribbon.canResume()).toBe(false);
        expect(ribbon.canPause()).toBe(true);
        ribbon.pause();
        await settled();

        expect(calledWith(ContainerChannel.Unpause)).toEqual(['paused1']);
        expect(calledWith(ContainerChannel.Pause)).toEqual(['abc123']);
      });

      it('opensNoShell_inAContainerThatIsNotRunning', async () => {
        listed = [PAUSED];
        const fixture: ComponentFixture<ContainersView> = await createView();
        drive(fixture).selectedId.set('paused1');

        TestBed.inject(ContainersCommands).shell();

        expect(fixture.debugElement.injector.get(ContainerTerminals).sessions()).toEqual([]);
      });

      it('removesTheSelectedContainer_afterAsking', async () => {
        const fixture: ComponentFixture<ContainersView> = await createView();
        drive(fixture).selectedId.set('abc123');

        TestBed.inject(ContainersCommands).remove();
        await settled();

        expect(
          calledWith(FileChannel.ConfirmDestructive as unknown as ContainerChannel),
        ).toHaveLength(1);
        expect(calledWith(ContainerChannel.Remove)).toEqual(['abc123']);
      });

      it('stopsAnsweringForATabThatWentToTheBack', async () => {
        const fixture: ComponentFixture<ContainersView> = await createView();
        const ribbon: ContainersCommands = TestBed.inject(ContainersCommands);
        drive(fixture).selectedId.set('abc123');

        fixture.componentRef.setInput('isActive', false);
        fixture.detectChanges();
        ribbon.stop();
        await settled();

        expect(calledWith(ContainerChannel.Stop)).toEqual([]);
      });
    });

    describe('the row menu', () => {
      it('runsTheChoiceOnTheRowThatOpenedIt', async () => {
        const fixture: ComponentFixture<ContainersView> = await createView();
        const view: View = drive(fixture);
        view.menuTarget.set(CONTAINER);

        view.onRowMenu('pause');
        await settled();
        view.onRowMenu('shell');

        expect(calledWith(ContainerChannel.Pause)).toEqual(['abc123']);
        expect(fixture.debugElement.injector.get(ContainerTerminals).sessions()).toHaveLength(1);
      });

      it('ignoresAChoiceWithNoRow', async () => {
        const fixture: ComponentFixture<ContainersView> = await createView();
        calls = [];

        drive(fixture).onRowMenu('pause');
        await settled();

        expect(calls).toEqual([]);
      });
    });

    describe('ticking', () => {
      it('untickingAndClearing_leavesNothingToActOn', async () => {
        const fixture: ComponentFixture<ContainersView> = await createView();
        const view: View = drive(fixture);
        view.setChecked('abc123', true);
        view.setChecked('abc123', false);
        await view.bulk('stop');
        view.setChecked('abc123', true);
        view.clearChecked();
        await view.bulk('stop');

        expect(calledWith(ContainerChannel.Stop)).toEqual([]);
      });
    });

    describe('bulk', () => {
      it('theRibbon_actsOnTheTickedContainers', async () => {
        const fixture: ComponentFixture<ContainersView> = await createView();
        const view: View = drive(fixture);
        const ribbon: ContainersCommands = TestBed.inject(ContainersCommands);
        view.setChecked('abc123', true);

        expect(ribbon.hasTargets()).toBe(true);
        expect(ribbon.canStop()).toBe(true);
        expect(ribbon.canPause()).toBe(true);

        ribbon.restart();
        await settled();

        expect(calledWith(ContainerChannel.Restart)).toEqual(['abc123']);
      });

      describe('which ticked containers each ribbon button reaches', () => {
        const STOPPED: ContainerSummary = { ...CONTAINER, id: 'stopped1', state: 'exited' };

        /**
         * Lists and ticks one running, one paused and one stopped container.
         * @returns Returns the ribbon.
         */
        async function tickOneOfEach(): Promise<ContainersCommands> {
          listed = [CONTAINER, PAUSED, STOPPED];
          const view: View = drive(await createView());
          view.setChecked('abc123', true);
          view.setChecked('paused1', true);
          view.setChecked('stopped1', true);
          return TestBed.inject(ContainersCommands);
        }

        it('start_startsTheStopped_resumesThePaused_andSkipsTheRunning', async () => {
          const ribbon: ContainersCommands = await tickOneOfEach();

          ribbon.start();
          await settled();

          expect(calledWith(ContainerChannel.Start)).toEqual(['stopped1']);
          expect(calledWith(ContainerChannel.Unpause)).toEqual(['paused1']);
        });

        it('stop_stopsTheRunningAndThePaused_andSkipsTheStopped', async () => {
          const ribbon: ContainersCommands = await tickOneOfEach();

          ribbon.stop();
          await settled();

          expect(calledWith(ContainerChannel.Stop)).toEqual(['abc123', 'paused1']);
        });

        it('pause_reachesOnlyTheRunning', async () => {
          const ribbon: ContainersCommands = await tickOneOfEach();

          ribbon.pause();
          await settled();

          expect(calledWith(ContainerChannel.Pause)).toEqual(['abc123']);
        });

        it('resume_reachesOnlyThePaused', async () => {
          const ribbon: ContainersCommands = await tickOneOfEach();

          ribbon.resume();
          await settled();

          expect(calledWith(ContainerChannel.Unpause)).toEqual(['paused1']);
        });

        it('theSelectSwitches_addAndRemoveAKind_andShowItChecked', async () => {
          listed = [CONTAINER, PAUSED, STOPPED];
          const view: View = drive(await createView());
          const ribbon: ContainersCommands = TestBed.inject(ContainersCommands);

          ribbon.setSelected('running', true);
          ribbon.setSelected('paused', true);
          expect([...view.checked()]).toEqual(['abc123', 'paused1']);
          expect(ribbon.selectedGroups().has('running')).toBe(true);
          expect(ribbon.selectedGroups().has('stopped')).toBe(false);

          ribbon.setSelected('running', false);
          expect([...view.checked()]).toEqual(['paused1']);
        });

        it('hidingAKind_unticksIt_soTheRibbonCannotActOnWhatIsOutOfSight', async () => {
          listed = [CONTAINER, PAUSED, STOPPED];
          const view: View = drive(await createView());
          const ribbon: ContainersCommands = TestBed.inject(ContainersCommands);
          view.setChecked('stopped1', true);

          ribbon.setShown('stopped', false);

          expect(view.checked().size).toBe(0);
          ribbon.showAll();
          expect(ribbon.shownGroups().size).toBe(3);
        });

        it('aPausedAndAStoppedContainer_offerStartStopAndResume_butNotPause', async () => {
          listed = [PAUSED, STOPPED];
          const view: View = drive(await createView());
          const ribbon: ContainersCommands = TestBed.inject(ContainersCommands);
          view.setChecked('paused1', true);
          view.setChecked('stopped1', true);

          expect(ribbon.canStart()).toBe(true);
          expect(ribbon.canStop()).toBe(true);
          expect(ribbon.canResume()).toBe(true);
          expect(ribbon.canPause()).toBe(false);
        });
      });

      it('remove_whenTheUserSaysNo_removesNothing', async () => {
        const fixture: ComponentFixture<ContainersView> = await createView();
        const view: View = drive(fixture);
        view.setChecked('abc123', true);
        confirms = false;

        await view.bulk('remove');

        expect(calledWith(ContainerChannel.Remove)).toEqual([]);
        expect(view.checked().size).toBe(1);
      });

      it('remove_clearsTheTicks', async () => {
        const fixture: ComponentFixture<ContainersView> = await createView();
        const view: View = drive(fixture);
        view.setChecked('abc123', true);

        await view.bulk('remove');

        expect(calledWith(ContainerChannel.Remove)).toEqual(['abc123']);
        expect(view.checked().size).toBe(0);
      });

      it('reportsHowManyFailed', async () => {
        refused = new Set<ContainerChannel>([ContainerChannel.Stop]);
        listed = [CONTAINER, { ...CONTAINER, id: 'other' }];
        const fixture: ComponentFixture<ContainersView> = await createView();
        const view: View = drive(fixture);
        view.setChecked('abc123', true);
        view.setChecked('other', true);

        await view.bulk('stop');

        expect(view.notice()).toBe('2 of 2 containers did not stop.');
      });

      it('aSecondAction_whileOneRuns_isIgnored', async () => {
        const fixture: ComponentFixture<ContainersView> = await createView();
        const view: View = drive(fixture);
        view.setChecked('abc123', true);

        await Promise.all([view.bulk('restart'), view.bulk('restart')]);

        expect(calledWith(ContainerChannel.Restart)).toEqual(['abc123']);
      });
    });

    describe('images and volumes', () => {
      it('removeImage_refused_saysAContainerUsesIt', async () => {
        refused = new Set<ContainerChannel>([ContainerChannel.RemoveImage]);
        const fixture: ComponentFixture<ContainersView> = await createView();

        await drive(fixture).removeImage({ image: NGINX, usedBy: 1 });

        expect(drive(fixture).notice()).toBe(
          'nginx:latest could not be removed: a container uses it.',
        );
      });

      it('removeImage_refusedForNoKnownReason_saysOnlyThat', async () => {
        refused = new Set<ContainerChannel>([ContainerChannel.RemoveImage]);
        const fixture: ComponentFixture<ContainersView> = await createView();

        await drive(fixture).removeImage({ image: NGINX, usedBy: 0 });

        expect(drive(fixture).notice()).toBe('nginx:latest could not be removed.');
      });

      it('removeImage_clearsAnEarlierNotice', async () => {
        refused = new Set<ContainerChannel>([ContainerChannel.RemoveImage]);
        const fixture: ComponentFixture<ContainersView> = await createView();
        await drive(fixture).removeImage({ image: NGINX, usedBy: 0 });
        refused = new Set<ContainerChannel>();

        await drive(fixture).removeImage({ image: NGINX, usedBy: 0 });

        expect(drive(fixture).notice()).toBeNull();
      });

      it('removeVolume_whenTheUserSaysNo_keepsIt', async () => {
        const fixture: ComponentFixture<ContainersView> = await createView();
        confirms = false;

        await drive(fixture).removeVolume({ volume: USED, usedBy: 0 });

        expect(calledWith(ContainerChannel.RemoveVolume)).toEqual([]);
      });

      it('removeVolume_withConfirmationOff_doesNotAsk', async () => {
        TestBed.inject(Settings).set('containers.confirmRemoval', false);
        const fixture: ComponentFixture<ContainersView> = await createView();

        await drive(fixture).removeVolume({ volume: USED, usedBy: 0 });

        expect(calledWith(FileChannel.ConfirmDestructive as unknown as ContainerChannel)).toEqual(
          [],
        );
        expect(calledWith(ContainerChannel.RemoveVolume)).toEqual(['data']);
      });

      it('removeVolume_refused_saysAContainerMountsIt', async () => {
        refused = new Set<ContainerChannel>([ContainerChannel.RemoveVolume]);
        const fixture: ComponentFixture<ContainersView> = await createView();

        await drive(fixture).removeVolume({ volume: USED, usedBy: 2 });

        expect(drive(fixture).notice()).toBe('data could not be removed: a container mounts it.');
      });

      it('volumeRows_countMounts_andFollowTheSearch', async () => {
        volumed = [USED, LOOSE];
        listed = [{ ...CONTAINER, volumes: ['data'] }];
        const fixture: ComponentFixture<ContainersView> = await createView();
        const view: View = drive(fixture);

        expect(view.volumeRows().map((row: TableRow): unknown => row.data)).toEqual([
          { volume: USED, usedBy: 1 },
          { volume: LOOSE, usedBy: 0 },
        ]);

        view.query.set('DAT');

        expect(view.volumeRows().map((row: TableRow): string => row.id)).toEqual(['data']);
      });

      it('displayVolume_shortensAnAnonymousName', async () => {
        const fixture: ComponentFixture<ContainersView> = await createView();

        expect(drive(fixture).displayVolume(LOOSE)).toBe('0123456789ab… (anonymous)');
        expect(drive(fixture).displayVolume(USED)).toBe('data');
      });
    });

    describe('the Run and Pull dialogs', () => {
      it('run_withAnImage_seedsTheDialog', async () => {
        const fixture: ComponentFixture<ContainersView> = await createView();

        drive(fixture).openRun('nginx:latest');

        expect(drive(fixture).runImage()).toBe('nginx:latest');
      });

      it('run_closedWithAContainer_showsIt', async () => {
        const fixture: ComponentFixture<ContainersView> = await createView();
        const view: View = drive(fixture);
        view.kind.set('images');
        view.openRun();

        view.onRunClosed('abc123');
        await settled();

        expect(view.runImage()).toBeNull();
        expect(view.kind()).toBe('containers');
        expect(view.selectedId()).toBe('abc123');
      });

      it('run_cancelled_staysWhereItWas', async () => {
        const fixture: ComponentFixture<ContainersView> = await createView();
        const view: View = drive(fixture);
        view.kind.set('images');
        view.openRun();
        calls = [];

        view.onRunClosed(null);
        await settled();

        expect(view.kind()).toBe('images');
        expect(calls).toEqual([]);
      });

      it('pull_reloadsOnlyWhenAnImageCame', async () => {
        const fixture: ComponentFixture<ContainersView> = await createView();
        calls = [];

        drive(fixture).onPullClosed(false);
        await settled();
        expect(calledWith(ContainerChannel.ListImages)).toEqual([]);

        drive(fixture).onPullClosed(true);
        await settled();
        expect(calledWith(ContainerChannel.ListImages)).toHaveLength(1);
      });
    });

    describe('the shell it opens', () => {
      /**
       * Opens a shell under given settings.
       * @param settings The container settings to hold.
       * @returns Returns the session's command.
       */
      async function shellWith(settings: Record<string, string>): Promise<string> {
        const held: Settings = TestBed.inject(Settings);
        for (const [key, value] of Object.entries(settings)) {
          held.set(key as 'containers.shell', value as 'custom');
        }
        const fixture: ComponentFixture<ContainersView> = await createView();
        const opened: Mock<(name: string, command: string) => void> =
          vi.fn<(name: string, command: string) => void>();
        vi.spyOn(fixture.debugElement.injector.get(ContainerTerminals), 'open').mockImplementation(
          opened,
        );
        drive(fixture).menuTarget.set(CONTAINER);
        drive(fixture).onRowMenu('shell');
        return opened.mock.calls[0]?.[1] ?? '';
      }

      it('usesTheNamedShell', async () => {
        expect(await shellWith({ 'containers.shell': 'zsh' })).toMatch(/exec -it abc123 zsh$/);
      });

      it('usesACustomShell', async () => {
        const command: string = await shellWith({
          'containers.shell': 'custom',
          'containers.shellCustom': ' fish -l ',
        });

        expect(command).toMatch(/exec -it abc123 fish -l$/);
      });

      it('fallsBackToSh_whenTheCustomShellIsBlank', async () => {
        const command: string = await shellWith({
          'containers.shell': 'custom',
          'containers.shellCustom': '   ',
        });

        expect(command).toMatch(/exec -it abc123 sh$/);
      });

      it('reachesTheEngineAtACustomAddress', async () => {
        const command: string = await shellWith({
          'containers.engineAddressMode': 'custom',
          'containers.engineAddress': 'tcp://engine:2375',
        });

        expect(command).toContain('-H "tcp://engine:2375" exec');
      });
    });

    describe('what a row shows', () => {
      it('formatPorts_showsPublishedPortsOnce_andMarksNonTcp', async () => {
        const fixture: ComponentFixture<ContainersView> = await createView();

        const ports: string = drive(fixture).formatPorts({
          ...CONTAINER,
          ports: [
            { privatePort: 80, publicPort: 8080, protocol: 'tcp' },
            { privatePort: 80, publicPort: 8080, protocol: 'tcp' },
            { privatePort: 53, publicPort: 5353, protocol: 'udp' },
            { privatePort: 443, protocol: 'tcp' },
          ],
        });

        expect(ports).toBe('8080→80, 5353→53/udp');
      });

      it('formatPorts_withNonePublished_isADash', async () => {
        const fixture: ComponentFixture<ContainersView> = await createView();

        expect(drive(fixture).formatPorts(CONTAINER)).toBe('—');
      });

      it('stats_showForARunningContainer_andDashForOneNotRead', async () => {
        sampled = [{ id: 'abc123', cpuPercent: 12.34, memoryBytes: 2048 } as ContainerStats];
        const fixture: ComponentFixture<ContainersView> = await createView();
        await settled();

        expect(drive(fixture).formatCpu('abc123')).toBe('12.3%');
        expect(drive(fixture).formatMemory('abc123')).toContain('KB');
        expect(drive(fixture).formatCpu('other')).toBe('—');
        expect(drive(fixture).formatMemory('other')).toBe('—');
      });
    });

    it('selection_ofAContainerThatWentAway_isDropped', async () => {
      const fixture: ComponentFixture<ContainersView> = await createView();
      const view: View = drive(fixture);
      view.selectedId.set('abc123');
      view.setChecked('abc123', true);
      listed = [];

      TestBed.inject(ContainersCommands).refresh();
      await settled();

      expect(view.selectedId()).toBeNull();
      expect(TestBed.inject(ContainersCommands).hasSelection()).toBe(false);
    });
  });
});
