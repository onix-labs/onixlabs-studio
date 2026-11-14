import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { MemoryDetailMetric, MetricsSample } from '@shared/api/system-monitor-channels';
import { MetricTile, TileChannel } from '../../metric-tile/metric-tile';
import { formatBytes, formatPercent } from '../../readings/format';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';

/**
 * Describes one fact shown under the memory graphs.
 */
interface MemoryFact {
  /**
   * Gets the fact's label.
   */
  readonly label: string;

  /**
   * Gets the fact's value.
   */
  readonly value: string;
}

/**
 * Represents the System Monitor's Memory tab: memory in use with Studio's share overlaid, swap in use
 * beside it, and the breakdown — what is used, what is available, and what is Studio's.
 *
 * Available is shown beside used because they do not add up to the total: macOS and Linux keep file
 * data cached in otherwise idle memory and give it up on demand, so "used" alone makes a machine look
 * fuller than it is.
 */
@Component({
  selector: 'app-system-monitor-memory-tab',
  imports: [MetricTile],
  templateUrl: './memory-tab.html',
  styleUrl: './memory-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemoryTab {
  /**
   * Gets the view's readings.
   */
  protected readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets whether the machine has swap configured, so its graph is worth showing.
   */
  protected readonly hasSwap: Signal<boolean> = computed(
    (): boolean => (this.readings.memoryDetail()?.swapTotalBytes ?? 0) > 0,
  );

  /**
   * Gets the swap graph's channel.
   */
  protected readonly swapChannels: Signal<readonly TileChannel[]> = computed(
    (): readonly TileChannel[] => {
      const detail: MemoryDetailMetric | null = this.readings.memoryDetail();
      const value: string =
        detail === null || detail.swapTotalBytes === 0
          ? '—'
          : `${formatBytes(detail.swapUsedBytes)} of ${formatBytes(detail.swapTotalBytes)}`;
      return [{ value, values: this.readings.swapHistory() }];
    },
  );

  /**
   * Gets the memory facts: total, used, available, Studio's and swap, as far as they were read.
   */
  protected readonly facts: Signal<readonly MemoryFact[]> = computed((): readonly MemoryFact[] => {
    const sample: MetricsSample | null = this.readings.latest();
    if (sample === null) {
      return [];
    }
    const facts: MemoryFact[] = [
      { label: 'Total', value: formatBytes(sample.memory.totalBytes) },
      {
        label: 'In use',
        value: `${formatBytes(sample.memory.usedBytes)} (${formatPercent(sample.memory.percent)})`,
      },
    ];
    const detail: MemoryDetailMetric | undefined = sample.memoryDetail;
    if (detail !== undefined) {
      facts.push({ label: 'Available', value: formatBytes(detail.availableBytes) });
    }
    const studio: string | null = this.readings.memoryAppValue();
    if (studio !== null) {
      facts.push({ label: 'Studio', value: studio });
    }
    if (detail !== undefined && detail.swapTotalBytes > 0) {
      facts.push({
        label: 'Swap',
        value: `${formatBytes(detail.swapUsedBytes)} of ${formatBytes(detail.swapTotalBytes)}`,
      });
    }
    return facts;
  });
}
