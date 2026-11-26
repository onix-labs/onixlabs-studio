import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Chip, ChipTone } from '@shared/angular/components/chip/chip';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { NetworkConnection } from '@shared/api/system-monitor-channels';
import { formatCount } from '../../../readings/format';
import { ProcessIcons } from '../../../readings/process-icons';
import { SystemMonitorNetwork } from '../../../readings/system-monitor-network';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Describes one connection's row.
 */
interface ConnectionRow {
  /**
   * Gets the connection.
   */
  readonly connection: NetworkConnection;

  /**
   * Gets the row's identity, unique within the list.
   */
  readonly key: string;

  /**
   * Gets the state's tone: established connections are good, listening sockets informative, the rest
   * quiet.
   */
  readonly tone: ChipTone;
}

/**
 * Gets the tone a connection's state is shown in.
 * @param state The state.
 * @returns Returns the tone.
 */
function toneOf(state: string): ChipTone {
  if (state === 'ESTABLISHED') {
    return 'success';
  }
  return state === 'LISTEN' || state === 'LISTENING' ? 'info' : 'neutral';
}

/**
 * Represents the Network view's Active Connections card: every connection and listening socket, with
 * the process that owns it (and its app's icon), its endpoints, protocol and state. Established
 * connections are listed first; the list scrolls within the card.
 */
@Component({
  selector: 'app-system-monitor-network-connections-card',
  imports: [AppIcon, Chip, DashboardCard],
  templateUrl: './network-connections-card.html',
  styleUrl: './network-connections-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NetworkConnectionsCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the view's network readings.
   */
  private readonly network: SystemMonitorNetwork = inject(SystemMonitorNetwork);

  /**
   * Gets the apps' icons.
   */
  protected readonly icons: ProcessIcons = inject(ProcessIcons);

  /**
   * Gets the card's heading, counting the connections.
   */
  protected readonly heading: Signal<string> = computed((): string => {
    const connections: readonly NetworkConnection[] | null = this.network.connections();
    return connections === null
      ? 'Active Connections'
      : `Active Connections (${formatCount(connections.length)})`;
  });

  /**
   * Gets the connections' rows, or null before they are read.
   */
  protected readonly rows: Signal<readonly ConnectionRow[] | null> = computed(
    (): readonly ConnectionRow[] | null =>
      this.network
        .connections()
        ?.map((connection: NetworkConnection, index: number): ConnectionRow => ({
          connection,
          key: `${connection.protocol} ${connection.local} ${connection.remote} ${connection.pid ?? ''} ${index}`,
          tone: toneOf(connection.state),
        })) ?? null,
  );
}
