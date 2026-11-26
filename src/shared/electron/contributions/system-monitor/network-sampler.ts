import { NetworkInterfaceReading } from '@shared/api/system-monitor-channels';
import { GpuSources } from './gpu-sampler';
import {
  interfaceReading,
  NetworkCounters,
  parseNetstatInterfaces,
  parseProcNetDev,
  parseWindowsAdapters,
  WindowsAdapterStatistics,
} from './network-readers';

/**
 * What a network sampler reads the machine through: commands, files and the clock — the same as a GPU
 * sampler's.
 */
export type NetworkSources = GpuSources;

/**
 * The PowerShell that reads Windows's adapters' statistics.
 */
export const WINDOWS_ADAPTERS_COMMAND: string =
  'Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes,ReceivedUnicastPackets,ReceivedMulticastPackets,ReceivedBroadcastPackets,SentUnicastPackets,SentMulticastPackets,SentBroadcastPackets,ReceivedPacketErrors,OutboundPacketErrors,ReceivedDiscardedPackets,OutboundDiscardedPackets | ConvertTo-Json -Compress';

/**
 * Reads the machine's network interfaces' activity: each interface's cumulative counters, turned into
 * rates against the previous reading.
 *
 * - macOS: `netstat -ibnd`.
 * - Linux: `/proc/net/dev`.
 * - Windows: `Get-NetAdapterStatistics`.
 *
 * The first reading has nothing to compare with, so its rates read 0.
 */
export class NetworkSampler {
  /**
   * Holds each interface's counters at the last reading.
   */
  private previous: ReadonlyMap<string, NetworkCounters> = new Map<string, NetworkCounters>();

  /**
   * Holds when the last reading was taken, in milliseconds, or 0 before the first.
   */
  private previousAt: number = 0;

  /**
   * Initializes a new instance of the {@link NetworkSampler} class.
   * @param sources What the sampler reads the machine through.
   */
  public constructor(private readonly sources: NetworkSources) {}

  /**
   * Takes a reading of every interface.
   * @returns Returns each interface's activity; none where the counters cannot be read.
   */
  public async read(): Promise<readonly NetworkInterfaceReading[]> {
    const counters: ReadonlyMap<string, NetworkCounters> = await this.counters();
    const now: number = this.sources.now();
    const elapsedMs: number = this.previousAt === 0 ? 0 : now - this.previousAt;
    const readings: readonly NetworkInterfaceReading[] = [...counters].map(
      ([id, current]: [string, NetworkCounters]): NetworkInterfaceReading =>
        interfaceReading(id, current, this.previous.get(id), elapsedMs),
    );
    if (counters.size > 0) {
      this.previous = counters;
      this.previousAt = now;
    }
    return readings;
  }

  /**
   * Reads each interface's counters.
   * @returns Returns the counters, by interface; empty where they cannot be read.
   */
  private async counters(): Promise<ReadonlyMap<string, NetworkCounters>> {
    try {
      switch (this.sources.platform) {
        case 'darwin':
          return parseNetstatInterfaces(await this.sources.run('netstat', ['-ibnd']));
        case 'linux':
          return parseProcNetDev(await this.sources.readFile('/proc/net/dev'));
        case 'win32':
          return parseWindowsAdapters(
            JSON.parse(
              await this.sources.run('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                WINDOWS_ADAPTERS_COMMAND,
              ]),
            ) as WindowsAdapterStatistics | WindowsAdapterStatistics[],
          );
        default:
          return new Map<string, NetworkCounters>();
      }
    } catch {
      return new Map<string, NetworkCounters>();
    }
  }
}
