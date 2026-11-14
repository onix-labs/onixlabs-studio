import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import {
  ButtonGroup,
  ButtonGroupOption,
} from '@shared/angular/components/forms/button-group/button-group';
import { Icon } from '@shared/angular/icons/icon';
import {
  NETWORK_SAMPLE_INTERVAL_MS,
  NetworkInterfaceReading,
} from '@shared/api/system-monitor-channels';
import { ChartSeries } from '../../../charts/chart-series';
import { LineChart } from '../../../charts/line-chart/line-chart';
import { formatAxisRate } from '../../../readings/format';
import { SystemMonitorNetwork } from '../../../readings/system-monitor-network';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Identifies which direction the graph shows.
 */
type Direction = 'download' | 'upload';

/**
 * The directions offered.
 */
const DIRECTIONS: readonly ButtonGroupOption[] = [
  { value: 'download', label: 'Download', icon: Icon.MONITOR_IN },
  { value: 'upload', label: 'Upload', icon: Icon.MONITOR_OUT },
];

/**
 * Represents the Network view's Interface Activity card: the chosen interface's download or upload over
 * Graph History, one at a time.
 */
@Component({
  selector: 'app-system-monitor-network-activity-card',
  imports: [ButtonGroup, DashboardCard, LineChart],
  templateUrl: './network-activity-card.html',
  styleUrl: './network-activity-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NetworkActivityCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the directions offered.
   */
  protected readonly directions: readonly ButtonGroupOption[] = DIRECTIONS;

  /**
   * Holds the view's network readings.
   */
  private readonly network: SystemMonitorNetwork = inject(SystemMonitorNetwork);

  /**
   * Gets the axis's formatting.
   */
  protected readonly format: (value: number) => string = formatAxisRate;

  /**
   * Gets the time between readings, for the graph's timescale.
   */
  protected readonly intervalMs: number = NETWORK_SAMPLE_INTERVAL_MS;

  /**
   * Holds the direction shown.
   */
  protected readonly direction: WritableSignal<Direction> = signal<Direction>('download');

  /**
   * Gets the card's heading, naming the interface.
   */
  protected readonly heading: Signal<string> = computed((): string => {
    const id: string | undefined = this.network.selected()?.id;
    return id === undefined ? 'Interface Activity' : `Interface Activity — ${id}`;
  });

  /**
   * Gets the graph's one series: the chosen direction.
   */
  protected readonly series: Signal<readonly ChartSeries[]> = computed(
    (): readonly ChartSeries[] => {
      const download: boolean = this.direction() === 'download';
      return [
        {
          label: download ? 'Download' : 'Upload',
          values: this.network
            .selectedHistory()
            .map((reading: NetworkInterfaceReading): number =>
              download ? reading.rxBytesPerSecond : reading.txBytesPerSecond,
            ),
          emphasis: 'primary',
        },
      ];
    },
  );

  /**
   * Shows a direction.
   * @param value The direction, as the button group's value.
   */
  protected setDirection(value: string): void {
    this.direction.set(value === 'upload' ? 'upload' : 'download');
  }
}
