import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Diagnostics } from '@shared/angular/services/diagnostics/diagnostics';
import { EditorZoom } from '@shared/angular/services/editor-zoom/editor-zoom';
import {
  DocumentStatus,
  DocumentStatusInfo,
} from '@shared/angular/services/document-status/document-status';

/**
 * Represents the status strip shown along the bottom of a document well. It summarises the active
 * document: the count of errors and warnings (from the workspace {@link Diagnostics} aggregate) and,
 * from the active surface via the shared {@link DocumentStatus} service, the caret line and column, the
 * language mode, the end-of-line sequence and the encoding. The zoom segment is a drop-up that shows
 * and sets the global {@link EditorZoom} level.
 */
@Component({
  selector: 'app-dock-status-strip',
  imports: [AppIcon, CdkMenuTrigger, CdkMenu, CdkMenuItem],
  templateUrl: './dock-status-strip.html',
  styleUrl: './dock-status-strip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DockStatusStrip {
  /**
   * Holds the source of the active document's status.
   */
  private readonly documentStatus: DocumentStatus = inject(DocumentStatus);

  /**
   * Holds the workspace diagnostics aggregate backing the error and warning counts.
   */
  private readonly diagnostics: Diagnostics = inject(Diagnostics);

  /**
   * Holds the global editor zoom shown and set by the zoom drop-up.
   */
  private readonly editorZoom: EditorZoom = inject(EditorZoom);

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the active document's status, or null when no document is publishing.
   */
  protected readonly status: Signal<DocumentStatusInfo | null> = this.documentStatus.info;

  /**
   * Gets the number of error-severity diagnostics in the workspace.
   */
  protected readonly errors: Signal<number> = this.diagnostics.errorCount;

  /**
   * Gets the number of warning-severity diagnostics in the workspace.
   */
  protected readonly warnings: Signal<number> = this.diagnostics.warningCount;

  /**
   * Gets the current editor zoom level, as a percentage.
   */
  protected readonly zoom: Signal<number> = this.editorZoom.percent;

  /**
   * Gets the selectable zoom levels, as percentages.
   */
  protected readonly zoomLevels: readonly number[] = this.editorZoom.levels;

  /**
   * Gets the position that opens the zoom menu upward from its trigger, right edges aligned.
   */
  protected readonly menuPosition: readonly ConnectedPosition[] = [
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom' },
  ];

  /**
   * Sets the global editor zoom to the given level.
   * @param percent The zoom level, as a percentage.
   */
  protected setZoom(percent: number): void {
    this.editorZoom.set(percent);
  }
}
