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
import { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';
import { MarkdownToolstrip } from '@shared/angular/components/markdown-toolstrip/markdown-toolstrip';
import { CodeDocument, Documents } from '@shared/angular/services/documents/documents';
import { DocumentStatus } from '@shared/angular/services/document-status/document-status';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { MarkdownDocument } from '@features/markdown/angular/markdown-document/markdown-document';
import {
  computeMarkdownStats,
  MarkdownStats,
} from '@features/markdown/angular/markdown-status/markdown-status';

/**
 * Represents the lean markdown surface mounted in a workspace document well: the shared
 * {@link MarkdownDocument} core. Unlike the full markdown tab view it carries no ribbon and no
 * outline/review/reader tool panels — because the well is a secondary editing surface beside the
 * workspace tree — but it does mount the shared {@link MarkdownToolstrip} over the editor, so the
 * basic formatting capabilities the ribbon would otherwise provide are still reachable here. It shows
 * no inline status strip: the dock supplies the tab header and, while this panel is the active
 * document, it publishes its word count, read time, language and encoding to the shared
 * {@link DocumentStatus} so the well's status strip renders them. The editor is fully editable, as in
 * a tab.
 */
@Component({
  selector: 'app-markdown-document-panel',
  imports: [MarkdownDocument, MarkdownToolstrip],
  templateUrl: './markdown-document-panel.html',
  styleUrl: './markdown-document-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownDocumentPanel {
  /**
   * Holds the document core hosting the shared editor pane.
   */
  private readonly core: Signal<MarkdownDocument | undefined> =
    viewChild<MarkdownDocument>(MarkdownDocument);

  /**
   * Holds the editor pane the toolstrip drives, captured once the pane's editor is ready (and again
   * after a recreate for external content).
   */
  protected readonly pane: WritableSignal<MarkdownEditor | undefined> = signal<
    MarkdownEditor | undefined
  >(undefined);

  /**
   * Captures the ready pane for the toolstrip.
   */
  protected onEditorReady(): void {
    this.pane.set(this.core()?.getPane());
  }

  /**
   * Gets whether the backing document has a file path, and so can also be opened as its own tab.
   */
  protected readonly hasFilePath: Signal<boolean> = computed(
    (): boolean => (this.document()?.filePath() ?? null) !== null,
  );

  /**
   * Opens the well document's file as a standalone markdown tab, so it can be edited with the full
   * tab chrome (ribbon and tool panels).
   */
  protected onOpenInTab(): void {
    const path: string | null = this.document()?.filePath() ?? null;
    if (path === null) {
      return;
    }
    void this.fileOpener.reopenFile(path);
  }
  /**
   * Holds the documents service backing the hosted document's content, language and encoding.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds the well status strip this panel publishes to while it is the active document.
   */
  private readonly documentStatus: DocumentStatus = inject(DocumentStatus);

  /**
   * Holds the file opener backing the toolstrip's open-in-tab action.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

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
