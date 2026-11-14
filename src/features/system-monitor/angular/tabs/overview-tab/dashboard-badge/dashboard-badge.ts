import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';

/**
 * Identifies a badge's meaning, which colours it. Status tones always come with an icon and words, so
 * the colour is never the only signal.
 */
export type DashboardBadgeTone = 'accent' | 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/**
 * Represents a headline reading in a card's head: a value, optionally captioned (`Read`) and marked
 * with an icon (an arrow for a direction, a status glyph for a state).
 */
@Component({
  selector: 'app-system-monitor-dashboard-badge',
  imports: [AppIcon],
  templateUrl: './dashboard-badge.html',
  styleUrl: './dashboard-badge.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardBadge {
  /**
   * Gets the reading.
   */
  public readonly value: InputSignal<string> = input.required<string>();

  /**
   * Gets what the reading is, beneath it, or the empty string for none.
   */
  public readonly caption: InputSignal<string> = input<string>('');

  /**
   * Gets the icon beside the reading, if any.
   */
  public readonly icon: InputSignal<Icon | undefined> = input<Icon | undefined>(undefined);

  /**
   * Gets the badge's meaning.
   */
  public readonly tone: InputSignal<DashboardBadgeTone> = input<DashboardBadgeTone>('accent');
}
