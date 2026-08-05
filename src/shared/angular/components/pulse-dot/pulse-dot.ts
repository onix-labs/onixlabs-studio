import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  Signal,
} from '@angular/core';

/**
 * The meaning a {@link PulseDot} carries, which colours it: the active accent by default, one of the
 * fixed state colours, or a neutral grey for an inactive/idle indicator.
 */
export type PulseTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

/**
 * A small round status dot, optionally pulsing. THE status dot, used everywhere a status dot is used,
 * so the shape, size, colour, and pulse live in one place rather than being redrawn per surface.
 *
 * The dot itself is always solid; when {@link pulse} is set it emits a ring that grows out of the
 * dot's edge — from nothing to a few pixels — fading to transparent as it grows, then repeats. The
 * ring is a box-shadow spread, so it never affects layout (a row of dots stays aligned whether or not
 * they pulse). Colour comes from {@link tone}; size from {@link size}.
 */
@Component({
  selector: 'app-pulse-dot',
  template: '',
  styleUrl: './pulse-dot.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'pulse-dot',
    '[class.pulse-dot--pulsing]': 'pulse()',
    '[class.pulse-dot--neutral]': "tone() === 'neutral'",
    '[class.pulse-dot--accent]': "tone() === 'accent'",
    '[class.pulse-dot--success]': "tone() === 'success'",
    '[class.pulse-dot--warning]': "tone() === 'warning'",
    '[class.pulse-dot--danger]': "tone() === 'danger'",
    '[class.pulse-dot--info]': "tone() === 'info'",
    '[style.--pulse-dot-size]': 'sizeRem()',
    'aria-hidden': 'true',
  },
})
export class PulseDot {
  /**
   * Gets the meaning the dot carries, which colours it. Defaults to a neutral grey; a caller states a
   * tone for an active or state-coloured indicator.
   */
  public readonly tone: InputSignal<PulseTone> = input<PulseTone>('neutral');

  /**
   * Gets whether the dot pulses (emits the growing ring), for a live/in-progress state. A settled or
   * idle indicator leaves this off and the dot simply reads as a solid colour.
   */
  public readonly pulse: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the dot's diameter in rem. Defaults to 0.5rem; a denser surface (a compact list row) may ask
   * for a little less.
   */
  public readonly size: InputSignal<number> = input<number>(0.5);

  /**
   * Gets the diameter as a rem length, for the host's size custom property.
   */
  protected readonly sizeRem: Signal<string> = computed((): string => `${this.size()}rem`);
}
