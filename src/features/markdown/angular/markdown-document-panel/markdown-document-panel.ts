import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { CodeDocument, Documents } from '@shared/angular/services/documents/documents';
import { DocumentStatus } from '@shared/angular/services/document-status/document-status';
import { MarkdownDocument } from '@features/markdown/angular/markdown-document/markdown-document';
import {
  computeMarkdownStats,
  MarkdownStats,
} from '@features/markdown/angular/markdown-status/markdown-status';

/**
 * Represents the lean markdown surface mounted in a workspace document well: the shared
 * {@link MarkdownDocument} core. Unlike the full markdown tab view it carries no ribbon and no
 * outline/review/reader tool panels — because the well is a secondary editing surface beside the
 * workspace tree — and it shows neither a file toolstrip nor an inline status strip: the dock supplies
 * the tab header and, while this panel is the active document, it publishes its word count, read time,
 * language and encoding to the shared {@link DocumentStatus} so the well's status strip renders them.
 * The editor is fully editable, as in a tab.
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
   * Holds the documents service backing the hosted document's content, language and encoding.
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
   * Initializes a new instance of the {@link MarkdownDocumentPanel} class, publishing its status to
   * the well status strip while it is the active document and clearing it when it is not or is
   * destroyed.
   */
  public constructor() {
    const destroyRef: DestroyRef = inject(DestroyRef);
    effect((): void => {
      const document: CodeDocument | undefined = this.document();
      if (!this.isActive() || document === undefined) {
        this.documentStatus.clear(this.documentId());
        return;
      }
      const stats: MarkdownStats = computeMarkdownStats(document.content());
      const encoding: string = document.encoding();
      this.documentStatus.set(this.documentId(), {
        words: stats.words,
        readMinutes: stats.readMinutes,
        language: document.language(),
        encoding: document.hasBom() ? `${encoding} with BOM` : encoding,
      });
    });

    destroyRef.onDestroy((): void => {
      this.documentStatus.clear(this.documentId());
    });
  }
}
