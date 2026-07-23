import { ApplicationRef, signal, Signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { StudioConfig } from '@shared/angular/services/studio/studio-config';
import { ConfigureDialog } from '@shared/angular/services/configure-dialog/configure-dialog';
import { WorkspaceCapabilities } from '@shared/angular/services/workspace/workspace-capabilities';
import { ProjectCapabilities } from '@shared/api/project-system';
import { RunConfiguration } from '@shared/api/studio';
import { DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { RunConfigurationAgent } from '@features/workspace/angular/run-configuration-agent/run-configuration-agent';
import { ConfigureDialogPanel } from './configure-dialog';

/**
 * A group of configurations in the dialog list.
 */
interface Group {
  readonly kind: string;
  readonly configurations: readonly RunConfiguration[];
}

/**
 * The protected surface of the dialog exercised by these tests.
 */
interface DialogInternals {
  groups(): readonly Group[];
  selected(): RunConfiguration | null;
  buildConfigOptions(): readonly DropdownOption[];
  targetOptions(): readonly DropdownOption[];
  hasTarget(): boolean;
  argsText(): string;
  envText(): string;
  isDebug(): boolean;
  select(id: string): void;
  onNew(): void;
  onDuplicate(): void;
  onDelete(): void;
  onName(name: string): void;
  onArgs(text: string): void;
  onEnv(text: string): void;
  onModeChange(debug: boolean): void;
  onSave(): void;
  onCancel(): void;
  onAuto(): void;
  onAsk(): void;
  onRequestInput(value: string): void;
  authoring(): boolean;
  canAsk(): boolean;
  askUnavailableReason(): string | null;
}

/**
 * A controllable fake of the seam that dispatches authoring to the workspace's agent.
 */
class FakeRunConfigurationAgent {
  public readonly canDispatch: WritableSignal<boolean> = signal<boolean>(true);
  public readonly pendingRequests: WritableSignal<readonly unknown[]> = signal<readonly unknown[]>(
    [],
  );
  public readonly unavailableReason: WritableSignal<string | null> = signal<string | null>(null);
  public readonly busy: WritableSignal<boolean> = signal<boolean>(false);
  public readonly autoCalls: number[] = [];
  public readonly requests: string[] = [];
  public accept: boolean = true;

  public dispatchAuto(): boolean {
    this.autoCalls.push(1);
    return this.accept;
  }

  public dispatchRequest(request: string): boolean {
    if (request.trim().length === 0) {
      return false;
    }
    this.requests.push(request);
    return this.accept;
  }
}

/**
 * A controllable fake of the dialog open-state service.
 */
class FakeDialog {
  private readonly openState: WritableSignal<boolean> = signal<boolean>(false);
  public readonly isOpen: Signal<boolean> = this.openState.asReadonly();

  public open(): void {
    this.openState.set(true);
  }

  public close(): void {
    this.openState.set(false);
  }
}

/**
 * A controllable fake of the `.studio` configuration service.
 */
class FakeStudio {
  public readonly runConfigurations: WritableSignal<readonly RunConfiguration[]> = signal<
    readonly RunConfiguration[]
  >([]);
  public readonly saved: RunConfiguration[][] = [];

  public saveRunConfigurations(configurations: readonly RunConfiguration[]): Promise<void> {
    this.saved.push([...configurations]);
    return Promise.resolve();
  }
}

/**
 * A controllable fake of the capabilities seam.
 */
class FakeCapabilities {
  public readonly capabilities: WritableSignal<ProjectCapabilities | null> =
    signal<ProjectCapabilities | null>(null);
  public readonly kind: WritableSignal<string | null> = signal<string | null>(null);
}

/**
 * Builds a run configuration for testing.
 * @param overrides The fields to override.
 * @returns Returns the configuration.
 */
function config(overrides: Partial<RunConfiguration>): RunConfiguration {
  return { id: 'a', name: 'A', providerKind: 'dotnet', mode: 'run', ...overrides };
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
      options: [{ id: 'any-cpu', name: 'Any CPU' }],
    },
    debug: null,
  };
}

