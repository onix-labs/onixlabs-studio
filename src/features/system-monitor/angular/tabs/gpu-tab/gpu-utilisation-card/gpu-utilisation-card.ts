import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { GPU_SAMPLE_INTERVAL_MS } from '@shared/api/system-monitor-channels';
import { ChartSeries } from '../../../charts/chart-series';
import { LineChart } from '../../../charts/line-chart/line-chart';
import { formatPercent } from '../../../readings/format';
import { SystemMonitorGpu } from '../../../readings/system-monitor-gpu';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { DashboardBadge } from '../../dashboard-badge/dashboard-badge';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Represents the GPU view's utilisation card: how busy the GPU has been over Graph History.
 */
@Component({
  selector: 'app-system-monitor-gpu-utilisation-card',
  imports: [DashboardCard, DashboardBadge, LineChart],
  templateUrl: './gpu-utilisation-card.html',
  styleUrl: './gpu-utilisation-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GpuUtilisationCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's GPU readings.
   */
  private readonly gpu: SystemMonitorGpu = inject(SystemMonitorGpu);

  /**
   * Gets the view's readings, for the graph's span.
   */
  protected readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets how a utilisation is written, on the axis and in the readout.
   */
  protected readonly percent: (value: number) => string = formatPercent;

  /**
   * Gets the time between readings, for the readout.
   */
  protected readonly intervalMs: number = GPU_SAMPLE_INTERVAL_MS;

  /**
   * Gets the latest utilisation, or a placeholder.
   */
  protected readonly value: Signal<string> = computed((): string => {
    const utilisation: number | undefined = this.gpu.latest()?.utilisationPercent;
    return utilisation === undefined ? '—' : formatPercent(utilisation);
  });

  /**
   * Gets the graph's series.
   */
  protected readonly series: Signal<readonly ChartSeries[]> = computed(
    (): readonly ChartSeries[] => [
      { label: 'GPU', values: this.gpu.utilisationHistory(), emphasis: 'primary' },
    ],
  );
}
