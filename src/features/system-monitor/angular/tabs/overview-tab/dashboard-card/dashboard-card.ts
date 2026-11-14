import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';

/**
 * Represents one card of the System Monitor's Overview: an icon, a title and what it covers, its
 * headline readings (projected with the `cardBadges` attribute), and its body. Its full view is a
 * button in the ribbon's View group.
 */
@Component({
  selector: 'app-system-monitor-dashboard-card',
  imports: [AppIcon],
  templateUrl: './dashboard-card.html',
  styleUrl: './dashboard-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardCard {
  /**
   * Gets the card's icon.
   */
  public readonly icon: InputSignal<Icon> = input.required<Icon>();

  /**
   * Gets the card's title (`CPU`).
   */
  public readonly heading: InputSignal<string> = input.required<string>();

  /**
   * Gets what the card covers, beneath its title.
   */
  public readonly subtitle: InputSignal<string> = input.required<string>();
}
