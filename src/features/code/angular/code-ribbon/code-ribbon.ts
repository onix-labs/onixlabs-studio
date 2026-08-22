import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { CodeAgents } from '@features/code/angular/code-agents/code-agents';
import { EditorCommands } from '@shared/angular/services/editor-commands/editor-commands';
import { CodeRunner } from '@features/code/angular/code-runner/code-runner';
import { EditorTerminals } from '@shared/angular/services/editor-terminals/editor-terminals';
import { CodeDocument, Documents } from '@shared/angular/services/documents/documents';
import { LanguageInfo, Monaco } from '@shared/angular/services/monaco/monaco';
import { Settings } from '@shared/angular/services/settings/settings';
import { Printing } from '@shared/angular/services/printing/printing';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { Icon } from '@shared/angular/icons/icon';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripButtonSmall } from '@shared/angular/components/ribbon-strip/ribbon-strip-button-small/ribbon-strip-button-small';
import { RibbonStripCheck } from '@shared/angular/components/ribbon-strip/ribbon-strip-check/ribbon-strip-check';
import { RibbonStripColumn } from '@shared/angular/components/ribbon-strip/ribbon-strip-column/ribbon-strip-column';
import { RibbonStripField } from '@shared/angular/components/ribbon-strip/ribbon-strip-field/ribbon-strip-field';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import {
  RibbonStripMenuButton,
  RibbonMenuItem,
} from '@shared/angular/components/ribbon-strip/ribbon-strip-menu-button/ribbon-strip-menu-button';
import { RibbonStripRow } from '@shared/angular/components/ribbon-strip/ribbon-strip-row/ribbon-strip-row';

/**
 * Identifies the Monaco plain-text language, used as the syntax field's fallback when the active
 * document's language is unknown or its entry has not been created yet.
 */
const PLAIN_TEXT_LANGUAGE_ID: string = 'plaintext';

/**
 * Identifies the Save-As item in the Save menu button's dropdown.
 */
const VARIANT_SAVE_AS: string = 'save-as';

/**
 * Identifies the Export-to-PDF item in the Print menu button's dropdown.
 */
const VARIANT_EXPORT_PDF: string = 'export-pdf';

/**
 * Represents the contextual ribbon shown when a code tab is active. File actions act on the active
 * document, editor commands route through the {@link EditorCommands} registry, the language field sets
 * the active document's syntax, and Start/Terminal drive the docked run terminal.
 */
