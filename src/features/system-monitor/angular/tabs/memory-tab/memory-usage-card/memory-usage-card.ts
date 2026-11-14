import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { MetricsSample } from '@shared/api/system-monitor-channels';
import { RadialMeter } from '../../../charts/radial-meter/radial-meter';
import { formatBytes } from '../../../readings/format';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Describes one entry of the usage legend.
 */
interface UsageEntry {
  /**
   * Gets the entry's label.
   */
  readonly label: string;

  /**
   * Gets the entry's value.
   */
  readonly value: string;

  /**
   * Gets the key beside the label, for what the meter draws: the outer ring's fill (in use), the
   * inner's (Studio's), the outer ring's track (available); none for what it does not draw.
   */
  readonly key: 'used' | 'studio' | 'free' | 'none';
}

/**
 * Represents the Memory view's usage card: memory in use as a nested meter — the system's in the outer
 * ring, Studio's own share in the inner — beside its breakdown.
 */
@Component({
  selector: 'app-system-monitor-memory-usage-card',
  imports: [DashboardCard, RadialMeter],
  templateUrl: './memory-usage-card.html',
  styleUrl: './memory-usage-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemoryUsageCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's readings.
   */
  private readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets the share of memory in use, 0 before the first sample.
   */
  protected readonly used: Signal<number> = computed(
    (): number => this.readings.latest()?.memory.percent ?? 0,
  );

  /**
   * Gets Studio's share of memory, or undefined when it was not read.
   */
  protected readonly studio: Signal<number | undefined> = computed(
    (): number | undefined => this.readings.latest()?.app?.memoryPercent,
  );

  /**
   * Gets the legend: in use, Studio's, compressed (where reported), available and the total.
   */
  protected readonly entries: Signal<readonly UsageEntry[]> = computed(
    (): readonly UsageEntry[] => {
      const sample: MetricsSample | null = this.readings.latest();
      if (sample === null) {
        return [];
      }
      const entries: UsageEntry[] = [
        { label: 'In Use', value: formatBytes(sample.memory.usedBytes), key: 'used' },
      ];
      if (sample.app !== undefined) {
        entries.push({
          label: 'Studio',
          value: formatBytes(sample.app.memoryBytes),
          key: 'studio',
        });
      }
      const compressed: number | undefined = sample.memoryDetail?.compressedBytes;
      if (compressed !== undefined) {
        entries.push({ label: 'Compressed', value: formatBytes(compressed), key: 'none' });
      }
      const available: number | undefined = sample.memoryDetail?.availableBytes;
      if (available !== undefined) {
        entries.push({ label: 'Available', value: formatBytes(available), key: 'free' });
      }
      entries.push({ label: 'Total', value: formatBytes(sample.memory.totalBytes), key: 'none' });
      return entries;
    },
  );
}
