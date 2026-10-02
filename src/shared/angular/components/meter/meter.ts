import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  Signal,
} from '@angular/core';

/**
 * The meaning a {@link Meter} carries, which colours its fill: the active accent by default, or one of
 * the fixed state colours.
 */
export type MeterTone = 'accent' | 'success' | 'warning' | 'danger' | 'info';

/**
 * A determinate meter: how much of something is done, as a thin track filled from the leading edge.
 *
 * The counterpart of the indeterminate `app-progress-bar`, which says only that work is running. This
 * one has a value and nothing else — no label and no motion — so it can sit in a table cell or a row
 * beside the figure it draws, and many of them on one screen stay calm.
 */
@Component({
  selector: 'app-meter',
  templateUrl: './meter.html',
  styleUrl: './meter.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'meter',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    '[attr.aria-valuenow]': 'percent()',
    '[attr.aria-label]': 'ariaLabel() ?? null',
    '[class.meter--accent]': "tone() === 'accent'",
    '[class.meter--success]': "tone() === 'success'",
    '[class.meter--warning]': "tone() === 'warning'",
    '[class.meter--danger]': "tone() === 'danger'",
    '[class.meter--info]': "tone() === 'info'",
  },
})
export class Meter {
  /**
   * Gets how much is done, from 0 to 1. Values outside the range, and non-numbers, are clamped.
   */
  public readonly value: InputSignal<number> = input<number>(0);

  /**
   * Gets the colour of the fill.
   */
  public readonly tone: InputSignal<MeterTone> = input<MeterTone>('accent');

  /**
   * Gets the accessible name: what is being measured, since the meter itself carries only a value.
   */
  public readonly ariaLabel: InputSignal<string | undefined> = input<string>();

  /**
   * Gets the value as a whole percentage, clamped to 0–100.
   */
  protected readonly percent: Signal<number> = computed((): number => {
    const value: number = this.value();
    return Number.isFinite(value) ? Math.round(Math.min(1, Math.max(0, value)) * 100) : 0;
  });
}
