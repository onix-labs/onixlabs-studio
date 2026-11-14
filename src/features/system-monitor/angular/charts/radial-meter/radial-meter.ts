import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  Signal,
} from '@angular/core';

/**
 * The meter's radius, in the 100 × 100 box it is drawn in.
 */
const RADIUS: number = 42;

/**
 * The meter's circumference, which the filled arc is a share of.
 */
const CIRCUMFERENCE: number = 2 * Math.PI * RADIUS;

/**
 * Identifies how severe a meter's reading is, which colours its fill.
 */
type MeterSeverity = 'normal' | 'warning' | 'danger';

/**
 * Represents a radial meter: one ratio against its limit, drawn as an arc over a lighter track of the
 * same hue, with the reading in the middle. The fill turns to the warning colour, then the danger
 * colour, as the reading crosses its thresholds, and the reading states its severity in words for
 * those who cannot tell the colours apart.
 *
 * A meter, not a pie: there is one value and its limit, so there is nothing to compare slice against
 * slice.
 */
@Component({
  selector: 'app-system-monitor-radial-meter',
  templateUrl: './radial-meter.html',
  styleUrl: './radial-meter.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RadialMeter {
  /**
   * Gets the reading, 0–100.
   */
  public readonly percent: InputSignal<number> = input.required<number>();

  /**
   * Gets what the reading is (`In use`), shown beneath it.
   */
  public readonly label: InputSignal<string> = input.required<string>();

  /**
   * Gets the reading at which the meter warns.
   */
  public readonly warning: InputSignal<number> = input<number>(80);

  /**
   * Gets the reading at which the meter is in danger.
   */
  public readonly danger: InputSignal<number> = input<number>(90);

  /**
   * Gets the meter's radius, exposed for the template.
   */
  protected readonly radius: number = RADIUS;

  /**
   * Gets the reading held to 0–100.
   */
  private readonly clamped: Signal<number> = computed((): number =>
    Math.min(100, Math.max(0, this.percent())),
  );

  /**
   * Gets the reading, formatted.
   */
  protected readonly value: Signal<string> = computed(
    (): string => `${Math.round(this.clamped())}%`,
  );

  /**
   * Gets the filled arc's dash pattern: its length, then the rest of the circle.
   */
  protected readonly dash: Signal<string> = computed((): string => {
    const filled: number = (this.clamped() / 100) * CIRCUMFERENCE;
    return `${filled} ${CIRCUMFERENCE - filled}`;
  });

  /**
   * Gets how severe the reading is.
   */
  protected readonly severity: Signal<MeterSeverity> = computed((): MeterSeverity => {
    const reading: number = this.clamped();
    if (reading >= this.danger()) {
      return 'danger';
    }
    return reading >= this.warning() ? 'warning' : 'normal';
  });

  /**
   * Gets the meter's accessible name: what it measures, how much, and how severe.
   */
  protected readonly description: Signal<string> = computed((): string => {
    const severity: MeterSeverity = this.severity();
    const note: string =
      severity === 'danger' ? ', critically high' : severity === 'warning' ? ', high' : '';
    return `${this.label()}: ${this.value()}${note}`;
  });
}
