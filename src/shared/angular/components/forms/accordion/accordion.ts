import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  model,
  ModelSignal,
} from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';

/**
 * Represents an expandable panel with a heading button and a collapsible body. Content marked
 * `accordionActions` is projected into the header beside the toggle — actions on the panel's subject,
 * such as deleting it — and the rest into the body.
 */
@Component({
  selector: 'app-accordion',
  imports: [AppIcon],
  templateUrl: './accordion.html',
  styleUrl: './accordion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.accordion--fill]': 'fill()',
  },
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
   * Gets the icon shown ahead of the heading, or undefined for none.
   */
  public readonly icon: InputSignal<Icon | undefined> = input<Icon | undefined>(undefined);

  /**
   * Gets the colour of the leading icon (any value {@link AppIcon} accepts), or undefined to inherit
   * the header's muted glyph colour.
   */
  public readonly iconColor: InputSignal<string | undefined> = input<string | undefined>(undefined);

  /**
   * Gets whether the heading is a section label: the small uppercase label that heads a section
   * elsewhere in the application (`.section-label`), rather than the row's own text. Defaults to false.
   */
  public readonly section: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets whether the accordion fills the height it is given, its body flush to its edges, for content
   * that scrolls on its own (a table whose header stays put). The host is a flex column, so its parent
   * decides the height. Defaults to false.
   */
  public readonly fill: InputSignal<boolean> = input<boolean>(false);

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
