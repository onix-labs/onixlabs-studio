import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { CodeCommands } from '../../../../../services/code-commands/code-commands';
import { Icon } from '../../../../../icons/icon';
import { RibbonButton } from '../../controls/ribbon-button/ribbon-button';
import { RibbonButtonSmall } from '../../controls/ribbon-button-small/ribbon-button-small';
import { RibbonColumn } from '../../controls/ribbon-column/ribbon-column';
import { RibbonField } from '../../controls/ribbon-field/ribbon-field';
import { RibbonGroup } from '../../controls/ribbon-group/ribbon-group';
import { RibbonSplitButton } from '../../controls/ribbon-split-button/ribbon-split-button';

/**
 * Represents the contextual ribbon shown when a directory tab is active. The File and Editor groups
 * route Save and edit commands through the {@link CodeCommands} seam, so they act on the focused
 * well document's own (workspace-scoped) services; the Solution/Run/Target/Source-Control groups are
 * still static scaffolding whose final wiring is not yet decided.
 */
@Component({
  selector: 'app-directory-ribbon',
  imports: [
    RibbonGroup,
    RibbonColumn,
    RibbonButton,
    RibbonButtonSmall,
    RibbonField,
    RibbonSplitButton,
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
   * Gets whether a code editor (a focused well document) is active, enabling the File/Editor groups.
   */
  protected readonly hasActiveEditor: Signal<boolean> = this.commands.hasActiveEditor;

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
}
