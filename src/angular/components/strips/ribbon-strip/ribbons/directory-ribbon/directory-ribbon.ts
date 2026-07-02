import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { EditorCommands } from '@shared/angular/services/editor-commands/editor-commands';
import { WorkspaceSourceControlCommands } from '../../../../../services/workspace-source-control-commands/workspace-source-control-commands';
import { Builds, BuildTask } from '../../../../../services/tasks/builds';
import { Icon } from '@shared/angular/icons/icon';
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
 * the {@link Builds} seam to the active workspace's build runner (the Task picker chooses what Start
 * runs). The Target and Source-Control groups remain static scaffolding.
 */
@Component({
  selector: 'app-directory-ribbon',
  imports: [
    RibbonStripOverflow,
    RibbonStripGroup,
    RibbonStripColumn,
    RibbonStripRow,
    RibbonStripButton,
    RibbonStripButtonSmall,
    RibbonStripField,
  ],
  templateUrl: './directory-ribbon.html',
  styleUrl: '../ribbon-row.scss',
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
   * Holds the build seam the Solution and Run groups dispatch through to the active workspace.
   */
  private readonly builds: Builds = inject(Builds);

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
   * Gets whether the active workspace has a task the Start action can run.
   */
  protected readonly canStart: Signal<boolean> = this.builds.canStart;

  /**
   * Gets the label of the task the Start action runs.
   */
  protected readonly startLabel: Signal<string> = this.builds.startLabel;

  /**
   * Gets whether the active workspace is running a task.
   */
  protected readonly running: Signal<boolean> = this.builds.running;

  /**
   * Gets the labels of the discovered tasks offered by the picker.
   */
  protected readonly taskLabels: Signal<readonly string[]> = computed((): readonly string[] =>
    this.builds.tasks().map((task: BuildTask): string => task.label),
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
   * Opens the find widget in the focused editor.
   */
  protected onFind(): void {
    this.commands.find();
  }

  /**
   * Runs the active workspace's default build task.
   */
  protected onBuild(): void {
    this.builds.build();
  }

  /**
   * Selects the task the Start action runs.
   * @param label The label of the chosen task.
   */
  protected onSelectTask(label: string): void {
    const task: BuildTask | undefined = this.builds
      .tasks()
      .find((candidate: BuildTask): boolean => candidate.label === label);
    if (task !== undefined) {
      this.builds.select(task.id);
    }
  }

  /**
   * Runs the selected (or default) task on the active workspace.
   */
  protected onStart(): void {
    this.builds.start();
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
