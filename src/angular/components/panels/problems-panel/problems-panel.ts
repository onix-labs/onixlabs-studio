import { ChangeDetectionStrategy, Component, inject, input, InputSignal } from '@angular/core';
import { DockPanel } from '../../../services/dock/dock-panel';
import {
  Diagnostic,
  DiagnosticSeverity,
  Diagnostics,
} from '../../../services/diagnostics/diagnostics';

/**
 * Maps each severity to its Tabler icon (without the leading `ti` base class).
 */
const SEVERITY_ICONS: Readonly<Record<DiagnosticSeverity, string>> = {
  error: 'ti-circle-x',
  warning: 'ti-alert-triangle',
  info: 'ti-info-circle',
  hint: 'ti-bulb',
};

/**
 * Renders the aggregated {@link Diagnostics} as the body of the Problems (Error List) dock panel: a
 * severity-sorted list of file/line/message rows with an error/warning summary. The dock chrome
 * supplies the title bar. Fed by the Monaco-markers provider today; future language back-ends add
 * more providers behind the same service.
 */
@Component({
  selector: 'app-problems-panel',
  imports: [],
  templateUrl: './problems-panel.html',
  styleUrl: './problems-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProblemsPanel {
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
   * Resolves the Tabler icon class for a diagnostic's severity.
   * @param severity The diagnostic severity.
   * @returns Returns the icon class.
   */
  public iconFor(severity: DiagnosticSeverity): string {
    return SEVERITY_ICONS[severity];
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
