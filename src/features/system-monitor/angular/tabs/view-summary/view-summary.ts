import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';

/**
 * Describes one figure in a view's summary.
 */
export interface SummaryItem {
  /**
   * Gets the figure's label.
   */
  readonly label: string;

  /**
   * Gets the figure's value.
   */
  readonly value: string;

  /**
   * Gets the status the figure is toned in (a warnings or errors count), or undefined for none. The
   * label names it too, so the tone is never alone.
   */
  readonly tone?: 'warning' | 'danger';
}

/**
 * Represents a System Monitor view's summary: its headline figures in one strip against the header's
 * right edge, each label over its value, a hairline between them. Every view's header uses it, so the
 * figures read the same wherever they are.
 */
@Component({
  selector: 'app-system-monitor-view-summary',
  templateUrl: './view-summary.html',
  styleUrl: './view-summary.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewSummary {
  /**
   * Gets the figures, in order.
   */
  public readonly items: InputSignal<readonly SummaryItem[]> =
    input.required<readonly SummaryItem[]>();

  /**
   * Gets the strip's accessible name.
   */
  public readonly ariaLabel: InputSignal<string> = input<string>('Summary');
}
