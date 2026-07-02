import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { DockPanel } from '../../../services/dock/dock-panel';
import { DockState } from '../../../services/dock/dock-state';
import { findStackOfPanel } from '../../../services/dock/dock-tree';
import { Documents } from '@shared/angular/services/documents/documents';
import { CodeView } from '../../views/code-view/code-view';
import { MarkdownView } from '../../views/markdown-view/markdown-view';

/**
 * Hosts an open file inside a workspace's document well. The dock panel id is the document id; this
 * resolves the right editor for it — the Milkdown editor for markdown, the Monaco editor otherwise —
 * reusing the same editor components as the standalone tabs. The dock keeps every well panel mounted,
 * so this passes the well's active state through to drive the editor's relayout and focus.
 */
@Component({
  selector: 'app-document-panel',
  imports: [CodeView, MarkdownView],
  templateUrl: './document-panel.html',
  styleUrl: './document-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentPanel {
  /**
   * Gets the dock panel descriptor; its id is the document id this panel hosts.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Holds the document model backing the hosted editor.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds the dock layout used to derive whether this document is the active one in its well.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Gets the hosted document's id.
   */
  public readonly documentId: Signal<string> = computed((): string => this.panel().id);

  /**
   * Gets whether the hosted file is markdown (and so uses the Milkdown editor).
   */
  public readonly isMarkdown: Signal<boolean> = computed(
    (): boolean => this.documents.get(this.panel().id)?.language() === 'markdown',
  );

  /**
   * Gets whether this document is the active one in its well, so the editor relayouts and focuses.
   */
  public readonly isActive: Signal<boolean> = computed((): boolean => {
    const id: string = this.panel().id;
    return findStackOfPanel(this.dockState.layout(), id)?.active === id;
  });

  /**
   * Gets the markdown editor's initial content, seeded from the document.
   * @returns Returns the document's initial content.
   */
  public markdownContent(): string {
    return this.documents.initialContentOf(this.panel().id);
  }

  /**
   * Records an edit to a markdown document so its dirty state and saves track the changes.
   * @param content The new markdown content.
   */
  public onMarkdownChange(content: string): void {
    this.documents.setContent(this.panel().id, content);
  }
}
