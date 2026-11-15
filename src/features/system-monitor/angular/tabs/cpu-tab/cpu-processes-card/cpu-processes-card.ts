import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { ProcessSample } from '@shared/api/system-monitor-channels';
import { formatBytes, formatDuration, formatShare } from '../../../readings/format';
import { SystemMonitorProcesses } from '../../../readings/system-monitor-processes';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * The number of processes the card lists.
 */
const SHOWN: number = 5;

/**
 * Describes one process's row.
 */
interface ProcessRow {
  /**
   * Gets the process's pid.
   */
  readonly pid: number;

  /**
   * Gets the process's name.
   */
  readonly name: string;

  /**
   * Gets the process's command, for its tooltip.
   */
  readonly command: string;

  /**
   * Gets the CPU share, formatted.
   */
  readonly cpu: string;

  /**
   * Gets the thread count, or a placeholder where it could not be read.
   */
  readonly threads: string;

  /**
   * Gets the CPU time used, formatted, or a placeholder where it could not be read.
   */
  readonly cpuTime: string;

  /**
   * Gets the resident memory, formatted.
   */
  readonly memory: string;
}

/**
 * Represents the CPU view's processes card: the five processes using the most CPU, with their thread
 * counts and the CPU time each has used since it started.
 */
@Component({
  selector: 'app-system-monitor-cpu-processes-card',
  imports: [DashboardCard],
  templateUrl: './cpu-processes-card.html',
  styleUrl: './cpu-processes-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CpuProcessesCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's process listing.
   */
  private readonly listing: SystemMonitorProcesses = inject(SystemMonitorProcesses);

  /**
   * Gets whether a listing has arrived.
   */
  protected readonly listed: Signal<boolean> = computed(
    (): boolean => this.listing.snapshot() !== null,
  );

  /**
   * Gets the busiest processes' rows, by CPU.
   */
  protected readonly rows: Signal<readonly ProcessRow[]> = computed((): readonly ProcessRow[] =>
    [...this.listing.processes()]
      .sort((a: ProcessSample, b: ProcessSample): number => b.cpuPercent - a.cpuPercent)
      .slice(0, SHOWN)
      .map((process: ProcessSample): ProcessRow => ({
        pid: process.pid,
        name: process.name,
        command: process.command,
        cpu: formatShare(process.cpuPercent),
        threads: process.threads === undefined ? '—' : `${process.threads}`,
        cpuTime:
          process.cpuTimeSeconds === undefined ? '—' : formatDuration(process.cpuTimeSeconds),
        memory: formatBytes(process.memoryBytes),
      })),
  );
}
