import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { NetworkInterfaceReading } from '@shared/api/system-monitor-channels';
import { formatBytes, formatCount } from '../../../readings/format';
import { SystemMonitorNetwork } from '../../../readings/system-monitor-network';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Describes one statistic.
 */
interface Statistic {
  /**
   * Gets the statistic's label.
   */
  readonly label: string;

  /**
   * Gets the statistic's value.
   */
  readonly value: string;
}

/**
 * Represents the Network view's Network Statistics card: what the chosen interface has received and
 * sent since its counters started (at boot), in bytes and packets, with its errors and drops.
 */
@Component({
  selector: 'app-system-monitor-network-statistics-card',
  imports: [DashboardCard],
  templateUrl: './network-statistics-card.html',
  styleUrl: './network-statistics-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NetworkStatisticsCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the view's network readings.
   */
  private readonly network: SystemMonitorNetwork = inject(SystemMonitorNetwork);

  /**
   * Gets the card's heading, naming the interface.
   */
  protected readonly heading: Signal<string> = computed((): string => {
    const id: string | undefined = this.network.selected()?.id;
    return id === undefined ? 'Network Statistics' : `Network Statistics — ${id}`;
  });

  /**
   * Gets the interface's statistics, or none before it is read.
   */
  protected readonly statistics: Signal<readonly Statistic[]> = computed(
    (): readonly Statistic[] => {
      const reading: NetworkInterfaceReading | null = this.network.selectedReading();
      return reading === null
        ? []
        : [
            { label: 'Bytes Received', value: formatBytes(reading.totalRxBytes) },
            { label: 'Bytes Sent', value: formatBytes(reading.totalTxBytes) },
            { label: 'Packets Received', value: formatCount(reading.totalRxPackets) },
            { label: 'Packets Sent', value: formatCount(reading.totalTxPackets) },
            { label: 'Receive Errors', value: formatCount(reading.rxErrors) },
            { label: 'Transmit Errors', value: formatCount(reading.txErrors) },
            { label: 'Dropped Packets', value: formatCount(reading.dropped) },
          ];
    },
  );
}
