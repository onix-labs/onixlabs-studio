import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { CacheInfo, SystemInfo } from '@shared/api/system-monitor-channels';
import { formatBytes } from '../../../readings/format';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Describes one row of the processor's description.
 */
interface InformationRow {
  /**
   * Gets the row's label.
   */
  readonly label: string;

  /**
   * Gets the row's value.
   */
  readonly value: string;
}

/**
 * Formats a cache level: its total, and where it is per core, each core's share (`1.5 MB (24 × 64 KB)`).
 * @param cache The cache level.
 * @param cores The number of physical cores.
 * @returns Returns the formatted cache.
 */
function describeCache(cache: CacheInfo, cores: number | undefined): string {
  const total: string = formatBytes(cache.totalBytes).replace('.0 ', ' ');
  if (cache.perCoreBytes === undefined || cores === undefined) {
    return total;
  }
  return `${total} (${cores} × ${formatBytes(cache.perCoreBytes).replace('.0 ', ' ')})`;
}

/**
 * Represents the CPU view's information card: the processor described — its model, architecture,
 * cores, frequencies and caches — as far as the platform reports them. A row the platform does not
 * report (a maximum frequency on macOS, a hybrid core split on a non-hybrid CPU) is left out rather
 * than shown wrong.
 */
@Component({
  selector: 'app-system-monitor-cpu-information-card',
  imports: [DashboardCard],
  templateUrl: './cpu-information-card.html',
  styleUrl: './cpu-information-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CpuInformationCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's readings.
   */
  private readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets the processor's rows, or none until it has been described.
   */
  protected readonly rows: Signal<readonly InformationRow[]> = computed(
    (): readonly InformationRow[] => {
      const info: SystemInfo | null = this.readings.info();
      if (info === null) {
        return [];
      }
      const rows: InformationRow[] = [
        { label: 'Model', value: info.cpuModel },
        { label: 'Architecture', value: info.architecture },
      ];
      if (info.physicalCores !== undefined) {
        rows.push({ label: 'Cores (Physical)', value: `${info.physicalCores}` });
      }
      rows.push({ label: 'Cores (Logical)', value: `${info.logicalCores}` });
      if (info.performanceCores !== undefined && info.efficiencyCores !== undefined) {
        rows.push({
          label: 'Performance / Efficiency',
          value: `${info.performanceCores} / ${info.efficiencyCores}`,
        });
      }
      if (info.speedGhz !== undefined) {
        rows.push({ label: 'Base Frequency', value: `${info.speedGhz.toFixed(2)} GHz` });
      }
      if (info.maxSpeedGhz !== undefined) {
        rows.push({ label: 'Max Frequency (Turbo)', value: `${info.maxSpeedGhz.toFixed(2)} GHz` });
      }
      for (const cache of info.caches) {
        rows.push({
          label: `${cache.level} Cache`,
          value: describeCache(cache, info.physicalCores),
        });
      }
      return rows;
    },
  );
}
