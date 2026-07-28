import { computed, signal, Signal, WritableSignal } from '@angular/core';
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
import {
  LayoutPresetInfo,
  LayoutPresets,
} from '@shared/angular/services/layout-presets/layout-presets';
import { SourceControlCommands } from '@shared/angular/services/source-control-commands/source-control-commands';
import {
  WorkspaceDocumentCommandHandler,
  WorkspaceDocumentCommands,
} from '@features/workspace/angular/workspace-document-commands/workspace-document-commands';
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
  canBuild(): boolean;
  canClean(): boolean;
  canRebuild(): boolean;
  solutionGroupVisible(): boolean;
  targetGroupVisible(): boolean;
  buildConfigNames(): readonly string[];
  buildConfigValue(): string;
  targetNames(): readonly string[];
  onBuild(): void;
  onClean(): void;
  onRebuild(): void;
  pendingRunConfiguration(): RunConfiguration | null;
  confirmRunRestart(): void;
  cancelRunRestart(): void;
  pendingBuildAction(): 'build' | 'rebuild' | 'clean' | null;
  confirmBuildRestart(): void;
  cancelBuildRestart(): void;
  onSelectBuildConfiguration(name: string): void;
  onSelectTarget(name: string): void;
  canDebug(): boolean;
  onDebug(): void;
  canSave(): boolean;
  hasUnsavedChanges(): boolean;
  saveMenuItems(): readonly RibbonMenuItem[];
  onSave(): void;
  onSaveAll(): void;
  onSaveMenuItem(id: string): void;
  buildMenuItems(): readonly RibbonMenuItem[];
  onBuildMenuItem(id: string): void;
  hasActiveEditor(): boolean;
  canCodeCleanup(): boolean;
  commitMenuItems(): readonly RibbonMenuItem[];
  onCommitMenuItem(id: string): void;
  presets(): readonly LayoutPresetInfo[];
  presetMenuItems(): readonly RibbonMenuItem[];
  defaultPresetName(): string;
  defaultPresetId(): string | null;
  onApplyDefaultPreset(): void;
  onSelectPreset(id: string): void;
  onSavePresetAs(): void;
  saveAsOpen(): boolean;
  saveAsName: WritableSignal<string>;
  saveAsDefault: WritableSignal<boolean>;
  confirmSaveAs(): void;
  cancelSaveAs(): void;
  manageOpen(): boolean;
  onManagePresets(): void;
  closeManage(): void;
  onSetDefaultPreset(id: string): void;
  onRenamePreset(id: string, name: string): void;
  onDeletePreset(id: string): void;
  onResetPreset(): void;
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
  };
}

/**
 * The descriptor of an ecosystem with no build step at all (Python, or a Node package whose manifest
 * backs no conventional script): no gated controls, and so no Solution group.
 * @returns Returns the capabilities.
 */
function actionlessCapabilities(): ProjectCapabilities {
  return { actions: [], buildConfigurations: [], target: null, debug: null };
}

/**
 * The descriptor of a Node package whose manifest backs a `build` script alone.
 * @returns Returns the capabilities.
 */
