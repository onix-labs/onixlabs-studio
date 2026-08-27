import { ApplicationRef, signal, Signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { StudioConfig } from '@shared/angular/services/studio/studio-config';
import { ConfigureDialog } from '@shared/angular/services/configure-dialog/configure-dialog';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { WorkspaceCapabilities } from '@shared/angular/services/workspace/workspace-capabilities';
import { ProjectCapabilities } from '@shared/api/project-system';
import { RunConfiguration } from '@shared/api/studio';
import { DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { TreeRow } from '@shared/angular/components/tree-view/tree-view';
import { ConfigurationRow, ConfigureDialogPanel } from './configure-dialog';

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
  rows(): readonly TreeRow[];
  selectedRowId(): string | null;
  asRow(row: TreeRow): ConfigurationRow;
  onRowClick(row: TreeRow): void;
  autoConfigureOpen(): boolean;
  onAutoConfigure(): void;
  onAutoConfigureClose(): void;
  onNew(): void;
  onDuplicate(): void;
  onDelete(): void;
  onName(name: string): void;
  onArgs(text: string): void;
  onEnv(text: string): void;
  onModeChange(debug: boolean): void;
  isDefault(): boolean;
  onDefaultChange(isDefault: boolean): void;
  onSave(): void;
  onCancel(): void;
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
    renamesSolutionFolders: false,
  };
}

