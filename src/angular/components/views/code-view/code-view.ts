import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  InputSignal,
  OnDestroy,
  OnInit,
  signal,
  Signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { CodeCommandHandler, CodeCommands } from '../../../services/code-commands/code-commands';
import { CodeStatus } from '../../../services/code-status/code-status';
import { CodeTerminals, TerminalLayout } from '../../../services/code-terminals/code-terminals';
import { CodeDocument, Documents } from '../../../services/documents/documents';
import { Editors, RevealRequest } from '../../../services/editors/editors';
import { LspClient } from '../../../services/lsp/lsp-client';
import { Monaco } from '../../../services/monaco/monaco';
import { Settings, TextEditorSettings } from '../../../services/settings/settings';
import { Theme } from '../../../services/theme/theme';
import { ActiveWorkspace } from '../../../services/workspace/active-workspace';
import { CodeTerminalPanel } from './code-terminal-panel/code-terminal-panel';

/**
 * Identifies the source label passed to Monaco when triggering editor actions from the ribbon.
 */
const COMMAND_SOURCE: string = 'ribbon';

/**
 * Holds the minimum size, in pixels, of the docked terminal pane.
 */
const MIN_TERMINAL_SIZE: number = 80;

/**
 * Holds the maximum size, in pixels, of the docked terminal pane.
 */
const MAX_TERMINAL_SIZE: number = 1600;

/**
 * Holds the initial size, in pixels, of the docked terminal pane.
 */
const DEFAULT_TERMINAL_SIZE: number = 260;

/**
 * Represents the code editor view, hosting a Monaco editor bound to the owning tab's document.
 */
