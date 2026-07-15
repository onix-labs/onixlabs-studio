import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal, WritableSignal } from '@angular/core';
import { EditorCommands } from '@shared/angular/services/editor-commands/editor-commands';
import { WorkspaceFind } from '@features/workspace/angular/workspace-find/workspace-find';
import { WorkspaceSourceControlCommands } from '@features/workspace/angular/workspace-source-control-commands/workspace-source-control-commands';
import { Builds } from '@shared/angular/services/tasks/builds';
import { StudioConfig } from '@shared/angular/services/studio/studio-config';
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
 * (sourced from the workspace's `.studio` configurations, falling back to discovered tasks), an inert
 * Debug pending the DAP epic, and an inert Configure pending its editor. The Target and Source-Control
 * groups remain static scaffolding.
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
   * Holds the active workspace's `.studio` configuration, the source of the run dropdown's items.
   */
  private readonly studio: StudioConfig = inject(StudioConfig);

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
   * Gets whether the active workspace can run a build task.
   */
  protected readonly canBuild: Signal<boolean> = this.builds.canBuild;

  /**
   * Gets whether the active workspace is running a task.
   */
  protected readonly running: Signal<boolean> = this.builds.running;

  /**
   * Gets the run configurations offered by the dropdown, sourced from the workspace's `.studio`
   * configurations when it has any, otherwise from the discovered build tasks as a fallback.
   */
  protected readonly runOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => {
      const configurations: readonly RunConfiguration[] = this.studio.runConfigurations();
      if (configurations.length > 0) {
        return configurations.map(
          (configuration: RunConfiguration): DropdownOption => ({
            value: configuration.id,
            label: configuration.name,
          }),
        );
      }
      return this.builds
        .tasks()
        .map((task): DropdownOption => ({ value: task.id, label: task.label }));
    },
  );

  /**
   * Gets the id of the effective selected run item: the user's pick when it is still offered, otherwise
   * the default (the `.studio` selection, or the default build task), or null when there is nothing to
   * run.
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
    const fallback: string | undefined =
      this.studio.runConfigurations().length > 0
        ? this.studio.selectedRunConfiguration()?.id
        : this.builds.startTask()?.id;
    return fallback ?? options[0].value;
  });

  /**
   * Gets whether there is a run item the Start action can launch.
   */
  protected readonly canRun: Signal<boolean> = computed(
    (): boolean => this.selectedRunId() !== null,
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
   * Runs the selected run item on the active workspace: a `.studio` run configuration through the
   * configuration path, or a discovered task through the task path.
   */
  protected onRun(): void {
    const id: string | null = this.selectedRunId();
    if (id === null) {
      return;
    }
    const configuration: RunConfiguration | undefined = this.studio
      .runConfigurations()
      .find((candidate: RunConfiguration): boolean => candidate.id === id);
    if (configuration !== undefined) {
      this.builds.runConfiguration(configuration);
    } else {
      this.builds.runTask(id);
    }
  }

  /**
   * Picks the chosen run item from the dropdown, persisting the choice when it is a `.studio`
   * configuration.
   * @param id The id of the chosen run item.
   */
  protected onSelectRunItem(id: string): void {
    this.picked.set(id);
    if (this.studio.runConfigurations().some((c: RunConfiguration): boolean => c.id === id)) {
      void this.studio.setSelectedRunConfiguration(id);
    }
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
