import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { MetricsSample, SystemInfo } from '@shared/api/system-monitor-channels';
import { formatBytes } from '../../readings/format';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';

/**
 * Describes one fact about the machine.
 */
interface SystemFact {
  /**
   * Gets the fact's icon.
   */
  readonly icon: Icon;

  /**
   * Gets the fact's label.
   */
  readonly label: string;

  /**
   * Gets the fact's value.
   */
  readonly value: string;
}

/**
 * Formats a span of time as a clock, with days ahead of it once there are any (`3d 04:12:09`).
 * @param ms The span, in milliseconds.
 * @returns Returns the formatted span.
 */
function formatSpan(ms: number): string {
  const total: number = Math.max(0, Math.floor(ms / 1000));
  const days: number = Math.floor(total / 86_400);
  const clock: string = [
    Math.floor((total % 86_400) / 3600),
    Math.floor((total % 3600) / 60),
    total % 60,
  ]
    .map((part: number): string => `${part}`.padStart(2, '0'))
    .join(':');
  return days > 0 ? `${days}d ${clock}` : clock;
}

/**
 * Represents the machine's facts: its operating system, processor, cores, memory, how long it has been
 * up, and when the logging session started. Shared by the Overview's System card and the System view.
 */
@Component({
  selector: 'app-system-monitor-system-facts',
  imports: [AppIcon],
  templateUrl: './system-facts.html',
  styleUrl: './system-facts.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SystemFacts {
  /**
   * Gets when the current logging session started, as an ISO-8601 timestamp, or null when unknown.
   */
  public readonly sessionStartedAt: InputSignal<string | null> = input<string | null>(null);

  /**
   * Gets the view's readings.
   */
  private readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Gets the machine's facts, each a placeholder until it is known. Uptime is measured to the latest
   * sample, so it advances with the readings rather than on a timer of its own.
   */
  protected readonly facts: Signal<readonly SystemFact[]> = computed((): readonly SystemFact[] => {
    const info: SystemInfo | null = this.readings.info();
    const sample: MetricsSample | null = this.readings.latest();
    const started: string | null = this.sessionStartedAt();
    const startedAt: Date | null = started === null ? null : new Date(started);
    const physical: string = info?.physicalCores === undefined ? '—' : `${info.physicalCores}`;
    return [
      { icon: Icon.MONITOR_OS, label: 'Operating System', value: info?.os ?? '—' },
      { icon: Icon.MONITOR_CPU, label: 'Processor', value: info?.cpuModel ?? '—' },
      {
        icon: Icon.MONITOR_PROCESSES,
        label: 'Cores (Physical / Logical)',
        value: info === null ? '—' : `${physical} / ${info.logicalCores}`,
      },
      {
        icon: Icon.MONITOR_MEMORY,
        label: 'Memory',
        value: info === null ? '—' : formatBytes(info.totalMemoryBytes),
      },
      {
        icon: Icon.MONITOR_UPTIME,
        label: 'Uptime',
        value:
          info?.bootTime === undefined || sample === null
            ? '—'
            : formatSpan(Date.parse(sample.timestamp) - info.bootTime),
      },
      {
        icon: Icon.MONITOR_SESSION,
        label: 'Current Session',
        value:
          startedAt === null || Number.isNaN(startedAt.getTime())
            ? '—'
            : startedAt.toLocaleString(),
      },
    ];
  });
}
