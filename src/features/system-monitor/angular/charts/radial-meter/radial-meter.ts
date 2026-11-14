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
 * The inner ring's radius: inside the outer ring, a ring's width and a gap's in from it.
 */
const INNER_RADIUS: number = 31;

/**
 * The meter's circumference, which the filled arc is a share of.
 */
const CIRCUMFERENCE: number = 2 * Math.PI * RADIUS;

/**
 * The inner ring's circumference.
 */
const INNER_CIRCUMFERENCE: number = 2 * Math.PI * INNER_RADIUS;

/**
 * Holds a reading to 0–100, treating anything not finite as 0.
 * @param percent The reading.
 * @returns Returns the held reading.
 */
function clamp(percent: number): number {
  return Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
}

/**
 * Works out a ring's dash pattern: its filled length, then the rest of the circle; or none for an
 * empty reading, whose round cap would otherwise draw a dot.
 * @param percent The reading, 0–100.
 * @param circumference The ring's circumference.
 * @returns Returns the dash pattern, or null when nothing is filled.
 */
function dashFor(percent: number, circumference: number): string | null {
  if (percent <= 0) {
    return null;
  }
  const filled: number = (percent / 100) * circumference;
  return `${filled} ${circumference - filled}`;
}

/**
 * Formats a reading: whole percent, or one decimal below 10% so a small share does not read as 0.
 * @param percent The reading, 0–100.
 * @returns Returns the formatted reading.
 */
function format(percent: number): string {
  return percent > 0 && percent < 10 ? `${percent.toFixed(1)}%` : `${Math.round(percent)}%`;
}

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
 * Given an inner reading, a second, narrower ring sits inside the first in the muted grey: a share of
 * the same limit (Studio's own memory within the machine's), read beneath the main reading. The two
 * readings then stand alone in the centre, each in its ring's colour; the accessible label names them.
 * Each ring is a meter in its own right, so the two are never stacked or summed.
 *
 * A meter, not a pie: each ring is one value and its limit, so there is nothing to compare slice
 * against slice.
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
   * Gets the inner ring's reading, 0–100, or undefined for a single ring.
   */
  public readonly innerPercent: InputSignal<number | undefined> = input<number | undefined>(
    undefined,
  );

  /**
   * Gets what the inner reading is (`Studio`).
   */
  public readonly innerLabel: InputSignal<string> = input<string>('');

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
   * Gets the inner ring's radius, exposed for the template.
   */
  protected readonly innerRadius: number = INNER_RADIUS;

  /**
   * Gets the reading held to 0–100.
   */
  private readonly clamped: Signal<number> = computed((): number => clamp(this.percent()));

  /**
   * Gets the inner reading held to 0–100, or undefined for a single ring.
   */
  private readonly innerClamped: Signal<number | undefined> = computed((): number | undefined => {
    const inner: number | undefined = this.innerPercent();
    return inner === undefined ? undefined : clamp(inner);
  });

  /**
   * Gets whether the meter has an inner ring.
   */
  protected readonly nested: Signal<boolean> = computed(
    (): boolean => this.innerClamped() !== undefined,
  );

  /**
   * Gets the inner reading, formatted, or the empty string for a single ring.
   */
  protected readonly innerValue: Signal<string> = computed((): string => {
    const inner: number | undefined = this.innerClamped();
    return inner === undefined ? '' : format(inner);
  });

  /**
   * Gets the inner ring's dash pattern, or null when it is empty or absent.
   */
  protected readonly innerDash: Signal<string | null> = computed((): string | null => {
    const inner: number | undefined = this.innerClamped();
    return inner === undefined ? null : dashFor(inner, INNER_CIRCUMFERENCE);
  });

  /**
   * Gets the reading, formatted.
   */
  protected readonly value: Signal<string> = computed(
    (): string => `${Math.round(this.clamped())}%`,
  );

  /**
   * Gets the filled arc's dash pattern, or null when nothing is filled.
   */
  protected readonly dash: Signal<string | null> = computed((): string | null =>
    dashFor(this.clamped(), CIRCUMFERENCE),
  );

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
    const inner: string = this.nested() ? `; ${this.innerLabel()}: ${this.innerValue()}` : '';
    return `${this.label()}: ${this.value()}${note}${inner}`;
  });
}
