import { isValidHost, pingCommand, traceCommand } from './network-tool-commands';

describe('network tool commands', () => {
  it('isValidHost_acceptsAddressesAndHostNames', () => {
    expect(
      [
        '1.1.1.1',
        '2001:db8::1',
        'fe80::aede:48ff:fe00:1122%en7',
        'example.com',
        'example.com.',
        'localhost',
        'a-b.example',
      ].every(isValidHost),
    ).toBe(true);
  });

  it('isValidHost_refusesOptionsAndJunk', () => {
    expect(
      [
        '',
        '-c',
        '--help',
        '1.1.1.1 -f',
        'example.com;rm',
        'a..b',
        '-example.com',
        'fe80::1%en0 x',
        '1.1.1.1%en0',
        'x'.repeat(254),
      ].some(isValidHost),
    ).toBe(false);
  });

  it('pingCommand_usesPing6ForIpv6_onMacOs', () => {
    expect(pingCommand('1.1.1.1', 4, 'darwin')).toEqual({
      command: '/sbin/ping',
      args: ['-c', '4', '1.1.1.1'],
    });
    expect(pingCommand('::1', 4, 'darwin')?.command).toBe('/sbin/ping6');
  });

  it('traceCommand_isNumeric_andUsesTraceroute6ForIpv6', () => {
    expect(traceCommand('1.1.1.1', 30, 'darwin')).toEqual({
      command: '/usr/sbin/traceroute',
      args: ['-n', '-q', '3', '-w', '2', '-m', '30', '1.1.1.1'],
    });
    expect(traceCommand('fe80::1%en0', 30, 'darwin')?.command).toBe('/usr/sbin/traceroute6');
    expect(traceCommand('2001:db8::1', 30, 'linux')?.args[0]).toBe('-6');
  });

  it('commands_areUnsupportedOnWindows', () => {
    expect(pingCommand('1.1.1.1', 4, 'win32')).toBeUndefined();
    expect(traceCommand('1.1.1.1', 30, 'win32')).toBeUndefined();
  });
});
