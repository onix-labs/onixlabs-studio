import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { ChartSeries } from '../../../../charts/chart-series';
import { LineChart } from '../../../../charts/line-chart/line-chart';
import { RadialMeter } from '../../../../charts/radial-meter/radial-meter';
import { formatBytes, formatPercent } from '../../../../readings/format';
import { SystemMonitorReadings } from '../../../../readings/system-monitor-readings';
import { DashboardBadge } from '../../../dashboard-badge/dashboard-badge';
import { DashboardCard } from '../../../dashboard-card/dashboard-card';

/**
 * Describes one line of the video memory's breakdown beside its meter.
 */
interface VramEntry {
  /**
   * Gets the entry's label.
   */
  readonly label: string;

  /**
   * Gets the entry's value, formatted.
   */
  readonly value: string;

  /**
   * Gets which part of the meter the entry's key mirrors, or null for none (the total).
   */
  readonly key: 'used' | 'free' | null;
}

/**
 * Represents the Overview's GPU card: the GPU's utilisation over time, filling the card, and the GPU's
 * model and video memory beneath. Where GPU Monitoring is off, it says so.
 */
@Component({
  selector: 'app-system-monitor-gpu-card',
  imports: [DashboardCard, DashboardBadge, LineChart, RadialMeter],
  templateUrl: './gpu-card.html',
  styleUrl: './gpu-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GpuCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's readings.
   */
  protected readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets how a utilisation is written, on the axis and in the readout.
   */
  protected readonly percent: (value: number) => string = formatPercent;

  /**
   * Gets the utilisation graph's series.
   */
  protected readonly series: Signal<readonly ChartSeries[]> = computed(
    (): readonly ChartSeries[] => [
      { label: 'GPU', values: this.readings.gpuHistory(), emphasis: 'primary' },
    ],
  );

  /**
   * Gets the video memory there is, in bytes: as the latest reading reports it, else as the GPU
   * describes itself; undefined when neither does.
   */
  private readonly vramTotal: Signal<number | undefined> = computed(
    (): number | undefined =>
      this.readings.latest()?.gpu?.memoryTotalBytes ?? this.readings.info()?.gpus[0]?.memoryBytes,
  );

  /**
   * Gets the share of the video memory in use, 0–100, for the meter; 0 when it is not reported.
   */
  protected readonly vramUsed: Signal<number> = computed((): number => {
    const used: number | undefined = this.readings.latest()?.gpu?.memoryUsedBytes;
    const total: number | undefined = this.vramTotal();
    return used === undefined || total === undefined || total <= 0
      ? 0
      : Math.min(100, (used / total) * 100);
  });

  /**
   * Gets the video memory's breakdown: in use, available and in all, dashes where not reported.
   */
  protected readonly entries: Signal<readonly VramEntry[]> = computed((): readonly VramEntry[] => {
    const used: number | undefined = this.readings.latest()?.gpu?.memoryUsedBytes;
    const total: number | undefined = this.vramTotal();
    const bytes: (value: number | undefined) => string = (value: number | undefined): string =>
      value === undefined ? '—' : formatBytes(value);
    return [
      { label: 'In Use', value: bytes(used), key: 'used' },
      {
        label: 'Available',
        value: bytes(
          used === undefined || total === undefined ? undefined : Math.max(0, total - used),
        ),
        key: 'free',
      },
      { label: 'Total', value: bytes(total), key: null },
    ];
  });
}
