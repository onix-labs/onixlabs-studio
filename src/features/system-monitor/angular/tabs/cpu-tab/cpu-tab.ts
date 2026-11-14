import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { SystemInfo } from '@shared/api/system-monitor-channels';
import { MetricTile, TileChannel } from '../../metric-tile/metric-tile';
import { formatPercent } from '../../readings/format';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';

/**
 * Describes one core's graph.
 */
interface CoreGraph {
  /**
   * Gets the core's label (`Core 1`).
   */
  readonly label: string;

  /**
   * Gets the graph's channel.
   */
  readonly channels: readonly TileChannel[];
}

/**
 * Describes one fact shown under the CPU graph.
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
 * Represents the System Monitor's CPU tab: the machine-wide graph with Studio's share overlaid, the
 * processor described, and one small graph per logical core.
 */
@Component({
  selector: 'app-system-monitor-cpu-tab',
  imports: [MetricTile],
  templateUrl: './cpu-tab.html',
  styleUrl: './cpu-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CpuTab {
  /**
   * Gets the view's readings.
   */
  protected readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets the processor's facts: its model, cores and speed, as far as they are known.
   */
  protected readonly facts: Signal<readonly CpuFact[]> = computed((): readonly CpuFact[] => {
    const info: SystemInfo | null = this.readings.info();
    if (info === null) {
      return [];
    }
    const facts: CpuFact[] = [{ label: 'Processor', value: info.cpuModel }];
    if (info.physicalCores !== undefined) {
      facts.push({ label: 'Cores', value: `${info.physicalCores}` });
    }
    facts.push({ label: 'Logical processors', value: `${info.logicalCores}` });
    if (info.performanceCores !== undefined && info.efficiencyCores !== undefined) {
      facts.push({
        label: 'Performance / efficiency',
        value: `${info.performanceCores} / ${info.efficiencyCores}`,
      });
    }
    if (info.speedGhz !== undefined) {
      facts.push({ label: 'Base speed', value: `${info.speedGhz.toFixed(2)} GHz` });
    }
    return facts;
  });

  /**
   * Gets one graph per logical core, in the OS's core order.
   */
  protected readonly cores: Signal<readonly CoreGraph[]> = computed((): readonly CoreGraph[] => {
    const latest: readonly number[] = this.readings.cores();
    return this.readings
      .coreHistories()
      .map((values: readonly number[], index: number): CoreGraph => ({
        label: `Core ${index + 1}`,
        channels: [{ value: formatPercent(latest[index] ?? 0), values }],
      }));
  });
}
