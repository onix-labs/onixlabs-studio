import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { ProcessesSnapshot, ProcessSample } from '@shared/api/system-monitor-channels';
import { formatBytes, formatShare } from '../../../../readings/format';
import { SystemMonitorProcesses } from '../../../../readings/system-monitor-processes';
import { DashboardBadge } from '../../dashboard-badge/dashboard-badge';
import { DashboardCard } from '../../dashboard-card/dashboard-card';

/**
 * The number of processes the card lists.
 */
const SHOWN: number = 5;

/**
 * The shells, whose processes are marked with a terminal rather than a window.
 */
const SHELLS: ReadonlySet<string> = new Set<string>([
  'sh',
  'bash',
  'zsh',
  'fish',
  'dash',
  'ksh',
  'pwsh',
  'powershell',
  'cmd',
  'nu',
]);

/**
 * Describes one listed process's row.
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
   * Gets the icon marking what kind of process it is.
   */
  readonly icon: Icon;

  /**
   * Gets the CPU share, formatted.
   */
  readonly cpu: string;

  /**
   * Gets the resident memory, formatted.
   */
  readonly memory: string;
}

/**
 * Represents the Overview's Processes card: how many processes are running, and the five busiest.
 */
@Component({
  selector: 'app-system-monitor-processes-card',
  imports: [DashboardCard, DashboardBadge, AppIcon],
  templateUrl: './processes-card.html',
  styleUrl: './processes-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProcessesCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's process listing.
   */
  private readonly listing: SystemMonitorProcesses = inject(SystemMonitorProcesses);

  /**
   * Gets the number of processes running, or a placeholder before the first listing.
   */
  protected readonly total: Signal<string> = computed((): string => {
    const snapshot: ProcessesSnapshot | null = this.listing.snapshot();
    return snapshot === null ? '—' : `${snapshot.total}`;
  });

  /**
   * Gets whether a listing has arrived.
   */
  protected readonly listed: Signal<boolean> = computed(
    (): boolean => this.listing.snapshot() !== null,
  );

  /**
   * Gets the busiest processes' rows; the listing already comes busiest first.
   */
  protected readonly rows: Signal<readonly ProcessRow[]> = computed((): readonly ProcessRow[] =>
    this.listing
      .processes()
      .slice(0, SHOWN)
      .map((process: ProcessSample): ProcessRow => ({
        pid: process.pid,
        name: process.name,
        command: process.command,
        icon: SHELLS.has(process.name.toLowerCase().replace(/\.exe$/, ''))
          ? Icon.MONITOR_SHELL
          : Icon.MONITOR_PROCESS,
        cpu: formatShare(process.cpuPercent),
        memory: formatBytes(process.memoryBytes),
      })),
  );
}
