import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';

/**
 * Represents a titled group of related controls within the ribbon strip.
 */
@Component({
  selector: 'app-ribbon-group',
  imports: [],
  templateUrl: './ribbon-group.html',
  styleUrl: './ribbon-group.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RibbonGroup {
  /**
   * Gets the title displayed beneath the group's controls.
   */
  public readonly title: InputSignal<string> = input.required<string>();
}
