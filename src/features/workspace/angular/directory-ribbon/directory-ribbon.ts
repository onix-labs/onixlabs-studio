import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal, WritableSignal } from '@angular/core';
import { EditorCommands } from '@shared/angular/services/editor-commands/editor-commands';
import { WorkspaceFind } from '@features/workspace/angular/workspace-find/workspace-find';
import { WorkspaceSourceControlCommands } from '@features/workspace/angular/workspace-source-control-commands/workspace-source-control-commands';
import { Builds } from '@shared/angular/services/tasks/builds';
import { Debugger } from '@shared/angular/services/debug/debugger';
import { StudioConfig } from '@shared/angular/services/studio/studio-config';
import { ConfigureDialog } from '@shared/angular/services/configure-dialog/configure-dialog';
import { WorkspaceCapabilities } from '@shared/angular/services/workspace/workspace-capabilities';
import { ProjectCapabilities, TargetAxis } from '@shared/api/project-system';
import { RunConfiguration } from '@shared/api/studio';
import { Icon } from '@shared/angular/icons/icon';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripButtonSmall } from '@shared/angular/components/ribbon-strip/ribbon-strip-button-small/ribbon-strip-button-small';
import { RibbonStripColumn } from '@shared/angular/components/ribbon-strip/ribbon-strip-column/ribbon-strip-column';
import { RibbonStripField } from '@shared/angular/components/ribbon-strip/ribbon-strip-field/ribbon-strip-field';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { RibbonStripRow } from '@shared/angular/components/ribbon-strip/ribbon-strip-row/ribbon-strip-row';

/**
 * Represents the contextual ribbon shown when a directory tab is active. The Edit group routes edit
 * commands through the {@link EditorCommands} seam; the Solution Build and Run groups dispatch through
 * the {@link Builds} seam to the active workspace's build runner. The Run group is the Tier-1 universal
 * widget: a Start button that toggles to Stop while a run is in flight, a run-configuration dropdown
 * (sourced solely from the workspace's authored `.studio` configurations — nothing is inferred), a Debug
 * button that launches the selected configuration under the {@link Debugger} seam, and a Configure
 * button that opens the run-configuration editor. The Solution group's
 * Build/Rebuild/Clean and the Target group's configuration and target selectors gate themselves on the
 * active provider's declared {@link ProjectCapabilities}: unsupported actions are disabled, and the
 * Target group is hidden entirely when the provider declares no build-configuration or target axis. The
 * Source-Control group remains static scaffolding.
 */
