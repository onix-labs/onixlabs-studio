import { ChangeDetectionStrategy, Component, inject, input, InputSignal } from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { NetworkInterfaceKind } from '@shared/api/system-monitor-channels';
import { formatRate } from '../../network-activity/format-rate';
import { InterfaceRow, NetworkActivity } from '../../network-activity/network-activity';
import { NetworkCaptures } from '../../network-captures/network-captures';

/**
 * The Network Explorer's Interfaces panel: the machine's network interfaces, what each is, its
 * addresses, how busy it is, and how many remote connections are made over it.
 *
 * Choosing an interface narrows the Connections panel to it; choosing it again widens it back to
 * every interface. Interfaces that are down or carry no address are left out unless asked for — a Mac
 * reports a dozen of them.
 *
 * Each interface can be watched: its packets captured, live, in a document of their own.
 */
@Component({
  selector: 'app-interfaces-panel',
  imports: [AppIcon, Button, PanelToolbar],
  templateUrl: './interfaces-panel.html',
  styleUrl: './interfaces-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InterfacesPanel {
  /**
   * Gets the dock panel this component is projected into.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Holds the tab's network readings and selection.
   */
  protected readonly activity: NetworkActivity = inject(NetworkActivity);

  /**
   * Holds the tab's packet captures.
   */
  private readonly captures: NetworkCaptures = inject(NetworkCaptures);

  /**
   * Holds the icon tokens used by the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Formats a rate for the template.
   */
  protected readonly formatRate: (bytesPerSecond: number) => string = formatRate;

  /**
   * Gets the icon an interface's kind is shown with.
   * @param kind The kind.
   * @returns Returns the icon.
   */
  protected iconFor(kind: NetworkInterfaceKind): Icon {
    switch (kind) {
      case 'ethernet':
        return Icon.MONITOR_ETHERNET;
      case 'wifi':
        return Icon.MONITOR_WIFI;
      case 'loopback':
        return Icon.MONITOR_LOOPBACK;
      case 'vpn':
        return Icon.MONITOR_VPN;
      case 'bridge':
        return Icon.MONITOR_BRIDGE;
      case 'virtual':
      case 'other':
        return Icon.MONITOR_VIRTUAL;
    }
  }

  /**
   * Gets an interface's addresses as one line.
   * @param row The interface's row.
   * @returns Returns its addresses, or a note that it has none.
   */
  protected addresses(row: InterfaceRow): string {
    const addresses: readonly string[] = [row.info.ipv4, row.info.ipv6].filter(
      (address: string | undefined): address is string => address !== undefined,
    );
    return addresses.length > 0 ? addresses.join(' · ') : 'No address';
  }

  /**
   * Narrows the Connections panel to an interface, or widens it back.
   * @param row The interface's row.
   */
  protected choose(row: InterfaceRow): void {
    this.activity.select(row.info.id);
  }

  /**
   * Re-reads the machine's interfaces.
   */
  protected refresh(): void {
    void this.activity.refresh();
  }

  /**
   * Captures an interface's packets, in a document of their own.
   * @param row The interface's row.
   */
  protected watch(row: InterfaceRow): void {
    this.captures.watchInterface(row.info.id, row.info.name);
  }
}