describe('ConfigureDialogPanel', () => {
  let component: ConfigureDialogPanel;
  let fixture: ComponentFixture<ConfigureDialogPanel>;
  let dialog: FakeDialog;
  let studio: FakeStudio;
  let capabilities: FakeCapabilities;
  let windows: FakeModalWindows;

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
    windows = new FakeModalWindows();
    await TestBed.configureTestingModule({
      imports: [ConfigureDialogPanel],
      providers: [
        { provide: ConfigureDialog, useValue: dialog },
        { provide: StudioConfig, useValue: studio },
        { provide: WorkspaceCapabilities, useValue: capabilities },
        { provide: ModalWindows, useValue: windows },
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

    expect(
      internals()
        .groups()
        .flatMap((g) => g.configurations.map((c) => c.name)),
    ).toEqual(['A', 'B']);
    expect(internals().selected()?.id).toBe('a');
  });

  it('whenOpened_rendersTheDialogContent_andRetiresItOnClose', () => {
    studio.runConfigurations.set([config({ id: 'a', name: 'A' })]);
    expect(windows.openWindows).toBe(0);

    dialog.open();
    tick();

    const host: HTMLElement = windows.contentHost!;
    expect(windows.openWindows).toBe(1);
    expect(host.querySelector('.configure__title')?.textContent).toContain('Run Configurations');
    expect(host.textContent).toContain('A');

    internals().onCancel();
    tick();

    expect(windows.openWindows).toBe(0);
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

    expect(
      internals()
        .groups()
        .flatMap((g) => g.configurations.map((c) => c.name)),
    ).toEqual(['A', 'A copy']);
    expect(internals().selected()?.name).toBe('A copy');
  });

  it('deletesTheSelectedConfiguration', () => {
    studio.runConfigurations.set([config({ id: 'a', name: 'A' }), config({ id: 'b', name: 'B' })]);
    dialog.open();
    tick();

    internals().onDelete();

    expect(
      internals()
        .groups()
        .flatMap((g) => g.configurations.map((c) => c.id)),
    ).toEqual(['b']);
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

    expect(
      internals()
        .buildConfigOptions()
        .map((o) => o.label),
    ).toEqual(['Debug', 'Release']);
    expect(internals().hasTarget()).toBe(true);
    expect(
      internals()
        .targetOptions()
        .map((o) => o.label),
    ).toEqual(['Any CPU']);
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

  it('tree_groupsConfigurationsUnderTheirProviderKind_withAFriendlyLabel', () => {
    studio.runConfigurations.set([
      config({ id: 'a', name: 'Start app', providerKind: 'node' }),
      config({ id: 'b', name: 'API', providerKind: 'dotnet' }),
      config({ id: 'c', name: 'Run tests', providerKind: 'node' }),
    ]);
    dialog.open();
    tick();

    const shape: string[] = internals()
      .rows()
      .map((row: TreeRow): string => `${row.depth}:${internals().asRow(row).label}`);
    // The stored kinds are identifiers (`node`, `dotnet`); the tree reads as headings.
    expect(shape).toEqual(['0:Node', '1:Start app', '1:Run tests', '0:.NET', '1:API']);
  });

  it('tree_anUnmappedProviderKind_stillReadsAsAHeading', () => {
    studio.runConfigurations.set([config({ id: 'a', name: 'A', providerKind: 'elixir' })]);
    dialog.open();
    tick();

    expect(internals().asRow(internals().rows()[0]).label).toBe('Elixir');
  });

  it('tree_clickingAGroupCollapsesIt_hidingOnlyItsOwnConfigurations', () => {
    studio.runConfigurations.set([
      config({ id: 'a', name: 'Start app', providerKind: 'node' }),
      config({ id: 'b', name: 'API', providerKind: 'dotnet' }),
    ]);
    dialog.open();
    tick();

    internals().onRowClick(internals().rows()[0]);

    const shape: string[] = internals()
      .rows()
      .map((row: TreeRow): string => `${row.depth}:${internals().asRow(row).label}`);
    expect(shape).toEqual(['0:Node', '0:.NET', '1:API']);
    expect(internals().rows()[0].expanded).toBe(false);

    // And clicking it again brings its configurations back.
    internals().onRowClick(internals().rows()[0]);
    expect(internals().rows()).toHaveLength(4);
  });

  it('tree_selectingAConfigurationRow_marksItSelectedInTheTreesOwnIdSpace', () => {
    studio.runConfigurations.set([config({ id: 'a', name: 'A', providerKind: 'node' })]);
    dialog.open();
    tick();

    internals().onRowClick(internals().rows()[1]);

    expect(internals().selected()?.id).toBe('a');
    // Groups and configurations share the tree's flat id space, so the row id is not the bare id.
    expect(internals().selectedRowId()).toBe('config:a');
  });

  it('autoConfigure_opensAndClosesItsOwnModal_andClosesWithTheDialog', () => {
    dialog.open();
    tick();
    expect(internals().autoConfigureOpen()).toBe(false);

    internals().onAutoConfigure();
    expect(internals().autoConfigureOpen()).toBe(true);

    internals().onAutoConfigureClose();
    expect(internals().autoConfigureOpen()).toBe(false);

    // It is raised from this dialog's window, so it cannot outlive it.
    internals().onAutoConfigure();
    dialog.close();
    tick();
    expect(internals().autoConfigureOpen()).toBe(false);
  });

  it('togglesRunAndDebugMode', () => {
    studio.runConfigurations.set([config({ id: 'a', name: 'A' })]);
    dialog.open();
    tick();

    internals().onModeChange(true);

    expect(internals().selected()?.mode).toBe('debug');
    expect(internals().isDebug()).toBe(true);
  });

  it('markingAConfigurationDefault_clearsAnyOtherDefault', () => {
    studio.runConfigurations.set([
      config({ id: 'a', name: 'A', default: true }),
      config({ id: 'b', name: 'B' }),
    ]);
    dialog.open();
    tick();

    // Select B and make it the default: the workspace keeps exactly one default, so A's flag drops.
    internals().onRowClick(internals().rows()[2]);
    expect(internals().selected()?.id).toBe('b');
    internals().onDefaultChange(true);

    internals().onSave();
    const saved: readonly RunConfiguration[] = studio.saved[0];
    expect(saved.find((c: RunConfiguration): boolean => c.id === 'a')?.default).toBeUndefined();
    expect(saved.find((c: RunConfiguration): boolean => c.id === 'b')?.default).toBe(true);
  });

  it('clearingTheDefault_dropsTheFlagRatherThanWritingItFalse', () => {
    studio.runConfigurations.set([config({ id: 'a', name: 'A', default: true })]);
    dialog.open();
    tick();
    expect(internals().isDefault()).toBe(true);

    internals().onDefaultChange(false);

    expect(internals().selected()?.default).toBeUndefined();
    expect(internals().isDefault()).toBe(false);
  });
});

describe('ConfigureDialogPanel external writes', () => {
  let component: ConfigureDialogPanel;
  let fixture: ComponentFixture<ConfigureDialogPanel>;
  let dialog: FakeDialog;
  let studio: FakeStudio;
  let windows: FakeModalWindows;

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

  /**
   * Selects a configuration through the tree, as a click on its row would.
   * @param id The configuration id.
   */
  function select(id: string): void {
    const row: TreeRow | undefined = internals()
      .rows()
      .find((candidate: TreeRow): boolean => internals().asRow(candidate).configuration?.id === id);
    internals().onRowClick(row!);
  }

  beforeEach(async () => {
    dialog = new FakeDialog();
    studio = new FakeStudio();
    windows = new FakeModalWindows();
    await TestBed.configureTestingModule({
      imports: [ConfigureDialogPanel],
      providers: [
        { provide: ConfigureDialog, useValue: dialog },
        { provide: StudioConfig, useValue: studio },
        { provide: WorkspaceCapabilities, useValue: new FakeCapabilities() },
        { provide: ModalWindows, useValue: windows },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfigureDialogPanel);
    component = fixture.componentInstance;
    await fixture.whenStable();
    dialog.open();
    tick();
  });

  it('whenConfigurationsAreWrittenWhileOpen_theListFillsIn_keepingTheSelection', () => {
    studio.runConfigurations.set([config({ id: 'a', name: 'A' }), config({ id: 'b', name: 'B' })]);
    tick();
    select('b');

    // A write straight to `.studio` (the agent authoring, say) lands in the list without a reopen.
    studio.runConfigurations.set([
      config({ id: 'a', name: 'A' }),
      config({ id: 'b', name: 'B' }),
      config({ id: 'c', name: 'C' }),
    ]);
    tick();

    expect(
      internals()
        .groups()
        .flatMap((g) => g.configurations.map((c) => c.id)),
    ).toEqual(['a', 'b', 'c']);
    // The configuration the user was reading does not jump under them as new ones arrive.
    expect(internals().selected()?.id).toBe('b');
  });

  it('whenTheSelectedConfigurationIsRemovedExternally_theSelectionFallsBack', () => {
    studio.runConfigurations.set([config({ id: 'a', name: 'A' }), config({ id: 'b', name: 'B' })]);
    tick();
    select('b');

    studio.runConfigurations.set([config({ id: 'a', name: 'A' })]);
    tick();

    expect(internals().selected()?.id).toBe('a');
  });
});
