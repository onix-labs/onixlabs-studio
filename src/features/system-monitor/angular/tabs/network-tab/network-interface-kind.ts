import { Icon } from '@shared/angular/icons/icon';
import { NetworkInterfaceKind } from '@shared/api/system-monitor-channels';

/**
 * How each kind of network interface is described.
 */
export const NETWORK_KIND_LABELS: Readonly<Record<NetworkInterfaceKind, string>> = {
  ethernet: 'Ethernet',
  wifi: 'Wi-Fi',
  loopback: 'Loopback',
  vpn: 'VPN / Tunnel',
  bridge: 'Bridge',
  virtual: 'Virtual',
  other: 'Interface',
};

/**
 * The icon each kind of network interface wears.
 */
export const NETWORK_KIND_ICONS: Readonly<Record<NetworkInterfaceKind, Icon>> = {
  ethernet: Icon.MONITOR_ETHERNET,
  wifi: Icon.MONITOR_WIFI,
  loopback: Icon.MONITOR_LOOPBACK,
  vpn: Icon.MONITOR_VPN,
  bridge: Icon.MONITOR_BRIDGE,
  virtual: Icon.MONITOR_VIRTUAL,
  other: Icon.MONITOR_NETWORK,
};

/**
 * Formats a link speed (`10 Gbit/s`, `152 Mbit/s`).
 * @param megabits The speed, in megabits per second.
 * @returns Returns the formatted speed.
 */
export function formatLinkSpeed(megabits: number): string {
  return megabits >= 1000
    ? `${Number((megabits / 1000).toFixed(1))} Gbit/s`
    : `${Math.round(megabits)} Mbit/s`;
}
