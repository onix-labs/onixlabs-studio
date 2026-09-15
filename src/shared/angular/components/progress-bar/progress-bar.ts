import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';

/**
 * The meaning a {@link ProgressBar} carries, which colours its sweep: the active accent by default,
 * or one of the fixed state colours.
 */
export type ProgressTone = 'accent' | 'success' | 'warning' | 'danger' | 'info';

/**
 * An indeterminate progress bar: a solid bar in the button's footprint with diagonal stripes sliding
 * across it for as long as it is shown, for work whose duration is unknown — a download, an install.
 * Sized and shaped exactly as a button so it can stand in for the button that started the work
 * without the row moving, and it may carry a label ("Installing…") where the button's label was.
 * THE progress bar, so the fill, the stripes and their motion live in one place rather than being
 * redrawn per surface. It has no value: show it while the work runs and remove it when the work ends.
 */
@Component({
  selector: 'app-progress-bar',
  templateUrl: './progress-bar.html',
  styleUrl: './progress-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'progressbar',
    'aria-busy': 'true',
    '[attr.aria-label]': 'ariaLabel() ?? label()',
    '[class.progress-bar--accent]': "tone() === 'accent'",
    '[class.progress-bar--success]': "tone() === 'success'",
    '[class.progress-bar--warning]': "tone() === 'warning'",
    '[class.progress-bar--danger]': "tone() === 'danger'",
    '[class.progress-bar--info]': "tone() === 'info'",
  },
})
export class ProgressBar {
  /**
   * Gets the colour of the sweep.
   */
  public readonly tone: InputSignal<ProgressTone> = input<ProgressTone>('accent');

  /**
   * Gets the label shown on the bar, or undefined for a bare bar.
   */
  public readonly label: InputSignal<string | undefined> = input<string>();

  /**
   * Gets the accessible name: what the work is, since the bar itself says only that something runs.
   * Falls back to the visible label when omitted.
   */
  public readonly ariaLabel: InputSignal<string | undefined> = input<string>();
}
