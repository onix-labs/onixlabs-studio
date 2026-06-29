import {
  ChangeDetectionStrategy,
  Component,
  effect,
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
import {
  TextEditor,
  TextEditorCursor,
  TextEditorEol,
} from '@shared/angular/components/text-editor/text-editor';
import { ChangeMarginController } from '../../../services/change-margin/change-margin-controller';
import { ChangeMargins } from '../../../services/change-margin/change-margins';
import { CodeAgents } from '../../../services/code-agents/code-agents';
import { CodeCommandHandler, CodeCommands } from '../../../services/code-commands/code-commands';
import { CodeStatus, EndOfLine } from '../../../services/code-status/code-status';
import { CodeTerminals, TerminalLayout } from '../../../services/code-terminals/code-terminals';
import { CodeDocument, Documents } from '../../../services/documents/documents';
import { Editors, RevealRequest } from '@shared/angular/services/editors/editors';
import { LspClient } from '../../../services/lsp/lsp-client';
import { Theme } from '@shared/angular/services/theme/theme';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import { CodeAgentPanel } from './code-agent-panel/code-agent-panel';
import { CodeTerminalPanel } from './code-terminal-panel/code-terminal-panel';

/**
 * Holds the display name given to a new, unsaved code document (matching the markdown editor).
 */
const NEW_DOCUMENT_NAME: string = 'New Document';

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
 * Holds the minimum size, in pixels, of the docked agent pane.
 */
const MIN_AGENT_SIZE: number = 240;

/**
 * Holds the maximum size, in pixels, of the docked agent pane.
 */
const MAX_AGENT_SIZE: number = 900;

/**
 * Holds the initial size, in pixels, of the docked agent pane.
 */
const DEFAULT_AGENT_SIZE: number = 360;

/**
 * Represents the code editor view: the shared {@link TextEditor} pane bound to the owning tab's
 * document, with optional docked run-terminal and agent panels beside it. It owns the code-tab
 * concerns the bare pane does not — the backing document and save state, the change-margin save
 * gutter, the model-URI registration, language-server sync, the ribbon command handler, the status
 * segment, and the docked panels and their splitters — driving the pane through its imperative API.
 */
@Component({
  selector: 'app-code-view',
  imports: [TextEditor, CodeTerminalPanel, CodeAgentPanel],
  templateUrl: './code-view.html',
  styleUrl: './code-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeView implements OnInit, OnDestroy {
  /**
   * Holds the theme service supplying the resolved light/dark mode (for the change-margin colours).
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
   * Holds the code editor status publisher (path, cursor, line-ending, encoding).
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
   * Holds the docked agent-panel state.
   */
  private readonly codeAgents: CodeAgents = inject(CodeAgents);

  /**
   * Holds the change-margin registry that draws the editor's save-state gutter bars.
   */
  private readonly changeMargins: ChangeMargins = inject(ChangeMargins);

  /**
   * Holds the shared text-editor pane this view drives, or undefined before the view initialises.
   */
  private readonly editorPane: Signal<TextEditor | undefined> = viewChild<TextEditor>(TextEditor);

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
   * Holds the size, in pixels, of the docked terminal pane.
   */
  private readonly terminalSizeSignal: WritableSignal<number> =
    signal<number>(DEFAULT_TERMINAL_SIZE);

  /**
   * Holds the size, in pixels, of the docked agent pane.
   */
  private readonly agentSizeSignal: WritableSignal<number> = signal<number>(DEFAULT_AGENT_SIZE);

  /**
   * Holds the splitter drag origin (pointer coordinate at drag start).
   */
  private dragOrigin: number = 0;

  /**
   * Holds the pane size at the start of a splitter drag.
   */
  private dragOriginSize: number = 0;

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
   * Holds the string form of the pane's model URI while registered, or null when not registered.
   */
  private modelUri: string | null = null;

  /**
   * Holds a value indicating whether the pane's editor instance has been created.
   */
  private readonly paneReady: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the command handler registered with the {@link CodeCommands} registry while active.
   */
  private commandHandler: CodeCommandHandler | null = null;

  /**
   * Holds the change-margin controller drawing the save-state gutter bars, or null before the editor
   * is created and after disposal.
   */
  private changeMargin: ChangeMarginController | null = null;

  /**
   * Initialises the view, wiring the feature effects that compose against the editor pane.
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
      const document: CodeDocument | null = this.document();
      const savedContent: string = document?.savedContent() ?? '';
      const hasSavedVersion: boolean = (document?.filePath() ?? null) !== null;
      if (!this.paneReady()) {
        return;
      }
      this.changeMargin?.setBaseline(savedContent, hasSavedVersion);
    });

    // Register/deactivate the ribbon command handler with activation, and mark the active document.
    effect((): void => {
      const active: boolean = this.isActive();
      if (active && this.paneReady()) {
        if (this.commandHandler === null) {
          this.registerCommandHandler();
        }
        this.documents.setActiveDocument(this.tabId());
      } else if (this.commandHandler !== null) {
        this.codeCommands.deactivate(this.tabId());
        this.commandHandler = null;
      }
    });

    // Publish the active editor's context (path, cursor, line-ending, encoding) to the status strip.
    // Reads the document's path/encoding signals so it refreshes on save and rename, and the local
    // caret/eol signals fed by the pane's cursor and content outputs. Clears when not active.
    effect((): void => {
      const document: CodeDocument | null = this.document();
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
      const document: CodeDocument | null = this.document();
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
      const pane: TextEditor | undefined = this.editorPane();
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
   * Resolves the backing document for the owning tab.
   */
  public ngOnInit(): void {
    this.document.set(this.documents.ensure(this.tabId(), NEW_DOCUMENT_NAME));
  }

  /**
   * Detaches the change-margin, releases the command handler, and unregisters the editor when the
   * view is torn down, then releases the document when this view owns its lifecycle. The pane disposes
   * the Monaco editor itself.
   */
  public ngOnDestroy(): void {
    if (this.changeMargin !== null) {
      this.changeMargins.detach(this.changeMargin);
      this.changeMargin = null;
    }
    if (this.commandHandler !== null) {
      this.codeCommands.forget(this.tabId());
      this.commandHandler = null;
    }
    if (this.modelUri !== null) {
      this.editors.unregister(this.modelUri);
      this.modelUri = null;
    }
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
      this.codeAgents.remove(this.tabId());
    }
  }

  /**
   * Gets the backing document, exposed for the template's content/language bindings.
   * @returns Returns the document, or null before initialisation.
   */
  protected doc(): CodeDocument | null {
    return this.document();
  }

  /**
   * Wires the editor-instance features once the pane's editor exists: attaches the change-margin
   * gutter and captures the model URI for registration.
   */
  protected onEditorReady(): void {
    const pane: TextEditor | undefined = this.editorPane();
    const document: CodeDocument | null = this.document();
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
    }
    this.paneReady.set(true);
  }

  /**
   * Writes a user edit through to the backing document.
   * @param text The editor's new text.
   */
  protected onContentChange(text: string): void {
    this.documents.setContent(this.tabId(), text);
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
   * Gets a value indicating whether the docked agent panel is mounted.
   * @returns Returns true when the panel has been shown at least once.
   */
  protected agentMounted(): boolean {
    return this.codeAgents.isMounted(this.tabId());
  }

  /**
   * Gets a value indicating whether the docked agent panel is currently visible.
   * @returns Returns true when the panel is shown.
   */
  protected agentVisible(): boolean {
    return this.codeAgents.isVisible(this.tabId());
  }

  /**
   * Gets the size, in pixels, of the docked agent pane.
   * @returns Returns the agent pane size.
   */
  protected agentSize(): number {
    return this.agentSizeSignal();
  }

  /**
   * Begins a splitter drag that resizes the docked agent pane. The agent always docks to the right,
   * so the drag is horizontal: moving the splitter left widens the agent.
   * @param event The originating pointer event.
   */
  protected onAgentSplitterDown(event: MouseEvent): void {
    event.preventDefault();
    this.dragOrigin = event.clientX;
    this.dragOriginSize = this.agentSizeSignal();

    const onMove: (move: MouseEvent) => void = (move: MouseEvent): void => {
      const delta: number = this.dragOrigin - move.clientX;
      const next: number = Math.min(
        MAX_AGENT_SIZE,
        Math.max(MIN_AGENT_SIZE, this.dragOriginSize + delta),
      );
      this.agentSizeSignal.set(next);
    };
    const onUp: () => void = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  /**
   * Registers the ribbon command handler, mapping each command to the pane's editor API.
   */
  private registerCommandHandler(): void {
    const pane: TextEditor | undefined = this.editorPane();
    if (pane === undefined) {
      return;
    }

    this.commandHandler = {
      cut: (): void => pane.trigger('editor.action.clipboardCutAction'),
      copy: (): void => pane.trigger('editor.action.clipboardCopyAction'),
      paste: (): void => pane.paste(),
      undo: (): void => pane.trigger('undo'),
      redo: (): void => pane.trigger('redo'),
      find: (): void => pane.trigger('actions.find'),
      formatDocument: (): void => pane.trigger('editor.action.formatDocument'),
      save: (): void => void this.documents.saveActive(),
      saveAs: (): void => void this.documents.saveActiveAs(),
      getText: (): string => pane.getValue(),
      replaceText: (text: string): void => pane.replaceAll(text),
    };

    this.codeCommands.register(this.tabId(), this.commandHandler);
  }
}
