import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
  signal,
  Signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import {
  TextEditor,
  TextEditorCursor,
  TextEditorEol,
} from '@shared/angular/components/text-editor/text-editor';
import { CodeDocumentEditor } from '@features/code/angular/code-document/code-document';
import { ChangeMarginController } from '@features/code/angular/change-margin/change-margin-controller';
import { ChangeMargins } from '@features/code/angular/change-margin/change-margins';
import { CodeAgents } from '@features/code/angular/code-agents/code-agents';
import { CodeRunner } from '@features/code/angular/code-runner/code-runner';
import {
  EditorCommandHandler,
  EditorCommands,
} from '@shared/angular/services/editor-commands/editor-commands';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { CodeStatus, EndOfLine } from '@features/code/angular/code-status/code-status';
import { EditorTerminals } from '@shared/angular/services/editor-terminals/editor-terminals';
import { CodeDocument, Documents } from '@shared/angular/services/documents/documents';
import { Editors, RevealRequest } from '@shared/angular/services/editors/editors';
import { LspClient } from '@shared/angular/services/lsp/lsp-client';
import { Theme } from '@shared/angular/services/theme/theme';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import { Panel } from '@shared/angular/components/panel-layout/panel';
import { PanelEdge } from '@shared/angular/components/panel-layout/panel-types';
import type * as MonacoApi from 'monaco-editor';
import { PanelLayout } from '@shared/angular/components/panel-layout/panel-layout';
import { FindPanel } from '@shared/angular/components/find-panel/find-panel';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { CodeFindAdapter } from '@features/code/angular/find/code-find-adapter';
import { CodeAgentPanel } from './code-agent-panel/code-agent-panel';
import { CodeTerminalPanel } from './code-terminal-panel/code-terminal-panel';

/**
 * Represents the code editor view: the document-bound {@link CodeDocumentEditor} core (the shared
 * text-editor pane wired to its backing document), with optional docked run-terminal, agent and find
 * panels around it. It owns the code-tab concerns the core does not — the change-margin save gutter,
 * the model-URI registration, language-server sync, the ribbon command handler, the status segment,
 * and the docked panels — reading the core's document and driving its pane through its imperative
 * API. Where each panel docks is the user's choice, dragged and persisted through the shared panel
 * layout.
 */