function nodeBuildOnlyCapabilities(): ProjectCapabilities {
  return { actions: ['build'], buildConfigurations: [], target: null, debug: null };
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
  let presets: LayoutPresets;

  /**
   * Reveals the protected surface under test.
   * @returns Returns the ribbon's internals.
   */
  function internals(): RibbonInternals {
    return component as unknown as RibbonInternals;
  }

  beforeEach(async () => {
    // The preset store persists through localStorage; clear it so each test starts with no saved
    // presets and no chosen default.
    localStorage.clear();
    builds = new FakeBuilds();
    studio = new FakeStudio();
    capabilities = new FakeCapabilities();
    debuggerSeam = new FakeDebugger();
    documentHandler = new FakeDocumentHandler();
    repositoryCommands = new FakeRepositoryCommands();
    await TestBed.configureTestingModule({
      imports: [DirectoryRibbon],
      providers: [
        { provide: Builds, useValue: builds },
        { provide: StudioConfig, useValue: studio },
        { provide: WorkspaceCapabilities, useValue: capabilities },
        { provide: Debugger, useValue: debuggerSeam },
        { provide: SourceControlCommands, useValue: repositoryCommands },
      ],
    }).compileComponents();

    // The well and the preset store are what the File and View groups act through; register the
    // stand-ins exactly as an active directory view would.
    TestBed.inject(WorkspaceDocumentCommands).register(documentHandler);
    presets = TestBed.inject(LayoutPresets);
    presets.registerBuiltIn({
      id: 'coding',
      name: 'Coding',
      createLayout: (): DockNode => mkStack('tool', ['files']),
    });
    presets.register({
      root: signal<string | null>('/repo'),
      capture: (): DockNode => mkStack('tool', ['errors']),
      apply: (): void => undefined,
    });

    fixture = TestBed.createComponent(DirectoryRibbon);
    component = fixture.componentInstance;
    await fixture.whenStable();
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

  it('enablesBuildCleanRebuildAndShowsTheTargetGroupForDotnet', () => {
    capabilities.capabilities.set(dotnetCapabilities());

    expect(internals().canBuild()).toBe(true);
    expect(internals().canClean()).toBe(true);
    expect(internals().canRebuild()).toBe(true);
    expect(internals().targetGroupVisible()).toBe(true);
    expect(internals().buildConfigNames()).toEqual(['Debug', 'Release']);
    expect(internals().targetNames()).toEqual(['Any CPU', 'x64']);
  });

  it('hidesTheSolutionAndTargetGroupsForAnEcosystemWithNoBuildStep', () => {
    // Python, or a Node package whose manifest backs no build/clean script: nothing to show, so the
    // group disappears rather than standing as a row of permanently disabled buttons.
    capabilities.capabilities.set(actionlessCapabilities());

    expect(internals().canBuild()).toBe(false);
    expect(internals().canClean()).toBe(false);
    expect(internals().canRebuild()).toBe(false);
    expect(internals().solutionGroupVisible()).toBe(false);
    expect(internals().targetGroupVisible()).toBe(false);
  });

  it('showsTheSolutionGroupForAProviderDeclaringOnlySomeActions', () => {
    // A Node package with a `build` script but no `clean`: Build shows, Clean does not.
    capabilities.capabilities.set(nodeBuildOnlyCapabilities());

    expect(internals().canBuild()).toBe(true);
    expect(internals().canClean()).toBe(false);
    expect(internals().canRebuild()).toBe(false);
    expect(internals().solutionGroupVisible()).toBe(true);
    expect(internals().targetGroupVisible()).toBe(false);
  });

  it('fallsBackToTheDiscoveredBuildTaskForBuildWhenThereAreNoCapabilities', () => {
    // No capability model (a Gradle/Make ecosystem): Build follows the discovered-task fallback.
    builds.canBuild.set(true);

    expect(internals().canBuild()).toBe(true);
    expect(internals().canClean()).toBe(false);
    expect(internals().solutionGroupVisible()).toBe(true);
    expect(internals().targetGroupVisible()).toBe(false);

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

  it('showsTheSelectedBuildConfigurationAndTargetByName', () => {
    capabilities.capabilities.set(dotnetCapabilities());
    studio.lastBuildConfiguration.set('release');
    studio.lastTarget.set('x64');

    expect(internals().buildConfigValue()).toBe('Release');
  });

  it('mapsSelectedConfigurationAndTargetNamesBackToIdsWhenPersisting', () => {
    capabilities.capabilities.set(dotnetCapabilities());

    internals().onSelectBuildConfiguration('Release');
    internals().onSelectTarget('x64');

    expect(studio.buildConfigCalls).toEqual(['release']);
    expect(studio.targetCalls).toEqual(['x64']);
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

  describe('the Solution group', () => {
    it('buildMenu_carriesRebuildAlone_neverAsADeadEntry', () => {
      // The button carries the menu only where Rebuild is declared, so the item is always live.
      const items: readonly RibbonMenuItem[] = internals().buildMenuItems();

      expect(items.map((item: RibbonMenuItem): string => item.label)).toEqual(['Rebuild']);
      expect(items[0].disabled).toBeUndefined();
    });

    it('buildMenu_dispatchesRebuildThroughTheActionPath', () => {
      capabilities.capabilities.set(dotnetCapabilities());

      internals().onBuildMenuItem('rebuild');

      expect(builds.actionCalls).toEqual(['rebuild']);
    });
  });

  describe('the Edit group', () => {
    it('tidyingActions_areInertWithoutAFocusedEditor', () => {
      // Format and Code Cleanup act on the well's focused document, not on the build — no editor is
      // registered in this bare fixture, so both stay inert.
      expect(internals().hasActiveEditor()).toBe(false);
      expect(internals().canCodeCleanup()).toBe(false);
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

  describe('the View group', () => {
    /**
     * Saves the current layout as a user preset through the Save As dialog.
     * @param name The preset name.
     * @param makeDefault Whether to tick the dialog's Default box.
     * @returns Returns the new preset's identifier.
     */
    function saveAs(name: string, makeDefault: boolean): string {
      internals().onSavePresetAs();
      internals().saveAsName.set(name);
      internals().saveAsDefault.set(makeDefault);
      internals().confirmSaveAs();
      return (
        internals()
          .presets()
          .find((preset: LayoutPresetInfo): boolean => preset.name === name)?.id ?? ''
      );
    }

    it('theBigButtonNamesTheDefaultPreset_whichIsTheFirstOneUntilOneIsChosen', () => {
      expect(internals().defaultPresetName()).toBe('Coding');
      expect(internals().defaultPresetId()).toBe('coding');
    });

    it('theBigButtonAppliesTheDefaultPreset', () => {
      const customId: string = saveAs('Custom', false);
      // Saving made the custom preset this root's pick, so applying the default moves off it.
      expect(
        internals()
          .presetMenuItems()
          .find((item): boolean => item.active === true)?.id,
      ).toBe(customId);

      internals().onApplyDefaultPreset();

      expect(
        internals()
          .presetMenuItems()
          .find((item): boolean => item.active === true)?.id,
      ).toBe('coding');
    });

    it('theMenuListsEveryPreset_markingTheOneShowing', () => {
      const customId: string = saveAs('Custom', false);

      const items: readonly RibbonMenuItem[] = internals().presetMenuItems();
      expect(items.map((item: RibbonMenuItem): string => item.label)).toEqual(['Coding', 'Custom']);
      expect(items.find((item: RibbonMenuItem): boolean => item.id === customId)?.active).toBe(
        true,
      );
      expect(items.find((item: RibbonMenuItem): boolean => item.id === 'coding')?.active).toBe(
        false,
      );
    });

    it('choosingFromTheMenuApplies_butDoesNotChangeTheDefault', () => {
      const customId: string = saveAs('Custom', false);

      internals().onSelectPreset(customId);

      expect(internals().defaultPresetId()).toBe('coding');
      expect(internals().defaultPresetName()).toBe('Coding');
    });

    it('saveAs_withTheDefaultBoxTicked_makesTheNewPresetTheDefault', () => {
      const customId: string = saveAs('Custom', true);

      expect(internals().defaultPresetId()).toBe(customId);
      expect(internals().defaultPresetName()).toBe('Custom');
      expect(internals().saveAsOpen()).toBe(false);
    });

    it('presetModals_renderTheirContentOnlyWhileOpen', () => {
      const customId: string = saveAs('Custom', false);
      const host: HTMLElement = fixture.nativeElement as HTMLElement;

      expect(host.querySelector('.directory-ribbon__confirm-title')).toBeNull();

      internals().onSavePresetAs();
      fixture.detectChanges();
      expect(host.querySelector('.directory-ribbon__confirm-title')?.textContent).toContain(
        'Save layout as preset',
      );

      internals().cancelSaveAs();
      internals().onManagePresets();
      fixture.detectChanges();
      const manage: string = host.textContent ?? '';
      expect(manage).toContain('Manage layouts');
      expect(manage).toContain('Coding');

      internals().onDeletePreset(customId);
      internals().closeManage();
      fixture.detectChanges();
      expect(host.querySelector('.directory-ribbon__confirm-title')).toBeNull();
    });

    it('saveAs_withAnEmptyName_savesNothingAndStaysOpen', () => {
      internals().onSavePresetAs();
      internals().saveAsName.set('   ');

      internals().confirmSaveAs();

      expect(internals().presets().length).toBe(1);
      expect(internals().saveAsOpen()).toBe(true);
    });

    it('saveAs_reopening_startsFromACleanNameAndUntickedDefault', () => {
      saveAs('Custom', true);

      internals().onSavePresetAs();

      expect(internals().saveAsName()).toBe('');
      expect(internals().saveAsDefault()).toBe(false);
    });

    it('manage_renamesAndDeletesUserPresets_andSetsTheDefault', () => {
      const customId: string = saveAs('Custom', false);
      internals().onManagePresets();
      expect(internals().manageOpen()).toBe(true);

      internals().onSetDefaultPreset(customId);
      expect(internals().defaultPresetId()).toBe(customId);

      internals().onRenamePreset(customId, 'Renamed');
      expect(internals().defaultPresetName()).toBe('Renamed');

      internals().onDeletePreset(customId);
      expect(
        internals()
          .presets()
          .map((preset): string => preset.name),
      ).toEqual(['Coding']);
      // The deleted preset held the default, so it falls back rather than stranding the choice.
      expect(internals().defaultPresetId()).toBe('coding');

      internals().closeManage();
      expect(internals().manageOpen()).toBe(false);
    });

    it('manage_cannotRenameOrDeleteABuiltIn_butCanMakeItTheDefault', () => {
      const customId: string = saveAs('Custom', true);

      internals().onRenamePreset('coding', 'Hacked');
      internals().onDeletePreset('coding');

      expect(
        internals()
          .presets()
          .map((preset): string => preset.name),
      ).toEqual(['Coding', 'Custom']);
      expect(internals().defaultPresetId()).toBe(customId);

      internals().onSetDefaultPreset('coding');
      expect(internals().defaultPresetId()).toBe('coding');
    });
  });
});
