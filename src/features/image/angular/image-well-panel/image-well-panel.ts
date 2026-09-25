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
  viewChild,
} from '@angular/core';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { findStackOfPanel } from '@shared/angular/services/dock-layout/dock-tree';
import {
  DocumentStatus,
  StatusDetail,
} from '@shared/angular/services/document-status/document-status';
import { RecentItems } from '@shared/angular/services/recent-items/recent-items';
import { Tab } from '@shared/angular/services/tabs/tab';
import { ImageDocument, ImageDocuments } from '../image-document/image-document';
import { formatFileSize, ImageSize } from '../image-geometry/image-geometry';
import { ImageToolstrip } from '../image-toolstrip/image-toolstrip';
import { ImageView } from '../image-view/image-view';

/**
 * Represents an image in a workspace's document well: the {@link ImageView} a tab shows, with the
 * image's commands on a strip above it (the ribbon on screen is the workspace's) and its format,
 * dimensions, file size and zoom on the well's status strip.
 *
 * Registered directly as the dock panel's component rather than through the text document panel,
 * which assumes every well document is text.
 */
@Component({
  selector: 'app-image-well-panel',
  imports: [ImageToolstrip, ImageView],
  template: `
    <div class="image-well-panel">
      <app-image-toolstrip [view]="view()" (openInTab)="openInTab()" />
      <app-image-view
        class="image-well-panel__view"
        host="well"
        [tabId]="panel().id"
        [isActive]="isActive()"
      />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        min-height: 0;
      }

      .image-well-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }

      .image-well-panel__view {
        flex: 1 1 auto;
        min-height: 0;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageWellPanel {
  /**
   * Gets the dock panel this component renders.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Holds the shared image documents.
   */
  private readonly documents: ImageDocuments = inject(ImageDocuments);

  /**
   * Holds the workspace's dock layout, to tell whether this panel is the one on screen in its well.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the well's status strip.
   */
  private readonly documentStatus: DocumentStatus = inject(DocumentStatus);

  /**
   * Holds the recent-items registry, updated when the image is opened in its own tab.
   */
  private readonly recentItems: RecentItems = inject(RecentItems);

  /**
   * Gets the image view.
   */
  protected readonly view: Signal<ImageView | undefined> = viewChild(ImageView);

  /**
   * Gets a value indicating whether the panel is the active one in its well.
   */
  protected readonly isActive: Signal<boolean> = computed((): boolean => {
    const id: string = this.panel().id;
    return findStackOfPanel(this.dockState.layout(), id)?.active === id;
  });

  /**
   * Initializes a new instance of the {@link ImageWellPanel} class, publishing the image's facts to
   * the well's status strip while the panel is the active document, and clearing them otherwise.
   */
  public constructor() {
    effect((): void => {
      const id: string = this.panel().id;
      const view: ImageView | undefined = this.view();
      const document: ImageDocument | undefined = view?.document();
      if (!this.isActive() || view === undefined || document === undefined) {
        this.documentStatus.clear(id);
        return;
      }
      this.documentStatus.set(id, {
        details: this.details(document, view),
        language: document.format,
      });
    });
    inject(DestroyRef).onDestroy((): void => this.documentStatus.clear(this.panel().id));
  }

  /**
   * Opens the image in its own top-level tab, which shares this panel's document.
   */
  protected openInTab(): void {
    const document: ImageDocument | undefined = this.view()?.document();
    if (document !== undefined) {
      const tab: Tab = this.documents.openTab(document.path);
      this.recentItems.record(document.path, tab.title, 'image');
    }
  }

  /**
   * Builds the status strip's facts about the image.
   * @param document The image.
   * @param view The view showing it.
   * @returns Returns the segments, in display order.
   */
  private details(document: ImageDocument, view: ImageView): readonly StatusDetail[] {
    const details: StatusDetail[] = [];
    const note: string | null = view.editingNote();
    if (note !== null) {
      details.push({ text: note, title: 'Editing' });
    }
    const size: ImageSize | null = document.size();
    if (size !== null) {
      details.push({ text: `${size.width} × ${size.height}`, title: 'Pixel dimensions' });
    }
    const fileSize: number | null = document.fileSize();
    if (fileSize !== null) {
      details.push({ text: formatFileSize(fileSize), title: 'File size' });
    }
    details.push({ text: view.zoomLabel(), title: 'Zoom' });
    return details;
  }
}
