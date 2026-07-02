import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
import { CodeDocumentEditor } from '../code-document/code-document';

/**
 * Represents the lean code surface mounted in a workspace document well: the shared
 * {@link CodeDocumentEditor} core with a compact toolstrip (document name, unsaved indicator, save) and
 * a status strip (cursor position, language, line-ending). It is deliberately spare — unlike the full
 * code tab view it carries no ribbon and no docked terminal/agent panels — because the well is a
 * secondary editing surface beside the workspace tree. The editor is fully editable, as in a tab. The
 * status strip renders inline here rather than through the shared {@link CodeStatus} publisher, which
 * targets the shell status bar owned by the enclosing workspace tab.
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
   * Holds the documents service backing the hosted document's name, dirty state, language and save.
   */
  private readonly documents: Documents = inject(Documents);

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
   * Holds the editor's cursor position, or null before the editor reports one, for the status strip.
   */
  private readonly caretSignal: WritableSignal<{ line: number; column: number } | null> = signal<{
    line: number;
    column: number;
  } | null>(null);

  /**
   * Holds the document's end-of-line sequence, for the status strip.
   */
  private readonly eolSignal: WritableSignal<TextEditorEol> = signal<TextEditorEol>('LF');

  /**
   * Gets the hosted document's display file name.
   */
  protected readonly fileName: Signal<string> = computed(
    (): string => this.document()?.fileName() ?? '',
  );

  /**
   * Gets a value indicating whether the document has unsaved changes.
   */
  protected readonly dirty: Signal<boolean> = computed(
    (): boolean => this.document()?.dirty() ?? false,
  );

  /**
   * Gets the hosted document's language identifier, shown in the status strip.
   */
  protected readonly language: Signal<string> = computed(
    (): string => this.document()?.language() ?? 'plaintext',
  );

  /**
   * Gets the editor's cursor position, or null before the editor reports one.
   */
  protected readonly caret: Signal<{ line: number; column: number } | null> =
    this.caretSignal.asReadonly();

  /**
   * Gets the document's end-of-line sequence.
   */
  protected readonly eol: Signal<TextEditorEol> = this.eolSignal.asReadonly();

  /**
   * Saves the hosted document, prompting for a path when it has never been saved.
   */
  protected onSave(): void {
    void this.documents.save(this.documentId());
  }

  /**
   * Records the caret position reported by the editor core, for the status strip.
   * @param cursor The caret position.
   */
  protected onCursorChange(cursor: TextEditorCursor): void {
    this.caretSignal.set({ line: cursor.line, column: cursor.column });
  }

  /**
   * Records the end-of-line sequence reported by the editor core, for the status strip.
   * @param eol The end-of-line sequence.
   */
  protected onEolChange(eol: TextEditorEol): void {
    this.eolSignal.set(eol);
  }
}
