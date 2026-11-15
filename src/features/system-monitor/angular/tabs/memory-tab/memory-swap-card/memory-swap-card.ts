import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { MemoryDetailMetric } from '@shared/api/system-monitor-channels';
import { formatBytes } from '../../../readings/format';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Describes swap as the card states it.
 */
interface SwapState {
  /**
   * Gets the swap in use, formatted.
   */
  readonly used: string;

  /**
   * Gets what the reading means.
   */
  readonly note: string;

  /**
   * Gets the share of swap in use, 0–100, or undefined where none is configured.
   */
  readonly percent?: number;
}

/**
 * Represents the Memory view's swap card: the swap in use, of what is configured, and whether it is
 * being used at all.
 */
@Component({
  selector: 'app-system-monitor-memory-swap-card',
  imports: [DashboardCard],
  templateUrl: './memory-swap-card.html',
  styleUrl: './memory-swap-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemorySwapCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's readings.
   */
  private readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets swap as stated, or null before the first reading.
   */
  protected readonly state: Signal<SwapState | null> = computed((): SwapState | null => {
    const detail: MemoryDetailMetric | null = this.readings.memoryDetail();
    if (detail === null) {
      return null;
    }
    const { swapUsedBytes, swapTotalBytes }: MemoryDetailMetric = detail;
    if (swapTotalBytes === 0) {
      return { used: formatBytes(0), note: 'No swap is in use, and none is set aside yet.' };
    }
    const percent: number = (swapUsedBytes / swapTotalBytes) * 100;
    return {
      used: formatBytes(swapUsedBytes),
      note:
        swapUsedBytes === 0
          ? `Swap is inactive: none of its ${formatBytes(swapTotalBytes)} is in use.`
          : `In use of ${formatBytes(swapTotalBytes)} set aside.`,
      percent,
    };
  });
}
