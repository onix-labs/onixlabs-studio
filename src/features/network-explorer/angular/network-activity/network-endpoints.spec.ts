import { NetworkConnection, NetworkInterfaceInfo } from '@shared/api/system-monitor-channels';
import {
  endpointHost,
  endpointPort,
  hasRemotePeer,
  interfaceOf,
  isLoopbackHost,
  isUnspecifiedHost,
} from './network-endpoints';

/**
 * Builds a TCP connection between two endpoints.
 * @param local The local endpoint.
 * @param remote The remote endpoint.
 * @returns Returns the connection.
 */
function connection(local: string, remote: string): NetworkConnection {
  return { protocol: 'TCP', local, remote, state: 'ESTABLISHED' };
}

const interfaces: readonly NetworkInterfaceInfo[] = [
  { id: 'lo0', name: 'Loopback', kind: 'loopback', up: true, isDefault: false, ipv4: '127.0.0.1' },
  {
    id: 'en0',
    name: 'Wi-Fi',
    kind: 'wifi',
    up: true,
    isDefault: true,
    ipv4: '192.168.1.20',
    ipv6: 'FE80::AAAA',
  },
];

describe('network endpoints', () => {
  it('endpointHost_stripsThePortAndBrackets', () => {
    expect(endpointHost('192.168.1.20:443')).toBe('192.168.1.20');
    expect(endpointHost('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(endpointHost('*:53')).toBe('*');
    expect(endpointHost('2001:db8::1')).toBe('2001:db8::1');
    expect(endpointHost('')).toBe('');
  });

  it('endpointPort_readsThePort_ofEitherFamily', () => {
    expect(endpointPort('140.82.112.3:443')).toBe(443);
    expect(endpointPort('[2001:db8::1]:8443')).toBe(8443);
    expect(endpointPort('[fe80::1%en0]:49253')).toBe(49253);
    expect(endpointPort('*:*')).toBeUndefined();
    expect(endpointPort('2001:db8::1')).toBeUndefined();
    expect(endpointPort('')).toBeUndefined();
  });

  it('isUnspecifiedHost_coversWildcardsAndAnyAddresses', () => {
    expect(['', '*', '0.0.0.0', '::'].every(isUnspecifiedHost)).toBe(true);
    expect(isUnspecifiedHost('10.0.0.1')).toBe(false);
  });

  it('isLoopbackHost_coversBothFamilies', () => {
    expect(
      ['127.0.0.1', '127.8.8.8', '::1', 'localhost', '::ffff:127.0.0.1'].every(isLoopbackHost),
    ).toBe(true);
    expect(isLoopbackHost('10.0.0.1')).toBe(false);
  });

  it('hasRemotePeer_isFalseForAListeningSocket', () => {
    expect(hasRemotePeer(connection('*:80', ''))).toBe(false);
    expect(hasRemotePeer(connection('*:80', '*:*'))).toBe(false);
    expect(hasRemotePeer(connection('192.168.1.20:5000', '140.82.112.3:443'))).toBe(true);
  });

  it('interfaceOf_matchesTheLocalAddress', () => {
    expect(interfaceOf(connection('192.168.1.20:5000', '1.1.1.1:443'), interfaces)).toBe('en0');
    expect(interfaceOf(connection('[fe80::aaaa]:5000', '[fe80::1]:443'), interfaces)).toBe('en0');
    expect(interfaceOf(connection('[::ffff:192.168.1.20]:5000', '1.1.1.1:443'), interfaces)).toBe(
      'en0',
    );
  });

  it('interfaceOf_sendsAnyLoopbackAddressToTheLoopbackInterface', () => {
    expect(interfaceOf(connection('127.0.0.1:5000', '127.0.0.1:6000'), interfaces)).toBe('lo0');
    expect(interfaceOf(connection('[::1]:5000', '[::1]:6000'), interfaces)).toBe('lo0');
  });

  it('interfaceOf_readsTheZoneOfALinkLocalAddress', () => {
    expect(interfaceOf(connection('[fe80::1234%en0]:5000', '[fe80::1]:443'), interfaces)).toBe(
      'en0',
    );
  });

  it('interfaceOf_isUndefinedForAnAddressNoInterfaceCarries', () => {
    expect(interfaceOf(connection('[2001:db8::99]:5000', '[2001:db8::1]:443'), interfaces)).toBe(
      undefined,
    );
  });
});
