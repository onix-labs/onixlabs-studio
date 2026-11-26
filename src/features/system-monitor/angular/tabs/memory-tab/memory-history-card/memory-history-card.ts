import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { Icon } from '@shared/angular/icons/icon';
import { ChartSeries } from '../../../charts/chart-series';
import { LineChart } from '../../../charts/line-chart/line-chart';
import { formatPercent } from '../../../readings/format';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Identifies what the history graph shows: memory in use, memory pressure, or swap in use.
 */
type MemoryHistoryMode = 'usage' | 'pressure' | 'swap';

/**
 * Represents the Memory view's history card: memory over the graph's span, as the system's and Studio's
 * use, as pressure, or as swap in use, each a share of 0–100%.
 */
@Component({
  selector: 'app-system-monitor-memory-history-card',
  imports: [DashboardCard, Button, LineChart],
  templateUrl: './memory-history-card.html',
  styleUrl: './memory-history-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemoryHistoryCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's readings.
   */
  protected readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets how a share is written, on the axis and in the readout.
   */
  protected readonly percent: (value: number) => string = formatPercent;

  /**
   * Holds what the graph shows.
   */
  protected readonly mode: WritableSignal<MemoryHistoryMode> = signal<MemoryHistoryMode>('usage');

  /**
   * Gets the card's title: what it shows over which span.
   */
  protected readonly heading: Signal<string> = computed(
    (): string => `Memory Usage (${this.readings.historyLabel()})`,
  );

  /**
   * Gets the graph's series for what it shows.
   */
  protected readonly series: Signal<readonly ChartSeries[]> = computed(
    (): readonly ChartSeries[] => {
      switch (this.mode()) {
        case 'pressure':
          return [
            { label: 'Pressure', values: this.readings.pressureHistory(), emphasis: 'primary' },
          ];
        case 'swap':
          return [{ label: 'Swap', values: this.readings.swapHistory(), emphasis: 'primary' }];
        default:
          return [
            { label: 'System', values: this.readings.memoryHistory(), emphasis: 'primary' },
            { label: 'Studio', values: this.readings.appMemoryHistory(), emphasis: 'secondary' },
          ];
      }
    },
  );

  /**
   * Gets what the graph says instead, where what it shows is not reported, or null to draw it.
   */
  protected readonly unavailable: Signal<string | null> = computed((): string | null => {
    const mode: MemoryHistoryMode = this.mode();
    if (mode === 'swap' && (this.readings.memoryDetail()?.swapTotalBytes ?? 0) === 0) {
      return 'No swap is configured.';
    }
    if (mode === 'pressure' && this.readings.memoryDetail()?.pressure === undefined) {
      return 'This platform does not report memory pressure.';
    }
    return null;
  });

  /**
   * Shows memory in use, pressure, or swap in use.
   * @param mode What to show.
   */
  protected setMode(mode: MemoryHistoryMode): void {
    this.mode.set(mode);
  }
}