describe('ConfigureDialogPanel', () => {
  let component: ConfigureDialogPanel;
  let fixture: ComponentFixture<ConfigureDialogPanel>;
  let dialog: FakeDialog;
  let studio: FakeStudio;
  let capabilities: FakeCapabilities;
  let agent: FakeRunConfigurationAgent;

  /**
   * Reveals the protected surface under test.
   * @returns Returns the dialog's internals.
   */
  function internals(): DialogInternals {
    return component as unknown as DialogInternals;
  }

  /**
   * Runs change detection so the open effect seeds the draft.
   */
  function tick(): void {
    TestBed.inject(ApplicationRef).tick();
  }

  beforeEach(async () => {
    dialog = new FakeDialog();
    studio = new FakeStudio();
    capabilities = new FakeCapabilities();
    agent = new FakeRunConfigurationAgent();
    await TestBed.configureTestingModule({
      imports: [ConfigureDialogPanel],
      providers: [
        { provide: ConfigureDialog, useValue: dialog },
        { provide: StudioConfig, useValue: studio },
        { provide: WorkspaceCapabilities, useValue: capabilities },
        { provide: RunConfigurationAgent, useValue: agent },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfigureDialogPanel);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('seedsTheDraftFromTheStoredConfigurationsWhenOpened', () => {
    studio.runConfigurations.set([config({ id: 'a', name: 'A' }), config({ id: 'b', name: 'B' })]);
    dialog.open();
    tick();

    expect(internals().groups().flatMap((g) => g.configurations.map((c) => c.name))).toEqual([
      'A',
      'B',
    ]);
    expect(internals().selected()?.id).toBe('a');
  });

  it('addsANewConfigurationBoundToTheActiveProviderKind', () => {
    capabilities.kind.set('node');
    dialog.open();
    tick();

    internals().onNew();

    expect(internals().selected()?.name).toBe('New Configuration');
    expect(internals().selected()?.providerKind).toBe('node');
  });

  it('duplicatesTheSelectedConfiguration', () => {
    studio.runConfigurations.set([config({ id: 'a', name: 'A' })]);
    dialog.open();
    tick();

    internals().onDuplicate();

    expect(internals().groups().flatMap((g) => g.configurations.map((c) => c.name))).toEqual([
      'A',
      'A copy',
    ]);
    expect(internals().selected()?.name).toBe('A copy');
  });

  it('deletesTheSelectedConfiguration', () => {
    studio.runConfigurations.set([config({ id: 'a', name: 'A' }), config({ id: 'b', name: 'B' })]);
    dialog.open();
    tick();

    internals().onDelete();

    expect(internals().groups().flatMap((g) => g.configurations.map((c) => c.id))).toEqual(['b']);
  });

  it('savesTheDraftAndClosesTheDialog', () => {
    studio.runConfigurations.set([config({ id: 'a', name: 'A' })]);
    dialog.open();
    tick();
    internals().onName('Renamed');

    internals().onSave();

    expect(studio.saved).toHaveLength(1);
    expect(studio.saved[0][0].name).toBe('Renamed');
    expect(dialog.isOpen()).toBe(false);
  });

  it('cancelDiscardsEditsAndClosesWithoutSaving', () => {
    studio.runConfigurations.set([config({ id: 'a', name: 'A' })]);
    dialog.open();
    tick();
    internals().onName('Renamed');

    internals().onCancel();

    expect(studio.saved).toHaveLength(0);
    expect(dialog.isOpen()).toBe(false);
  });

  it('offersTheBuildConfigurationAndTargetOptionsFromCapabilities', () => {
    capabilities.capabilities.set(dotnetCapabilities());
    studio.runConfigurations.set([config({ id: 'a', name: 'A' })]);
    dialog.open();
    tick();

    expect(internals().buildConfigOptions().map((o) => o.label)).toEqual(['Debug', 'Release']);
    expect(internals().hasTarget()).toBe(true);
    expect(internals().targetOptions().map((o) => o.label)).toEqual(['Any CPU']);
  });

  it('roundTripsArgumentsAndEnvironmentThroughTheirTextForms', () => {
    studio.runConfigurations.set([
      config({ id: 'a', name: 'A', args: ['--fast', '-v'], env: { KEY: '1' } }),
    ]);
    dialog.open();
    tick();

    expect(internals().argsText()).toBe('--fast -v');
    expect(internals().envText()).toBe('KEY=1');

    internals().onArgs('one two');
    internals().onEnv('X=2\nY=3');

    expect(internals().selected()?.args).toEqual(['one', 'two']);
    expect(internals().selected()?.env).toEqual({ X: '2', Y: '3' });
  });

  it('togglesRunAndDebugMode', () => {
    studio.runConfigurations.set([config({ id: 'a', name: 'A' })]);
    dialog.open();
    tick();

    internals().onModeChange(true);

    expect(internals().selected()?.mode).toBe('debug');
    expect(internals().isDebug()).toBe(true);
  });
});

describe('ConfigureDialogPanel agent authoring', () => {
  let component: ConfigureDialogPanel;
  let fixture: ComponentFixture<ConfigureDialogPanel>;
  let dialog: FakeDialog;
  let studio: FakeStudio;
  let agent: FakeRunConfigurationAgent;

  /**
   * Reveals the protected surface under test.
   * @returns Returns the dialog's internals.
   */
  function internals(): DialogInternals {
    return component as unknown as DialogInternals;
  }

  /**
   * Runs change detection so the dialog's effects settle.
   */
  function tick(): void {
    TestBed.inject(ApplicationRef).tick();
  }

  beforeEach(async () => {
    dialog = new FakeDialog();
    studio = new FakeStudio();
    agent = new FakeRunConfigurationAgent();
    await TestBed.configureTestingModule({
      imports: [ConfigureDialogPanel],
      providers: [
        { provide: ConfigureDialog, useValue: dialog },
        { provide: StudioConfig, useValue: studio },
        { provide: WorkspaceCapabilities, useValue: new FakeCapabilities() },
        { provide: RunConfigurationAgent, useValue: agent },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfigureDialogPanel);
    component = fixture.componentInstance;
    await fixture.whenStable();
    dialog.open();
    tick();
  });

  it('autoDispatchesToTheWorkspacesAgent', () => {
    internals().onAuto();

    expect(agent.autoCalls).toHaveLength(1);
  });

  it('askDispatchesTheTypedRequest_andClearsTheBox', () => {
    internals().onRequestInput('run the three scripts in ./scripts in parallel');
    internals().onAsk();

    expect(agent.requests).toEqual(['run the three scripts in ./scripts in parallel']);
  });

  it('askWithABlankRequest_dispatchesNothing', () => {
    internals().onRequestInput('   ');
    internals().onAsk();

    expect(agent.requests).toEqual([]);
  });

  it('whileTheAgentAuthors_theListFillsInAsItWrites_keepingTheSelection', () => {
    studio.runConfigurations.set([config({ id: 'a', name: 'A' }), config({ id: 'b', name: 'B' })]);
    tick();
    internals().select('b');
    internals().onAuto();

    // The agent writes straight to `.studio`; each write lands in the list without a reopen.
    studio.runConfigurations.set([
      config({ id: 'a', name: 'A' }),
      config({ id: 'b', name: 'B' }),
      config({ id: 'c', name: 'C' }),
    ]);
    tick();

    expect(internals().groups().flatMap((g) => g.configurations.map((c) => c.id))).toEqual([
      'a',
      'b',
      'c',
    ]);
    // The configuration the user was reading does not jump under them as new ones arrive.
    expect(internals().selected()?.id).toBe('b');
  });

  it('whenTheSelectedConfigurationIsRemovedExternally_theSelectionFallsBack', () => {
    studio.runConfigurations.set([config({ id: 'a', name: 'A' }), config({ id: 'b', name: 'B' })]);
    tick();
    internals().select('b');

    studio.runConfigurations.set([config({ id: 'a', name: 'A' })]);
    tick();

    expect(internals().selected()?.id).toBe('a');
  });

  it('authoring_isTrueOnlyWhileADelegatedRunIsInFlight', () => {
    expect(internals().authoring()).toBe(false);

    // The workspace agent running for some other reason is not this dialog's business.
    agent.busy.set(true);
    tick();
    expect(internals().authoring()).toBe(false);

    internals().onAuto();
    tick();
    expect(internals().authoring()).toBe(true);

    agent.busy.set(false);
    tick();
    expect(internals().authoring()).toBe(false);
  });

  it('whenTheAgentCannotBeAsked_theDialogExplainsWhy', () => {
    agent.canDispatch.set(false);
    agent.unavailableReason.set('Open a workspace folder first.');
    tick();

    expect(internals().canAsk()).toBe(false);
    expect(internals().askUnavailableReason()).toBe('Open a workspace folder first.');
  });
});
