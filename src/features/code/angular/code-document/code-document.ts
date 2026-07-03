import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
  OnInit,
  output,
  OutputEmitterRef,
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

/**
 * Display name given to a new, unsaved code document (matching the markdown editor).
 */
const NEW_DOCUMENT_NAME: string = 'New Document';

/**
 * Represents the document-bound code editor: the shared {@link TextEditor} pane wired to its backing
 * document in the {@link Documents} service. This is the inner composition shared by the two code
 * leaves — the full code tab view and the lean document-well panel — owning exactly the concerns both
 * need: resolving the backing document, seeding the editor's content and language from it, recording
 * edits back to it, and tracking the active document over its lifecycle. It owns none of the
 * surrounding chrome (ribbon, docked panels, change-margin gutter, language-server sync, status), which
 * each leaf adds around it by reading the exposed document and driving the pane through its imperative
 * API.
 */
@Component({
  selector: 'app-code-document',
  imports: [TextEditor],
  templateUrl: './code-document.html',
  styleUrl: './code-document.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeDocumentEditor implements OnInit, OnDestroy {
  /**
   * Holds the documents service owning the backing document's content, file association and dirty
   * state.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds the shared text-editor pane this component drives, or undefined before the view initialises.
   */
  private readonly editor: Signal<TextEditor | undefined> = viewChild<TextEditor>(TextEditor);

  /**
   * Holds the backing document, or null before initialisation.
   */
  private readonly backingDocument: WritableSignal<CodeDocument | null> =
    signal<CodeDocument | null>(null);

  /**
   * Gets the identifier of the backing document, used to resolve the document and target edits at it.
   * For a standalone code tab this is the tab id; in a workspace's document well it is the well
   * document id.
   */
  public readonly documentId: InputSignal<string> = input.required<string>();

  /**
   * Gets whether the backing document is released when this component is destroyed. True for standalone
   * code tabs, whose destruction means the tab was closed. False inside the document well, where the
   * workspace owns the document's lifecycle and a destroy is a re-parent, not a close.
   */
  public readonly removeOnDestroy: InputSignal<boolean> = input<boolean>(true);

  /**
   * Gets a value indicating whether the owning leaf belongs to the active tab or well slot. Inactive
   * editors stay mounted so their state is preserved.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits once the pane's Monaco editor instance has been created, so the owning leaf can wire its
   * editor-dependent state.
   */
  public readonly ready: OutputEmitterRef<void> = output<void>();

  /**
   * Emits the editor's text whenever the user edits the content, after it has been recorded to the
   * backing document.
   */
  public readonly contentChange: OutputEmitterRef<string> = output<string>();

  /**
   * Emits the editor's caret position whenever it moves, so the owning leaf can reflect it.
   */
  public readonly cursorChange: OutputEmitterRef<TextEditorCursor> = output<TextEditorCursor>();

  /**
   * Emits the model's end-of-line sequence whenever it changes, so the owning leaf can reflect it.
   */
  public readonly eolChange: OutputEmitterRef<TextEditorEol> = output<TextEditorEol>();

  /**
   * Holds the document id captured at initialisation, so teardown releases exactly the document that
   * was resolved without re-reading the required {@link documentId} input during destruction.
   */
  private registeredDocumentId: string | null = null;

  /**
   * Initialises the component, wiring the effect that focuses the documents service on this document
   * while the owning leaf is active.
   */
  public constructor() {
    effect((): void => {
      if (this.isActive()) {
        this.documents.setActiveDocument(this.documentId());
      }
    });
  }

  /**
   * Resolves the backing document for the owning leaf, seeding a new code document with its display
   * name. An existing document (a file opened into the well) keeps its own name and content.
   */
  public ngOnInit(): void {
    this.registeredDocumentId = this.documentId();
    this.backingDocument.set(this.documents.ensure(this.documentId(), NEW_DOCUMENT_NAME));
  }

  /**
   * Clears the active-document focus and releases the backing document when this component owns its
   * lifecycle (a standalone tab). The pane disposes the Monaco editor itself. No-ops when the component
   * was never initialised (it has no resolved document to release).
   */
  public ngOnDestroy(): void {
    const id: string | null = this.registeredDocumentId;
    if (id === null) {
      return;
    }
    if (this.documents.activeDocumentId() === id) {
      this.documents.setActiveDocument(null);
    }
    if (this.removeOnDestroy()) {
      this.documents.remove(id);
    }
  }

  /**
   * Gets the backing document, so the owning leaf can drive its editor-instance features (change
   * margin, language-server sync, editor registration, status) from the document's signals.
   * @returns Returns the document, or null before initialisation.
   */
  public document(): CodeDocument | null {
    return this.backingDocument();
  }

  /**
   * Gets the shared text-editor pane, so the owning leaf can drive it through its imperative API.
   * @returns Returns the pane, or undefined before the view initialises.
   */
  public getPane(): TextEditor | undefined {
    return this.editor();
  }

  /**
   * Gets the backing document, exposed for the template's content and language bindings.
   * @returns Returns the document, or null before initialisation.
   */
  protected doc(): CodeDocument | null {
    return this.backingDocument();
  }

  /**
   * Re-emits the pane's ready event to the owning leaf.
   */
  protected onReady(): void {
    this.ready.emit();
  }

  /**
   * Records the user's edit to the backing document and re-emits it to the owning leaf.
   * @param text The editor's new text.
   */
  protected onContentChange(text: string): void {
    this.documents.setContent(this.documentId(), text);
    this.contentChange.emit(text);
  }

  /**
   * Re-emits the pane's caret position to the owning leaf.
   * @param cursor The caret position.
   */
  protected onCursorChange(cursor: TextEditorCursor): void {
    this.cursorChange.emit(cursor);
  }

  /**
   * Re-emits the pane's end-of-line sequence to the owning leaf.
   * @param eol The end-of-line sequence.
   */
  protected onEolChange(eol: TextEditorEol): void {
    this.eolChange.emit(eol);
  }
}
