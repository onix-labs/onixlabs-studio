import { Service, signal, WritableSignal } from '@angular/core';
import type { DiagnosticSeverity } from '@shared/angular/services/diagnostics/diagnostics';

/**
 * Names the severities the Error List can be narrowed to, or all of them.
 */
export type SeverityFilter = 'all' | DiagnosticSeverity;

/**
 * Remembers the Error List's grouping and severity filter for the session, so a panel closed and
 * opened again keeps them. Not persisted — a fresh launch starts grouped, showing everything.
 */
@Service()
export class ProblemsPanelOptions {
  /**
   * Gets whether the list is grouped by project and file (#1182), or flat.
   */
  public readonly grouped: WritableSignal<boolean> = signal<boolean>(true);

  /**
   * Gets the selected severity filter.
   */
  public readonly severity: WritableSignal<SeverityFilter> = signal<SeverityFilter>('all');
}