@Component({
  selector: 'app-code-ribbon',
  imports: [
    RibbonStripOverflow,
    RibbonStripGroup,
    RibbonStripColumn,
    RibbonStripRow,
    RibbonStripButton,
    RibbonStripButtonSmall,
    RibbonStripMenuButton,
    RibbonStripCheck,
    RibbonStripField,
  ],
  templateUrl: './code-ribbon.html',
  hostDirectives: [RibbonHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeRibbon {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the structured logger for the code ribbon's user actions.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the code command registry editor commands route through.
   */
  private readonly commands: EditorCommands = inject(EditorCommands);

  /**
   * Holds the documents service handling open, save and language.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds the tabs registry, used to resolve the active code document.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the printing service backing the Print and Export-to-PDF actions.
   */
  private readonly printing: Printing = inject(Printing);

  /**
   * Holds the Monaco service supplying the language list.
   */
  private readonly monaco: Monaco = inject(Monaco);

  /**
   * Holds the code runner driving the Start action.
   */
  private readonly runner: CodeRunner = inject(CodeRunner);

  /**
   * Holds the docked-terminal panel state backing the Terminal toggle.
   */
  private readonly editorTerminals: EditorTerminals = inject(EditorTerminals);

  /**
   * Holds the docked agent-panel state backing the Agent toggle.
   */
  private readonly codeAgents: CodeAgents = inject(CodeAgents);

  /**
   * Holds the settings service backing the view toggles.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the language list, in display order.
   */
  private readonly languages: readonly LanguageInfo[] = this.monaco.getSupportedLanguages();

  /**
   * Maps a language display name to its identifier.
   */
  private readonly idByName: ReadonlyMap<string, string> = new Map<string, string>(
    this.languages.map((info: LanguageInfo): [string, string] => [info.name, info.id]),
  );

  /**
   * Maps a language identifier to its display name.
   */
  private readonly nameById: ReadonlyMap<string, string> = new Map<string, string>(
    this.languages.map((info: LanguageInfo): [string, string] => [info.id, info.name]),
  );

  /**
   * Gets the language display names offered by the syntax field.
   */
  protected readonly languageOptions: readonly string[] = this.languages.map(
    (info: LanguageInfo): string => info.name,
  );

  /**
   * Gets the active document, or undefined when no code document is active.
   */
  private readonly activeDocument: Signal<CodeDocument | undefined> = computed(
    (): CodeDocument | undefined => {
      const id: string | undefined = this.tabs.activeTabId();
      return id === undefined ? undefined : this.documents.get(id);
    },
  );

  /**
   * Gets the display name of the active document's language.
   */
  protected readonly languageName: Signal<string> = computed((): string => {
    const language: string = this.activeDocument()?.language() ?? PLAIN_TEXT_LANGUAGE_ID;
    return this.nameById.get(language) ?? this.nameById.get(PLAIN_TEXT_LANGUAGE_ID) ?? '';
  });

  /**
   * Gets a value indicating whether the active document's language can be run.
   */
  protected readonly canRun: Signal<boolean> = computed((): boolean =>
    this.runner.canRun(this.activeDocument()?.language() ?? ''),
  );

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
   * Gets the extra actions offered by the Save menu button's dropdown.
   */
  protected readonly saveItems: readonly RibbonMenuItem[] = [
    { id: VARIANT_SAVE_AS, label: 'Save As', icon: Icon.SAVE_AS },
  ];

  /**
   * Gets the extra actions offered by the Print menu button's dropdown.
   */
  protected readonly printItems: readonly RibbonMenuItem[] = [
    { id: VARIANT_EXPORT_PDF, label: 'Export to PDF', icon: Icon.EXPORT_PDF },
  ];

  /**
   * Saves the active document.
   */
  protected onSave(): void {
    this.log.info('code.ribbon', 'Save active document requested');
    void this.documents.saveActive();
  }

  /**
   * Runs the action chosen from the Save menu button's dropdown.
   * @param id The chosen save variant's identifier.
   */
  protected onSaveVariant(id: string): void {
    this.log.info('code.ribbon', 'Save variant chosen', id);
    if (id === VARIANT_SAVE_AS) {
      void this.documents.saveActiveAs();
    } else {
      void this.documents.saveActive();
    }
  }

  /**
   * Prints the active document via the browser print dialog.
   */
  protected onPrint(): void {
    this.log.info('code.ribbon', 'Print requested');
    this.printing.print();
  }

  /**
   * Runs the action chosen from the Print menu button's dropdown.
   * @param id The chosen print variant's identifier.
   */
  protected onPrintVariant(id: string): void {
    if (id === VARIANT_EXPORT_PDF) {
      this.onExportPdf();
    } else {
      this.onPrint();
    }
  }

  /**
   * Exports the active document to PDF, prompting for a destination and opening the result.
   */
  protected onExportPdf(): void {
    this.log.info('code.ribbon', 'Export to PDF requested', this.activeDocument()?.fileName() ?? '');
    void this.printing.exportPdf(this.activeDocument()?.fileName() ?? '');
  }

  /**
   * Formats the active document.
   */
  protected onFormat(): void {
    this.log.info('code.ribbon', 'Format document requested');
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
    this.log.info('code.ribbon', 'Find requested');
    this.commands.find();
  }

  /**
   * Applies the language chosen in the syntax field to the active document.
   * @param name The selected language display name.
   */
  protected onLanguageChange(name: string): void {
    const id: string | undefined = this.tabs.activeTabId();
    const language: string | undefined = this.idByName.get(name);
    if (id !== undefined && language !== undefined) {
      this.log.info('code.ribbon', 'Language changed', language);
      this.documents.setLanguage(id, language);
    }
  }

  /**
   * Runs the active document in its docked terminal.
   */
  protected onRun(): void {
    const id: string | undefined = this.tabs.activeTabId();
    const document: CodeDocument | undefined = this.activeDocument();
    if (id !== undefined && document !== undefined) {
      this.log.info('code.ribbon', 'Run active document from ribbon', document.language());
      void this.runner.run(id, document.language(), document.content());
    }
  }

  /**
   * Toggles the docked terminal for the active tab.
   */
  protected onTerminal(): void {
    const id: string | undefined = this.tabs.activeTabId();
    if (id !== undefined) {
      this.log.debug('code.ribbon', 'Toggle docked terminal', id);
      this.editorTerminals.toggle(id);
    }
  }

  /**
   * Toggles the docked agent panel for the active tab.
   */
  protected onAgent(): void {
    const id: string | undefined = this.tabs.activeTabId();
    if (id !== undefined) {
      this.log.debug('code.ribbon', 'Toggle docked agent panel', id);
      this.codeAgents.toggle(id);
    }
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
