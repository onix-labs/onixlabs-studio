import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { CpuCard } from './cards/cpu-card/cpu-card';
import { GpuCard } from './cards/gpu-card/gpu-card';
import { LogsCard } from './cards/logs-card/logs-card';
import { MemoryCard } from './cards/memory-card/memory-card';
import { NetworkCard } from './cards/network-card/network-card';
import { ProcessesCard } from './cards/processes-card/processes-card';
import { StorageCard } from './cards/storage-card/storage-card';
import { SystemCard } from './cards/system-card/system-card';
import { LogsOverview } from './logs-overview';

/**
 * Represents the System Monitor's Overview: a dashboard of eight cards, each the gist of a view the
 * ribbon's View group opens in full. The live resources lead — CPU, Memory, GPU and Network — and the
 * slower-moving ones follow: Storage, Processes, System and Logs. The cards read the monitor's shared
 * readings and process listing; the logs and the session's start come from the monitor, which owns
 * them.
 */
@Component({
  selector: 'app-system-monitor-overview-tab',
  imports: [
    CpuCard,
    MemoryCard,
    GpuCard,
    ProcessesCard,
    StorageCard,
    NetworkCard,
    SystemCard,
    LogsCard,
  ],
  templateUrl: './overview-tab.html',
  styleUrl: './overview-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverviewTab {
  /**
   * Gets the logs at a glance, for the Logs card.
   */
  public readonly logs: InputSignal<LogsOverview> = input.required<LogsOverview>();

  /**
   * Gets when the current logging session started, or null when unknown, for the System card.
   */
  public readonly sessionStartedAt: InputSignal<string | null> = input<string | null>(null);
}
