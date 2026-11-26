import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { GPU_SAMPLE_INTERVAL_MS } from '@shared/api/system-monitor-channels';
import { ChartSeries } from '../../../charts/chart-series';
import { LineChart } from '../../../charts/line-chart/line-chart';
import { formatAxisBytes } from '../../../readings/format';
import { SystemMonitorGpu } from '../../../readings/system-monitor-gpu';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { DashboardBadge } from '../../dashboard-badge/dashboard-badge';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Represents the GPU view's video memory history card: the video memory in use over Graph History,
 * against what there is.
 */
@Component({
  selector: 'app-system-monitor-gpu-memory-history-card',
  imports: [DashboardCard, DashboardBadge, LineChart],
  templateUrl: './gpu-memory-history-card.html',
  styleUrl: './gpu-memory-history-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GpuMemoryHistoryCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's GPU readings.
   */
  private readonly gpu: SystemMonitorGpu = inject(SystemMonitorGpu);

  /**
   * Gets the view's readings, for the GPU's described memory and the graph's span.
   */
  protected readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets how a size is written, on the axis and in the readout.
   */
  protected readonly bytes: (value: number) => string = formatAxisBytes;

  /**
   * Gets the time between readings, for the readout.
   */
  protected readonly intervalMs: number = GPU_SAMPLE_INTERVAL_MS;

  /**
   * Gets the axis's top: the video memory there is, or undefined to scale to the peak.
   */
  protected readonly total: Signal<number | undefined> = computed(
    (): number | undefined =>
      this.gpu.latest()?.memoryTotalBytes ?? this.readings.info()?.gpus[0]?.memoryBytes,
  );

  /**
   * Gets whether the GPU reports its video memory in use.
   */
  protected readonly reported: Signal<boolean> = computed(
    (): boolean => this.gpu.memoryHistory().length > 0,
  );

  /**
   * Gets the graph's series.
   */
  protected readonly series: Signal<readonly ChartSeries[]> = computed(
    (): readonly ChartSeries[] => [
      { label: 'VRAM', values: this.gpu.memoryHistory(), emphasis: 'primary' },
    ],
  );
}
