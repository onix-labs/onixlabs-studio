import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { CodeCommands } from '../../../../../services/code-commands/code-commands';
import { Builds, BuildTask } from '../../../../../services/tasks/builds';
import { Icon } from '../../../../../icons/icon';
import { RibbonStripButton } from '../../ribbon-strip-button/ribbon-strip-button';
import { RibbonStripButtonSmall } from '../../ribbon-strip-button-small/ribbon-strip-button-small';
import { RibbonStripColumn } from '../../ribbon-strip-column/ribbon-strip-column';
import { RibbonStripField } from '../../ribbon-strip-field/ribbon-strip-field';
import { RibbonStripGroup } from '../../ribbon-strip-group/ribbon-strip-group';
import { RibbonStripSplitButton } from '../../ribbon-strip-split-button/ribbon-strip-split-button';

/**
 * Represents the contextual ribbon shown when a directory tab is active. The File and Editor groups
 * route Save and edit commands through the {@link CodeCommands} seam; the Solution Build and Run
 * groups dispatch through the {@link Builds} seam to the active workspace's build runner (the Task
 * picker chooses what Start runs). The Target and Source-Control groups remain static scaffolding.
 */
@Component({
  selector: 'app-directory-ribbon',
  imports: [
    RibbonStripGroup,
    RibbonStripColumn,
    RibbonStripButton,
    RibbonStripButtonSmall,
    RibbonStripField,
    RibbonStripSplitButton,
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
   * Holds the editor command seam the File and Editor groups dispatch through.
   */
  private readonly commands: CodeCommands = inject(CodeCommands);

  /**
   * Holds the build seam the Solution and Run groups dispatch through to the active workspace.
   */
  private readonly builds: Builds = inject(Builds);

  /**
   * Gets whether a code editor (a focused well document) is active, enabling the File/Editor groups.
   */
  protected readonly hasActiveEditor: Signal<boolean> = this.commands.hasActiveEditor;

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
   * Saves the focused well document.
   */
  protected onSave(): void {
    this.commands.save();
  }

  /**
   * Saves the focused well document to a newly chosen path.
   */
  protected onSaveAs(): void {
    this.commands.saveAs();
  }

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
}
