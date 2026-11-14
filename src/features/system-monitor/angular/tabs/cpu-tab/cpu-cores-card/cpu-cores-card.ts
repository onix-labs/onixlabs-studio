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
import { formatPercent } from '../../../readings/format';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { Sparkline } from '../../../sparkline/sparkline';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Identifies how the cores are laid out: a grid of tiles, or a list of rows.
 */
type CoreLayout = 'grid' | 'list';

/**
 * Describes one core.
 */
interface CoreReading {
  /**
   * Gets the core's number, from 1.
   */
  readonly number: number;

  /**
   * Gets the core's load, 0–100.
   */
  readonly percent: number;

  /**
   * Gets the core's load, formatted.
   */
  readonly value: string;

  /**
   * Gets the core's recent load.
   */
  readonly values: readonly number[];
}

/**
 * Represents the CPU view's per-core card: every logical core's load, as a grid of small graphs or a
 * list of rows with a bar each. Every core is shown at once, scrolling within the card when they do
 * not fit.
 */
@Component({
  selector: 'app-system-monitor-cpu-cores-card',
  imports: [DashboardCard, Button, Sparkline],
  templateUrl: './cpu-cores-card.html',
  styleUrl: './cpu-cores-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CpuCoresCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's readings.
   */
  private readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Holds the layout chosen.
   */
  protected readonly layout: WritableSignal<CoreLayout> = signal<CoreLayout>('grid');

  /**
   * Gets each core's reading, in the OS's core order.
   */
  protected readonly cores: Signal<readonly CoreReading[]> = computed(
    (): readonly CoreReading[] => {
      const latest: readonly number[] = this.readings.cores();
      return this.readings
        .coreHistories()
        .map((values: readonly number[], index: number): CoreReading => {
          const percent: number = latest[index] ?? 0;
          return { number: index + 1, percent, value: formatPercent(percent), values };
        });
    },
  );

  /**
   * Gets the card's title, counting the cores once they are known.
   */
  protected readonly heading: Signal<string> = computed((): string => {
    const count: number = this.cores().length;
    return count === 0 ? 'Utilisation by Core' : `Utilisation by Core (${count})`;
  });

  /**
   * Lays the cores out as a grid or a list.
   * @param layout The layout.
   */
  protected setLayout(layout: CoreLayout): void {
    this.layout.set(layout);
  }
}
