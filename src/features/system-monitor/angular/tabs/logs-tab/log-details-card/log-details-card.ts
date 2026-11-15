import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { Chip, ChipTone } from '@shared/angular/components/chip/chip';
import { Icon } from '@shared/angular/icons/icon';
import { LogRecord } from '@shared/api/log-channels';
import { DashboardCard } from '../../dashboard-card/dashboard-card';
import { describeOrigin, formatLogTimestamp, SEVERITY_TONES } from '../log-format';

/**
 * Describes the facts shown about the chosen record.
 */
interface LogFacts {
  /**
   * Gets the record.
   */
  readonly record: LogRecord;

  /**
   * Gets its date and time, to the millisecond.
   */
  readonly timestamp: string;

  /**
   * Gets its severity, as its chip reads.
   */
  readonly level: string;

  /**
   * Gets its severity's tone.
   */
  readonly tone: ChipTone;

  /**
   * Gets where it came from.
   */
  readonly origin: string;
}

/**
 * Represents the Logs view's Log Details card: the chosen record's time, level, component, origin and
 * session, and its whole message, which can be selected and copied.
 */
@Component({
  selector: 'app-system-monitor-log-details-card',
  imports: [Chip, DashboardCard],
  templateUrl: './log-details-card.html',
  styleUrl: './log-details-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogDetailsCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the record chosen, or null when none is.
   */
  public readonly record: InputSignal<LogRecord | null> = input<LogRecord | null>(null);

  /**
   * Gets the session the record belongs to, in words.
   */
  public readonly session: InputSignal<string> = input<string>('');

  /**
   * Gets the chosen record's facts, or null when none is chosen.
   */
  protected readonly facts: Signal<LogFacts | null> = computed((): LogFacts | null => {
    const record: LogRecord | null = this.record();
    return record === null
      ? null
      : {
          record,
          timestamp: formatLogTimestamp(record.timestamp),
          level: record.severity.toUpperCase(),
          tone: SEVERITY_TONES[record.severity],
          origin: describeOrigin(record),
        };
  });
}
