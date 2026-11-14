import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { MetricsSample } from '@shared/api/system-monitor-channels';
import { ChartSeries } from '../../../../charts/chart-series';
import { LineChart } from '../../../../charts/line-chart/line-chart';
import { RadialMeter } from '../../../../charts/radial-meter/radial-meter';
import { formatBytes, formatPercent } from '../../../../readings/format';
import { SystemMonitorReadings } from '../../../../readings/system-monitor-readings';
import { DashboardBadge } from '../../dashboard-badge/dashboard-badge';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Describes one entry of the memory breakdown.
 */
interface MemoryEntry {
  /**
   * Gets the entry's label.
   */
  readonly label: string;

  /**
   * Gets the entry's value.
   */
  readonly value: string;

  /**
   * Gets the key beside the label: the meter's fill, its track, or none for the total.
   */
  readonly key: 'used' | 'free' | 'none';
}

/**
 * Represents the Overview's Memory card: memory in use as a meter against the total, its breakdown, and
 * its history beneath with Studio's own share.
 */
@Component({
  selector: 'app-system-monitor-memory-card',
  imports: [DashboardCard, DashboardBadge, LineChart, RadialMeter],
  templateUrl: './memory-card.html',
  styleUrl: './memory-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemoryCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's readings.
   */
  protected readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets how a share is written, on the axis and in the readout.
   */
  protected readonly percent: (value: number) => string = formatPercent;

  /**
   * Gets the share of memory in use, 0 before the first sample.
   */
  protected readonly used: Signal<number> = computed(
    (): number => this.readings.latest()?.memory.percent ?? 0,
  );

  /**
   * Gets the history graph's series: the system's memory in use, and Studio's own share in grey.
   */
  protected readonly series: Signal<readonly ChartSeries[]> = computed(
    (): readonly ChartSeries[] => [
      { label: 'System', values: this.readings.memoryHistory(), emphasis: 'primary' },
      { label: 'Studio', values: this.readings.appMemoryHistory(), emphasis: 'secondary' },
    ],
  );

  /**
   * Gets the breakdown: in use, available and the total.
   */
  protected readonly entries: Signal<readonly MemoryEntry[]> = computed(
    (): readonly MemoryEntry[] => {
      const sample: MetricsSample | null = this.readings.latest();
      const available: number | undefined = sample?.memoryDetail?.availableBytes;
      return [
        {
          label: 'In Use',
          value: sample === null ? '—' : formatBytes(sample.memory.usedBytes),
          key: 'used',
        },
        {
          label: 'Available',
          value: available === undefined ? '—' : formatBytes(available),
          key: 'free',
        },
        {
          label: 'Total',
          value: sample === null ? '—' : formatBytes(sample.memory.totalBytes),
          key: 'none',
        },
      ];
    },
  );
}