@Component({
  selector: 'app-directory-ribbon',
  imports: [
    RibbonStripOverflow,
    RibbonStripGroup,
    RibbonStripColumn,
    RibbonStripButton,
    RibbonStripButtonSmall,
    RibbonStripField,
    RibbonStripRow,
    Dropdown,
  ],
  templateUrl: './directory-ribbon.html',
  hostDirectives: [RibbonHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DirectoryRibbon {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the editor command seam the Edit group dispatches through.
   */
  private readonly commands: EditorCommands = inject(EditorCommands);

  /**
   * Holds the workspace find seam the Find command reveals the Search panel through.
   */
  private readonly workspaceFind: WorkspaceFind = inject(WorkspaceFind);

  /**
   * Holds the build seam the Solution and Run groups dispatch through to the active workspace.
   */
  private readonly builds: Builds = inject(Builds);

  /**
   * Holds the debugger seam the Debug button launches the selected run configuration through.
   */
  private readonly debugger: Debugger = inject(Debugger);

  /**
   * Holds the active workspace's `.studio` configuration, the source of the run dropdown's items.
   */
  private readonly studio: StudioConfig = inject(StudioConfig);

  /**
   * Holds the active workspace's declared capabilities, gating the Solution and Target groups.
   */
  private readonly workspaceCapabilities: WorkspaceCapabilities = inject(WorkspaceCapabilities);

  /**
   * Holds the Configure dialog's open-state service, opened by the Run group's Configure button.
   */
  private readonly configureDialog: ConfigureDialog = inject(ConfigureDialog);

  /**
   * Gets the active workspace's declared capabilities, or null when none are available.
   */
  protected readonly capabilities: Signal<ProjectCapabilities | null> =
    this.workspaceCapabilities.capabilities;

  /**
   * Holds the run item the user has explicitly picked in the dropdown, or null to use the default.
   */
  private readonly picked: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the source-control seam the Source Control group dispatches through to the active workspace.
   */
  private readonly sourceControl: WorkspaceSourceControlCommands = inject(
    WorkspaceSourceControlCommands,
  );

  /**
   * Gets whether the active workspace's open folder is a git repository, enabling the Source Control
   * group's actions.
   */
  protected readonly hasRepository: Signal<boolean> = this.sourceControl.hasRepository;

  /**
   * Gets whether the active workspace supports Build: authoritative from the provider's declared
   * actions when a capability model exists, otherwise the discovered-task fallback so ecosystems
   * without a capability provider (Gradle, Make) still build.
   */
  protected readonly canBuild: Signal<boolean> = computed((): boolean => {
    const capabilities: ProjectCapabilities | null = this.capabilities();
    return capabilities !== null
      ? capabilities.actions.includes('build')
      : this.builds.canBuild();
  });

  /**
   * Gets whether the active workspace's provider declares the Clean action.
   */
  protected readonly canClean: Signal<boolean> = computed(
    (): boolean => this.capabilities()?.actions.includes('clean') ?? false,
  );

  /**
   * Gets whether the active workspace's provider declares the Rebuild action.
   */
  protected readonly canRebuild: Signal<boolean> = computed(
    (): boolean => this.capabilities()?.actions.includes('rebuild') ?? false,
  );

  /**
   * Gets whether the active workspace is running a task.
   */
  protected readonly running: Signal<boolean> = this.builds.running;

  /**
   * Gets whether the Target group is shown at all: only when the provider declares a build-configuration
   * or target axis (so, for example, an interpreted ecosystem shows no Target group).
   */
  protected readonly targetGroupVisible: Signal<boolean> = computed((): boolean => {
    const capabilities: ProjectCapabilities | null = this.capabilities();
    return (
      capabilities !== null &&
      (capabilities.buildConfigurations.length > 0 || capabilities.target !== null)
    );
  });

  /**
   * Gets the build-configuration names offered by the Configuration selector.
   */
  protected readonly buildConfigNames: Signal<readonly string[]> = computed(
    (): readonly string[] =>
      this.capabilities()?.buildConfigurations.map((configuration) => configuration.name) ?? [],
  );

  /**
   * Gets the display name of the selected build configuration.
   */
  protected readonly buildConfigValue: Signal<string> = computed((): string => {
    const capabilities: ProjectCapabilities | null = this.capabilities();
    const selectedId: string | undefined =
      this.studio.lastBuildConfiguration() ?? capabilities?.buildConfigurations[0]?.id;
    return (
      capabilities?.buildConfigurations.find(
        (configuration) => configuration.id === selectedId,
      )?.name ?? ''
    );
  });

  /**
   * Gets the active provider's target axis, or null when it has none.
   */
  protected readonly targetAxis: Signal<TargetAxis | null> = computed(
    (): TargetAxis | null => this.capabilities()?.target ?? null,
  );

  /**
   * Gets the target-option names offered by the target selector.
   */
  protected readonly targetNames: Signal<readonly string[]> = computed(
    (): readonly string[] => this.targetAxis()?.options.map((option) => option.name) ?? [],
  );

  /**
   * Gets the display name of the selected target option.
   */
  protected readonly targetValue: Signal<string> = computed((): string => {
    const axis: TargetAxis | null = this.targetAxis();
    const selectedId: string | undefined = this.studio.lastTarget() ?? axis?.options[0]?.id;
    return axis?.options.find((option) => option.id === selectedId)?.name ?? '';
  });

  /**
   * Gets the run configurations offered by the dropdown: the workspace's authored `.studio`
   * configurations, and nothing else. Studio never infers what a workspace should run, so a workspace
   * with no configurations offers none.
   */
  protected readonly runOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.studio.runConfigurations().map(
        (configuration: RunConfiguration): DropdownOption => ({
          value: configuration.id,
          label: configuration.name,
        }),
      ),
  );

  /**
   * Gets the id of the effective selected run configuration: the user's pick when it is still offered,
   * otherwise the persisted `.studio` selection, or null when the workspace has no configurations.
   */
  protected readonly selectedRunId: Signal<string | null> = computed((): string | null => {
    const options: readonly DropdownOption[] = this.runOptions();
    if (options.length === 0) {
      return null;
    }
    const picked: DropdownOption | undefined = options.find(
      (option: DropdownOption): boolean => option.value === this.picked(),
    );
    if (picked !== undefined) {
      return picked.value;
    }
    return this.studio.selectedRunConfiguration()?.id ?? options[0].value;
  });

  /**
   * Gets whether there is a run configuration the Start action can launch.
   */
  protected readonly canRun: Signal<boolean> = computed(
    (): boolean => this.selectedRunId() !== null,
  );

  /**
   * Gets the selected `.studio` run configuration, or undefined when the workspace has none. Both Start
   * and Debug launch this one.
   */
  private readonly selectedConfiguration: Signal<RunConfiguration | undefined> = computed(
    (): RunConfiguration | undefined => {
      const id: string | null = this.selectedRunId();
      return id === null
        ? undefined
        : this.studio
            .runConfigurations()
            .find((candidate: RunConfiguration): boolean => candidate.id === id);
    },
  );

  /**
   * Gets whether the Debug button can launch: the active provider declares a debug adapter, a run
   * configuration is selected, and no debug session is already running. Providers that declare no
   * adapter (or none at all) leave the button disabled rather than launching a session that would
   * immediately report it has nowhere to attach.
   */
  protected readonly canDebug: Signal<boolean> = computed(
    (): boolean =>
      this.capabilities()?.debug != null &&
      this.selectedConfiguration() !== undefined &&
      !this.debugger.running(),
  );

  /**
   * Cuts the selection in the focused editor.
   */
  protected onCut(): void {
    this.commands.cut();
  }

  /**
   * Copies the selection in the focused editor.
   */
  protected onCopy(): void {
    this.commands.copy();
  }

  /**
   * Pastes into the focused editor.
   */
  protected onPaste(): void {
    this.commands.paste();
  }

  /**
   * Undoes the last edit in the focused editor.
   */
  protected onUndo(): void {
    this.commands.undo();
  }

  /**
   * Redoes the last undone edit in the focused editor.
   */
  protected onRedo(): void {
    this.commands.redo();
  }

  /**
   * Reveals the workspace's multi-file Search panel.
   */
  protected onFind(): void {
    this.workspaceFind.reveal();
  }

  /**
   * Runs the active workspace's default build task.
   */
  protected onBuild(): void {
    this.builds.build();
  }

  /**
   * Cleans the active workspace's build outputs.
   */
  protected onClean(): void {
    this.builds.runAction('clean');
  }

  /**
   * Rebuilds the active workspace from clean.
   */
  protected onRebuild(): void {
    this.builds.runAction('rebuild');
  }

  /**
   * Records the selected build configuration, mapping its display name back to its id.
   * @param name The chosen build configuration's display name.
   */
  protected onSelectBuildConfiguration(name: string): void {
    const id: string | undefined = this.capabilities()?.buildConfigurations.find(
      (configuration): boolean => configuration.name === name,
    )?.id;
    if (id !== undefined) {
      void this.studio.setLastBuildConfiguration(id);
    }
  }

  /**
   * Records the selected target option, mapping its display name back to its id.
   * @param name The chosen target option's display name.
   */
  protected onSelectTarget(name: string): void {
    const id: string | undefined = this.targetAxis()?.options.find(
      (option): boolean => option.name === name,
    )?.id;
    if (id !== undefined) {
      void this.studio.setLastTarget(id);
    }
  }

  /**
   * Runs the selected `.studio` run configuration on the active workspace.
   */
  protected onRun(): void {
    const configuration: RunConfiguration | undefined = this.selectedConfiguration();
    if (configuration !== undefined) {
      this.builds.runConfiguration(configuration);
    }
  }

  /**
   * Picks the chosen run configuration from the dropdown, persisting the choice.
   * @param id The id of the chosen run configuration.
   */
  protected onSelectRunItem(id: string): void {
    this.picked.set(id);
    if (this.studio.runConfigurations().some((c: RunConfiguration): boolean => c.id === id)) {
      void this.studio.setSelectedRunConfiguration(id);
    }
  }

  /**
   * Launches the selected run configuration under the debugger on the active workspace.
   */
  protected onDebug(): void {
    const configuration: RunConfiguration | undefined = this.selectedConfiguration();
    if (configuration !== undefined) {
      this.debugger.launch(configuration);
    }
  }

  /**
   * Opens the Configure dialog to edit the workspace's run configurations.
   */
  protected onConfigure(): void {
    this.configureDialog.open();
  }

  /**
   * Cancels the active workspace's running task.
   */
  protected onStop(): void {
    this.builds.cancel();
  }

  /**
   * Opens the active workspace's repository in the full source-control view.
   */
  protected onOpenSourceControl(): void {
    this.sourceControl.openInSourceControl();
  }

  /**
   * Reveals the active workspace's commit panel.
   */
  protected onCommit(): void {
    this.sourceControl.commit();
  }

  /**
   * Pushes the active workspace's current branch.
   */
  protected onPush(): void {
    this.sourceControl.push();
  }

  /**
   * Pulls the active workspace's current branch.
   */
  protected onPull(): void {
    this.sourceControl.pull();
  }
}
