import { signal, Signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Builds, BuildTask } from '@shared/angular/services/tasks/builds';
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
  selectedRunId(): string | null;
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
  onClean(): void;
  onRebuild(): void;
  onSelectBuildConfiguration(name: string): void;
  onSelectTarget(name: string): void;
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
 * A controllable fake of the build seam.
 */
class FakeBuilds {
  public readonly tasks: WritableSignal<readonly BuildTask[]> = signal<readonly BuildTask[]>([]);
  public readonly running: WritableSignal<boolean> = signal<boolean>(false);
  public readonly canBuild: WritableSignal<boolean> = signal<boolean>(false);
  public readonly startTask: WritableSignal<BuildTask | undefined> = signal<BuildTask | undefined>(
    undefined,
  );
  public readonly runTaskCalls: string[] = [];
  public readonly runConfigurationCalls: RunConfiguration[] = [];
  public readonly actionCalls: ProjectAction[] = [];
  public cancelCalls: number = 0;

  public runTask(id: string): void {
    this.runTaskCalls.push(id);
  }

  public runConfiguration(configuration: RunConfiguration): void {
    this.runConfigurationCalls.push(configuration);
  }

  public runAction(action: ProjectAction): void {
    this.actionCalls.push(action);
  }

  public cancel(): void {
    this.cancelCalls += 1;
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
    await TestBed.configureTestingModule({
      imports: [DirectoryRibbon],
      providers: [
        { provide: Builds, useValue: builds },
        { provide: StudioConfig, useValue: studio },
        { provide: WorkspaceCapabilities, useValue: capabilities },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DirectoryRibbon);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('listsTheStudioConfigurationsWhenPresent', () => {
    studio.runConfigurations.set([configuration('a', 'A'), configuration('b', 'B')]);

    const options: readonly DropdownOption[] = internals().runOptions();
    expect(options).toEqual([
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ]);
  });

  it('fallsBackToDiscoveredTasksWhenThereAreNoConfigurations', () => {
    builds.tasks.set([task({ id: 't', label: 'dotnet run' })]);

    const options: readonly DropdownOption[] = internals().runOptions();
    expect(options).toEqual([{ value: 't', label: 'dotnet run' }]);
  });

  it('runsAConfigurationThroughTheConfigurationPath', () => {
    const config: RunConfiguration = configuration('a', 'A');
    studio.runConfigurations.set([config]);

    internals().onRun();

    expect(builds.runConfigurationCalls).toEqual([config]);
    expect(builds.runTaskCalls).toEqual([]);
  });

  it('runsADiscoveredTaskThroughTheTaskPath', () => {
    const runnable: BuildTask = task({ id: 't', label: 'dotnet run' });
    builds.tasks.set([runnable]);
    builds.startTask.set(runnable);

    internals().onRun();

    expect(builds.runTaskCalls).toEqual(['t']);
    expect(builds.runConfigurationCalls).toEqual([]);
  });

  it('selectingAConfigurationPersistsTheChoice', () => {
    studio.runConfigurations.set([configuration('a', 'A'), configuration('b', 'B')]);

    internals().onSelectRunItem('b');

    expect(studio.selectCalls).toEqual(['b']);
    expect(internals().selectedRunId()).toBe('b');
  });

  it('stopCancelsTheActiveRun', () => {
    internals().onStop();

    expect(builds.cancelCalls).toBe(1);
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
