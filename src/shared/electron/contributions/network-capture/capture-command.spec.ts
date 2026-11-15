import {
  captureCommand,
  isPermissionError,
  isValidFilter,
  isValidInterface,
} from './capture-command';

describe('capture command', () => {
  it('isValidInterface_acceptsRealNames_andRefusesOptions', () => {
    expect(['en0', 'lo0', 'utun3', 'bridge100', 'eth0.42', 'wlp2s0'].every(isValidInterface)).toBe(
      true,
    );
    expect(
      ['', '-i', '--help', 'en0 -w /tmp/x', 'en0;rm', 'x'.repeat(33)].some(isValidInterface),
    ).toBe(false);
  });

  it('isValidFilter_acceptsALine_andRefusesControlCharacters', () => {
    expect(isValidFilter('tcp port 443 and host 140.82.112.3')).toBe(true);
    expect(isValidFilter('')).toBe(true);
    expect(isValidFilter('tcp\n-w /tmp/x')).toBe(false);
    expect(isValidFilter('x'.repeat(1025))).toBe(false);
  });

  it('captureCommand_writesUnbufferedPcapToStandardOutput_withTheFilterAfterTheOptions', () => {
    expect(captureCommand('en0', ' tcp port 443 ', 'darwin')).toEqual({
      command: '/usr/sbin/tcpdump',
      args: ['-i', 'en0', '-n', '-U', '-s', '0', '-w', '-', '--', 'tcp port 443'],
    });
    expect(captureCommand('en0', '', 'darwin')?.args).not.toContain('--');
    expect(captureCommand('en0', '', 'win32')).toBeUndefined();
  });

  it('isPermissionError_recognisesTcpdumpsComplaints', () => {
    expect(
      isPermissionError(
        "tcpdump: en0: You don't have permission to capture on that device ((cannot open BPF device) /dev/bpf0: Permission denied)",
      ),
    ).toBe(true);
    expect(isPermissionError('tcpdump: en0: No such device exists')).toBe(false);
  });
});
