import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { SystemInfo } from '@shared/api/system-monitor-channels';
import { ChartSeries } from '../../../../charts/chart-series';
import { LineChart } from '../../../../charts/line-chart/line-chart';
import { formatPercent } from '../../../../readings/format';
import { SystemMonitorReadings } from '../../../../readings/system-monitor-readings';
import { Sparkline } from '../../../../sparkline/sparkline';
import { DashboardBadge } from '../../../dashboard-badge/dashboard-badge';
import { DashboardCard } from '../../../dashboard-card/dashboard-card';
import { coresPerRow } from '../../../cores-per-row';

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
 * Represents the Overview's CPU card: the machine's load over time with Studio's own share, a small
 * graph per logical core so a single busy core stands out, and the processor in four facts at its foot.
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
   * Gets the load graph's series: the system's, and Studio's own share beneath it in grey. The per-core
   * graphs carry the system's alone, since Studio's share is not read per core.
   */
  protected readonly series: Signal<readonly ChartSeries[]> = computed(
    (): readonly ChartSeries[] => [
      { label: 'System', values: this.readings.cpuHistory(), emphasis: 'primary' },
      { label: 'Studio', values: this.readings.appCpuHistory(), emphasis: 'secondary' },
    ],
  );

  /**
   * Gets the processor's facts, two to a row: its model and base speed, then its physical and logical
   * cores. Its load is the badge above.
   */
  protected readonly facts: Signal<readonly CpuFact[]> = computed((): readonly CpuFact[] => {
    const info: SystemInfo | null = this.readings.info();
    return [
      { label: 'Model', value: info?.cpuModel ?? '—' },
      {
        label: 'Base Speed',
        value: info?.speedGhz === undefined ? '—' : `${info.speedGhz.toFixed(2)} GHz`,
      },
      {
        label: 'Physical Cores',
        value: info?.physicalCores === undefined ? '—' : `${info.physicalCores}`,
      },
      { label: 'Logical Cores', value: info === null ? '—' : `${info.logicalCores}` },
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
   * Gets how many core graphs a row of the grid holds, so every row is full.
   */
  protected readonly perRow: Signal<number> = computed((): number =>
    coresPerRow(this.cores().length),
  );
}
