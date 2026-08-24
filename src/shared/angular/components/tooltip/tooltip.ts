import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';

/**
 * Represents the bubble a {@link TooltipTrigger} shows beneath its control: the control's name, drawn
 * where a sighted user can read it.
 *
 * Deliberately presentational and `aria-hidden`. The name it shows is already the control's accessible
 * name — a screen reader reads that from the control itself — so announcing the bubble as well would
 * say everything twice.
 */
@Component({
  selector: 'app-tooltip',
  imports: [],
  templateUrl: './tooltip.html',
  styleUrl: './tooltip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
  },
})
export class Tooltip {
  /**
   * Gets the text shown in the bubble.
   */
  public readonly text: InputSignal<string> = input.required<string>();
}
