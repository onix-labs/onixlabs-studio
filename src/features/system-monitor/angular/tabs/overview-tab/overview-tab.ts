import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { SystemMonitorTabId } from '../system-monitor-tab-id';
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
 * Represents the System Monitor's Overview: a dashboard of eight cards — CPU, Memory, GPU, Processes,
 * Storage, Network, System and Logs — each the gist of its view, with a link to the view in full. The
 * cards read the monitor's shared readings and process listing; the logs and the session's start come
 * from the monitor, which owns them.
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
   * Gets the view identities, exposed for the template.
   */
  protected readonly Tab: typeof SystemMonitorTabId = SystemMonitorTabId;

  /**
   * Gets the logs at a glance, for the Logs card.
   */
  public readonly logs: InputSignal<LogsOverview> = input.required<LogsOverview>();

  /**
   * Gets when the current logging session started, or null when unknown, for the System card.
   */
  public readonly sessionStartedAt: InputSignal<string | null> = input<string | null>(null);

  /**
   * Emits the view a card asks to open.
   */
  public readonly open: OutputEmitterRef<SystemMonitorTabId> = output<SystemMonitorTabId>();
}
