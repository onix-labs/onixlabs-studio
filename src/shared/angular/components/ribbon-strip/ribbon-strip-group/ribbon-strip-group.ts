import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';

/**
 * Represents a titled group of related controls within the ribbon strip.
 */
@Component({
  selector: 'app-ribbon-strip-group',
  imports: [],
  templateUrl: './ribbon-strip-group.html',
  styleUrl: './ribbon-strip-group.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RibbonStripGroup {
  /**
   * Gets the title displayed beneath the group's controls.
   */
  public readonly title: InputSignal<string> = input.required<string>();
}
