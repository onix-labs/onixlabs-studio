import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { CodeCommands } from '../../../../../services/code-commands/code-commands';
import { Documents } from '../../../../../services/documents/documents';
import { Settings } from '../../../../../services/settings/settings';
import { RibbonButton } from '../../controls/ribbon-button/ribbon-button';
import { RibbonButtonSmall } from '../../controls/ribbon-button-small/ribbon-button-small';
import { RibbonCheck } from '../../controls/ribbon-check/ribbon-check';
import { RibbonColumn } from '../../controls/ribbon-column/ribbon-column';
import { RibbonGroup } from '../../controls/ribbon-group/ribbon-group';

/**
 * Represents the contextual ribbon shown when a code tab is active. File actions act on the active
 * document, editor commands route through the {@link CodeCommands} registry, and the view toggles
 * drive the global editor settings live.
 */
@Component({
  selector: 'app-code-ribbon',
  imports: [RibbonGroup, RibbonColumn, RibbonButton, RibbonButtonSmall, RibbonCheck],
  templateUrl: './code-ribbon.html',
  styleUrl: '../ribbon-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeRibbon {
  /**
   * Holds the code command registry editor commands route through.
   */
  private readonly commands: CodeCommands = inject(CodeCommands);

  /**
   * Holds the documents service handling open and save actions.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds the settings service backing the view toggles.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets a value indicating whether long lines are wrapped.
   */
  protected readonly wordWrap: Signal<boolean> = computed(
    (): boolean => this.settings.globalTextEditor().wordWrap,
  );

  /**
   * Gets a value indicating whether the minimap is shown.
   */
  protected readonly minimap: Signal<boolean> = computed(
    (): boolean => this.settings.globalTextEditor().showMinimap,
  );

  /**
   * Gets a value indicating whether line numbers are shown.
   */
  protected readonly lineNumbers: Signal<boolean> = computed(
    (): boolean => this.settings.globalTextEditor().showLineNumbers,
  );

  /**
   * Opens a file in a new code tab.
   */
  protected onOpen(): void {
    void this.documents.openFile();
  }

  /**
   * Saves the active document.
   */
  protected onSave(): void {
    void this.documents.saveActive();
  }

  /**
   * Saves the active document to a newly chosen path.
   */
  protected onSaveAs(): void {
    void this.documents.saveActiveAs();
  }

  /**
   * Formats the active document.
   */
  protected onFormat(): void {
    this.commands.formatDocument();
  }

  /**
   * Cuts the selection to the clipboard.
   */
  protected onCut(): void {
    this.commands.cut();
  }

  /**
   * Copies the selection to the clipboard.
   */
  protected onCopy(): void {
    this.commands.copy();
  }

  /**
   * Pastes the clipboard contents.
   */
  protected onPaste(): void {
    this.commands.paste();
  }

  /**
   * Undoes the last edit.
   */
  protected onUndo(): void {
    this.commands.undo();
  }

  /**
   * Redoes the last undone edit.
   */
  protected onRedo(): void {
    this.commands.redo();
  }

  /**
   * Opens the find widget.
   */
  protected onFind(): void {
    this.commands.find();
  }

  /**
   * Toggles word wrap.
   * @param value The new word-wrap state.
   */
  protected onWordWrap(value: boolean): void {
    this.settings.updateTextEditorSettings({ wordWrap: value });
  }

  /**
   * Toggles the minimap.
   * @param value The new minimap state.
   */
  protected onMinimap(value: boolean): void {
    this.settings.updateTextEditorSettings({ showMinimap: value });
  }

  /**
   * Toggles line numbers.
   * @param value The new line-numbers state.
   */
  protected onLineNumbers(value: boolean): void {
    this.settings.updateTextEditorSettings({ showLineNumbers: value });
  }
}
