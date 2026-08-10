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
import { Editors } from '@shared/angular/services/editors/editors';
import { LspClient } from '@shared/angular/services/lsp/lsp-client';
import { CodeDocumentEditor } from '@features/code/angular/code-document/code-document';
import { ChangeMarginController } from '@features/code/angular/change-margin/change-margin-controller';
import { ChangeMargins } from '@features/code/angular/change-margin/change-margins';
import { Theme } from '@shared/angular/services/theme/theme';

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
  imports: [CodeDocumentEditor],
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

    destroyRef.onDestroy((): void => {
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
