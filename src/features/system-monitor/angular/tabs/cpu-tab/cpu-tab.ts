import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { SystemInfo } from '@shared/api/system-monitor-channels';
import { ChartSeries } from '../../charts/chart-series';
import { LineChart } from '../../charts/line-chart/line-chart';
import { formatBytes, formatPercent } from '../../readings/format';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';
import { DashboardBadge } from '../dashboard-badge/dashboard-badge';
import { DashboardCard } from '../dashboard-card/dashboard-card';
import { CpuCoresCard } from './cpu-cores-card/cpu-cores-card';
import { CpuGroupsCard } from './cpu-groups-card/cpu-groups-card';
import { CpuInformationCard } from './cpu-information-card/cpu-information-card';
import { CpuProcessesCard } from './cpu-processes-card/cpu-processes-card';

/**
 * Describes one of the header's summary chips (`48 Logical Cores`).
 */
interface SummaryChip {
  /**
   * Gets the chip's reading.
   */
  readonly value: string;

  /**
   * Gets what the reading is.
   */
  readonly label: string;
}

/**
 * Represents the System Monitor's CPU view: the processor named with its headline facts, its total
 * load over time (the system's and Studio's), its description, every core's load (as a grid or a
 * list), the cores' load in groups, and the processes using the most CPU.
 */
@Component({
  selector: 'app-system-monitor-cpu-tab',
  imports: [
    AppIcon,
    DashboardCard,
    DashboardBadge,
    LineChart,
    CpuInformationCard,
    CpuCoresCard,
    CpuGroupsCard,
    CpuProcessesCard,
  ],
  templateUrl: './cpu-tab.html',
  styleUrl: './cpu-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CpuTab {
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
   * Gets the processor's model, or the empty string until it has been described.
   */
  protected readonly model: Signal<string> = computed(
    (): string => this.readings.info()?.cpuModel ?? '',
  );

  /**
   * Gets the header's chips: the cores, the frequencies (the maximum only where the platform reports
   * one) and the memory.
   */
  protected readonly chips: Signal<readonly SummaryChip[]> = computed(
    (): readonly SummaryChip[] => {
      const info: SystemInfo | null = this.readings.info();
      if (info === null) {
        return [];
      }
      const chips: SummaryChip[] = [{ value: `${info.logicalCores}`, label: 'Logical Cores' }];
      if (info.physicalCores !== undefined) {
        chips.push({ value: `${info.physicalCores}`, label: 'Physical Cores' });
      }
      if (info.speedGhz !== undefined) {
        chips.push({ value: `${info.speedGhz.toFixed(2)} GHz`, label: 'Base' });
      }
      if (info.maxSpeedGhz !== undefined) {
        chips.push({ value: `${info.maxSpeedGhz.toFixed(2)} GHz`, label: 'Max (Turbo)' });
      }
      chips.push({ value: formatBytes(info.totalMemoryBytes), label: 'RAM' });
      return chips;
    },
  );

  /**
   * Gets the total load graph's series: the system's, and Studio's own share in grey.
   */
  protected readonly series: Signal<readonly ChartSeries[]> = computed(
    (): readonly ChartSeries[] => [
      { label: 'System', values: this.readings.cpuHistory(), emphasis: 'primary' },
      { label: 'Studio', values: this.readings.appCpuHistory(), emphasis: 'secondary' },
    ],
  );
}
