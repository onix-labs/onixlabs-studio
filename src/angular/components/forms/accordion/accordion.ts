import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  model,
  ModelSignal,
} from '@angular/core';
import { Icon } from '../../../icons/icon';
import { AppIcon } from '../../shared/icon/app-icon';

/**
 * Represents an expandable panel with a heading button and a collapsible body.
 */
@Component({
  selector: 'app-accordion',
  imports: [AppIcon],
  templateUrl: './accordion.html',
  styleUrl: './accordion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Accordion {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the heading shown on the panel's toggle button.
   */
  public readonly heading: InputSignal<string> = input.required<string>();

  /**
   * Gets or sets a value indicating whether the panel is expanded.
   */
  public readonly expanded: ModelSignal<boolean> = model<boolean>(false);

  /**
   * Toggles the panel between expanded and collapsed.
   */
  protected toggle(): void {
    this.expanded.update((expanded: boolean): boolean => !expanded);
  }
}
