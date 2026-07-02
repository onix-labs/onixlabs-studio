import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { CodeDocument, Documents } from '@shared/angular/services/documents/documents';
import { MarkdownDocument } from '../markdown-document/markdown-document';

/**
 * Sentinel word count for an empty document.
 */
const NO_WORDS: number = 0;

/**
 * Represents the lean markdown surface mounted in a workspace document well: the shared
 * {@link MarkdownDocument} core with a compact toolstrip (document name, unsaved indicator, save) and
 * a status strip (word count). It is deliberately spare — unlike the full markdown tab view it carries
 * no ribbon and no outline/review/reader tool panels — because the well is a secondary editing surface
 * beside the workspace tree. The editor is fully editable, as in a tab.
 */
@Component({
  selector: 'app-markdown-document-panel',
  imports: [MarkdownDocument],
  templateUrl: './markdown-document-panel.html',
  styleUrl: './markdown-document-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownDocumentPanel {
  /**
   * Holds the documents service backing the hosted document's name, dirty state, content and save.
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
   * Gets the number of whitespace-separated words in the document's markdown source.
   */
  protected readonly wordCount: Signal<number> = computed((): number => {
    const content: string = this.document()?.content()?.trim() ?? '';
    return content.length === 0 ? NO_WORDS : content.split(/\s+/).length;
  });

  /**
   * Saves the hosted document, prompting for a path when it has never been saved.
   */
  protected onSave(): void {
    void this.documents.save(this.documentId());
  }
}
