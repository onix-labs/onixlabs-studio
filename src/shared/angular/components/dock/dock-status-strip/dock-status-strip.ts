import { CdkMenuTrigger } from '@angular/cdk/menu';
import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Menu, MenuItem } from '@shared/angular/components/menu/menu';
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
  imports: [AppIcon, CdkMenuTrigger, Menu],
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
   * Gets the selectable zoom levels as menu items, the current level marked active.
   */
  protected readonly zoomItems: Signal<readonly MenuItem[]> = computed((): readonly MenuItem[] =>
    this.editorZoom.levels.map(
      (level: number): MenuItem => ({
        id: String(level),
        label: `${level}%`,
        active: level === this.zoom(),
      }),
    ),
  );

  /**
   * Sets the global editor zoom to the chosen level.
   * @param id The chosen zoom level's id, a percentage.
   */
  protected setZoom(id: string): void {
    this.editorZoom.set(Number(id));
  }
}
