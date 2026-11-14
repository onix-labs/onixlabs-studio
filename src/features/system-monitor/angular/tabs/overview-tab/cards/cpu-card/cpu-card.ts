import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { SystemInfo } from '@shared/api/system-monitor-channels';
import { ChartSeries } from '../../../../charts/chart-series';
import { LineChart } from '../../../../charts/line-chart/line-chart';
import { formatPercent } from '../../../../readings/format';
import { SystemMonitorReadings } from '../../../../readings/system-monitor-readings';
import { Sparkline } from '../../../../sparkline/sparkline';
import { DashboardBadge } from '../../dashboard-badge/dashboard-badge';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Describes one core's small graph.
 */
interface CoreGraph {
  /**
   * Gets the core's number, from 1.
   */
  readonly number: number;

  /**
   * Gets the core's recent load.
   */
  readonly values: readonly number[];

  /**
   * Gets the core's reading, for its tooltip (`Core 3: 24%`).
   */
  readonly title: string;
}

/**
 * Describes one fact under the CPU graph.
 */
interface CpuFact {
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
 * Represents the Overview's CPU card: the machine's load over time, the processor in four facts, and a
 * small graph per logical core so a single busy core stands out.
 */
@Component({
  selector: 'app-system-monitor-cpu-card',
  imports: [DashboardCard, DashboardBadge, LineChart, Sparkline],
  templateUrl: './cpu-card.html',
  styleUrl: './cpu-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CpuCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's readings.
   */
  protected readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets how a load is written, on the axis and in the readout.
   */
  protected readonly percent: (value: number) => string = formatPercent;

  /**
   * Gets the load graph's series.
   */
  protected readonly series: Signal<readonly ChartSeries[]> = computed(
    (): readonly ChartSeries[] => [
      { label: 'CPU', values: this.readings.cpuHistory(), emphasis: 'primary' },
    ],
  );

  /**
   * Gets the processor's facts: its cores, logical processors, base speed and load.
   */
  protected readonly facts: Signal<readonly CpuFact[]> = computed((): readonly CpuFact[] => {
    const info: SystemInfo | null = this.readings.info();
    return [
      { label: 'Cores', value: info?.physicalCores === undefined ? '—' : `${info.physicalCores}` },
      { label: 'Logical', value: info === null ? '—' : `${info.logicalCores}` },
      {
        label: 'Base Speed',
        value: info?.speedGhz === undefined ? '—' : `${info.speedGhz.toFixed(2)} GHz`,
      },
      { label: 'Usage', value: this.readings.cpuValue() },
    ];
  });

  /**
   * Gets one small graph per logical core.
   */
  protected readonly cores: Signal<readonly CoreGraph[]> = computed((): readonly CoreGraph[] => {
    const latest: readonly number[] = this.readings.cores();
    return this.readings
      .coreHistories()
      .map((values: readonly number[], index: number): CoreGraph => ({
        number: index + 1,
        values,
        title: `Core ${index + 1}: ${formatPercent(latest[index] ?? 0)}`,
      }));
  });

  /**
   * Emits when the user asks for the CPU view.
   */
  public readonly details: OutputEmitterRef<void> = output<void>();
}
