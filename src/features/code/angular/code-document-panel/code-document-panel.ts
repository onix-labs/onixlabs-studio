import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  untracked,
  viewChild,
  WritableSignal,
} from '@angular/core';
import {
  TextEditor,
  TextEditorCursor,
  TextEditorEol,
} from '@shared/angular/components/text-editor/text-editor';
import { CodeDocument, Documents } from '@shared/angular/services/documents/documents';
import { Log } from '@shared/angular/services/log/log';
import { DocumentStatus } from '@shared/angular/services/document-status/document-status';
import {
  EditorCommandHandler,
  EditorCommands,
} from '@shared/angular/services/editor-commands/editor-commands';
import { Editors, RevealRequest } from '@shared/angular/services/editors/editors';
import { LspClient } from '@shared/angular/services/lsp/lsp-client';
import { CodeDocumentEditor } from '@features/code/angular/code-document/code-document';
import { ChangeMarginController } from '@features/code/angular/change-margin/change-margin-controller';
import { ChangeMargins } from '@features/code/angular/change-margin/change-margins';
import { Theme } from '@shared/angular/services/theme/theme';
import { LspFeatures } from '@shared/angular/services/lsp/lsp-features';
import { CodeSymbol, SymbolPosition } from '@shared/angular/services/lsp/lsp-symbols';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { Button } from '@shared/angular/components/forms/button/button';
import { Menu, MenuItem } from '@shared/angular/components/menu/menu';
import { TooltipTrigger } from '@shared/angular/components/tooltip/tooltip-trigger';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import { Icon } from '@shared/angular/icons/icon';
import { Settings } from '@shared/angular/services/settings/settings';
import { LanguageSupportPrompt } from '@shared/angular/services/plugins/language-support-prompt';
import { languageDisplayName } from '@shared/angular/services/plugins/language-names';
import {
  DocumentFileCommands,
  injectDocumentFileCommands,
} from '@shared/angular/services/document-file-commands/document-file-commands';
import {
  buildNavigation,
  GLOBAL_ENTRY_ID,
  locate,
  qualifierFor,
  NavigationLocation,
  NavigationMember,
  NavigationTarget,
  NavigationType,
} from '@features/code/angular/code-navigation/code-navigation';
import type * as MonacoApi from 'monaco-editor';

/**
 * How long the document must be left unchanged before its symbols are read again, in milliseconds:
 * typing changes them on every keystroke, and the dropdowns need them only once it settles.
 */
const SYMBOLS_DEBOUNCE_MS: number = 500;

/**
 * How long to wait before asking again a server that has not answered yet, in milliseconds. A heavy
 * server (Roslyn, jdtls) loads its project for seconds after starting and answers nothing until then.
 */
const SYMBOLS_RETRY_MS: number = 2000;

/**
 * How many times to ask a server that has not answered before taking it at its word.
 */
const SYMBOLS_RETRIES: number = 15;

/**
 * Names where the Type and Member dropdowns' entries are: read, being waited for, or not to be had.
 */
type NavigationState = 'ready' | 'waiting' | 'unavailable';

/**
 * Identifies the strip menu's commands.
 */
const MENU_GO_TO_SYMBOL: string = 'code.goToSymbol';
const MENU_GO_TO_LINE: string = 'code.goToLine';
const MENU_WORD_WRAP: string = 'code.wordWrap';
const MENU_MINIMAP: string = 'code.minimap';
const MENU_LINE_NUMBERS: string = 'code.lineNumbers';

/**
 * Represents the lean code surface mounted in a workspace document well: the shared
 * {@link CodeDocumentEditor} core. Unlike the full code tab view it carries no ribbon and no docked
 * terminal/agent panels — because the well is a secondary editing surface beside the workspace tree —
 * and it shows neither a file toolstrip nor an inline status strip: the dock supplies the tab header
 * and, while this panel is the active document, it publishes its caret position, language, line-ending
 * and encoding to the shared {@link DocumentStatus} so the well's status strip renders them. It does
 * carry the change-margin save gutter, wired the same way the code tab view wires it, so a well editor
 * shows the same dirty-diff bars. The editor is fully editable, as in a tab.
 */