@Component({
  selector: 'app-code-view',
  imports: [CodeTerminalPanel],
  templateUrl: './code-view.html',
  styleUrl: './code-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeView implements OnInit, AfterViewInit, OnDestroy {
  /**
   * Holds the Monaco service used to load the editor and resolve options and themes.
   */
  private readonly monaco: Monaco = inject(Monaco);

  /**
   * Holds the settings service supplying editor preferences.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the theme service supplying the resolved light/dark mode.
   */
  private readonly theme: Theme = inject(Theme);

  /**
   * Holds the documents service owning the tab's content and file association.
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
   * Holds the cursor-position status publisher.
   */
  private readonly codeStatus: CodeStatus = inject(CodeStatus);

  /**
   * Holds the code command registry the ribbon routes editor commands through.
   */
  private readonly codeCommands: CodeCommands = inject(CodeCommands);

  /**
   * Holds the docked run-terminal panel state.
   */
  private readonly codeTerminals: CodeTerminals = inject(CodeTerminals);

  /**
   * Holds the size, in pixels, of the docked terminal pane.
   */
  private readonly terminalSizeSignal: WritableSignal<number> =
    signal<number>(DEFAULT_TERMINAL_SIZE);

  /**
   * Holds the splitter drag origin (pointer coordinate at drag start).
   */
  private dragOrigin: number = 0;

  /**
   * Holds the terminal pane size at the start of a splitter drag.
   */
  private dragOriginSize: number = 0;

  /**
   * Holds a reference to the element Monaco mounts into.
   */
  private readonly editorContainer: Signal<ElementRef<HTMLDivElement>> =
    viewChild.required<ElementRef<HTMLDivElement>>('editorContainer');

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
   * Holds the backing document, or null before initialisation.
   */
  private readonly document: WritableSignal<CodeDocument | null> = signal<CodeDocument | null>(
    null,
  );

  /**
   * Holds the Monaco editor instance, or null before creation and after disposal.
   */
  private editor: MonacoApi.editor.IStandaloneCodeEditor | null = null;

  /**
   * Holds the string form of the editor's model URI while registered, or null when not registered.
   */
  private modelUri: string | null = null;

  /**
   * Holds a value indicating whether the editor is ready for interaction.
   */
  private readonly editorReady: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds a value indicating whether the next model-content change should be ignored because it
   * originated from an external content update applied to the editor.
   */
  private ignoreNextChange: boolean = false;

  /**
   * Holds the command handler registered with the {@link CodeCommands} registry while active.
   */
  private commandHandler: CodeCommandHandler | null = null;

  /**
   * Initialises the view, wiring effects for live settings/theme, external content updates, language
   * changes, and activation.
   */
  public constructor() {
    effect((): void => {
      this.settings.textEditor();
      this.theme.resolvedMode();
      const document: CodeDocument | null = this.document();
      const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
      if (!this.editorReady() || editor === null || document === null) {
        return;
      }
      const resolved: TextEditorSettings = this.settings.resolveSettingsForLanguage(
        document.language(),
      );
      editor.updateOptions({
        lineNumbers: resolved.showLineNumbers ? 'on' : 'off',
        minimap: { enabled: resolved.showMinimap },
        renderLineHighlight: resolved.currentLineHighlight === 'filled' ? 'all' : 'line',
        wordWrap: resolved.wordWrap ? 'on' : 'off',
        stickyScroll: { enabled: resolved.stickyScroll },
        cursorBlinking: resolved.cursorBlinking,
        cursorSmoothCaretAnimation: resolved.cursorSmoothCaretAnimation,
        fontFamily: `"${resolved.fontFamily}", monospace`,
        fontSize: resolved.fontSize,
      });
      this.monaco
        .getMonaco()
        ?.editor.setTheme(this.monaco.getThemeName(resolved.currentLineHighlight));
    });

    effect((): void => {
      const document: CodeDocument | null = this.document();
      const content: string = document?.content() ?? '';
      const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
      if (!this.editorReady() || editor === null) {
        return;
      }
      if (editor.getValue() !== content) {
        this.ignoreNextChange = true;
        editor.setValue(content);
      }
    });

    effect((): void => {
      const document: CodeDocument | null = this.document();
      const language: string = document?.language() ?? 'plaintext';
      const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
      const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
      if (!this.editorReady() || editor === null || monaco === undefined) {
        return;
      }
      const model: MonacoApi.editor.ITextModel | null = editor.getModel();
      if (model !== null && model.getLanguageId() !== language) {
        monaco.editor.setModelLanguage(model, language);
      }
    });

    effect((): void => {
      const active: boolean = this.isActive();
      const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
      if (!this.editorReady() || editor === null) {
        return;
      }
      if (active) {
        editor.layout();
        this.registerCommandHandler();
        this.documents.setActiveDocument(this.tabId());
        const position: MonacoApi.Position | null = editor.getPosition();
        this.codeStatus.setPosition(
          position === null ? null : { line: position.lineNumber, column: position.column },
        );
        editor.focus();
      } else {
        if (this.commandHandler !== null) {
          this.codeCommands.unregister(this.commandHandler);
          this.commandHandler = null;
        }
        this.codeStatus.setPosition(null);
      }
    });

    // Keep this editor registered against its document, so global Monaco diagnostics resolve to a
    // file and a reveal can target it; re-runs when the file path or name changes (save/rename).
    effect((): void => {
      const document: CodeDocument | null = this.document();
      if (!this.editorReady() || this.modelUri === null || document === null) {
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
      const document: CodeDocument | null = this.document();
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
      const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
      if (request === null || !this.editorReady() || editor === null) {
        return;
      }
      if (request.documentId !== this.tabId()) {
        return;
      }
      editor.revealLineInCenter(request.line);
      editor.setPosition({ lineNumber: request.line, column: request.column });
      editor.focus();
    });
  }

  /**
   * Resolves the backing document for the owning tab.
   */
  public ngOnInit(): void {
    this.document.set(this.documents.ensure(this.tabId()));
  }

  /**
   * Loads Monaco if needed and creates the editor once the view's element is available.
   */
  public ngAfterViewInit(): void {
    void this.initEditor();
  }

  /**
   * Awaits the Monaco load, then creates the editor.
   * @returns Returns a promise that resolves once the editor has been created.
   */
  private async initEditor(): Promise<void> {
    await this.monaco.ensureLoaded();
    this.createEditor();
  }

  /**
   * Disposes the editor and releases the document when the view is torn down.
   */
  public ngOnDestroy(): void {
    this.disposeEditor();
    if (this.documents.activeDocumentId() === this.tabId()) {
      this.documents.setActiveDocument(null);
    }
    // Only release the document and run terminal when this view owns their lifecycle (standalone
    // tabs). In the dock well a destroy is a re-parent, not a close, so the workspace handles it.
    if (this.removeOnDestroy()) {
      this.activeWorkspace.clearRoot(this.tabId());
      this.lsp.closeDocument(this.tabId());
      this.documents.remove(this.tabId());
      this.codeTerminals.remove(this.tabId());
    }
  }

  /**
   * Gets a value indicating whether the docked terminal panel is mounted.
   * @returns Returns true when the panel has been shown at least once.
   */
  protected terminalMounted(): boolean {
    return this.codeTerminals.isMounted(this.tabId());
  }

  /**
   * Gets a value indicating whether the docked terminal panel is currently visible.
   * @returns Returns true when the panel is shown.
   */
  protected terminalVisible(): boolean {
    return this.codeTerminals.isVisible(this.tabId());
  }

  /**
   * Gets the editor/terminal layout for the tab.
   * @returns Returns the layout.
   */
  protected terminalLayout(): TerminalLayout {
    return this.codeTerminals.layout(this.tabId());
  }

  /**
   * Gets the size, in pixels, of the docked terminal pane.
   * @returns Returns the terminal pane size.
   */
  protected terminalSize(): number {
    return this.terminalSizeSignal();
  }

  /**
   * Begins a splitter drag that resizes the docked terminal pane.
   * @param event The originating pointer event.
   */
  protected onSplitterDown(event: MouseEvent): void {
    event.preventDefault();
    const horizontal: boolean = this.terminalLayout() === 'side-by-side';
    this.dragOrigin = horizontal ? event.clientX : event.clientY;
    this.dragOriginSize = this.terminalSizeSignal();

    const onMove: (move: MouseEvent) => void = (move: MouseEvent): void => {
      const position: number = horizontal ? move.clientX : move.clientY;
      const delta: number = this.dragOrigin - position;
      const next: number = Math.min(
        MAX_TERMINAL_SIZE,
        Math.max(MIN_TERMINAL_SIZE, this.dragOriginSize + delta),
      );
      this.terminalSizeSignal.set(next);
    };
    const onUp: () => void = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  /**
   * Creates the Monaco editor for the backing document.
   */
  private createEditor(): void {
    const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
    const document: CodeDocument | null = this.document();
    if (monaco === undefined || document === null) {
      return;
    }

    const language: string = document.language();
    this.editor = monaco.editor.create(this.editorContainer().nativeElement, {
      ...this.monaco.getEditorOptions(language),
      value: document.content(),
      language,
    });

    const model: MonacoApi.editor.ITextModel | null = this.editor.getModel();
    this.modelUri = model !== null ? model.uri.toString() : null;

    this.editor.onDidChangeModelContent((): void => {
      if (this.ignoreNextChange) {
        this.ignoreNextChange = false;
        return;
      }
      this.documents.setContent(this.tabId(), this.editor?.getValue() ?? '');
    });

    this.editor.onDidChangeCursorPosition(
      (event: MonacoApi.editor.ICursorPositionChangedEvent): void => {
        if (!this.isActive()) {
          return;
        }
        this.codeStatus.setPosition({
          line: event.position.lineNumber,
          column: event.position.column,
        });
      },
    );

    this.editorReady.set(true);
  }

  /**
   * Disposes the Monaco editor and releases the command handler.
   */
  private disposeEditor(): void {
    if (this.commandHandler !== null) {
      this.codeCommands.forget(this.commandHandler);
      this.commandHandler = null;
    }
    if (this.modelUri !== null) {
      this.editors.unregister(this.modelUri);
      this.modelUri = null;
    }
    if (this.editor !== null) {
      this.editor.dispose();
      this.editor = null;
    }
    this.editorReady.set(false);
  }

  /**
   * Registers the ribbon command handler, mapping each command to a Monaco editor action.
   */
  private registerCommandHandler(): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
    if (editor === null) {
      return;
    }

    this.commandHandler = {
      cut: (): void => this.trigger(editor, 'editor.action.clipboardCutAction'),
      copy: (): void => this.trigger(editor, 'editor.action.clipboardCopyAction'),
      paste: (): void => this.paste(editor),
      undo: (): void => this.trigger(editor, 'undo'),
      redo: (): void => this.trigger(editor, 'redo'),
      find: (): void => this.trigger(editor, 'actions.find'),
      formatDocument: (): void => this.trigger(editor, 'editor.action.formatDocument'),
      save: (): void => void this.documents.saveActive(),
      saveAs: (): void => void this.documents.saveActiveAs(),
      getText: (): string => editor.getValue(),
      replaceText: (text: string): void => this.replaceAll(editor, text),
    };

    this.codeCommands.register(this.commandHandler);
  }

  /**
   * Replaces the editor's full contents as a single undoable edit (used by the agent's in-app edit
   * capability).
   * @param editor The editor instance.
   * @param text The new text.
   */
  private replaceAll(editor: MonacoApi.editor.IStandaloneCodeEditor, text: string): void {
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    if (model === null) {
      return;
    }
    editor.executeEdits('agent', [{ range: model.getFullModelRange(), text }]);
  }

  /**
   * Focuses the editor and triggers a built-in Monaco action.
   * @param editor The editor instance.
   * @param action The Monaco action identifier.
   */
  private trigger(editor: MonacoApi.editor.IStandaloneCodeEditor, action: string): void {
    editor.focus();
    editor.trigger(COMMAND_SOURCE, action, null);
  }

  /**
   * Pastes the clipboard contents at the current selection, since Monaco has no paste trigger.
   * @param editor The editor instance.
   */
  private paste(editor: MonacoApi.editor.IStandaloneCodeEditor): void {
    editor.focus();
    void navigator.clipboard
      .readText()
      .then((text: string): void => {
        const selection: MonacoApi.Selection | null = editor.getSelection();
        if (selection !== null) {
          editor.executeEdits(COMMAND_SOURCE, [{ range: selection, text, forceMoveMarkers: true }]);
        }
      })
      .catch((): void => undefined);
  }
}
