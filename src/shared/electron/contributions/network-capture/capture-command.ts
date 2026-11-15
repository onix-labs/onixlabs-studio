/**
 * Describes how to run `tcpdump`.
 */
export interface CaptureCommand {
  /**
   * Gets the executable.
   */
  readonly command: string;

  /**
   * Gets its arguments.
   */
  readonly args: readonly string[];
}

/**
 * Matches an interface name as the platforms spell them: `en0`, `utun3`, `bridge100`, `eth0.42`,
 * `wlp2s0`. Never starts with `-`, which tcpdump would read as an option.
 */
const INTERFACE: RegExp = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$/;

/**
 * The longest capture filter accepted. Real ones are a line; this only guards against nonsense.
 */
const MAX_FILTER_LENGTH: number = 1024;

/**
 * Gets whether an interface name is safe to hand to tcpdump.
 * @param interfaceId The interface's name.
 * @returns Returns true when it may be captured on.
 */
export function isValidInterface(interfaceId: string): boolean {
  return INTERFACE.test(interfaceId);
}

/**
 * Gets whether a capture filter is safe to hand to tcpdump: printable, one line, of a sane length.
 * Whether it is a filter tcpdump understands is tcpdump's to say, and it says so on starting.
 * @param filter The filter.
 * @returns Returns true when it may be passed on.
 */
export function isValidFilter(filter: string): boolean {
  return (
    filter.length <= MAX_FILTER_LENGTH &&
    Array.from(filter).every((character: string): boolean => {
      const code: number = character.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
  );
}

/**
 * Builds the command that captures on an interface: numeric, unbuffered pcap, every byte of every
 * packet. The filter goes after `--`, so even one tcpdump would otherwise read as an option is only
 * ever its expression.
 * @param interfaceId The interface, already validated.
 * @param filter The capture filter, already validated; empty for every packet.
 * @param platform The operating system.
 * @param output Where the pcap is written: `-` for standard output, or a path.
 * @returns Returns the command, or undefined where capturing is not supported yet.
 */
export function captureCommand(
  interfaceId: string,
  filter: string,
  platform: NodeJS.Platform,
  output: string = '-',
): CaptureCommand | undefined {
  const args: readonly string[] = [
    '-i',
    interfaceId,
    '-n',
    '-U',
    '-s',
    '0',
    '-w',
    output,
    ...(filter.trim().length > 0 ? ['--', filter.trim()] : []),
  ];
  if (platform === 'darwin') {
    return { command: '/usr/sbin/tcpdump', args };
  }
  if (platform === 'linux') {
    return { command: 'tcpdump', args };
  }
  return undefined;
}

/**
 * Gets whether tcpdump's complaint means it lacks permission to capture, which the user can grant,
 * rather than anything wrong with the request.
 * @param message What tcpdump wrote to its error stream.
 * @returns Returns true when the failure is one of permission.
 */
export function isPermissionError(message: string): boolean {
  return /permission|operation not permitted|cannot open bpf|you don't have permission/i.test(
    message,
  );
}