@Component({
  selector: 'app-code-document-panel',
  imports: [
    Button,
    CdkMenuTrigger,
    CodeDocumentEditor,
    Dropdown,
    Menu,
    PanelToolbar,
    TooltipTrigger,
  ],
  templateUrl: './code-document-panel.html',
  styleUrl: './code-document-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeDocumentPanel {
  /**
   * Holds the documents service backing the hosted document's language and encoding.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds the structured logger for the well document panel's lifecycle and command actions.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the well status strip this panel publishes to while it is the active document.
   */
  private readonly documentStatus: DocumentStatus = inject(DocumentStatus);

  /**
   * Holds the theme service supplying the resolved light/dark mode, for the change-margin colours.
   */
  private readonly theme: Theme = inject(Theme);

  /**
   * Holds the workspace's language-server client, kept in sync with this well document so the workspace
   * receives its language-server diagnostics, hover, and completion. This resolves the directory view's
   * scoped client — the same instance that prestarts the server — so opened well documents are the ones
   * the server analyses. Without this the well (unlike a standalone code tab) never opened its documents
   * against the server, so the Error List stayed empty.
   */
  private readonly lsp: LspClient = inject(LspClient);

  /**
   * Holds the (root) editor registry that maps this document's Monaco model to its file, so
   * language-server diagnostics resolve back to a model and paint as editor markers (squiggles).
   */
  private readonly editors: Editors = inject(Editors);

  /**
   * Holds the URI of this panel's Monaco model, or null before the editor is created and after
   * disposal. Registered with the {@link Editors} registry so markers can find the model.
   */
  private modelUri: string | null = null;

  /**
   * Holds the change-margin registry that draws the editor's save-state gutter bars.
   */
  private readonly changeMargins: ChangeMargins = inject(ChangeMargins);

  /**
   * Holds the editor-command registry this panel registers its editor with, keyed by document id. A
   * well document is an editor like any other: registering here is what lets the workspace ribbon's
   * Edit commands, its Save actions, and its Clean group's Format and Code Cleanup reach the focused
   * well document — without it those controls resolve no handler and silently do nothing.
   */
  private readonly editorCommands: EditorCommands = inject(EditorCommands);

  /**
   * Holds the command handler registered with the {@link EditorCommands} registry, or null before the
   * editor exists and after disposal.
   */
  private commandHandler: EditorCommandHandler | null = null;

  /**
   * Holds the document-bound code editor core this panel drives, so it can attach the change margin to
   * the core's pane once the editor exists.
   */
  private readonly core: Signal<CodeDocumentEditor | undefined> =
    viewChild<CodeDocumentEditor>(CodeDocumentEditor);

  /**
   * Holds a value indicating whether the core's Monaco editor has been created.
   */
  private readonly paneReady: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the change-margin controller drawing the save-state gutter bars, or null before the editor
   * is created and after disposal.
   */
  private changeMargin: ChangeMarginController | null = null;

  /**
   * Gets the identifier of the document this panel displays (the well panel's id).
   */
  public readonly documentId: InputSignal<string> = input.required<string>();

  /**
   * Gets whether this document is the active one in its well, so the editor relayouts and focuses.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets whether the backing document is released when this panel is destroyed. The workspace owns the
   * document's lifecycle in the well, so this is false: a destroy is a re-parent, not a close.
   */
  public readonly removeOnDestroy: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the backing document, or undefined before it is registered.
   */
  private readonly document: Signal<CodeDocument | undefined> = computed(
    (): CodeDocument | undefined => this.documents.get(this.documentId()),
  );

  /**
   * Holds the editor's cursor position, or null before the editor reports one.
   */
  private readonly caretSignal: WritableSignal<{ line: number; column: number } | null> = signal<{
    line: number;
    column: number;
  } | null>(null);

  /**
   * Holds the language-server features that read the document's symbols.
   */
  private readonly lspFeatures: LspFeatures = inject(LspFeatures);

  /**
   * Holds the Type dropdown's entries, or null until a language server has answered for the document.
   * The strip is drawn either way — a code file always has one (#882) — and the dropdowns are disabled
   * until there is something to list.
   */
  protected readonly navigation: WritableSignal<readonly NavigationType[] | null> = signal<
    readonly NavigationType[] | null
  >(null);

  /**
   * Holds where the dropdowns' entries are, which decides what their hint says.
   */
  private readonly navigationState: WritableSignal<NavigationState> =
    signal<NavigationState>('waiting');

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the settings service, whose editor-wide Word Wrap the strip's toggle reads and sets.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the offer of language support, which names the plugin a language's server comes from.
   */
  private readonly languageSupport: LanguageSupportPrompt = inject(LanguageSupportPrompt);

  /**
   * Holds the file commands the strip's menu ends with, shared with the markdown strip's.
   */
  private readonly fileCommands: DocumentFileCommands = injectDocumentFileCommands();

  /**
   * Gets whether long lines wrap, editor-wide — the same setting the ribbon's Word Wrap sets.
   */
  protected readonly wordWrap: Signal<boolean> = computed(
    (): boolean => this.settings.globalTextEditor().wordWrap,
  );

  /**
   * Gets whether the minimap shows, editor-wide — the same setting the ribbon's Minimap sets.
   */
  protected readonly minimap: Signal<boolean> = computed(
    (): boolean => this.settings.globalTextEditor().showMinimap,
  );

  /**
   * Gets whether line numbers show, editor-wide — the same setting the ribbon's Line Numbers sets.
   */
  protected readonly lineNumbers: Signal<boolean> = computed(
    (): boolean => this.settings.globalTextEditor().showLineNumbers,
  );

  /**
   * Gets why the dropdowns are empty, shown over them while they are disabled; empty once they list
   * something.
   */
  protected readonly navigationHint: Signal<string> = computed((): string => {
    const state: NavigationState = this.navigationState();
    if (state === 'ready' && this.typeOptions().length > 0) {
      return '';
    }
    if (state === 'ready') {
      return 'No types or members in this file';
    }
    const language: string = this.document()?.language() ?? '';
    const plugin: string | null = this.languageSupport.installableFor(language);
    if (plugin !== null) {
      return `Install ${plugin} to list this file's types and members`;
    }
    return state === 'waiting'
      ? 'Waiting for the language server'
      : `No language server for ${languageDisplayName(language)}`;
  });

  /**
   * Gets the strip menu's items. The file's own commands are offered only once it has a path.
   */
  protected readonly menuItems: Signal<readonly MenuItem[]> = computed((): readonly MenuItem[] => {
    return [
      { id: MENU_GO_TO_SYMBOL, label: 'Go to Symbol…', icon: Icon.GO_TO_SYMBOL },
      { id: MENU_GO_TO_LINE, label: 'Go to Line…', icon: Icon.GO_TO_LINE },
      { id: 'separator', label: '', separator: true },
      // The editor's view options, the ribbon's three checkboxes (#882): editor-wide, so they agree.
      { id: MENU_WORD_WRAP, label: 'Word Wrap', checked: this.wordWrap() },
      { id: MENU_MINIMAP, label: 'Minimap', checked: this.minimap() },
      { id: MENU_LINE_NUMBERS, label: 'Line Numbers', checked: this.lineNumbers() },
      { id: 'separator-view', label: '', separator: true },
      ...this.fileCommands.items(this.document()?.filePath() ?? null),
    ];
  });

  /**
   * Holds the pending symbol read, or null when none is scheduled.
   */
  private symbolsTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds how many times in a row the server has not answered, so a document whose server never will
   * stops being asked.
   */
  private unanswered: number = 0;

  /**
   * Gets the type and member the cursor is in.
   */
  protected readonly location: Signal<NavigationLocation> = computed((): NavigationLocation => {
    const caret: { line: number; column: number } | null = this.caretSignal();
    const types: readonly NavigationType[] = this.navigation() ?? [];
    if (caret === null) {
      return { typeId: null, memberId: null };
    }
    return locate(types, { line: caret.line - 1, character: caret.column - 1 });
  });

  /**
   * Gets the Type dropdown's options.
   */
  protected readonly typeOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      (this.navigation() ?? []).map((type: NavigationType): DropdownOption => ({
        value: type.id,
        label: type.label,
      })),
  );

  /**
   * Gets the Member dropdown's options: the members of the type the cursor is in.
   */
  protected readonly memberOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      (this.currentType()?.members ?? []).map((member: NavigationMember): DropdownOption => ({
        value: member.id,
        label: member.label,
      })),
  );

  /**
   * Gets the type the cursor is in, or null when it is in none.
   */
  private readonly currentType: Signal<NavigationType | null> = computed(
    (): NavigationType | null =>
      (this.navigation() ?? []).find(
        (type: NavigationType): boolean => type.id === this.location().typeId,
      ) ?? null,
  );

  /**
   * Holds the document's end-of-line sequence.
   */
  private readonly eolSignal: WritableSignal<TextEditorEol> = signal<TextEditorEol>('LF');

  /**
   * Initializes a new instance of the {@link CodeDocumentPanel} class, publishing its status to the
   * well status strip while it is the active document and clearing it when it is not or is destroyed.
   */
  public constructor() {
    const destroyRef: DestroyRef = inject(DestroyRef);
    effect((): void => {
      const document: CodeDocument | undefined = this.document();
      const caret: { line: number; column: number } | null = this.caretSignal();
      if (!this.isActive() || document === undefined || caret === null) {
        this.documentStatus.clear(this.documentId());
        return;
      }
      const encoding: string = document.encoding();
      this.documentStatus.set(this.documentId(), {
        line: caret.line,
        column: caret.column,
        language: document.language(),
        diagnostics: true,
        eol: this.eolSignal(),
        encoding: document.hasBom() ? `${encoding} with BOM` : encoding,
      });
    });

    // Keep the language server in sync with this well document's path, language, and text, so the
    // workspace receives live diagnostics; re-runs on edits, save-as, and language changes. The client
    // ignores untitled documents, those outside a workspace, and languages with no server.
    effect((): void => {
      const document: CodeDocument | undefined = this.document();
      if (document === undefined) {
        return;
      }
      this.lsp.syncDocument({
        documentId: this.documentId(),
        path: document.filePath(),
        languageId: document.language(),
        content: document.content(),
      });
    });

    // Tell the language server when the document is saved: the saved text changing is the save.
    effect((): void => {
      const document: CodeDocument | undefined = this.document();
      if (document === undefined) {
        return;
      }
      const savedContent: string = document.savedContent();
      untracked((): void => this.lsp.notifySaved(this.documentId(), savedContent));
    });

    // Register this editor's model against its document, so language-server diagnostics resolve to a
    // model and paint as markers (squiggles) and a reveal can target it; re-runs when the path or name
    // changes (save/rename).
    effect((): void => {
      const document: CodeDocument | undefined = this.document();
      if (!this.paneReady() || this.modelUri === null || document === undefined) {
        return;
      }
      this.editors.register(this.modelUri, {
        documentId: this.documentId(),
        path: document.filePath(),
        name: document.fileName(),
      });
    });

    // Keep the change-margin's overview-ruler colours current for the active theme (the gutter bars
    // themselves follow CSS automatically, but the ruler is a canvas colour).
    effect((): void => {
      this.theme.resolvedMode();
      if (!this.paneReady()) {
        return;
      }
      this.changeMargin?.setColors(this.changeMargins.resolveColors());
    });

    // Keep the change-margin's saved baseline current: every line in sync with it shows a saved
    // (green) bar and every line that differs an unsaved (yellow) bar. Re-runs when the last-saved
    // content changes (save, reload) and when the file path appears (first save of a new document).
    effect((): void => {
      const document: CodeDocument | undefined = this.document();
      const savedContent: string = document?.savedContent() ?? '';
      const hasSavedVersion: boolean = (document?.filePath() ?? null) !== null;
      if (!this.paneReady()) {
        return;
      }
      this.changeMargin?.setBaseline(savedContent, hasSavedVersion);
    });

    // Follow the well's active document with the editor-command registry, so the ribbon's edit, save
    // and clean-up commands act on the document the user is looking at. Registration itself marks the
    // handler active, so this only has to re-mark it when focus returns and stand it down when it
    // leaves; the handler stays registered either way, so a docked agent can still reach the editor.
    effect((): void => {
      if (this.commandHandler === null || !this.paneReady()) {
        return;
      }
      if (this.isActive()) {
        this.editorCommands.register(this.documentId(), this.commandHandler);
      } else {
        this.editorCommands.deactivate(this.documentId());
      }
    });

    // Honour reveal requests aimed at this document — Find & Replace opening a match, a diff's Open
    // File — as the code tab does: a well document is an editor like any other (#882).
    effect((): void => {
      const request: RevealRequest | null = this.editors.revealRequest();
      if (request === null || !this.paneReady() || request.documentId !== this.documentId()) {
        return;
      }
      untracked((): void => this.core()?.getPane()?.reveal(request.line, request.column));
    });

    // Read the document's symbols once the editor exists, and again whenever the text settles after a
    // change, for the strip's Type and Member dropdowns.
    effect((): void => {
      this.document()?.content();
      if (!this.paneReady()) {
        return;
      }
      untracked((): void => this.scheduleSymbols(SYMBOLS_DEBOUNCE_MS));
    });

    destroyRef.onDestroy((): void => {
      if (this.symbolsTimer !== null) {
        clearTimeout(this.symbolsTimer);
        this.symbolsTimer = null;
      }
      this.documentStatus.clear(this.documentId());
      this.editorCommands.forget(this.documentId());
      this.commandHandler = null;
      if (this.modelUri !== null) {
        this.editors.unregister(this.modelUri);
        this.modelUri = null;
      }
      if (this.changeMargin !== null) {
        this.changeMargins.detach(this.changeMargin);
        this.changeMargin = null;
      }
    });
  }

  /**
   * Wires the change-margin gutter once the core's pane editor exists, seeding it with the document's
   * saved baseline before the baseline/colour effects run on paneReady becoming true. A document with
   * no file path has no saved version yet.
   */
  protected onReady(): void {
    const pane: TextEditor | undefined = this.core()?.getPane();
    const document: CodeDocument | undefined = this.document();
    if (pane === undefined || document === undefined) {
      return;
    }
    this.modelUri = pane.getModelUri();
    const editor: ReturnType<TextEditor['getEditor']> = pane.getEditor();
    if (editor !== null) {
      this.changeMargin = this.changeMargins.attach(
        editor,
        document.savedContent(),
        document.filePath() !== null,
      );
    }
    this.registerCommandHandler(pane);
    this.paneReady.set(true);
  }

  /**
   * Registers this well document's editor with the {@link EditorCommands} registry, mapping each
   * command to the pane's editor API. Save routes through the workspace-scoped documents service, so
   * the file is written by the same instance that owns the well's documents.
   * @param pane The pane whose editor backs the commands.
   */
  private registerCommandHandler(pane: TextEditor): void {
    this.commandHandler = {
      cut: (): void => pane.trigger('editor.action.clipboardCutAction'),
      copy: (): void => pane.trigger('editor.action.clipboardCopyAction'),
      paste: (): void => pane.paste(),
      undo: (): void => pane.trigger('undo'),
      redo: (): void => pane.trigger('redo'),
      // The well carries no find panel of its own, so Find opens Monaco's own widget in place.
      find: (): void => pane.trigger('actions.find'),
      formatDocument: (): void => pane.trigger('editor.action.formatDocument'),
      codeCleanup: async (): Promise<void> => {
        // Sequenced, not fired together: organising imports rewrites the very lines the formatter
        // would otherwise lay out, so formatting has to see the tidied text.
        await pane.runAction('editor.action.organizeImports');
        await pane.runAction('editor.action.formatDocument');
      },
      save: (): void => {
        this.log.info('code.document', 'Save well document', this.documentId());
        void this.documents.save(this.documentId());
      },
      saveAs: (): void => {
        this.log.info('code.document', 'Save-as well document', this.documentId());
        void this.documents.saveAs(this.documentId());
      },
      getText: (): string => pane.getValue(),
      getSelectionText: (): string => pane.getSelectionText(),
      replaceText: (text: string): void => pane.replaceAll(text),
      replaceRange: (start: number, length: number, text: string): void =>
        pane.replaceRange(start, length, text),
    };
    this.editorCommands.register(this.documentId(), this.commandHandler);
  }

  /**
   * Goes to the type chosen in the Type dropdown — or, for the file's own entry, to the first thing
   * declared outside any type.
   * @param id The chosen type's identifier.
   */
  protected goToType(id: string): void {
    const type: NavigationType | undefined = (this.navigation() ?? []).find(
      (entry: NavigationType): boolean => entry.id === id,
    );
    const target: NavigationTarget | undefined =
      type?.target ?? (id === GLOBAL_ENTRY_ID ? type?.members[0] : undefined);
    if (target !== undefined) {
      this.goTo(target.selection.start);
    }
  }

  /**
   * Goes to the member chosen in the Member dropdown.
   * @param id The chosen member's identifier.
   */
  protected goToMember(id: string): void {
    const member: NavigationMember | undefined = this.currentType()?.members.find(
      (entry: NavigationMember): boolean => entry.id === id,
    );
    if (member !== undefined) {
      this.goTo(member.selection.start);
    }
  }

  /**
   * Folds every foldable region in the document.
   */
  protected foldAll(): void {
    this.runEditorAction('editor.foldAll');
  }

  /**
   * Unfolds every folded region in the document.
   */
  protected unfoldAll(): void {
    this.runEditorAction('editor.unfoldAll');
  }

  /**
   * Opens the editor's find, as ⌘F does.
   */
  protected find(): void {
    this.runEditorAction('actions.find');
  }

  /**
   * Turns Word Wrap on or off, editor-wide, as the ribbon's Word Wrap does.
   */
  private toggleWordWrap(): void {
    this.settings.updateTextEditorSettings({ wordWrap: !this.wordWrap() });
  }

  /**
   * Runs a command chosen from the strip's menu.
   * @param id The chosen item's identifier.
   */
  protected onMenu(id: string): void {
    if (this.fileCommands.run(id, this.document()?.filePath() ?? null)) {
      return;
    }
    switch (id) {
      case MENU_GO_TO_SYMBOL:
        this.runEditorAction('editor.action.quickOutline');
        break;
      case MENU_GO_TO_LINE:
        this.runEditorAction('editor.action.gotoLine');
        break;
      case MENU_WORD_WRAP:
        this.toggleWordWrap();
        break;
      case MENU_MINIMAP:
        this.settings.updateTextEditorSettings({ showMinimap: !this.minimap() });
        break;
      case MENU_LINE_NUMBERS:
        this.settings.updateTextEditorSettings({ showLineNumbers: !this.lineNumbers() });
        break;
      default:
        break;
    }
  }

  /**
   * Gives the editor focus and runs one of Monaco's own actions in it.
   * @param action The action's identifier.
   */
  private runEditorAction(action: string): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null =
      this.core()?.getPane()?.getEditor() ?? null;
    if (editor === null) {
      return;
    }
    editor.focus();
    void editor.getAction(action)?.run();
  }

  /**
   * Puts the cursor at a place in the document, scrolls it into view, and gives the editor focus, so
   * typing carries on from there.
   * @param position The place, zero-based.
   */
  private goTo(position: SymbolPosition): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null =
      this.core()?.getPane()?.getEditor() ?? null;
    if (editor === null) {
      return;
    }
    const target: MonacoApi.IPosition = {
      lineNumber: position.line + 1,
      column: position.character + 1,
    };
    editor.setPosition(target);
    editor.revealPositionInCenterIfOutsideViewport(target);
    editor.focus();
  }

  /**
   * Schedules a read of the document's symbols, replacing any already scheduled.
   * @param delay How long to wait first, in milliseconds.
   */
  private scheduleSymbols(delay: number): void {
    if (this.symbolsTimer !== null) {
      clearTimeout(this.symbolsTimer);
    }
    this.symbolsTimer = setTimeout((): void => {
      this.symbolsTimer = null;
      void this.readSymbols();
    }, delay);
  }

  /**
   * Reads the document's symbols from its language server into the dropdowns. A server that has not
   * answered is asked again a little later, a bounded number of times, since a heavy one answers
   * nothing until its project has loaded.
   */
  private async readSymbols(): Promise<void> {
    const model: MonacoApi.editor.ITextModel | null =
      this.core()?.getPane()?.getEditor()?.getModel() ?? null;
    if (model === null) {
      return;
    }
    const symbols: readonly CodeSymbol[] | null = await this.lspFeatures.documentSymbols(model);
    if (symbols === null) {
      this.unanswered += 1;
      // A server that is running but has not answered is being waited for; no server at all is
      // unavailable — still asked again for a while, since its session may be about to start.
      const serves: boolean = this.lspFeatures.servesDocument(model);
      this.navigationState.set(
        serves && this.unanswered <= SYMBOLS_RETRIES ? 'waiting' : 'unavailable',
      );
      if (this.unanswered <= SYMBOLS_RETRIES) {
        this.scheduleSymbols(SYMBOLS_RETRY_MS);
      } else {
        this.navigation.set(null);
      }
      return;
    }
    this.unanswered = 0;
    this.navigationState.set('ready');
    const document: CodeDocument | undefined = this.document();
    this.navigation.set(
      buildNavigation(
        symbols,
        document?.fileName() ?? '',
        qualifierFor(document?.language() ?? ''),
      ),
    );
  }

  /**
   * Records the caret position reported by the editor core, for the well status strip.
   * @param cursor The caret position.
   */
  protected onCursorChange(cursor: TextEditorCursor): void {
    this.caretSignal.set({ line: cursor.line, column: cursor.column });
  }

  /**
   * Reports whether this document's editor holds a selection, so controls acting on one (the agent's
   * Attach Selection) can offer themselves only when there is something to attach.
   * @param selected Whether the editor holds a non-empty selection.
   */
  protected onSelectionChange(selected: boolean): void {
    this.editorCommands.setSelectionState(this.documentId(), selected);
  }

  /**
   * Records the end-of-line sequence reported by the editor core, for the well status strip.
   * @param eol The end-of-line sequence.
   */
  protected onEolChange(eol: TextEditorEol): void {
    this.eolSignal.set(eol);
  }
}
