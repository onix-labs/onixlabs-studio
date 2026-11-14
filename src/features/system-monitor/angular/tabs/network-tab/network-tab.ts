import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { NetworkConnection, NetworkInterfaceInfo } from '@shared/api/system-monitor-channels';
import { formatBytes, formatCount, formatRate } from '../../readings/format';
import { NetworkTotals, SystemMonitorNetwork } from '../../readings/system-monitor-network';
import { NetworkActivityCard } from './network-activity-card/network-activity-card';
import { NetworkConnectionsCard } from './network-connections-card/network-connections-card';
import { NetworkInterfaceCard } from './network-interface-card/network-interface-card';
import {
  isActiveInterface,
  NetworkInterfacesCard,
} from './network-interfaces-card/network-interfaces-card';
import { NetworkPacketsCard } from './network-packets-card/network-packets-card';
import { NetworkStatisticsCard } from './network-statistics-card/network-statistics-card';
import { NetworkThroughputCard } from './network-throughput-card/network-throughput-card';

/**
 * Describes one figure in the header's summary.
 */
interface SummaryChip {
  /**
   * Gets the figure's label.
   */
  readonly label: string;

  /**
   * Gets the figure's value.
   */
  readonly value: string;
}

/**
 * Represents the System Monitor's Network view: the machine's interfaces and connections. A header
 * counts the interfaces and sums the live and total traffic, the connections and the DNS server's
 * latency; beneath it, the throughput and packets of every interface together over Graph History, the
 * interfaces (one chosen), what the chosen one is, its traffic and its totals since boot, and every
 * connection with the process that owns it.
 *
 * The network is read only while the view is in front of the user.
 */
@Component({
  selector: 'app-system-monitor-network-tab',
  imports: [
    AppIcon,
    NetworkActivityCard,
    NetworkConnectionsCard,
    NetworkInterfaceCard,
    NetworkInterfacesCard,
    NetworkPacketsCard,
    NetworkStatisticsCard,
    NetworkThroughputCard,
  ],
  templateUrl: './network-tab.html',
  styleUrl: './network-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NetworkTab {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the view's network readings.
   */
  private readonly network: SystemMonitorNetwork = inject(SystemMonitorNetwork);

  /**
   * Gets the count beside the title: the interfaces and how many are active.
   */
  protected readonly count: Signal<string> = computed((): string => {
    if (this.network.info() === null) {
      return '';
    }
    const interfaces: readonly NetworkInterfaceInfo[] = this.network.interfaces();
    const active: number = interfaces.filter(isActiveInterface).length;
    return `${interfaces.length} ${interfaces.length === 1 ? 'interface' : 'interfaces'} • ${active} active`;
  });

  /**
   * Gets the header's summary: the live download and upload, the totals since boot, the connections
   * and the DNS server's latency.
   */
  protected readonly chips: Signal<readonly SummaryChip[]> = computed(
    (): readonly SummaryChip[] => {
      const totals: NetworkTotals = this.network.totals();
      const connections: readonly NetworkConnection[] | null = this.network.connections();
      const latency: number | null = this.network.dnsLatencyMs();
      return [
        { label: 'Download (Live)', value: formatRate(totals.rxBytesPerSecond) },
        { label: 'Upload (Live)', value: formatRate(totals.txBytesPerSecond) },
        { label: 'Total Received', value: formatBytes(totals.totalRxBytes) },
        { label: 'Total Sent', value: formatBytes(totals.totalTxBytes) },
        {
          label: 'Connections',
          value: connections === null ? '—' : formatCount(connections.length),
        },
        { label: 'Latency (DNS)', value: latency === null ? '—' : `${latency} ms` },
      ];
    },
  );
}
