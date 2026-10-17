import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';

/**
 * The meaning a {@link Chip} carries, which colours it: the active accent, one of the fixed semantic
 * colours, or a neutral grey for structure — a chip that labels rather than judges.
 */
export type ChipTone = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/**
 * A small label for a status or a category: a diff's "Modified", an issue's "Open", a branch on a
 * commit (#882). THE chip, used everywhere a chip is used, so its shape and colour live in one place
 * rather than being redrawn per surface, as they had been — each a little different.
 *
 * A subtle wash of its tone behind the tone at full strength, so it reads at a glance without
 * shouting; a small rounded corner, squircle where the platform draws them, never a pill. Its text is
 * projected, with an optional leading {@link icon}.
 */
@Component({
  selector: 'app-chip',
  imports: [AppIcon],
  template: `
    @if (icon(); as glyph) {
      <app-icon class="chip__icon" [icon]="glyph" />
    }
    <span class="chip__text"><ng-content /></span>
  `,
  styleUrl: './chip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'chip',
    '[class.chip--accent]': "tone() === 'accent'",
    '[class.chip--success]': "tone() === 'success'",
    '[class.chip--warning]': "tone() === 'warning'",
    '[class.chip--danger]': "tone() === 'danger'",
    '[class.chip--info]': "tone() === 'info'",
    '[class.chip--neutral]': "tone() === 'neutral'",
  },
})
export class Chip {
  /**
   * Gets the chip's tone. Neutral by default: a chip states something before it judges it.
   */
  public readonly tone: InputSignal<ChipTone> = input<ChipTone>('neutral');

  /**
   * Gets the icon drawn before the text, or undefined for text alone.
   */
  public readonly icon: InputSignal<Icon | undefined> = input<Icon>();
}
