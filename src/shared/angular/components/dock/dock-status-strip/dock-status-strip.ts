import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Diagnostics } from '@shared/angular/services/diagnostics/diagnostics';
import {
  DocumentStatus,
  DocumentStatusInfo,
} from '@shared/angular/services/document-status/document-status';

/**
 * Represents the status strip shown along the bottom of a document well. It summarises the active
 * document: the count of errors and warnings (from the workspace {@link Diagnostics} aggregate) and,
 * from the active surface via the shared {@link DocumentStatus} service, the caret line and column, the
 * language mode, the end-of-line sequence, the encoding and the editor zoom level.
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
   * Holds the workspace diagnostics aggregate backing the error and warning counts.
   */
  private readonly diagnostics: Diagnostics = inject(Diagnostics);

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
}
