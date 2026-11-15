import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { formatBytes, formatShare } from '../../../readings/format';
import { memoryColour } from '../../../readings/memory-colour';
import { MemorySegment } from '../../../readings/memory-segment';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Describes one part of the breakdown, as the bar and its legend show it.
 */
interface BreakdownPart {
  /**
   * Gets the part.
   */
  readonly key: MemorySegment['key'];

  /**
   * Gets the part's name.
   */
  readonly label: string;

  /**
   * Gets the part's share of the whole, 0–100, for its width in the bar.
   */
  readonly percent: number;

  /**
   * Gets the part's size and share, formatted (`45.7 GB (17.8%)`).
   */
  readonly value: string;

  /**
   * Gets the part's colour.
   */
  readonly colour: string;
}

/**
 * Represents the Memory view's breakdown card: what holds the machine's memory — apps, wired,
 * compressed, cached files and free, as far as the platform reports them — as one bar of parts, each
 * named with its size and share.
 */
@Component({
  selector: 'app-system-monitor-memory-breakdown-card',
  imports: [DashboardCard],
  templateUrl: './memory-breakdown-card.html',
  styleUrl: './memory-breakdown-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemoryBreakdownCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's readings.
   */
  private readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets the parts, each a share of their sum (the parts reported, which on most platforms is all of
   * memory).
   */
  protected readonly parts: Signal<readonly BreakdownPart[]> = computed(
    (): readonly BreakdownPart[] => {
      const segments: readonly MemorySegment[] = this.readings.memorySegments();
      const whole: number = segments.reduce(
        (sum: number, segment: MemorySegment): number => sum + segment.bytes,
        0,
      );
      return whole <= 0
        ? []
        : segments.map((segment: MemorySegment): BreakdownPart => {
            const percent: number = (segment.bytes / whole) * 100;
            return {
              key: segment.key,
              label: segment.label,
              percent,
              value: `${formatBytes(segment.bytes)} (${formatShare(percent)})`,
              colour: memoryColour(segment.key),
            };
          });
    },
  );
}
