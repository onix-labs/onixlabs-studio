import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { GpuProcessReading, GpuReading, ProcessSample } from '@shared/api/system-monitor-channels';
import { formatBytes, formatShare } from '../../../readings/format';
import { SystemMonitorGpu } from '../../../readings/system-monitor-gpu';
import { SystemMonitorProcesses } from '../../../readings/system-monitor-processes';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * Describes one process's row.
 */
interface GpuProcessRow {
  /**
   * Gets the process's pid.
   */
  readonly pid: number;

  /**
   * Gets the process's name.
   */
  readonly name: string;

  /**
   * Gets its share of the GPU, formatted, or a placeholder.
   */
  readonly gpu: string;

  /**
   * Gets its video memory, formatted, or a placeholder.
   */
  readonly memory: string;

  /**
   * Gets its share of the encoder, formatted, or a placeholder.
   */
  readonly encoder: string;

  /**
   * Gets its share of the decoder, formatted, or a placeholder.
   */
  readonly decoder: string;
}

/**
 * Describes which columns the platform's readings fill.
 */
interface GpuProcessColumns {
  /**
   * Gets whether any process has a GPU share.
   */
  readonly gpu: boolean;

  /**
   * Gets whether any process has video memory.
   */
  readonly memory: boolean;

  /**
   * Gets whether any process has an encoder or decoder share.
   */
  readonly codec: boolean;
}

/**
 * Formats a share, or a placeholder where it was not read.
 * @param percent The share.
 * @returns Returns the formatted share.
 */
function share(percent: number | undefined): string {
  return percent === undefined ? '—' : formatShare(percent);
}

/**
 * Represents the GPU view's processes card: the processes using the GPU, busiest first, with what the
 * platform reports of each — its share of the GPU, its video memory, its share of the video encoder and
 * decoder. A column no process has a reading for is left out. Names the reading lacks (Windows' counters
 * carry only pids) come from the process listing.
 */
@Component({
  selector: 'app-system-monitor-gpu-processes-card',
  imports: [DashboardCard],
  templateUrl: './gpu-processes-card.html',
  styleUrl: './gpu-processes-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GpuProcessesCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's GPU readings.
   */
  private readonly gpu: SystemMonitorGpu = inject(SystemMonitorGpu);

  /**
   * Gets the view's process listing, for names.
   */
  private readonly listing: SystemMonitorProcesses = inject(SystemMonitorProcesses);

  /**
   * Gets the processes using the GPU in the latest reading.
   */
  private readonly processes: Signal<readonly GpuProcessReading[]> = computed(
    (): readonly GpuProcessReading[] => this.gpu.latest()?.processes ?? [],
  );

  /**
   * Gets which columns the readings fill.
   */
  protected readonly columns: Signal<GpuProcessColumns> = computed((): GpuProcessColumns => {
    const processes: readonly GpuProcessReading[] = this.processes();
    return {
      gpu: processes.some(
        (process: GpuProcessReading): boolean => process.gpuPercent !== undefined,
      ),
      memory: processes.some(
        (process: GpuProcessReading): boolean => process.memoryBytes !== undefined,
      ),
      codec: processes.some(
        (process: GpuProcessReading): boolean =>
          process.encoderPercent !== undefined || process.decoderPercent !== undefined,
      ),
    };
  });

  /**
   * Gets whether a reading has arrived.
   */
  protected readonly read: Signal<boolean> = computed((): boolean => this.gpu.latest() !== null);

  /**
   * Gets the rows, busiest first.
   */
  protected readonly rows: Signal<readonly GpuProcessRow[]> = computed(
    (): readonly GpuProcessRow[] => {
      const reading: GpuReading | null = this.gpu.latest();
      const names: Map<number, string> = new Map<number, string>(
        this.listing
          .processes()
          .map((process: ProcessSample): [number, string] => [process.pid, process.name]),
      );
      return (reading?.processes ?? []).map((process: GpuProcessReading): GpuProcessRow => ({
        pid: process.pid,
        name: process.name ?? names.get(process.pid) ?? `PID ${process.pid}`,
        gpu: share(process.gpuPercent),
        memory: process.memoryBytes === undefined ? '—' : formatBytes(process.memoryBytes),
        encoder: share(process.encoderPercent),
        decoder: share(process.decoderPercent),
      }));
    },
  );
}
