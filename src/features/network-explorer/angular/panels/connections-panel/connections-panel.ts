import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { Chip, ChipTone } from '@shared/angular/components/chip/chip';
import { Button } from '@shared/angular/components/forms/button/button';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { NetworkInterfaceInfo } from '@shared/api/system-monitor-channels';
import { ConnectionRow, NetworkActivity } from '../../network-activity/network-activity';
import { endpointPort } from '../../network-activity/network-endpoints';
import { NetworkCaptures } from '../../network-captures/network-captures';
import { NetworkRuns } from '../../network-runs/network-runs';

/**
 * The Network Explorer's Connections panel: every connection this machine has open to a remote peer,
 * with the process that owns it, both ends, its protocol and its state.
 *
 * Listening sockets are left out — they are waiting for a peer, not connected to one — and so,
 * unless asked for, are connections between this machine and itself. Choosing an interface in the
 * Interfaces panel narrows the list to the connections made over it.
 *
 * Each row can ping its remote peer, trace the route to it, or watch it — capture the packets to and
 * from that peer on the interface the connection is made over; each opens in the well.
 */
@Component({
  selector: 'app-connections-panel',
  imports: [Button, Chip, PanelToolbar, TextField],
  templateUrl: './connections-panel.html',
  styleUrl: './connections-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectionsPanel {
  /**
   * Gets the dock panel this component is projected into.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Holds the tab's network readings and selection.
   */
  protected readonly activity: NetworkActivity = inject(NetworkActivity);

  /**
   * Holds the tab's pings and traces.
   */
  private readonly runs: NetworkRuns = inject(NetworkRuns);

  /**
   * Holds the tab's packet captures.
   */
  private readonly captures: NetworkCaptures = inject(NetworkCaptures);

  /**
   * Holds the icon tokens used by the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets what the list is showing, for the strip: how many connections, and over which interface.
   */
  protected readonly summary: Signal<string> = computed((): string => {
    const count: number = this.activity.connections().length;
    const noun: string = count === 1 ? 'connection' : 'connections';
    const selected: NetworkInterfaceInfo | undefined = this.activity.selectedInterface();
    return selected === undefined
      ? `${count} ${noun}`
      : `${count} ${noun} over ${selected.name} (${selected.id})`;
  });

  /**
   * Gets the tone a connection's state is shown in: established connections are good, ones opening or
   * closing are in between, the rest quiet.
   * @param state The state.
   * @returns Returns the tone.
   */
  protected toneOf(state: string): ChipTone {
    if (state === 'ESTABLISHED') {
      return 'success';
    }
    return state.startsWith('SYN') || state.endsWith('WAIT') ? 'warning' : 'neutral';
  }

  /**
   * Pings a connection's remote peer.
   * @param row The connection's row.
   */
  protected ping(row: ConnectionRow): void {
    this.runs.ping(row.remoteHost);
  }

  /**
   * Traces the route to a connection's remote peer.
   * @param row The connection's row.
   */
  protected trace(row: ConnectionRow): void {
    this.runs.trace(row.remoteHost);
  }

  /**
   * Gets the interface a connection would be watched on: the one it is made over, or the default
   * route's when its local address matches none.
   * @param row The connection's row.
   * @returns Returns the interface's id, or undefined when there is none to watch on.
   */
  private watchInterfaceOf(row: ConnectionRow): string | undefined {
    return (
      row.interfaceId ??
      this.activity.info()?.interfaces.find((info: NetworkInterfaceInfo): boolean => info.isDefault)
        ?.id
    );
  }

  /**
   * Gets whether a connection can be watched: it has a port, and an interface to capture on.
   * @param row The connection's row.
   * @returns Returns true when Watch can start.
   */
  protected canWatch(row: ConnectionRow): boolean {
    return (
      endpointPort(row.connection.remote) !== undefined && this.watchInterfaceOf(row) !== undefined
    );
  }

  /**
   * Captures the packets to and from a connection's remote peer.
   * @param row The connection's row.
   */
  protected watch(row: ConnectionRow): void {
    const port: number | undefined = endpointPort(row.connection.remote);
    const interfaceId: string | undefined = this.watchInterfaceOf(row);
    if (port !== undefined && interfaceId !== undefined) {
      this.captures.watchConnection(interfaceId, row.remoteHost, port);
    }
  }
}
