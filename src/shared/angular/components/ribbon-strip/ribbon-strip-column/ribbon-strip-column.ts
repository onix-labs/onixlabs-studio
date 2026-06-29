import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';

/**
 * Represents a vertical lane within a ribbon group, stacking its projected controls so that
 * different control types (large buttons, stacked small buttons, checks, fields) can sit
 * side by side within a single group.
 */
@Component({
  selector: 'app-ribbon-strip-column',
  imports: [],
  templateUrl: './ribbon-strip-column.html',
  styleUrl: './ribbon-strip-column.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.ribbon-column--spread]': 'spread()',
  },
})
export class RibbonStripColumn {
  /**
   * Gets a value indicating whether the column fills the group height and spaces its rows apart,
   * pinning the first row to the top and the last to the bottom (e.g. a field above a button row).
   */
  public readonly spread: InputSignal<boolean> = input<boolean>(false);
}
