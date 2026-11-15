import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { ProcessSample } from '@shared/api/system-monitor-channels';
import { formatBytes, formatShare } from '../../../readings/format';
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
   * Gets the resident memory, formatted.
   */
  readonly memory: string;

  /**
   * Gets the share of physical memory, formatted.
   */
  readonly share: string;
}

/**
 * Represents the Memory view's processes card: the five processes holding the most memory, with each
 * one's share of the machine's.
 */
@Component({
  selector: 'app-system-monitor-memory-processes-card',
  imports: [DashboardCard],
  templateUrl: './memory-processes-card.html',
  styleUrl: './memory-processes-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemoryProcessesCard {
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
   * Gets the processes holding the most memory.
   */
  protected readonly rows: Signal<readonly ProcessRow[]> = computed((): readonly ProcessRow[] =>
    [...this.listing.processes()]
      .sort((a: ProcessSample, b: ProcessSample): number => b.memoryBytes - a.memoryBytes)
      .slice(0, SHOWN)
      .map((process: ProcessSample): ProcessRow => ({
        pid: process.pid,
        name: process.name,
        command: process.command,
        memory: formatBytes(process.memoryBytes),
        share: formatShare(process.memoryPercent),
      })),
  );
}
