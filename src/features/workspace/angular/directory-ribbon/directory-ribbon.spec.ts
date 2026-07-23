import { computed, signal, Signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActiveRun, Builds, BuildTask } from '@shared/angular/services/tasks/builds';
import { Debugger } from '@shared/angular/services/debug/debugger';
import { StudioConfig } from '@shared/angular/services/studio/studio-config';
import { WorkspaceCapabilities } from '@shared/angular/services/workspace/workspace-capabilities';
import { ProjectAction, ProjectCapabilities } from '@shared/api/project-system';
import { RunConfiguration } from '@shared/api/studio';
import { DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
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
  targetGroupVisible(): boolean;
  buildConfigNames(): readonly string[];
  buildConfigValue(): string;
  targetNames(): readonly string[];
  onBuild(): void;
  onClean(): void;
  onRebuild(): void;
  pendingBuildAction(): 'build' | 'rebuild' | 'clean' | null;
  confirmBuildRestart(): void;
  cancelBuildRestart(): void;
  onSelectBuildConfiguration(name: string): void;
  onSelectTarget(name: string): void;
  canDebug(): boolean;
  onDebug(): void;
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
 * The Node-shaped capability descriptor: an interpreted ecosystem with no gated controls.
 * @returns Returns the capabilities.
 */
function nodeCapabilities(): ProjectCapabilities {
  return { actions: [], buildConfigurations: [], target: null, debug: null };
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
  public readonly buildCalls: (object | undefined)[] = [];
  public cancelAllCalls: number = 0;

  public build(options?: object): void {
    this.buildCalls.push(options);
  }

  public runConfiguration(
    configuration: RunConfiguration,
    siblings: readonly RunConfiguration[],
  ): void {
    this.runConfigurationCalls.push(configuration);
    this.siblingCalls.push(siblings);
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

  /**
   * Reveals the protected surface under test.
   * @returns Returns the ribbon's internals.
   */
  function internals(): RibbonInternals {
    return component as unknown as RibbonInternals;
  }

  beforeEach(async () => {
    builds = new FakeBuilds();
    studio = new FakeStudio();
    capabilities = new FakeCapabilities();
    debuggerSeam = new FakeDebugger();
    await TestBed.configureTestingModule({
      imports: [DirectoryRibbon],
      providers: [
        { provide: Builds, useValue: builds },
        { provide: StudioConfig, useValue: studio },
        { provide: WorkspaceCapabilities, useValue: capabilities },
        { provide: Debugger, useValue: debuggerSeam },
      ],
    }).compileComponents();

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
    expect(internals().runMenuItems().map((item) => item.label)).toEqual(['API', 'Web']);

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

    expect(internals().runMenuItems().map((item) => item.label)).toEqual([
      'API (1)',
      'API (2)',
      'Web',
    ]);
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

  it('disablesTheGatedActionsAndHidesTheTargetGroupForNode', () => {
    capabilities.capabilities.set(nodeCapabilities());

    expect(internals().canBuild()).toBe(false);
    expect(internals().canClean()).toBe(false);
    expect(internals().canRebuild()).toBe(false);
    expect(internals().targetGroupVisible()).toBe(false);
  });

  it('fallsBackToTheDiscoveredBuildTaskForBuildWhenThereAreNoCapabilities', () => {
    // No capability model (a Gradle/Make ecosystem): Build follows the discovered-task fallback.
    builds.canBuild.set(true);

    expect(internals().canBuild()).toBe(true);
    expect(internals().canClean()).toBe(false);
    expect(internals().targetGroupVisible()).toBe(false);
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

    expect(builds.buildCalls).toEqual([{ restart: false }]);
  });

  it('buildActions_neverGateOnRunConfigurations', () => {
    capabilities.capabilities.set(dotnetCapabilities());
    // A run configuration is in flight; builds must remain available regardless.
    builds.runs.set([{ id: 'r1', label: 'Api', taskId: 'api', startedAt: 0 }]);

    expect(internals().canBuild()).toBe(true);
    internals().onBuild();
    expect(builds.buildCalls).toEqual([{ restart: false }]);
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
});
