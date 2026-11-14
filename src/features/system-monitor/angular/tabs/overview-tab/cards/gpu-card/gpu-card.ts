import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { GpuInfo, GpuMetric, GpuSource } from '@shared/api/system-monitor-channels';
import { ChartSeries } from '../../../../charts/chart-series';
import { LineChart } from '../../../../charts/line-chart/line-chart';
import { formatBytes, formatPercent } from '../../../../readings/format';
import { SystemMonitorReadings } from '../../../../readings/system-monitor-readings';
import { DashboardBadge } from '../../dashboard-badge/dashboard-badge';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Describes one fact under the GPU graph.
 */
interface GpuFact {
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
 * How each GPU source is named.
 */
const SOURCES: Readonly<Record<GpuSource, string>> = {
  ioreg: 'ioreg (macOS)',
  'nvidia-smi': 'nvidia-smi',
};

/**
 * Represents the Overview's GPU card: the GPU's utilisation over time, and the GPU described — where
 * its reading comes from, its model and its memory. Where GPU Monitoring is off, it says so.
 */
@Component({
  selector: 'app-system-monitor-gpu-card',
  imports: [DashboardCard, DashboardBadge, LineChart],
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
   * Gets the GPU's facts: its utilisation, the reading's source, and the first controller's model and
   * memory.
   */
  protected readonly facts: Signal<readonly GpuFact[]> = computed((): readonly GpuFact[] => {
    const gpu: GpuMetric | undefined = this.readings.latest()?.gpu;
    const controller: GpuInfo | undefined = this.readings.info()?.gpus[0];
    return [
      { label: 'Utilisation', value: this.readings.gpuValue() },
      {
        label: 'Source',
        value: gpu?.source === undefined ? 'Not reported' : SOURCES[gpu.source],
      },
      { label: 'Model', value: controller?.model ?? '—' },
      {
        label: 'Memory',
        value: controller?.memoryBytes === undefined ? '—' : formatBytes(controller.memoryBytes),
      },
    ];
  });
}
