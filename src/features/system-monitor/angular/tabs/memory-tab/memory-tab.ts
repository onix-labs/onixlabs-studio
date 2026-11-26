import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import {
  MemoryDetailMetric,
  MemoryModule,
  MetricsSample,
  SystemInfo,
} from '@shared/api/system-monitor-channels';
import { formatBytes, formatPercent } from '../../readings/format';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';
import { MemoryBreakdownCard } from './memory-breakdown-card/memory-breakdown-card';
import { MemoryCompositionCard } from './memory-composition-card/memory-composition-card';
import { MemoryHistoryCard } from './memory-history-card/memory-history-card';
import { MemoryModulesCard } from './memory-modules-card/memory-modules-card';
import { MemoryPressureCard } from './memory-pressure-card/memory-pressure-card';
import { MemoryProcessesCard } from './memory-processes-card/memory-processes-card';
import { MemoryStatisticsCard } from './memory-statistics-card/memory-statistics-card';
import { MemorySwapCard } from './memory-swap-card/memory-swap-card';
import { MemoryUsageCard } from './memory-usage-card/memory-usage-card';
import { SummaryItem, ViewSummary } from '../view-summary/view-summary';

/**
 * Finds the speed most of the modules run at, which is the memory's speed.
 * @param modules The memory modules.
 * @returns Returns the speed in MT/s, or undefined when none reports one.
 */
function commonSpeed(modules: readonly MemoryModule[]): number | undefined {
  const counts: Map<number, number> = new Map<number, number>();
  for (const module of modules) {
    if (module.speedMts !== undefined) {
      counts.set(module.speedMts, (counts.get(module.speedMts) ?? 0) + 1);
    }
  }
  let best: number | undefined;
  for (const [speed, count] of counts) {
    if (best === undefined || count > (counts.get(best) ?? 0)) {
      best = speed;
    }
  }
  return best;
}

/**
 * Represents the System Monitor's Memory view: the memory named (its size, generation and whether it
 * corrects errors) with its headline readings, then its use — as a meter and over time — its pressure,
 * what holds it, swap, the processes holding the most, its composition over time, the modules it is
 * made of, and its statistics in full. Every figure is one the platform reports; what it does not is
 * left out or said to be unavailable.
 */
@Component({
  selector: 'app-system-monitor-memory-tab',
  imports: [
    ViewSummary,
    AppIcon,
    MemoryUsageCard,
    MemoryHistoryCard,
    MemoryPressureCard,
    MemoryBreakdownCard,
    MemorySwapCard,
    MemoryProcessesCard,
    MemoryCompositionCard,
    MemoryModulesCard,
    MemoryStatisticsCard,
  ],
  templateUrl: './memory-tab.html',
  styleUrl: './memory-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemoryTab {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's readings.
   */
  private readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets the memory described in a line (`256.0 GB DDR4 ECC`), as far as it is known.
   */
  protected readonly description: Signal<string> = computed((): string => {
    const info: SystemInfo | null = this.readings.info();
    if (info === null) {
      return '';
    }
    const generation: string =
      /\b(L?P?DDR\d\w*)/i.exec(info.memoryModules[0]?.type ?? '')?.[1] ?? '';
    return [formatBytes(info.totalMemoryBytes), generation, info.memoryEcc === true ? 'ECC' : '']
      .filter((part: string): boolean => part.length > 0)
      .join(' ');
  });

  /**
   * Gets the header's chips: in use, available, compressed and swap where reported, and the speed.
   */
  protected readonly chips: Signal<readonly SummaryItem[]> = computed(
    (): readonly SummaryItem[] => {
      const sample: MetricsSample | null = this.readings.latest();
      if (sample === null) {
        return [];
      }
      const detail: MemoryDetailMetric | undefined = sample.memoryDetail;
      const chips: SummaryItem[] = [
        {
          label: 'In Use',
          value: `${formatBytes(sample.memory.usedBytes)} (${formatPercent(sample.memory.percent)})`,
        },
      ];
      if (detail !== undefined) {
        chips.push({ label: 'Available', value: formatBytes(detail.availableBytes) });
        if (detail.compressedBytes !== undefined) {
          chips.push({ label: 'Compressed', value: formatBytes(detail.compressedBytes) });
        }
        chips.push({ label: 'Swap', value: formatBytes(detail.swapUsedBytes) });
      }
      const speed: number | undefined = commonSpeed(this.readings.info()?.memoryModules ?? []);
      if (speed !== undefined) {
        chips.push({ label: 'Speed', value: `${speed} MT/s` });
      }
      return chips;
    },
  );
}
