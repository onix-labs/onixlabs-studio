import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { ChartLayer } from '../../../charts/chart-layer';
import { StackedAreaChart } from '../../../charts/stacked-area-chart/stacked-area-chart';
import { formatAxisBytes, formatBytes } from '../../../readings/format';
import { memoryColour } from '../../../readings/memory-colour';
import { MemorySegment } from '../../../readings/memory-segment';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { DashboardBadge } from '../../dashboard-badge/dashboard-badge';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Describes one entry of the composition's legend.
 */
interface CompositionEntry {
  /**
   * Gets the part.
   */
  readonly key: MemorySegment['key'];

  /**
   * Gets the part's name.
   */
  readonly label: string;

  /**
   * Gets the part's latest size, formatted.
   */
  readonly value: string;

  /**
   * Gets the part's colour.
   */
  readonly colour: string;
}

/**
 * Represents the Memory view's composition card: what holds the machine's memory over the graph's span,
 * each part stacked on the last against the whole of memory — the free memory being what is left above
 * — and the parts named beside it, the top of the stack first. The graph is as tall as its legend,
 * and the span it covers is a chip beside the title.
 */
@Component({
  selector: 'app-system-monitor-memory-composition-card',
  imports: [DashboardCard, DashboardBadge, StackedAreaChart],
  templateUrl: './memory-composition-card.html',
  styleUrl: './memory-composition-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemoryCompositionCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's readings.
   */
  protected readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets how a size is written on the axis and in the readout.
   */
  protected readonly size: (value: number) => string = formatAxisBytes;

  /**
   * Gets the whole the parts are stacked against: the machine's memory.
   */
  protected readonly total: Signal<number> = computed(
    (): number => this.readings.latest()?.memory.totalBytes ?? 1,
  );

  /**
   * Gets the stacked parts, bottom first: every part but free, which is the room left above them.
   */
  protected readonly layers: Signal<readonly ChartLayer[]> = computed((): readonly ChartLayer[] => {
    const histories: ReadonlyMap<MemorySegment['key'], readonly number[]> =
      this.readings.segmentHistories();
    return this.readings
      .memorySegments()
      .filter((segment: MemorySegment): boolean => segment.key !== 'free')
      .map((segment: MemorySegment): ChartLayer => ({
        label: segment.label,
        values: histories.get(segment.key) ?? [],
        color: memoryColour(segment.key),
      }));
  });

  /**
   * Gets the legend, the top of the stack first, as the bands read.
   */
  protected readonly entries: Signal<readonly CompositionEntry[]> = computed(
    (): readonly CompositionEntry[] =>
      [...this.readings.memorySegments()]
        .reverse()
        .map((segment: MemorySegment): CompositionEntry => ({
          key: segment.key,
          label: segment.label,
          value: formatBytes(segment.bytes),
          colour: memoryColour(segment.key),
        })),
  );
}
