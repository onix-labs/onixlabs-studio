import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { formatPercent } from '../../../readings/format';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Describes one group of cores.
 */
interface CoreGroup {
  /**
   * Gets the group's cores, by number (`Cores 1 – 8`).
   */
  readonly label: string;

  /**
   * Gets the group's average load, 0–100.
   */
  readonly percent: number;

  /**
   * Gets the group's average load, formatted.
   */
  readonly value: string;
}

/**
 * Works out how many cores a group holds: eight on a large CPU, fewer on a small one, so the card has
 * a handful of bars whatever the core count.
 * @param count The number of logical cores.
 * @returns Returns the group size.
 */
export function groupSize(count: number): number {
  if (count > 16) {
    return 8;
  }
  return count > 8 ? 4 : 2;
}

/**
 * Represents the CPU view's grouped card: the cores taken a run at a time, each run's average load as
 * a bar, so a busy run of cores shows at a glance on a CPU with dozens of them.
 */
@Component({
  selector: 'app-system-monitor-cpu-groups-card',
  imports: [DashboardCard],
  templateUrl: './cpu-groups-card.html',
  styleUrl: './cpu-groups-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CpuGroupsCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's readings.
   */
  private readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets the groups, each a run of cores in the OS's order with its average load.
   */
  protected readonly groups: Signal<readonly CoreGroup[]> = computed((): readonly CoreGroup[] => {
    const cores: readonly number[] = this.readings.cores();
    const size: number = groupSize(cores.length);
    const groups: CoreGroup[] = [];
    for (let start: number = 0; start < cores.length; start += size) {
      const run: readonly number[] = cores.slice(start, start + size);
      const percent: number =
        run.reduce((sum: number, load: number): number => sum + load, 0) / run.length;
      const last: number = start + run.length;
      groups.push({
        label: run.length === 1 ? `Core ${last}` : `Cores ${start + 1} – ${last}`,
        percent,
        value: formatPercent(percent),
      });
    }
    return groups;
  });
}
