import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Chip } from '@shared/angular/components/chip/chip';
import { Icon } from '@shared/angular/icons/icon';
import { NetworkInfo, NetworkInterfaceInfo } from '@shared/api/system-monitor-channels';
import { SystemMonitorNetwork } from '../../../readings/system-monitor-network';
import { DashboardCard } from '../../dashboard-card/dashboard-card';
import {
  formatLinkSpeed,
  NETWORK_KIND_ICONS,
  NETWORK_KIND_LABELS,
} from '../network-interface-kind';

/**
 * Describes one fact about the interface.
 */
interface InterfaceFact {
  /**
   * Gets the fact's label.
   */
  readonly label: string;

  /**
   * Gets the fact's value.
   */
  readonly value: string;
}

/**
 * Represents the Network view's Interface Details card: what the chosen interface is — its kind and
 * state, hardware and IP addresses, link speed and MTU — and, for the default interface, the gateway
 * and DNS servers it reaches the world through.
 */
@Component({
  selector: 'app-system-monitor-network-interface-card',
  imports: [Chip, DashboardCard],
  templateUrl: './network-interface-card.html',
  styleUrl: './network-interface-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NetworkInterfaceCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the view's network readings.
   */
  private readonly network: SystemMonitorNetwork = inject(SystemMonitorNetwork);

  /**
   * Gets the chosen interface, or null before the interfaces are read.
   */
  protected readonly selected: Signal<NetworkInterfaceInfo | null> = this.network.selected;

  /**
   * Gets the card's heading, naming the interface.
   */
  protected readonly heading: Signal<string> = computed((): string => {
    const id: string | undefined = this.selected()?.id;
    return id === undefined ? 'Interface Details' : `Interface Details — ${id}`;
  });

  /**
   * Gets the interface's icon.
   */
  protected readonly icon: Signal<Icon> = computed(
    (): Icon => NETWORK_KIND_ICONS[this.selected()?.kind ?? 'other'],
  );

  /**
   * Gets the interface's facts after its state, those it has.
   */
  protected readonly facts: Signal<readonly InterfaceFact[]> = computed(
    (): readonly InterfaceFact[] => {
      const info: NetworkInterfaceInfo | null = this.selected();
      if (info === null) {
        return [];
      }
      const facts: InterfaceFact[] = [];
      const optional: (label: string, value: string | undefined) => void = (
        label: string,
        value: string | undefined,
      ): void => {
        if (value !== undefined) {
          facts.push({ label, value });
        }
      };
      optional('MAC Address', info.mac);
      optional('IP Address (IPv4)', info.ipv4);
      optional('IP Address (IPv6)', info.ipv6);
      optional('Speed', info.speedMbps === undefined ? undefined : formatLinkSpeed(info.speedMbps));
      optional('MTU', info.mtu === undefined ? undefined : `${info.mtu}`);
      if (info.isDefault) {
        const network: NetworkInfo | null = this.network.info();
        optional('Gateway', network?.gateway);
        optional(
          'DNS Servers',
          network === null || network.dnsServers.length === 0
            ? undefined
            : network.dnsServers.join(', '),
        );
      }
      return facts;
    },
  );

  /**
   * Gets what kind of interface the chosen one is.
   */
  protected readonly kind: Signal<string> = computed((): string => {
    const info: NetworkInterfaceInfo | null = this.selected();
    if (info === null) {
      return '';
    }
    return info.name !== info.id && info.name !== NETWORK_KIND_LABELS[info.kind]
      ? `${NETWORK_KIND_LABELS[info.kind]} (${info.name})`
      : NETWORK_KIND_LABELS[info.kind];
  });
}
