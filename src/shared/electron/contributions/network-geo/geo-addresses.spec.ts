import { isPrivateAddress } from './geo-addresses';

describe('geo addresses', () => {
  it('isPrivateAddress_coversPrivateAndReservedIpv4', () => {
    expect(
      [
        '10.1.2.3',
        '172.16.0.1',
        '172.31.255.255',
        '192.168.1.1',
        '127.0.0.1',
        '169.254.10.10',
        '100.64.0.1',
        '100.127.255.255',
        '0.0.0.0',
        '224.0.0.1',
      ].every(isPrivateAddress),
    ).toBe(true);
  });

  it('isPrivateAddress_letsPublicIpv4Through', () => {
    expect(
      ['1.1.1.1', '8.8.8.8', '172.32.0.1', '100.128.0.1', '51.191.191.254'].some(isPrivateAddress),
    ).toBe(false);
  });

  it('isPrivateAddress_coversPrivateIpv6', () => {
    expect(
      ['::1', '::', 'fd12::1', 'fc00::1', 'fe80::1', 'fe80::aede:48ff:fe00:1122%en7', 'ff02::1']
        .every(isPrivateAddress),
    ).toBe(true);
  });

  it('isPrivateAddress_letsPublicIpv6Through', () => {
    expect(['2606:4700:4700::1111', '2a00:1450:4009::'].some(isPrivateAddress)).toBe(false);
  });

  it('isPrivateAddress_judgesAMappedAddressAsItsIpv4', () => {
    expect(isPrivateAddress('::ffff:192.168.1.1')).toBe(true);
    expect(isPrivateAddress('::ffff:1.1.1.1')).toBe(false);
  });

  it('isPrivateAddress_treatsAnythingButAnAddressAsUnplaceable', () => {
    expect(isPrivateAddress('example.com')).toBe(true);
  });
});
