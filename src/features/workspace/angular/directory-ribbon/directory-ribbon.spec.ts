import { ApplicationRef, computed, signal, Signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActiveRun, Builds, BuildTask } from '@shared/angular/services/tasks/builds';
import { Debugger } from '@shared/angular/services/debug/debugger';
import { StudioConfig } from '@shared/angular/services/studio/studio-config';
import { WorkspaceCapabilities } from '@shared/angular/services/workspace/workspace-capabilities';
import { ProjectAction, ProjectCapabilities } from '@shared/api/project-system';
import { RunConfiguration } from '@shared/api/studio';
import { DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { RibbonMenuItem } from '@shared/angular/components/ribbon-strip/ribbon-strip-menu-button/ribbon-strip-menu-button';
import { DockNode, mkStack } from '@shared/angular/services/dock-layout/dock-node';
import { LayoutInfo, Layouts } from '@shared/angular/services/layouts/layouts';
import { SourceControlCommands } from '@shared/angular/services/source-control-commands/source-control-commands';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import {
  WorkspaceDocumentCommandHandler,
  WorkspaceDocumentCommands,
} from '@features/workspace/angular/workspace-document-commands/workspace-document-commands';
import { AppMenu } from '@shared/angular/services/app-menu/app-menu';
import { MenuContribution, MenuEntry } from '@shared/angular/services/app-menu/app-menu-model';
import {
  DockPanelCommandHandler,
  DockPanelCommands,
  DockPanelState,
} from '@shared/angular/services/dock-panel-commands/dock-panel-commands';
import { DirectoryRibbon } from './directory-ribbon';

/**
 * The protected surface of the ribbon exercised by these tests.
 */
interface RibbonInternals {
  runOptions(): readonly DropdownOption[];
  stopLabel(): string;
  runMenuItems(): readonly { readonly id: string; readonly label: string }[];
  onStopRun(runId: string): void;
  selectedRunId(): string | null;
  canRun(): boolean;
  onRun(): void;
  onSelectRunItem(id: string): void;
  onStop(): void;
  actionItems(): readonly RibbonMenuItem[];
  onActionItem(id: string): void;
  hasActions(): boolean;
  anyRunning(): boolean;
  onStartStop(): void;
  canBuild(): boolean;
  canClean(): boolean;
  canRebuild(): boolean;
  solutionGroupVisible(): boolean;
  onBuild(): void;
  onClean(): void;
  onRebuild(): void;
  pendingRunConfiguration(): RunConfiguration | null;
  confirmRunRestart(): void;
  cancelRunRestart(): void;
  pendingBuildAction(): 'build' | 'rebuild' | 'clean' | null;
  confirmBuildRestart(): void;
  cancelBuildRestart(): void;
  canDebug(): boolean;
  onDebug(): void;
  canSave(): boolean;
  hasUnsavedChanges(): boolean;
  saveMenuItems(): readonly RibbonMenuItem[];
  onSave(): void;
  onSaveAll(): void;
  onSaveMenuItem(id: string): void;
  commitMenuItems(): readonly RibbonMenuItem[];
  onCommitMenuItem(id: string): void;
  layouts(): readonly LayoutInfo[];
  templateOptions(): readonly DropdownOption[];
  layoutMenuItems(): readonly RibbonMenuItem[];
  activeLayoutName(): string;
  defaultLayoutId(): string | null;
  onApplyDefaultLayout(): void;
  onSelectLayout(id: string): void;
  onResetLayout(): void;
  onSaveLayoutAs(): void;
  saveAsOpen(): boolean;
  saveAsName: WritableSignal<string>;
  saveAsDefault: WritableSignal<boolean>;
  saveAsOverwrites(): LayoutInfo | null;
  confirmSaveAs(): void;
  cancelSaveAs(): void;
  manageOpen(): boolean;
  onManageLayouts(): void;
  closeManage(): void;
  onPickTemplate(templateId: string): void;
  onSetDefaultLayout(id: string): void;
  editingLayoutId(): string | null;
  editingName: WritableSignal<string>;
  canCommitRename(): boolean;
  onBeginRename(layout: LayoutInfo): void;
  onCommitRename(): void;
  onCancelRename(): void;
  deletingLayout(): LayoutInfo | null;
  onDeleteLayout(layout: LayoutInfo): void;
  confirmDeleteLayout(): void;
  cancelDeleteLayout(): void;
}

/**
 * A recording stand-in for an active workspace's dock, behind the View menu's Panels submenu. Its
 * panels stand for a workspace whose File Explorer and Agent are showing, whose Solution Explorer is
 * available but not docked, and whose History panel has no repository behind it.
 */
class FakePanelHandler implements DockPanelCommandHandler {
  /**
   * Holds the panels the workspace offers.
   */
  public readonly panels: Signal<readonly DockPanelState[]> = signal<readonly DockPanelState[]>([
    { id: 'files', title: 'File Explorer', docked: true, enabled: true },
    { id: 'solution', title: 'Solution Explorer', docked: false, enabled: true },
    { id: 'agent', title: 'Agent', docked: true, enabled: true },
    { id: 'history', title: 'History', docked: false, enabled: false },
  ]);

  /**
   * Holds the identifiers toggled through this handler, in order.
   */
  public readonly toggled: string[] = [];

  /**
   * Records a toggle.
   * @param panelId The identifier of the panel toggled.
   */
  public toggle(panelId: string): void {
    this.toggled.push(panelId);
  }
}

/**
 * A recording stand-in for a workspace's document well, behind the ribbon's File group.
 */
class FakeDocumentHandler implements WorkspaceDocumentCommandHandler {
  public readonly canSave: WritableSignal<boolean> = signal<boolean>(true);
  public readonly hasUnsavedChanges: WritableSignal<boolean> = signal<boolean>(false);
  public saveCalls: number = 0;
  public saveAllCalls: number = 0;

  public save(): void {
    this.saveCalls++;
  }

  public saveAll(): void {
    this.saveAllCalls++;
  }
}

/**
 * A recording stand-in for the repository command facade behind the Source Control group.
 */
class FakeRepositoryCommands {
  public readonly calls: string[] = [];
  public readonly canPromoteToWorktree: WritableSignal<boolean> = signal<boolean>(false);

  public fetch(): void {
    this.calls.push('fetch');
  }

  public stash(): void {
    this.calls.push('stash');
  }

  public promoteToWorktree(): void {
    this.calls.push('promoteToWorktree');
  }
}

/**
 * A controllable fake of the debugger seam.
 */
class FakeDebugger {
  public readonly running: WritableSignal<boolean> = signal<boolean>(false);
  public readonly launchCalls: RunConfiguration[] = [];

  public launch(configuration: RunConfiguration): void {
    this.launchCalls.push(configuration);
  }
}

/**
 * The .NET-shaped capability descriptor.
 * @returns Returns the capabilities.
 */
function dotnetCapabilities(): ProjectCapabilities {
  return {
    actions: ['build', 'clean', 'rebuild'],
    buildConfigurations: [
      { id: 'debug', name: 'Debug' },
      { id: 'release', name: 'Release' },
    ],
    target: {
      kind: 'platform',
      label: 'Platform',
      options: [
        { id: 'any-cpu', name: 'Any CPU' },
        { id: 'x64', name: 'x64' },
      ],
    },
    debug: null,
    renamesSolutionFolders: false,
  };
}

/**
 * The descriptor of an ecosystem with no build step at all (Python, or a Node package whose manifest
 * backs no conventional script): no gated controls, and so no Solution group.
 * @returns Returns the capabilities.
 */
function actionlessCapabilities(): ProjectCapabilities {
  return {
    actions: [],
    buildConfigurations: [],
    target: null,
    debug: null,
    renamesSolutionFolders: false,
  };
}

/**
 * The descriptor of a Node package whose manifest backs a `build` script alone.
 * @returns Returns the capabilities.
 */
function nodeBuildOnlyCapabilities(): ProjectCapabilities {
  return {
    actions: ['build'],
    buildConfigurations: [],
    target: null,
    debug: null,
    renamesSolutionFolders: false,
  };
}

/**
 * The .NET descriptor once a debug adapter is declared (as P5 will), for the Debug-button tests.
 * @returns Returns the capabilities with a debug adapter.
 */
function dotnetWithDebug(): ProjectCapabilities {
  return { ...dotnetCapabilities(), debug: { adapter: 'netcoredbg' } };
}

/**
 * A controllable fake of the build seam.
 */
class FakeBuilds {
  public readonly tasks: WritableSignal<readonly BuildTask[]> = signal<readonly BuildTask[]>([]);
  public readonly runs: WritableSignal<readonly ActiveRun[]> = signal<readonly ActiveRun[]>([]);
  public readonly running: Signal<boolean> = computed((): boolean => this.runs().length > 0);
  public readonly activeRuns: Signal<readonly ActiveRun[]> = this.runs.asReadonly();
  public readonly canBuild: WritableSignal<boolean> = signal<boolean>(false);
  public readonly buildBusy: WritableSignal<boolean> = signal<boolean>(false);
  public readonly cancelledRunIds: string[] = [];
  public readonly runConfigurationCalls: RunConfiguration[] = [];
  public readonly siblingCalls: (readonly RunConfiguration[])[] = [];
  public readonly actionCalls: ProjectAction[] = [];
  public readonly actionOptions: (object | undefined)[] = [];
  public readonly runConfigurationOptions: (object | undefined)[] = [];
  public readonly buildCalls: (object | undefined)[] = [];
  public cancelAllCalls: number = 0;

  public build(options?: object): void {
    this.buildCalls.push(options);
  }

  public runConfiguration(
    configuration: RunConfiguration,
    siblings: readonly RunConfiguration[],
    options?: object,
  ): void {
    this.runConfigurationCalls.push(configuration);
    this.siblingCalls.push(siblings);
    this.runConfigurationOptions.push(options);
  }

  public runAction(action: ProjectAction, options?: object): void {
    this.actionCalls.push(action);
    this.actionOptions.push(options);
  }

  public cancel(runId: string): void {
    this.cancelledRunIds.push(runId);
  }

  public cancelAll(): void {
    this.cancelAllCalls += 1;
  }
}

/**
 * A controllable fake of the capabilities seam.
 */
class FakeCapabilities {
  public readonly capabilities: WritableSignal<ProjectCapabilities | null> =
    signal<ProjectCapabilities | null>(null);
}

/**
 * A controllable fake of the `.studio` configuration service.
 */
class FakeStudio {
  public readonly runConfigurations: WritableSignal<readonly RunConfiguration[]> = signal<
    readonly RunConfiguration[]
  >([]);
  public readonly selected: WritableSignal<RunConfiguration | null> =
    signal<RunConfiguration | null>(null);
  public readonly lastBuildConfiguration: WritableSignal<string | undefined> = signal<
    string | undefined
  >(undefined);
  public readonly lastTarget: WritableSignal<string | undefined> = signal<string | undefined>(
    undefined,
  );
  public readonly selectCalls: (string | undefined)[] = [];
  public readonly buildConfigCalls: (string | undefined)[] = [];
  public readonly targetCalls: (string | undefined)[] = [];

  public get selectedRunConfiguration(): Signal<RunConfiguration | null> {
    return this.selected;
  }

  public setSelectedRunConfiguration(id: string | undefined): Promise<void> {
    this.selectCalls.push(id);
    return Promise.resolve();
  }

  public setLastBuildConfiguration(id: string | undefined): Promise<void> {
    this.buildConfigCalls.push(id);
    return Promise.resolve();
  }

  public setLastTarget(id: string | undefined): Promise<void> {
    this.targetCalls.push(id);
    return Promise.resolve();
  }
}

/**
 * Builds a run configuration for testing.
 * @param id The configuration id.
 * @param name The configuration name.
 * @returns Returns the configuration.
 */
function configuration(id: string, name: string): RunConfiguration {
  return { id, name, providerKind: 'dotnet', mode: 'run' };
}

/**
 * Builds a build task for testing.
 * @param overrides The fields to override.
 * @returns Returns the task.
 */
function task(overrides: Partial<BuildTask>): BuildTask {
  return { id: 'id', label: 'label', group: 'run', command: 'c', cwd: '/w', ...overrides };
}

describe('DirectoryRibbon', () => {
  let component: DirectoryRibbon;
  let fixture: ComponentFixture<DirectoryRibbon>;
  let builds: FakeBuilds;
  let studio: FakeStudio;
  let capabilities: FakeCapabilities;
  let debuggerSeam: FakeDebugger;
  let documentHandler: FakeDocumentHandler;
  let repositoryCommands: FakeRepositoryCommands;
  let layoutStore: Layouts;
  let windows: FakeModalWindows;
  let menu: AppMenu;
  let dockPanels: DockPanelCommands;
  let panelHandler: FakePanelHandler;

  /**
   * Reveals the protected surface under test.
   * @returns Returns the ribbon's internals.
   */
  function internals(): RibbonInternals {
    return component as unknown as RibbonInternals;
  }

  beforeEach(async () => {
    // The layout store persists through localStorage; clear it so each test starts on a first run —
    // no saved layouts and no chosen default, exactly as a fresh install.
    localStorage.clear();
    builds = new FakeBuilds();
    studio = new FakeStudio();
    capabilities = new FakeCapabilities();
    debuggerSeam = new FakeDebugger();
    documentHandler = new FakeDocumentHandler();
    repositoryCommands = new FakeRepositoryCommands();
    windows = new FakeModalWindows();
    await TestBed.configureTestingModule({
      imports: [DirectoryRibbon],
      providers: [
        { provide: Builds, useValue: builds },
        { provide: StudioConfig, useValue: studio },
        { provide: WorkspaceCapabilities, useValue: capabilities },
        { provide: Debugger, useValue: debuggerSeam },
        { provide: SourceControlCommands, useValue: repositoryCommands },
        { provide: ModalWindows, useValue: windows },
      ],
    }).compileComponents();

    // The well, the dock and the layout store are what the File and View groups act through;
    // register the stand-ins exactly as an active directory view would.
    TestBed.inject(WorkspaceDocumentCommands).register(documentHandler);
    panelHandler = new FakePanelHandler();
    dockPanels = TestBed.inject(DockPanelCommands);
    dockPanels.register(panelHandler);
    menu = TestBed.inject(AppMenu);
    layoutStore = TestBed.inject(Layouts);
    layoutStore.registerTemplate({
      id: 'default',
      name: 'Default',
      createLayout: (): DockNode => mkStack('tool', ['files']),
    });
    layoutStore.registerTemplate({
      id: 'source-control',
      name: 'Source Control',
      createLayout: (): DockNode => mkStack('tool', ['branches']),
    });
    layoutStore.seedFromTemplates();
    layoutStore.register({
      root: signal<string | null>('/repo'),
      capture: (): DockNode => mkStack('tool', ['errors']),
      apply: (): void => undefined,
    });

    fixture = TestBed.createComponent(DirectoryRibbon);
    component = fixture.componentInstance;
    await fixture.whenStable();
    // The menu contribution is an effect: without a tick it has never run, so the composed menu is
    // empty and dispatch finds nothing.
    TestBed.tick();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('listsTheStudioConfigurations', () => {
    studio.runConfigurations.set([configuration('a', 'A'), configuration('b', 'B')]);

    const options: readonly DropdownOption[] = internals().runOptions();
    expect(options).toEqual([
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ]);
  });

  it('offersNothingToRunWithoutConfigurations_evenWhenTasksWereDiscovered', () => {
    // Discovered build tasks drive the Solution group's Build action; Studio never guesses them into
    // the Run dropdown, so a workspace with no authored configurations has nothing to start.
    builds.tasks.set([task({ id: 't', label: 'dotnet run' })]);

    expect(internals().runOptions()).toEqual([]);
    expect(internals().selectedRunId()).toBeNull();
    expect(internals().canRun()).toBe(false);
  });

  it('runsAConfigurationThroughTheConfigurationPath', () => {
    const config: RunConfiguration = configuration('a', 'A');
    studio.runConfigurations.set([config]);

    internals().onRun();

    expect(builds.runConfigurationCalls).toEqual([config]);
  });

  it('runPassesTheWorkspacesOtherConfigurations_soACompoundCanResolveItsMembers', () => {
    const compound: RunConfiguration = {
      ...configuration('stack', 'Whole stack'),
      members: ['a', 'b'],
    };
    const configurations: readonly RunConfiguration[] = [
      compound,
      configuration('a', 'A'),
      configuration('b', 'B'),
    ];
    studio.runConfigurations.set(configurations);

    internals().onRun();

    expect(builds.runConfigurationCalls).toEqual([compound]);
    expect(builds.siblingCalls[0]).toEqual(configurations);
  });

  it('debugIsDisabledForACompound_whichHasNoSingleProgramToAttachTo', () => {
    capabilities.capabilities.set(dotnetWithDebug());
    studio.runConfigurations.set([configuration('a', 'A')]);
    expect(internals().canDebug()).toBe(true);

    studio.runConfigurations.set([
      { ...configuration('stack', 'Whole stack'), members: ['a'] },
      configuration('a', 'A'),
    ]);
    expect(internals().canDebug()).toBe(false);
  });

  it('start_whileTheConfigurationIsRunning_asksBeforeRestarting', () => {
    const config: RunConfiguration = configuration('a', 'A');
    studio.runConfigurations.set([config]);
    // A run of this configuration is in flight (taskId matches the configuration id).
    builds.runs.set([{ id: 'run:a', label: 'A', taskId: 'a', startedAt: 0 }]);

    internals().onRun();

    expect(builds.runConfigurationCalls).toEqual([]);
    expect(internals().pendingRunConfiguration()).toEqual(config);

    internals().confirmRunRestart();

    expect(builds.runConfigurationCalls).toEqual([config]);
    expect(builds.runConfigurationOptions[0]).toEqual({ restart: true });
    expect(internals().pendingRunConfiguration()).toBeNull();
  });

  it('start_whileACompoundMemberIsRunning_asksToo', () => {
    const compound: RunConfiguration = {
      ...configuration('stack', 'Whole stack'),
      members: ['a'],
    };
    const configurations: readonly RunConfiguration[] = [compound, configuration('a', 'A')];
    studio.runConfigurations.set(configurations);
    builds.runs.set([{ id: 'run:a', label: 'A', taskId: 'a', startedAt: 0 }]);

    internals().onRun();

    expect(builds.runConfigurationCalls).toEqual([]);
    expect(internals().pendingRunConfiguration()).toEqual(compound);
  });

  it('start_dismissingThePrompt_leavesTheRunUntouched', () => {
    const config: RunConfiguration = configuration('a', 'A');
    studio.runConfigurations.set([config]);
    builds.runs.set([{ id: 'run:a', label: 'A', taskId: 'a', startedAt: 0 }]);

    internals().onRun();
    internals().cancelRunRestart();

    expect(builds.runConfigurationCalls).toEqual([]);
    expect(internals().pendingRunConfiguration()).toBeNull();
  });

  it('start_whileADifferentConfigurationRuns_dispatchesWithoutAsking', () => {
    studio.runConfigurations.set([configuration('a', 'A'), configuration('b', 'B')]);
    builds.runs.set([{ id: 'run:b', label: 'B', taskId: 'b', startedAt: 0 }]);

    internals().onRun();

    // The selected configuration (the first, 'a') is idle; concurrency is the point.
    expect(builds.runConfigurationCalls).toHaveLength(1);
    expect(builds.runConfigurationOptions[0]).toEqual({ restart: false });
    expect(internals().pendingRunConfiguration()).toBeNull();
  });

  it('runsNothingWhenTheWorkspaceHasNoConfigurations', () => {
    builds.tasks.set([task({ id: 't', label: 'dotnet run' })]);

    internals().onRun();

    expect(builds.runConfigurationCalls).toEqual([]);
  });

  describe('the Start button face', () => {
    it('startsTheFlaggedDefaultConfiguration_notMerelyTheFirst', () => {
      const web: RunConfiguration = { ...configuration('b', 'Web'), default: true };
      studio.runConfigurations.set([configuration('a', 'App'), web]);

      internals().onStartStop();

      expect(builds.runConfigurationCalls).toEqual([web]);
      expect(builds.runConfigurationOptions[0]).toEqual({ restart: false });
    });

    it('withNoFlaggedDefault_fallsBackToTheEffectiveSelection', () => {
      // Flagging a default is opt-in and most workspaces do not, so the face starts what the workspace
      // already considers current rather than going dead.
      const app: RunConfiguration = configuration('a', 'App');
      studio.runConfigurations.set([app, configuration('b', 'Web')]);

      internals().onStartStop();

      expect(builds.runConfigurationCalls).toEqual([app]);
    });

    it('withNoConfigurationsAtAll_startsNothing', () => {
      internals().onStartStop();

      expect(builds.runConfigurationCalls).toEqual([]);
      expect(builds.cancelAllCalls).toBe(0);
    });

    it('onceAnythingRuns_theFaceStopsEverything_whicheverConfigurationStartedIt', () => {
      studio.runConfigurations.set([configuration('a', 'App'), configuration('b', 'Web')]);
      expect(internals().anyRunning()).toBe(false);

      // A run of a configuration the face would not itself have started still flips it to Stop.
      builds.runs.set([{ id: 'run:b', label: 'Web', taskId: 'b', startedAt: 0 }]);

      expect(internals().anyRunning()).toBe(true);
      internals().onStartStop();

      expect(builds.cancelAllCalls).toBe(1);
      expect(builds.runConfigurationCalls).toEqual([]);
    });

    it('inItsStopState_neverStartsAnything_soNoRestartPromptCanArise', () => {
      studio.runConfigurations.set([{ ...configuration('a', 'App'), default: true }]);
      builds.runs.set([{ id: 'run:a', label: 'App', taskId: 'a', startedAt: 0 }]);

      internals().onStartStop();

      expect(internals().pendingRunConfiguration()).toBeNull();
      expect(builds.runConfigurationCalls).toEqual([]);
    });
  });

  describe('the Actions button', () => {
    it('listsEachConfigurationColouredAndGlyphedByWhetherItRuns', () => {
      studio.runConfigurations.set([configuration('a', 'App'), configuration('b', 'Web')]);
      // 'a' is running (an active run carries its configuration id as the task id); 'b' is idle.
      builds.runs.set([{ id: 'run:a', label: 'App', taskId: 'a', startedAt: 0 }]);

      const items: readonly RibbonMenuItem[] = internals().actionItems();

      // The name stays as the label; the running/stopped state rides on the status and the icon tone.
      expect(items.map((item: RibbonMenuItem): string => item.label)).toEqual(['App', 'Web']);
      expect(items.map((item: RibbonMenuItem): string | undefined => item.status)).toEqual([
        '(running)',
        '(stopped)',
      ]);
      expect(items.map((item: RibbonMenuItem): string | undefined => item.tone)).toEqual([
        'danger',
        'success',
      ]);
    });

    it('startsAStoppedConfigurationWhenChosen', () => {
      const config: RunConfiguration = configuration('a', 'App');
      studio.runConfigurations.set([config]);

      internals().onActionItem('a');

      expect(builds.runConfigurationCalls).toEqual([config]);
      expect(builds.runConfigurationOptions[0]).toEqual({ restart: false });
    });

    it('stopsEveryRunOfARunningConfigurationWhenChosen_leavingOthersAlone', () => {
      studio.runConfigurations.set([configuration('a', 'App')]);
      builds.runs.set([
        { id: 'run:a1', label: 'App', taskId: 'a', startedAt: 0 },
        { id: 'run:a2', label: 'App', taskId: 'a', startedAt: 1 },
        { id: 'run:other', label: 'Other', taskId: 'z', startedAt: 2 },
      ]);

      internals().onActionItem('a');

      expect(builds.cancelledRunIds).toEqual(['run:a1', 'run:a2']);
      expect(builds.runConfigurationCalls).toEqual([]);
    });

    it('isDisabledUntilTheWorkspaceHasAConfiguration', () => {
      expect(internals().hasActions()).toBe(false);

      studio.runConfigurations.set([configuration('a', 'App')]);

      expect(internals().hasActions()).toBe(true);
    });
  });

  it('selectingAConfigurationPersistsTheChoice', () => {
    studio.runConfigurations.set([configuration('a', 'A'), configuration('b', 'B')]);

    internals().onSelectRunItem('b');

    expect(studio.selectCalls).toEqual(['b']);
    expect(internals().selectedRunId()).toBe('b');
  });

  it('stopCancelsEverythingTheWorkspaceIsRunning', () => {
    internals().onStop();

    expect(builds.cancelAllCalls).toBe(1);
  });

  it('stopMenu_listsEveryRun_andStopsJustTheChosenOne', () => {
    builds.runs.set([
      { id: 'r1', label: 'API', taskId: 'api', startedAt: 1 },
      { id: 'r2', label: 'Web', taskId: 'web', startedAt: 2 },
    ]);
    fixture.detectChanges();

    expect(internals().stopLabel()).toBe('Stop All (2)');
    expect(
      internals()
        .runMenuItems()
        .map((item) => item.label),
    ).toEqual(['API', 'Web']);

    internals().onStopRun('r2');

    expect(builds.cancelledRunIds).toEqual(['r2']);
    expect(builds.cancelAllCalls).toBe(0);
  });

  it('stopMenu_numbersRunsOfTheSameConfiguration_soTheyCanBeToldApart', () => {
    builds.runs.set([
      { id: 'r1', label: 'API', taskId: 'api', startedAt: 1 },
      { id: 'r2', label: 'API', taskId: 'api', startedAt: 2 },
      { id: 'r3', label: 'Web', taskId: 'web', startedAt: 3 },
    ]);
    fixture.detectChanges();

    expect(
      internals()
        .runMenuItems()
        .map((item) => item.label),
    ).toEqual(['API (1)', 'API (2)', 'Web']);
  });

  it('stopLabel_withASingleRun_needsNoQualification', () => {
    builds.runs.set([{ id: 'r1', label: 'API', taskId: 'api', startedAt: 1 }]);
    fixture.detectChanges();

    expect(internals().stopLabel()).toBe('Stop');
    expect(internals().runMenuItems()).toHaveLength(1);
  });

  it('debugLaunchesTheSelectedConfigurationThroughTheDebuggerSeam', () => {
    const config: RunConfiguration = configuration('a', 'A');
    studio.runConfigurations.set([config]);
    capabilities.capabilities.set(dotnetWithDebug());

    expect(internals().canDebug()).toBe(true);
    internals().onDebug();

    expect(debuggerSeam.launchCalls).toEqual([config]);
  });

  it('debugIsDisabledWithoutADeclaredAdapterOrAConfigurationOrWhileRunning', () => {
    const config: RunConfiguration = configuration('a', 'A');
    studio.runConfigurations.set([config]);

    // A configuration is selected but the provider declares no debug adapter (the .NET default today).
    capabilities.capabilities.set(dotnetCapabilities());
    expect(internals().canDebug()).toBe(false);

    // With a declared adapter the button enables.
    capabilities.capabilities.set(dotnetWithDebug());
    expect(internals().canDebug()).toBe(true);

    // With no run configuration there is nothing to debug, even with an adapter.
    studio.runConfigurations.set([]);
    expect(internals().canDebug()).toBe(false);

    // Not while a session is already running.
    studio.runConfigurations.set([config]);
    expect(internals().canDebug()).toBe(true);
    debuggerSeam.running.set(true);
    expect(internals().canDebug()).toBe(false);
  });

  it('enablesBuildCleanRebuildForDotnet', () => {
    capabilities.capabilities.set(dotnetCapabilities());

    expect(internals().canBuild()).toBe(true);
    expect(internals().canClean()).toBe(true);
    expect(internals().canRebuild()).toBe(true);
  });

  it('hidesTheSolutionGroupForAnEcosystemWithNoBuildStep', () => {
    // Python, or a Node package whose manifest backs no build/clean script: nothing to show, so the
    // group disappears rather than standing as a row of permanently disabled buttons.
    capabilities.capabilities.set(actionlessCapabilities());

    expect(internals().canBuild()).toBe(false);
    expect(internals().canClean()).toBe(false);
    expect(internals().canRebuild()).toBe(false);
    expect(internals().solutionGroupVisible()).toBe(false);
  });

  it('showsTheSolutionGroupForAProviderDeclaringOnlySomeActions', () => {
    // A Node package with a `build` script but no `clean`: Build shows, Clean does not.
    capabilities.capabilities.set(nodeBuildOnlyCapabilities());

    expect(internals().canBuild()).toBe(true);
    expect(internals().canClean()).toBe(false);
    expect(internals().canRebuild()).toBe(false);
    expect(internals().solutionGroupVisible()).toBe(true);
  });

  it('fallsBackToTheDiscoveredBuildTaskForBuildWhenThereAreNoCapabilities', () => {
    // No capability model (a Gradle/Make ecosystem): Build follows the discovered-task fallback.
    builds.canBuild.set(true);

    expect(internals().canBuild()).toBe(true);
    expect(internals().canClean()).toBe(false);
    expect(internals().solutionGroupVisible()).toBe(true);

    // ...and with no discovered task either, the group has nothing left to show.
    builds.canBuild.set(false);

    expect(internals().solutionGroupVisible()).toBe(false);
  });

  it('cleanAndRebuildDispatchThroughTheActionPath', () => {
    capabilities.capabilities.set(dotnetCapabilities());

    internals().onClean();
    internals().onRebuild();

    expect(builds.actionCalls).toEqual(['clean', 'rebuild']);
    // Dispatched while idle, so no stop-and-restart was granted.
    expect(builds.actionOptions).toEqual([{ restart: false }, { restart: false }]);
  });

  it('buildActions_whileTheBuildTerminalIsBusy_askBeforeStoppingTheRunningBuild', () => {
    capabilities.capabilities.set(dotnetCapabilities());
    builds.buildBusy.set(true);

    internals().onClean();

    // Nothing dispatched yet: the prompt is pending the user's decision.
    expect(builds.actionCalls).toEqual([]);
    expect(internals().pendingBuildAction()).toBe('clean');

    internals().confirmBuildRestart();

    expect(builds.actionCalls).toEqual(['clean']);
    expect(builds.actionOptions).toEqual([{ restart: true }]);
    expect(internals().pendingBuildAction()).toBeNull();
  });

  it('buildActions_dismissingThePrompt_leavesTheRunningBuildUntouched', () => {
    capabilities.capabilities.set(dotnetCapabilities());
    builds.buildBusy.set(true);

    internals().onBuild();
    expect(internals().pendingBuildAction()).toBe('build');

    internals().cancelBuildRestart();

    expect(builds.buildCalls).toEqual([]);
    expect(builds.actionCalls).toEqual([]);
    expect(internals().pendingBuildAction()).toBeNull();
  });

  it('build_whileIdle_dispatchesImmediately', () => {
    capabilities.capabilities.set(dotnetCapabilities());

    internals().onBuild();

    expect(builds.actionCalls).toEqual(['build']);
    expect(builds.actionOptions).toEqual([{ restart: false }]);
  });

  it('build_withoutACapabilityModel_runsTheDiscoveredDefaultBuildTask', () => {
    // A Gradle/Make ecosystem has no declared actions to compile a command from, so the discovered
    // task is what Build runs.
    builds.canBuild.set(true);

    internals().onBuild();

    expect(builds.actionCalls).toEqual([]);
    expect(builds.buildCalls).toEqual([{ restart: false }]);
  });

  it('buildActions_neverGateOnRunConfigurations', () => {
    capabilities.capabilities.set(dotnetCapabilities());
    // A run configuration is in flight; builds must remain available regardless.
    builds.runs.set([{ id: 'r1', label: 'Api', taskId: 'api', startedAt: 0 }]);

    expect(internals().canBuild()).toBe(true);
    internals().onBuild();
    expect(builds.actionCalls).toEqual(['build']);
  });

  describe('the File group', () => {
    it('saveAndSaveAll_routeThroughTheWorkspaceDocumentSeam', () => {
      internals().onSave();
      internals().onSaveMenuItem('save-all');

      expect(documentHandler.saveCalls).toBe(1);
      expect(documentHandler.saveAllCalls).toBe(1);
    });

    it('saveAll_isDisabledUntilSomethingIsUnsaved', () => {
      expect(internals().saveMenuItems()[0].disabled).toBe(true);

      documentHandler.hasUnsavedChanges.set(true);

      expect(internals().saveMenuItems()[0].disabled).toBe(false);
      expect(internals().hasUnsavedChanges()).toBe(true);
    });

    it('mirrorsTheWellsSaveableState', () => {
      expect(internals().canSave()).toBe(true);

      documentHandler.canSave.set(false);

      expect(internals().canSave()).toBe(false);
    });
  });

  describe('the Edit group', () => {
    it('carriesOnlyTheClipboardAndHistoryActions_notTheTidyingPair', () => {
      // Format and Code Cleanup were removed from the ribbon; the group is now the clipboard trio and
      // the history/find actions alone.
      const ribbon: Record<string, unknown> = internals() as unknown as Record<string, unknown>;

      expect(ribbon['onFormatDocument']).toBeUndefined();
      expect(ribbon['onCodeCleanup']).toBeUndefined();
      expect(typeof ribbon['onCut']).toBe('function');
      expect(typeof ribbon['onFind']).toBe('function');
    });
  });

  describe('the Source Control group', () => {
    it('commitMenu_carriesStashAlone_andDispatchesIt', () => {
      // Staging is deliberately absent: a commit resets the index and stages exactly the files
      // checked in the Commit panel, so staging beforehand cannot change what a commit contains.
      expect(
        internals()
          .commitMenuItems()
          .map((item): string => item.id),
      ).toEqual(['stash']);

      internals().onCommitMenuItem('stash');

      expect(repositoryCommands.calls).toEqual(['stash']);
    });

    it('carriesOnlyTheRepoGlobalActions_leavingSelectionScopedOnesToThePanels', () => {
      // Refresh, New Branch and Diff Layout belong to the Repository and Commit panels; the ribbon
      // must no longer dispatch them, and Stage All is gone for good.
      const ribbon: Record<string, unknown> = internals() as unknown as Record<string, unknown>;

      expect(ribbon['onStageAll']).toBeUndefined();
      expect(ribbon['onRepoRefresh']).toBeUndefined();
      expect(ribbon['onNewBranch']).toBeUndefined();
      expect(ribbon['onToggleDiff']).toBeUndefined();
      expect(typeof ribbon['onRepoFetch']).toBe('function');
      expect(typeof ribbon['onStash']).toBe('function');
    });
  });

  describe('the View menu Panels submenu', () => {
    /**
     * Reads the Panels submenu's rows from the composed application menu.
     * @returns Returns the rows, or an empty list when the submenu is absent.
     */
    function panelRows(): readonly MenuEntry[] {
      const view: readonly MenuEntry[] =
        menu.sections().find((section: MenuContribution): boolean => section.id === 'view')
          ?.items ?? [];
      return view.find((entry: MenuEntry): boolean => entry.id === 'directory.panels')?.items ?? [];
    }

    it('isAbsent_untilAViewRegistersItsDock', () => {
      // The ribbon renders for the tab before the view has published its dock; an empty submenu
      // would open onto nothing, so it is not offered at all.
      dockPanels.unregister(panelHandler);
      TestBed.tick();

      expect(panelRows()).toEqual([]);
    });

    it('listsEveryPanel_asATickBoxMarkingTheOnesShowing', () => {
      const rows: readonly MenuEntry[] = panelRows();

      expect(rows.map((row: MenuEntry): string | undefined => row.label)).toEqual([
        'File Explorer',
        'Solution Explorer',
        'Agent',
        'History',
      ]);
      expect(rows.every((row: MenuEntry): boolean => row.kind === 'checkbox')).toBe(true);
      expect(rows.map((row: MenuEntry): boolean | undefined => row.checked)).toEqual([
        true,
        false,
        true,
        false,
      ]);
    });

    it('disablesAPanelWithNothingBehindIt_butStillListsIt', () => {
      // The Solution Explorer needs a recognised project system; the menu stays a stable map of what
      // the workspace can hold rather than a list that reshuffles under the pointer.
      const rows: readonly MenuEntry[] = panelRows();

      expect(rows.find((row: MenuEntry): boolean => row.label === 'History')?.enabled).toBe(false);
      expect(
        rows.find((row: MenuEntry): boolean => row.label === 'Solution Explorer')?.enabled,
      ).toBe(true);
    });

    it('choosingARow_togglesThatPanelInTheActiveViewsDock', () => {
      menu.dispatch('directory.panels.solution');
      menu.dispatch('directory.panels.files');

      expect(panelHandler.toggled).toEqual(['solution', 'files']);
    });
  });

  describe('the View group', () => {
    /**
     * Saves the current arrangement through the Save As dialog.
     * @param name The layout name.
     * @param makeDefault Whether to tick the dialog's Default box.
     * @returns Returns the saved layout's identifier.
     */
    function saveAs(name: string, makeDefault: boolean): string {
      internals().onSaveLayoutAs();
      internals().saveAsName.set(name);
      internals().saveAsDefault.set(makeDefault);
      internals().confirmSaveAs();
      return idOf(name);
    }

    /**
     * Resolves a layout by name.
     * @param name The layout name.
     * @returns Returns its identifier, or the empty string when absent.
     */
    function idOf(name: string): string {
      return (
        internals()
          .layouts()
          .find((layout: LayoutInfo): boolean => layout.name === name)?.id ?? ''
      );
    }

    it('seedsALayoutPerTemplate_soAFirstRunHasNoBuiltInsToExplain', () => {
      expect(
        internals()
          .layouts()
          .map((layout: LayoutInfo): string => layout.name),
      ).toEqual(['Default', 'Source Control']);
      expect(internals().defaultLayoutId()).toBe(idOf('Default'));
    });

    it('theBigButtonAppliesTheDefaultLayout_whateverIsShowing', () => {
      const customId: string = saveAs('Custom', false);
      // Saving made the new layout this root's pick, so applying the default moves off it.
      expect(
        internals()
          .layoutMenuItems()
          .find((item): boolean => item.active === true)?.id,
      ).toBe(customId);

      internals().onApplyDefaultLayout();

      expect(
        internals()
          .layoutMenuItems()
          .find((item): boolean => item.active === true)?.id,
      ).toBe(idOf('Default'));
    });

    it('theMenuListsEveryLayout_markingTheOneShowing', () => {
      const customId: string = saveAs('Custom', false);

      const items: readonly RibbonMenuItem[] = internals().layoutMenuItems();
      expect(items.map((item: RibbonMenuItem): string => item.label)).toEqual([
        'Default',
        'Source Control',
        'Custom',
      ]);
      expect(items.find((item: RibbonMenuItem): boolean => item.id === customId)?.active).toBe(
        true,
      );
    });

    it('theStatusNameFollowsTheShowingLayout_whileTheButtonFaceStaysDefault', () => {
      expect(internals().activeLayoutName()).toBe('Default');

      internals().onSelectLayout(idOf('Source Control'));

      expect(internals().activeLayoutName()).toBe('Source Control');
      // The default is unmoved: switching to a layout is not choosing it as the default.
      expect(internals().defaultLayoutId()).toBe(idOf('Default'));
    });

    it('theTemplatePicker_addsALayoutPerPick_namedUniquely', () => {
      internals().onPickTemplate('default');
      internals().onPickTemplate('default');

      expect(
        internals()
          .layouts()
          .map((layout: LayoutInfo): string => layout.name),
      ).toEqual(['Default', 'Source Control', 'Default 2', 'Default 3']);
      // The prompt is not a template, so choosing it adds nothing.
      internals().onPickTemplate('');
      expect(internals().layouts().length).toBe(4);
    });

    it('theTemplatePickerOptions_areHeadedByAnInertPrompt', () => {
      expect(internals().templateOptions()).toEqual([
        { value: '', label: 'Templates' },
        { value: 'default', label: 'Default' },
        { value: 'source-control', label: 'Source Control' },
      ]);
    });

    it('saveAs_offersTheShowingLayoutsName_soSavingOverItIsTheDefaultGesture', () => {
      internals().onSelectLayout(idOf('Source Control'));

      internals().onSaveLayoutAs();

      expect(internals().saveAsName()).toBe('Source Control');
      expect(internals().saveAsDefault()).toBe(false);
      // The name is taken, so the dialog says what confirming will replace.
      expect(internals().saveAsOverwrites()?.id).toBe(idOf('Source Control'));
    });

    it('saveAs_overAnExistingName_replacesThatLayoutRatherThanAddingOne', () => {
      const id: string = idOf('Default');
      internals().onSetDefaultLayout(id);

      saveAs('default', false);

      expect(internals().layouts().length).toBe(2);
      expect(idOf('default')).toBe(id);
      // The identity survived, so the default marker is still pointed at the same layout.
      expect(internals().defaultLayoutId()).toBe(id);
    });

    it('saveAs_withAFreeName_reportsNothingToOverwrite', () => {
      internals().onSaveLayoutAs();
      internals().saveAsName.set('Brand New');

      expect(internals().saveAsOverwrites()).toBeNull();
    });

    it('saveAs_withTheDefaultBoxTicked_makesTheNewLayoutTheDefault', () => {
      const customId: string = saveAs('Custom', true);

      expect(internals().defaultLayoutId()).toBe(customId);
      expect(internals().activeLayoutName()).toBe('Custom');
      expect(internals().saveAsOpen()).toBe(false);
    });

    it('saveAs_withAnEmptyName_savesNothingAndStaysOpen', () => {
      internals().onSaveLayoutAs();
      internals().saveAsName.set('   ');

      internals().confirmSaveAs();

      expect(internals().layouts().length).toBe(2);
      expect(internals().saveAsOpen()).toBe(true);
    });

    it('layoutModals_renderTheirContentOnlyWhileOpen', () => {
      const appRef: ApplicationRef = TestBed.inject(ApplicationRef);

      expect(windows.openWindows).toBe(0);

      internals().onSaveLayoutAs();
      fixture.detectChanges();
      appRef.tick();
      expect(windows.openWindows).toBe(1);
      expect(
        windows.contentHost?.querySelector('.directory-ribbon__confirm-title')?.textContent,
      ).toContain('Save layout');

      internals().cancelSaveAs();
      internals().onManageLayouts();
      fixture.detectChanges();
      appRef.tick();
      expect(windows.openWindows).toBe(1);
      const manage: string = windows.contentHost?.textContent ?? '';
      expect(manage).toContain('Manage layouts');
      expect(manage).toContain('Pick from a template');
      expect(manage).toContain('Default');

      internals().closeManage();
      fixture.detectChanges();
      appRef.tick();
      expect(windows.openWindows).toBe(0);
    });

    it('manage_renamesALayoutThroughAnEditThatIsConfirmedOrAbandoned', () => {
      const id: string = idOf('Default');
      internals().onManageLayouts();

      internals().onBeginRename({ id, name: 'Default' });
      expect(internals().editingLayoutId()).toBe(id);
      expect(internals().editingName()).toBe('Default');

      internals().editingName.set('Renamed');
      internals().onCommitRename();

      expect(idOf('Renamed')).toBe(id);
      expect(internals().editingLayoutId()).toBeNull();

      internals().onBeginRename({ id, name: 'Renamed' });
      internals().editingName.set('Abandoned');
      internals().onCancelRename();

      expect(idOf('Renamed')).toBe(id);
      expect(internals().editingLayoutId()).toBeNull();
    });

    it('manage_refusesARenameOntoANameAnotherLayoutHolds', () => {
      const id: string = idOf('Default');
      internals().onBeginRename({ id, name: 'Default' });

      internals().editingName.set('  source CONTROL ');
      expect(internals().canCommitRename()).toBe(false);
      internals().onCommitRename();

      // Refused, so the row stays open on the name the user is still working on.
      expect(idOf('Default')).toBe(id);
      expect(internals().editingLayoutId()).toBe(id);

      internals().editingName.set('  ');
      expect(internals().canCommitRename()).toBe(false);

      internals().editingName.set('Mine');
      expect(internals().canCommitRename()).toBe(true);
    });

    it('manage_deletesOnlyAfterConfirmation_andTheDefaultFallsBack', () => {
      const id: string = idOf('Default');
      internals().onSetDefaultLayout(id);

      internals().onDeleteLayout({ id, name: 'Default' });
      expect(internals().deletingLayout()?.id).toBe(id);
      internals().cancelDeleteLayout();
      expect(internals().layouts().length).toBe(2);

      internals().onDeleteLayout({ id, name: 'Default' });
      internals().confirmDeleteLayout();

      expect(
        internals()
          .layouts()
          .map((layout: LayoutInfo): string => layout.name),
      ).toEqual(['Source Control']);
      // The deleted layout held the default, so it falls back rather than stranding the choice.
      expect(internals().defaultLayoutId()).toBe(idOf('Source Control'));
      expect(internals().deletingLayout()).toBeNull();
    });

    it('manage_setsTheDefault_whichAWorkspaceWithNoPickOfItsOwnFollows', () => {
      const sourceControl: string = idOf('Source Control');
      internals().onManageLayouts();

      internals().onSetDefaultLayout(sourceControl);

      expect(internals().defaultLayoutId()).toBe(sourceControl);
      // This workspace has never chosen a layout, so it follows the default wherever it moves.
      expect(internals().activeLayoutName()).toBe('Source Control');

      internals().closeManage();
      expect(internals().manageOpen()).toBe(false);
    });

    it('manage_settingTheDefault_leavesAWorkspaceThatHasChosenForItselfAlone', () => {
      internals().onSelectLayout(idOf('Default'));

      internals().onSetDefaultLayout(idOf('Source Control'));

      // A pick of its own outranks the default, so the showing layout does not move under the user.
      expect(internals().activeLayoutName()).toBe('Default');
    });

    it('closingManage_abandonsAnEditAndAPendingDelete', () => {
      const id: string = idOf('Default');
      internals().onManageLayouts();
      internals().onBeginRename({ id, name: 'Default' });
      internals().onDeleteLayout({ id, name: 'Default' });

      internals().closeManage();

      expect(internals().editingLayoutId()).toBeNull();
      expect(internals().deletingLayout()).toBeNull();
    });
  });
});
