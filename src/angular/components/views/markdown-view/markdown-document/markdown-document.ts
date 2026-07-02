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
  Signal,
  viewChild,
} from '@angular/core';
import type { Selection } from '@milkdown/kit/prose/state';
import { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';
import { Documents } from '@shared/angular/services/documents/documents';

/**
 * Display name given to a new, unsaved markdown document.
 */
const NEW_MARKDOWN_DOCUMENT_NAME: string = 'New Document';

/**
 * Monaco language identifier applied to markdown documents, so a new document still serialises and
 * saves as markdown before it has a file extension.
 */
const MARKDOWN_LANGUAGE: string = 'markdown';

/**
 * Represents the document-bound markdown editor: the shared {@link MarkdownEditor} pane wired to its
 * backing document in the {@link Documents} service. This is the inner composition shared by the two
 * markdown leaves — the full markdown tab view and the lean document-well panel — owning exactly the
 * concerns both need: seeding the editor from the document, recording edits back to it, saving, the
 * document's language and lifecycle, and tracking the active document. It owns none of the surrounding
 * chrome (ribbon, tool panels, toolstrip, status), which each leaf adds around it.
 */
@Component({
  selector: 'app-markdown-document',
  imports: [MarkdownEditor],
  templateUrl: './markdown-document.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownDocument implements OnInit, OnDestroy {
  /**
   * Holds the documents service owning the backing document's content, file association and dirty
   * state.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds the shared markdown-editor pane this component drives, or undefined before the view
   * initialises.
   */
  private readonly editor: Signal<MarkdownEditor | undefined> =
    viewChild<MarkdownEditor>(MarkdownEditor);

  /**
   * Gets the identifier of the backing document, used to register the document and target saves at it.
   * For a standalone markdown tab this is the tab id; in a workspace's document well it is the well
   * document id.
   */
  public readonly documentId: InputSignal<string> = input.required<string>();

  /**
   * Gets whether the backing document is released when this component is destroyed. True for standalone
   * markdown tabs, whose destruction means the tab was closed. False inside the document well, where
   * the workspace owns the document's lifecycle and a destroy is a re-parent, not a close.
   */
  public readonly removeOnDestroy: InputSignal<boolean> = input<boolean>(true);

  /**
   * Gets a value indicating whether the editor is read-only.
   */
  public readonly readOnly: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets a value indicating whether the owning leaf belongs to the active tab or well slot. Inactive
   * editors stay mounted so their state is preserved.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits once the pane's editor instance has been created (and again after it is recreated for
   * external content), so the owning leaf can wire its editor-dependent state.
   */
  public readonly ready: OutputEmitterRef<void> = output<void>();

  /**
   * Emits the serialised markdown whenever the user edits the content, after it has been recorded to
   * the backing document.
   */
  public readonly contentChange: OutputEmitterRef<string> = output<string>();

  /**
   * Emits the editor's current selection whenever it changes, so the owning leaf can reflect it.
   */
  public readonly selectionChange: OutputEmitterRef<Selection> = output<Selection>();

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
   * Registers the backing document so saves target it, seeding a new markdown document with its display
   * name and language. An existing document (a file opened into the well) keeps its own name and
   * content.
   */
  public ngOnInit(): void {
    this.documents.ensure(this.documentId(), NEW_MARKDOWN_DOCUMENT_NAME);
    this.documents.setLanguage(this.documentId(), MARKDOWN_LANGUAGE);
  }

  /**
   * Clears the active-document focus and releases the backing document when this component owns its
   * lifecycle (a standalone tab). The pane destroys the Crepe editor itself.
   */
  public ngOnDestroy(): void {
    if (this.documents.activeDocumentId() === this.documentId()) {
      this.documents.setActiveDocument(null);
    }
    if (this.removeOnDestroy()) {
      this.documents.remove(this.documentId());
    }
  }

  /**
   * Gets the shared markdown-editor pane, so the owning leaf can drive it through its imperative API.
   * @returns Returns the pane, or undefined before the view initialises.
   */
  public getPane(): MarkdownEditor | undefined {
    return this.editor();
  }

  /**
   * Gets the markdown content the editor is initialised with, seeded from the backing document.
   * @returns Returns the document's initial content, or an empty string for a blank document.
   */
  protected initialContent(): string {
    return this.documents.initialContentOf(this.documentId());
  }

  /**
   * Gets the absolute directory of the backing document's file, against which a relative image source
   * resolves. Returns an empty string when the document has no path yet (an unsaved tab), in which case
   * relative images cannot be located until the document is saved. Bound to the pane's base directory.
   * @returns Returns the document's directory, or an empty string.
   */
  protected documentDirectory(): string {
    const filePath: string | null = this.documents.get(this.documentId())?.filePath() ?? null;
    if (filePath === null) {
      return '';
    }
    const separator: number = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    return separator < 0 ? '' : filePath.slice(0, separator);
  }

  /**
   * Re-emits the pane's ready event to the owning leaf.
   */
  protected onReady(): void {
    this.ready.emit();
  }

  /**
   * Records the user's edit to the backing document and re-emits it to the owning leaf.
   * @param markdown The editor's new serialised markdown.
   */
  protected onContentChange(markdown: string): void {
    this.documents.setContent(this.documentId(), markdown);
    this.contentChange.emit(markdown);
  }

  /**
   * Re-emits the pane's selection change to the owning leaf.
   * @param selection The editor's current selection.
   */
  protected onSelectionChange(selection: Selection): void {
    this.selectionChange.emit(selection);
  }

  /**
   * Saves the backing document when the pane requests it (the editor's Cmd/Ctrl+S shortcut).
   */
  protected onSaveRequested(): void {
    void this.documents.save(this.documentId());
  }
}
