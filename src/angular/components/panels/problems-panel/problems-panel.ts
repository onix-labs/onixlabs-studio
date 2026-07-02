import { ChangeDetectionStrategy, Component, inject, input, InputSignal } from '@angular/core';
import { DockPanel } from '../../../services/dock/dock-panel';
import {
  Diagnostic,
  DiagnosticSeverity,
  Diagnostics,
} from '@shared/angular/services/diagnostics/diagnostics';
import { Editors } from '@shared/angular/services/editors/editors';
import { FileOpener } from '../../../services/file-opener/file-opener';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';

/**
 * Maps each severity to its icon.
 */
const SEVERITY_ICONS: Readonly<Record<DiagnosticSeverity, Icon>> = {
  error: Icon.ERROR,
  warning: Icon.WARNING,
  info: Icon.INFO,
  hint: Icon.HINT,
};

/**
 * Renders the aggregated {@link Diagnostics} as the body of the Problems (Error List) dock panel: a
 * severity-sorted list of file/line/message rows with an error/warning summary. The dock chrome
 * supplies the title bar. Fed by the Monaco-markers provider today; future language back-ends add
 * more providers behind the same service.
 */
@Component({
  selector: 'app-problems-panel',
  imports: [AppIcon],
  templateUrl: './problems-panel.html',
  styleUrl: './problems-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProblemsPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the dock panel descriptor this body renders. Supplied by the dock outlet, which sets it on
   * every projected panel component; unused here because the dock chrome renders the title.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Gets the diagnostics aggregate rendered by this panel.
   */
  public readonly diagnostics: Diagnostics = inject(Diagnostics);

  /**
   * Holds the file opener used to activate the document a diagnostic belongs to.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Holds the editor registry used to reveal the diagnostic's line in its editor.
   */
  private readonly editors: Editors = inject(Editors);

  /**
   * Resolves the icon for a diagnostic's severity.
   * @param severity The diagnostic severity.
   * @returns Returns the severity icon.
   */
  public iconFor(severity: DiagnosticSeverity): Icon {
    return SEVERITY_ICONS[severity];
  }

  /**
   * Reveals a diagnostic in the editor: opens its file (so a build problem against a file that is not
   * yet open still opens it), then jumps the editor to the reported line and column when the document
   * is known. A diagnostic with neither a path nor an open document cannot be revealed.
   * @param diagnostic The diagnostic to reveal.
   */
  public reveal(diagnostic: Diagnostic): void {
    if (diagnostic.path !== null) {
      void this.fileOpener.openPath(diagnostic.path);
    }
    if (diagnostic.documentId !== null) {
      this.editors.requestReveal(diagnostic.documentId, diagnostic.line, diagnostic.column);
    }
  }

  /**
   * Builds a stable tracking key for a diagnostic row.
   * @param index The row index.
   * @param diagnostic The diagnostic.
   * @returns Returns the tracking key.
   */
  public trackBy(index: number, diagnostic: Diagnostic): string {
    return `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}:${diagnostic.message}`;
  }
}
