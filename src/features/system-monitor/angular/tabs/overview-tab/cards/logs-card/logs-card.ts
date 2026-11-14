import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import { Chip, ChipTone } from '@shared/angular/components/chip/chip';
import { Icon } from '@shared/angular/icons/icon';
import { LogRecord, Severity } from '@shared/api/log-channels';
import { DashboardBadge } from '../../dashboard-badge/dashboard-badge';
import { DashboardCard } from '../../dashboard-card/dashboard-card';
import { LogsOverview } from '../../logs-overview';

/**
 * Each severity's tone, matching the Logs view's chips.
 */
const TONES: Readonly<Record<Severity, ChipTone>> = {
  trace: 'neutral',
  debug: 'neutral',
  info: 'info',
  warning: 'warning',
  error: 'danger',
};

/**
 * Describes the head's counts, formatted.
 */
interface LogCounts {
  /**
   * Gets the informational records counted.
   */
  readonly info: string;

  /**
   * Gets the warnings counted.
   */
  readonly warnings: string;

  /**
   * Gets the errors counted.
   */
  readonly errors: string;
}

/**
 * Describes one record's row.
 */
interface LogRow {
  /**
   * Gets the record's id.
   */
  readonly id: number;

  /**
   * Gets when it was recorded, as a local time.
   */
  readonly time: string;

  /**
   * Gets its severity, as the chip shows it.
   */
  readonly level: string;

  /**
   * Gets its severity's tone.
   */
  readonly tone: ChipTone;

  /**
   * Gets its message.
   */
  readonly message: string;
}

/**
 * Represents the Overview's Logs card: the session's informational records, warnings and errors
 * counted, and its latest records.
 */
@Component({
  selector: 'app-system-monitor-logs-card',
  imports: [DashboardCard, DashboardBadge, Chip],
  templateUrl: './logs-card.html',
  styleUrl: './logs-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogsCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the logs at a glance.
   */
  public readonly logs: InputSignal<LogsOverview> = input.required<LogsOverview>();

  /**
   * Gets the counts the head shows, formatted.
   */
  protected readonly counts: Signal<LogCounts> = computed((): LogCounts => {
    const logs: LogsOverview = this.logs();
    return { info: `${logs.info}`, warnings: `${logs.warnings}`, errors: `${logs.errors}` };
  });

  /**
   * Gets the latest records' rows.
   */
  protected readonly rows: Signal<readonly LogRow[]> = computed((): readonly LogRow[] =>
    this.logs().recent.map((record: LogRecord): LogRow => {
      const date: Date = new Date(record.timestamp);
      return {
        id: record.id,
        time: Number.isNaN(date.getTime()) ? record.timestamp : date.toLocaleTimeString(),
        level: record.severity.toUpperCase(),
        tone: TONES[record.severity],
        message: record.message,
      };
    }),
  );

  /**
   * Emits when the user asks for the Logs view.
   */
  public readonly details: OutputEmitterRef<void> = output<void>();
}
