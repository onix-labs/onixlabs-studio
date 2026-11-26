import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { NetworkInterfaceInfo, NetworkInterfaceReading } from '@shared/api/system-monitor-channels';
import { formatRate } from '../../../readings/format';
import { SystemMonitorNetwork } from '../../../readings/system-monitor-network';
import { DashboardCard } from '../../dashboard-card/dashboard-card';
import { NETWORK_KIND_ICONS, NETWORK_KIND_LABELS } from '../network-interface-kind';

/**
 * Describes one interface in the list.
 */
interface InterfaceRow {
  /**
   * Gets the interface.
   */
  readonly info: NetworkInterfaceInfo;

  /**
   * Gets its icon.
   */
  readonly icon: Icon;

  /**
   * Gets what it is and whether it is active (`Wi-Fi (Active)`).
   */
  readonly detail: string;

  /**
   * Gets whether it is active: up, with an address beyond the link-local one.
   */
  readonly active: boolean;

  /**
   * Gets its live download, formatted, or a dash while it is down.
   */
  readonly download: string;

  /**
   * Gets its live upload, formatted, or a dash while it is down.
   */
  readonly upload: string;
}

/**
 * Represents the Network view's Network Interfaces card: every interface, the default first, each with
 * its kind, whether it is active, and its live download and upload. One is chosen to be described by
 * the cards beside it.
 */
@Component({
  selector: 'app-system-monitor-network-interfaces-card',
  imports: [AppIcon, DashboardCard],
  templateUrl: './network-interfaces-card.html',
  styleUrl: './network-interfaces-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NetworkInterfacesCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's network readings.
   */
  protected readonly network: SystemMonitorNetwork = inject(SystemMonitorNetwork);

  /**
   * Gets the interfaces' rows.
   */
  protected readonly rows: Signal<readonly InterfaceRow[]> = computed(
    (): readonly InterfaceRow[] => {
      const readings: ReadonlyMap<string, NetworkInterfaceReading> = this.network.latestById();
      return this.network.interfaces().map((info: NetworkInterfaceInfo): InterfaceRow => {
        const reading: NetworkInterfaceReading | undefined = readings.get(info.id);
        const active: boolean = isActiveInterface(info);
        const kind: string =
          info.name !== info.id && info.name !== NETWORK_KIND_LABELS[info.kind]
            ? `${info.name} · ${NETWORK_KIND_LABELS[info.kind]}`
            : NETWORK_KIND_LABELS[info.kind];
        return {
          info,
          icon: NETWORK_KIND_ICONS[info.kind],
          detail: active ? `${kind} (Active)` : info.up ? kind : `${kind} (Down)`,
          active,
          download: reading === undefined || !info.up ? '–' : formatRate(reading.rxBytesPerSecond),
          upload: reading === undefined || !info.up ? '–' : formatRate(reading.txBytesPerSecond),
        };
      });
    },
  );

  /**
   * Gets whether the interfaces have been read.
   */
  protected readonly read: Signal<boolean> = computed((): boolean => this.network.info() !== null);
}

/**
 * Decides whether an interface is active: up, not the loopback, with an IPv4 address or a global IPv6
 * one.
 * @param info The interface.
 * @returns Returns true when it is active.
 */
export function isActiveInterface(info: NetworkInterfaceInfo): boolean {
  return (
    info.up &&
    info.kind !== 'loopback' &&
    (info.ipv4 !== undefined || (info.ipv6 !== undefined && !/^fe80:/i.test(info.ipv6)))
  );
}
