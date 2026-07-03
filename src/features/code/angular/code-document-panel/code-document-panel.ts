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
  WritableSignal,
} from '@angular/core';
import {
  TextEditorCursor,
  TextEditorEol,
} from '@shared/angular/components/text-editor/text-editor';
import { CodeDocument, Documents } from '@shared/angular/services/documents/documents';
import { DocumentStatus } from '@shared/angular/services/document-status/document-status';
import { CodeDocumentEditor } from '@features/code/angular/code-document/code-document';

/**
 * Represents the lean code surface mounted in a workspace document well: the shared
 * {@link CodeDocumentEditor} core with no chrome of its own. Unlike the full code tab view it carries no
 * ribbon and no docked terminal/agent panels — because the well is a secondary editing surface beside
 * the workspace tree — and it shows neither a file toolstrip nor an inline status strip: the dock
 * supplies the tab header and, while this panel is the active document, it publishes its caret
 * position, language, line-ending and encoding to the shared {@link DocumentStatus} so the well's
 * status strip renders them. The editor is fully editable, as in a tab.
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
   * Holds the well status strip this panel publishes to while it is the active document.
   */
  private readonly documentStatus: DocumentStatus = inject(DocumentStatus);

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
   * Holds the editor zoom level, as a percentage.
   */
  private readonly zoomSignal: WritableSignal<number> = signal<number>(100);

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
        zoom: this.zoomSignal(),
      });
    });
    destroyRef.onDestroy((): void => this.documentStatus.clear(this.documentId()));
  }

  /**
   * Records the caret position reported by the editor core, for the well status strip.
   * @param cursor The caret position.
   */
  protected onCursorChange(cursor: TextEditorCursor): void {
    this.caretSignal.set({ line: cursor.line, column: cursor.column });
  }

  /**
   * Records the end-of-line sequence reported by the editor core, for the well status strip.
   * @param eol The end-of-line sequence.
   */
  protected onEolChange(eol: TextEditorEol): void {
    this.eolSignal.set(eol);
  }

  /**
   * Records the editor zoom level reported by the editor core, for the well status strip.
   * @param zoom The zoom percentage.
   */
  protected onZoomChange(zoom: number): void {
    this.zoomSignal.set(zoom);
  }
}
