import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { GpuReading } from '@shared/api/system-monitor-channels';
import { RadialMeter } from '../../../charts/radial-meter/radial-meter';
import { formatBytes } from '../../../readings/format';
import { SystemMonitorGpu } from '../../../readings/system-monitor-gpu';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { DashboardBadge } from '../../dashboard-badge/dashboard-badge';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Describes one entry of the video memory legend.
 */
interface VramEntry {
  /**
   * Gets the entry's label.
   */
  readonly label: string;

  /**
   * Gets the entry's value.
   */
  readonly value: string;

  /**
   * Gets the key beside it: the meter's fill, its track, or none.
   */
  readonly key: 'used' | 'free' | 'none';
}

/**
 * Represents the GPU view's video memory card: the video memory in use as a meter against what there
 * is, with what is reserved and available where the platform reports them.
 */
@Component({
  selector: 'app-system-monitor-gpu-memory-card',
  imports: [DashboardCard, DashboardBadge, RadialMeter],
  templateUrl: './gpu-memory-card.html',
  styleUrl: './gpu-memory-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GpuMemoryCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's GPU readings.
   */
  private readonly gpu: SystemMonitorGpu = inject(SystemMonitorGpu);

  /**
   * Gets the view's readings, for the GPU's described memory.
   */
  private readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets the video memory there is: as the reading reports it, or as the GPU is described.
   */
  private readonly total: Signal<number | undefined> = computed(
    (): number | undefined =>
      this.gpu.latest()?.memoryTotalBytes ?? this.readings.info()?.gpus[0]?.memoryBytes,
  );

  /**
   * Gets the share of video memory in use, or undefined where it cannot be worked out.
   */
  protected readonly percent: Signal<number | undefined> = computed((): number | undefined => {
    const used: number | undefined = this.gpu.latest()?.memoryUsedBytes;
    const total: number | undefined = this.total();
    return used === undefined || total === undefined || total <= 0
      ? undefined
      : (used / total) * 100;
  });

  /**
   * Gets the head's reading: in use of what there is.
   */
  protected readonly summary: Signal<string> = computed((): string => {
    const used: number | undefined = this.gpu.latest()?.memoryUsedBytes;
    const total: number | undefined = this.total();
    if (used === undefined) {
      return '—';
    }
    return total === undefined ? formatBytes(used) : `${formatBytes(used)} / ${formatBytes(total)}`;
  });

  /**
   * Gets the legend, those figures the platform reports.
   */
  protected readonly entries: Signal<readonly VramEntry[]> = computed((): readonly VramEntry[] => {
    const reading: GpuReading | null = this.gpu.latest();
    const total: number | undefined = this.total();
    const entries: VramEntry[] = [];
    if (reading?.memoryUsedBytes !== undefined) {
      entries.push({ label: 'In Use', value: formatBytes(reading.memoryUsedBytes), key: 'used' });
    }
    if (reading?.memoryReservedBytes !== undefined) {
      entries.push({
        label: 'Reserved',
        value: formatBytes(reading.memoryReservedBytes),
        key: 'none',
      });
    }
    if (reading?.memoryUsedBytes !== undefined && total !== undefined) {
      entries.push({
        label: 'Available',
        value: formatBytes(
          Math.max(0, total - reading.memoryUsedBytes - (reading.memoryReservedBytes ?? 0)),
        ),
        key: 'free',
      });
    }
    if (total !== undefined) {
      entries.push({ label: 'Total', value: formatBytes(total), key: 'none' });
    }
    return entries;
  });
}