@Component({
  selector: 'app-code-view',
  imports: [PanelLayout, Panel, CodeDocumentEditor, CodeTerminalPanel, CodeAgentPanel, FindPanel],
  templateUrl: './code-view.html',
  styleUrl: './code-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeView implements OnDestroy {
  /**
   * Holds the theme service supplying the resolved light/dark mode (for the change-margin colours).
   */
  private readonly theme: Theme = inject(Theme);

  /**
   * Holds the documents service the ribbon's save commands target.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds the root editor registry this view registers its model with, so diagnostics resolve to a
   * document and a reveal request can target this editor.
   */
  private readonly editors: Editors = inject(Editors);

  /**
   * Holds the language-server client this view keeps its document synchronised with, so the workspace
   * receives language-server diagnostics for the file.
   */
  private readonly lsp: LspClient = inject(LspClient);

  /**
   * Holds the global active-workspace seam a standalone code tab publishes its file's session root to,
   * so the status strip's language-server menu can scope itself to the file's server while active.
   */
  private readonly activeWorkspace: ActiveWorkspace = inject(ActiveWorkspace);

  /**
   * Holds the code editor status publisher (path, cursor, line-ending, encoding).
   */
  private readonly codeStatus: CodeStatus = inject(CodeStatus);

  /**
   * Holds the code command registry the ribbon routes editor commands through.
   */
  private readonly editorCommands: EditorCommands = inject(EditorCommands);

  /**
   * Holds the application keybinding router this view registers its accelerators with while active.
   */
  private readonly keybindings: Keybindings = inject(Keybindings);

  /**
   * Holds the code runner the Run accelerator dispatches the active document through.
   */
  private readonly codeRunner: CodeRunner = inject(CodeRunner);

  /**
   * Holds the Monaco service, used to resolve the key codes for the find accelerator.
   */
  private readonly monaco: Monaco = inject(Monaco);

  /**
   * Holds the edges the integrated terminal panel may dock to. Unlike the other panels — restricted
   * to the sides — the terminal may also dock to the bottom, its default. A stable reference so the
   * panel's allowed-edge input does not change identity each check.
   */
  protected readonly terminalDockEdges: readonly PanelEdge[] = ['left', 'right', 'bottom'];

  /**
   * Holds a value indicating whether the find panel is shown for this editor.
   */
  protected readonly findVisible: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the find adapter the shared find panel drives, bound to this view's Monaco editor.
   */
  protected readonly findAdapter: CodeFindAdapter = new CodeFindAdapter(
    () => this.pane()?.getEditor() ?? null,
  );

  /**
   * Holds the docked run-terminal panel state.
   */
  private readonly editorTerminals: EditorTerminals = inject(EditorTerminals);

  /**
   * Holds the docked agent-panel state.
   */
  private readonly codeAgents: CodeAgents = inject(CodeAgents);

  /**
   * Holds the change-margin registry that draws the editor's save-state gutter bars.
   */
  private readonly changeMargins: ChangeMargins = inject(ChangeMargins);

  /**
   * Holds the document-bound code editor core this view drives, or undefined before the view
   * initialises.
   */
  private readonly documentCore: Signal<CodeDocumentEditor | undefined> =
    viewChild<CodeDocumentEditor>(CodeDocumentEditor);

  /**
   * Holds the editor's cursor position, or null when unknown, projected to the status strip.
   */
  private readonly caret: WritableSignal<{ line: number; column: number } | null> = signal<{
    line: number;
    column: number;
  } | null>(null);

  /**
   * Holds the document's end-of-line sequence, projected to the status strip.
   */
  private readonly eol: WritableSignal<EndOfLine> = signal<EndOfLine>('LF');

  /**
   * Gets the identifier of the owning tab, used to resolve the backing document.
   */
  public readonly tabId: InputSignal<string> = input.required<string>();

  /**
   * Gets a value indicating whether the view belongs to the active tab. Inactive views stay mounted
   * so their editor state is preserved, but they do not own the ribbon command handler or status.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets whether the backing document is released when this view is destroyed. True for standalone
   * editor tabs, whose destruction means the tab was closed. False inside the dock document well,
   * where a view is destroyed and recreated when its panel is re-parented (split or moved); there the
   * workspace owns document lifecycle and releases the document only when its panel actually closes.
   */
  public readonly removeOnDestroy: InputSignal<boolean> = input<boolean>(true);

  /**
   * Holds the string form of the pane's model URI while registered, or null when not registered.
   */
  private modelUri: string | null = null;

  /**
   * Holds a value indicating whether the pane's editor instance has been created.
   */
  private readonly paneReady: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the command handler registered with the {@link EditorCommands} registry while active.
   */
  private commandHandler: EditorCommandHandler | null = null;

  /**
   * Holds the change-margin controller drawing the save-state gutter bars, or null before the editor
   * is created and after disposal.
   */
  private changeMargin: ChangeMarginController | null = null;

  /**
   * Initialises the view, wiring the feature effects that compose against the editor core's document
   * and pane.
   */
  public constructor() {
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
      const document: CodeDocument | null = this.doc();
      const savedContent: string = document?.savedContent() ?? '';
      const hasSavedVersion: boolean = (document?.filePath() ?? null) !== null;
      if (!this.paneReady()) {
        return;
      }
      this.changeMargin?.setBaseline(savedContent, hasSavedVersion);
    });

    // Register/deactivate the ribbon command handler with activation. The core marks the active
    // document itself.
    effect((): void => {
      const active: boolean = this.isActive();
      if (active && this.paneReady()) {
        if (this.commandHandler === null) {
          this.registerCommandHandler();
        }
      } else if (this.commandHandler !== null) {
        this.editorCommands.deactivate(this.tabId());
        this.keybindings.deactivate(this.tabId());
        this.commandHandler = null;
      }
    });

    // Publish the active editor's context (path, cursor, line-ending, encoding) to the status strip.
    // Reads the document's path/encoding signals so it refreshes on save and rename, and the local
    // caret/eol signals fed by the pane's cursor and content outputs. Clears when not active.
    effect((): void => {
      const document: CodeDocument | null = this.doc();
      const caret: { line: number; column: number } | null = this.caret();
      if (!this.isActive() || document === null || caret === null) {
        this.codeStatus.clear(this.tabId());
        return;
      }
      const encoding: string = document.encoding();
      this.codeStatus.publish(this.tabId(), {
        path: document.filePath(),
        line: caret.line,
        column: caret.column,
        eol: this.eol(),
        encoding: document.hasBom() ? `${encoding} with BOM` : encoding,
      });
    });

    // Keep this editor registered against its document, so global Monaco diagnostics resolve to a
    // file and a reveal can target it; re-runs when the file path or name changes (save/rename).
    effect((): void => {
      const document: CodeDocument | null = this.doc();
      if (!this.paneReady() || this.modelUri === null || document === null) {
        return;
      }
      this.editors.register(this.modelUri, {
        documentId: this.tabId(),
        path: document.filePath(),
        name: document.fileName(),
      });
    });

    // Keep the language server in sync with this document's path, language, and text, so the
    // workspace receives live language-server diagnostics; re-runs on edits, save-as, and language
    // changes. Documents outside a workspace, untitled, or without a server are ignored by the client.
    effect((): void => {
      const document: CodeDocument | null = this.doc();
      if (document === null) {
        return;
      }
      this.lsp.syncDocument({
        documentId: this.tabId(),
        path: document.filePath(),
        languageId: document.language(),
        content: document.content(),
      });
      // A standalone code tab is its own top-level tab, so publish its file's server root for the
      // status strip's language-server menu. A docked editor is not a top-level tab (the directory
      // tab owns that), so it leaves the published root to its DirectoryView.
      if (this.removeOnDestroy()) {
        this.activeWorkspace.setRoot(this.tabId(), this.lsp.rootForDocument(this.tabId()));
      }
    });

    // Honour reveal requests aimed at this view's document, jumping the editor to the line.
    effect((): void => {
      const request: RevealRequest | null = this.editors.revealRequest();
      const pane: TextEditor | undefined = this.pane();
      if (request === null || !this.paneReady() || pane === undefined) {
        return;
      }
      if (request.documentId !== this.tabId()) {
        return;
      }
      pane.reveal(request.line, request.column);
    });
  }

  /**
   * Detaches the change-margin, releases the command handler, and unregisters the editor when the
   * view is torn down, then releases the feature-owned state when this view owns its lifecycle. The
   * document core releases the backing document and the pane disposes the Monaco editor themselves.
   */
  public ngOnDestroy(): void {
    if (this.changeMargin !== null) {
      this.changeMargins.detach(this.changeMargin);
      this.changeMargin = null;
    }
    if (this.commandHandler !== null) {
      this.editorCommands.forget(this.tabId());
      this.keybindings.forget(this.tabId());
      this.commandHandler = null;
    }
    if (this.modelUri !== null) {
      this.editors.unregister(this.modelUri);
      this.modelUri = null;
    }
    // Only release the language-server, workspace root, run terminal and agent when this view owns
    // their lifecycle (standalone tabs). In the dock well a destroy is a re-parent, not a close, so
    // the workspace handles it.
    if (this.removeOnDestroy()) {
      this.activeWorkspace.clearRoot(this.tabId());
      this.lsp.closeDocument(this.tabId());
      this.editorTerminals.remove(this.tabId());
      this.codeAgents.remove(this.tabId());
    }
  }

  /**
   * Wires the editor-instance features once the core's pane editor exists: attaches the change-margin
   * gutter and captures the model URI for registration.
   */
  protected onReady(): void {
    const pane: TextEditor | undefined = this.pane();
    const document: CodeDocument | null = this.doc();
    if (pane === undefined || document === null) {
      return;
    }
    this.modelUri = pane.getModelUri();
    const editor: ReturnType<TextEditor['getEditor']> = pane.getEditor();
    if (editor !== null) {
      // Seed the change margin with the document's saved baseline before the baseline/colour effects
      // run on paneReady becoming true. A document with no file path has no saved version yet.
      this.changeMargin = this.changeMargins.attach(
        editor,
        document.savedContent(),
        document.filePath() !== null,
      );
      this.bindFindAccelerator(editor);
    }
    this.paneReady.set(true);
  }

  /**
   * Rebinds the editor's Cmd/Ctrl+F to the shared find panel, replacing Monaco's built-in find widget
   * with the application's consistent panel. Monaco consumes the chord before it can reach the
   * application keybinding router, so it must be overridden on the editor instance here.
   * @param editor The Monaco editor to bind.
   */
  private bindFindAccelerator(editor: MonacoApi.editor.IStandaloneCodeEditor): void {
    const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
    if (monaco === undefined) {
      return;
    }
    editor.addAction({
      id: 'find-panel.open',
      label: 'Find',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF],
      run: (): void => this.toggleFind(),
    });
  }

  /**
   * Shows or hides the find panel.
   */
  protected toggleFind(): void {
    this.findVisible.update((visible: boolean): boolean => !visible);
  }

  /**
   * Shows the find panel (used by the ribbon's Find command, which should open rather than toggle it).
   */
  protected showFind(): void {
    this.findVisible.set(true);
  }

  /**
   * Hides the find panel when the shared panel asks to be dismissed.
   */
  protected onFindClosed(): void {
    this.findVisible.set(false);
  }

  /**
   * Records the caret position reported by the pane, for the status strip.
   * @param cursor The caret position.
   */
  protected onCursorChange(cursor: TextEditorCursor): void {
    this.caret.set({ line: cursor.line, column: cursor.column });
  }

  /**
   * Records the end-of-line sequence reported by the pane, for the status strip.
   * @param eol The end-of-line sequence.
   */
  protected onEolChange(eol: TextEditorEol): void {
    this.eol.set(eol);
  }

  /**
   * Gets a value indicating whether the docked terminal panel is mounted.
   * @returns Returns true when the panel has been shown at least once.
   */
  protected terminalMounted(): boolean {
    return this.editorTerminals.isMounted(this.tabId());
  }

  /**
   * Gets a value indicating whether the docked terminal panel is currently visible.
   * @returns Returns true when the panel is shown.
   */
  protected terminalVisible(): boolean {
    return this.editorTerminals.isVisible(this.tabId());
  }

  /**
   * Gets a value indicating whether the docked agent panel is currently visible.
   * @returns Returns true when the panel is shown.
   */
  protected agentVisible(): boolean {
    return this.codeAgents.isVisible(this.tabId());
  }

  /**
   * Gets the backing document from the editor core, for the view's feature effects.
   * @returns Returns the document, or null before the core initialises.
   */
  private doc(): CodeDocument | null {
    return this.documentCore()?.document() ?? null;
  }

  /**
   * Gets the shared text-editor pane through the document core, so this view can drive it through its
   * imperative API.
   * @returns Returns the pane, or undefined before the view initialises.
   */
  private pane(): TextEditor | undefined {
    return this.documentCore()?.getPane();
  }

  /**
   * Registers the ribbon command handler, mapping each command to the pane's editor API.
   */
  private registerCommandHandler(): void {
    const pane: TextEditor | undefined = this.pane();
    if (pane === undefined) {
      return;
    }

    this.commandHandler = {
      cut: (): void => pane.trigger('editor.action.clipboardCutAction'),
      copy: (): void => pane.trigger('editor.action.clipboardCopyAction'),
      paste: (): void => pane.paste(),
      undo: (): void => pane.trigger('undo'),
      redo: (): void => pane.trigger('redo'),
      find: (): void => this.showFind(),
      formatDocument: (): void => pane.trigger('editor.action.formatDocument'),
      codeCleanup: async (): Promise<void> => {
        // Sequenced, not fired together: organising imports rewrites the very lines the formatter
        // would otherwise lay out, so formatting has to see the tidied text.
        await pane.runAction('editor.action.organizeImports');
        await pane.runAction('editor.action.formatDocument');
      },
      save: (): void => void this.documents.saveActive(),
      saveAs: (): void => void this.documents.saveActiveAs(),
      getText: (): string => pane.getValue(),
      getSelectionText: (): string => pane.getSelectionText(),
      replaceText: (text: string): void => pane.replaceAll(text),
      replaceRange: (start: number, length: number, text: string): void =>
        pane.replaceRange(start, length, text),
    };

    this.editorCommands.register(this.tabId(), this.commandHandler);
    this.registerKeybindings();
  }

  /**
   * Registers the code editor's keyboard accelerators for the active tab. Only commands the Monaco
   * pane does not already bind are registered here — save and save-as, which the pane leaves to the
   * host — so the editor's own accelerators (find, undo, redo, clipboard) are left to compose.
   */
  private registerKeybindings(): void {
    this.keybindings.register(this.tabId(), [
      { id: 'code.save', command: (): void => this.editorCommands.save() },
      { id: 'code.saveAs', command: (): void => this.editorCommands.saveAs() },
      { id: 'code.run', command: (): void => this.run() },
    ]);
  }

  /**
   * Runs the active document in its docked terminal, matching the ribbon's Run action. Does nothing
   * when the document's language has no runner, so the accelerator is a safe no-op there rather than
   * falling through to the browser reload it overrides.
   */
  private run(): void {
    const document: CodeDocument | null = this.doc();
    if (document !== null) {
      void this.codeRunner.run(this.tabId(), document.language(), document.content());
    }
  }
}
