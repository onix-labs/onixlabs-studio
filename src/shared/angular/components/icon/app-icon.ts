import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';

/**
 * Maps the named colours the {@link AppIcon} accepts as keywords to their CSS custom property.
 */
const NAMED_COLORS: Readonly<Record<string, string>> = {
  accent: '--accent-color',
  foreground: '--body-foreground-color',
  muted: '--form-muted-foreground-color',
};

/**
 * Renders an {@link Icon} from the application's icon set, decoupling templates from the underlying
 * icon library. The glyph and weight come from the {@link Icon} token; size, colour, and rotation
 * are presentational and chosen per instance.
 */
@Component({
  selector: 'app-icon',
  imports: [],
  templateUrl: './app-icon.html',
  styleUrl: './app-icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppIcon {
  /**
   * Gets the icon to render.
   */
  public readonly icon: InputSignal<Icon> = input.required<Icon>();

  /**
   * Gets the icon size in rem. When omitted, the icon inherits the ambient font size, matching the
   * behaviour of a bare glyph element.
   */
  public readonly size: InputSignal<number | undefined> = input<number | undefined>(undefined);

  /**
   * Gets the clockwise rotation of the icon in degrees.
   */
  public readonly rotation: InputSignal<number> = input<number>(0);

  /**
   * Gets the requested colour: a named keyword (`accent`, `foreground`, `muted`), a bare hex value
   * (`abc123`), or any CSS colour. When omitted, the icon inherits the current foreground colour, so
   * the host can drive it through the cascade (for example, an accent colour on hover).
   */
  public readonly color: InputSignal<string | undefined> = input<string | undefined>(undefined);

  /**
   * Gets the resolved CSS colour to apply, or null to inherit the current foreground colour.
   */
  protected readonly resolvedColor: Signal<string | null> = computed((): string | null => {
    const value: string | undefined = this.color();
    if (value === undefined || value.length === 0) {
      return null;
    }
    if (value in NAMED_COLORS) {
      return `var(${NAMED_COLORS[value]})`;
    }
    if (/^[0-9a-fA-F]{3,8}$/.test(value)) {
      return `#${value}`;
    }
    return value;
  });

  /**
   * Gets the CSS transform to apply, or null when the icon is not rotated.
   */
  protected readonly transform: Signal<string | null> = computed((): string | null =>
    this.rotation() === 0 ? null : `rotate(${this.rotation()}deg)`,
  );
}
