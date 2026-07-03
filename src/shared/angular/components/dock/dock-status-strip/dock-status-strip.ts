import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import {
  DocumentStatus,
  DocumentStatusInfo,
} from '@shared/angular/services/document-status/document-status';

/**
 * Represents the status strip shown along the bottom of a document well. It summarises the active
 * document: the count of errors and warnings, the caret line and column, the language mode, the
 * end-of-line sequence, the encoding and the editor zoom level. The document-derived segments are fed
 * by the active surface through the shared {@link DocumentStatus} service; the error/warning counts
 * and zoom level remain stubbed until they are wired.
 */
@Component({
  selector: 'app-dock-status-strip',
  imports: [AppIcon],
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
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the active document's status, or null when no document is publishing.
   */
  protected readonly status: Signal<DocumentStatusInfo | null> = this.documentStatus.info;

  /**
   * Gets the stubbed number of errors found in the active document.
   */
  protected readonly errors: number = 0;

  /**
   * Gets the stubbed number of warnings found in the active document.
   */
  protected readonly warnings: number = 0;

  /**
   * Gets the stubbed editor zoom level, as a percentage.
   */
  protected readonly zoom: number = 100;
}
